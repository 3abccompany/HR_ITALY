import { db, storage } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  serverTimestamp,
  where,
  deleteDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, getMetadata } from "firebase/storage";
import { HRDocument, HRDocumentStatus } from "@/types/hr-document";
import { createAuditLog } from "./audit.service";

/**
 * Normalizes payload for Firestore
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

/**
 * Uploads a file to Firebase Storage and creates an HRDocument record in Firestore.
 * Path: entities/{entityId}/documents/{documentId}/{fileName}
 */
export async function uploadHRDocument(
  entityId: string, 
  file: File, 
  metadata: Partial<HRDocument>, 
  actorUid: string,
  actorName?: string
) {
  if (!db || !storage) throw new Error("Firebase services not initialized");

  // Basic File Validation
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || extension === file.name.toLowerCase()) {
    throw new Error("Le fichier doit avoir une extension valide (ex: .pdf).");
  }

  const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  if (!allowedMimeTypes.includes(file.type)) {
    throw new Error("Format de fichier non supporté. Veuillez utiliser PDF, PNG ou JPEG.");
  }

  const docRef = doc(collection(db, `entities/${entityId}/documents`));
  const docId = docRef.id;

  // 1. Upload to Storage using the required structured path
  // Path: entities/{entityId}/documents/{documentId}/{fileName}
  const safeFileName = file.name.replace(/\s+/g, '_');
  const storagePath = `entities/${entityId}/documents/${docId}/${safeFileName}`;
  const fileRef = ref(storage, storagePath);
  
  await uploadBytes(fileRef, file);
  
  // 2. Prepare Firestore Record
  const docData: HRDocument = {
    ...(metadata as any),
    id: docId,
    entityId,
    status: metadata.status || "valid",
    storagePath,
    fileName: safeFileName,
    mimeType: file.type,
    sizeBytes: file.size,
    version: metadata.version || 1,
    isSensitive: metadata.isSensitive ?? false,
    isRequired: metadata.isRequired ?? true,
    uploadedAt: serverTimestamp(),
    uploadedBy: actorUid,
    uploadedByDisplayName: actorName || actorUid,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(docRef, sanitizePayload(docData));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "document.uploaded",
    resourceType: "document",
    resourceId: docId,
    details: { title: docData.title, type: docData.documentType }
  });

  return docId;
}

/**
 * Archives a document by updating its status.
 */
export async function archiveHRDocument(entityId: string, documentId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const docRef = doc(db, `entities/${entityId}/documents`, documentId);
  await updateDoc(docRef, {
    status: "archived",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "document.archived",
    resourceType: "document",
    resourceId: documentId,
  });
}

/**
 * Generates a short-lived download URL from a storage path.
 */
export async function getDocumentDownloadUrl(storagePath: string) {
  if (!storage) throw new Error("Storage not initialized");
  const fileRef = ref(storage, storagePath);
  return await getDownloadURL(fileRef);
}

/**
 * Lists all documents for an entity.
 */
export async function listEntityDocuments(entityId: string) {
  if (!db) return [];
  const q = query(collection(db, `entities/${entityId}/documents`), orderBy("uploadedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as HRDocument));
}
