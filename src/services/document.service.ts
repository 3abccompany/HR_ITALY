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
  limit,
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
 * Upserts a document based on a unique source key to prevent duplicates.
 */
export async function upsertDocumentBySourceKey(
  entityId: string, 
  sourceKey: string, 
  data: Partial<HRDocument>, 
  userId: string
) {
  if (!db) throw new Error("Firestore not initialized");
  
  const docsRef = collection(db, `entities/${entityId}/documents`);
  const q = query(docsRef, where("sourceKey", "==", sourceKey), limit(1));
  const snap = await getDocs(q);

  if (!snap.empty) {
    const docRef = snap.docs[0].ref;
    await updateDoc(docRef, sanitizePayload({
      ...data,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }));
    return snap.docs[0].id;
  } else {
    const docRef = doc(docsRef);
    const docId = docRef.id;
    await setDoc(docRef, sanitizePayload({
      ...data,
      id: docId,
      entityId,
      sourceKey,
      status: data.status || "valid",
      createdAt: serverTimestamp(),
      createdBy: userId,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }));
    return docId;
  }
}

/**
 * Registers a generated contract PDF in the central documents registry.
 */
export async function registerGeneratedContractPdf(params: {
  entityId: string;
  contractId: string;
  employeeId: string;
  personId: string;
  employeeDisplayName: string;
  generatedPdfStoragePath: string;
  generatedPdfFileName: string;
  generatedPdfVersion: number;
  generatedPdfAt: any;
  generatedPdfBy: string;
}) {
  const { entityId, contractId, employeeId, personId, employeeDisplayName, generatedPdfStoragePath, generatedPdfFileName, generatedPdfVersion, generatedPdfAt, generatedPdfBy } = params;

  const sourceKey = `contract:${contractId}:generated_pdf:v${generatedPdfVersion}`;
  const title = `PDF contrat généré - ${employeeDisplayName} (V${generatedPdfVersion})`;

  const metadata: Partial<HRDocument> = {
    title,
    documentType: "generated_contract_pdf",
    status: "valid",
    relatedModule: "contracts",
    relatedId: contractId,
    contractId,
    employeeId,
    personId,
    employeeDisplayName,
    fileName: generatedPdfFileName,
    mimeType: "application/pdf",
    storagePath: generatedPdfStoragePath,
    source: "contract_pdf_generation",
    version: generatedPdfVersion,
    generatedAt: generatedPdfAt,
    generatedBy: generatedPdfBy,
    isSensitive: true,
    isRequired: true,
    uploadedAt: generatedPdfAt,
    uploadedBy: generatedPdfBy,
    uploadedByDisplayName: "Système"
  };

  return await upsertDocumentBySourceKey(entityId, sourceKey, metadata, generatedPdfBy);
}

/**
 * Registers a signed contract reference/document in the central registry.
 */
export async function registerSignedContractDocument(params: {
  entityId: string;
  contractId: string;
  employeeId: string;
  personId: string;
  employeeDisplayName: string;
  signedDocumentTitle: string;
  signedDocumentUrl?: string | null;
  signedDocumentId?: string | null;
  signedDocumentStoragePath?: string | null;
  signedDocumentFileName?: string | null;
  signedDocumentUploadedAt: any;
  signedDocumentUploadedBy: string;
}) {
  const { entityId, contractId, employeeId, personId, employeeDisplayName, signedDocumentTitle, signedDocumentUrl, signedDocumentId, signedDocumentStoragePath, signedDocumentFileName, signedDocumentUploadedAt, signedDocumentUploadedBy } = params;

  const sourceKey = `contract:${contractId}:signed_document`;

  const metadata: Partial<HRDocument> = {
    title: signedDocumentTitle,
    documentType: "signed_contract",
    status: "valid",
    relatedModule: "contracts",
    relatedId: contractId,
    contractId,
    employeeId,
    personId,
    employeeDisplayName,
    fileName: signedDocumentFileName || "Lien externe",
    mimeType: signedDocumentStoragePath ? "application/pdf" : "text/html",
    storagePath: signedDocumentStoragePath || "",
    externalUrl: signedDocumentUrl || null,
    externalReference: signedDocumentId || null,
    source: "signed_contract_reference",
    isSensitive: true,
    isRequired: true,
    uploadedAt: signedDocumentUploadedAt,
    uploadedBy: signedDocumentUploadedBy,
    uploadedByDisplayName: "Utilisateur HR"
  };

  return await upsertDocumentBySourceKey(entityId, sourceKey, metadata, signedDocumentUploadedBy);
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
