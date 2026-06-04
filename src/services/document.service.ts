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
  runTransaction,
  writeBatch
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { HRDocument, HRDocumentType, DOCUMENT_TYPE_LABELS } from "@/types/hr-document";
import { createAuditLog } from "./audit.service";
import { PreHireDocument } from "@/types/pre-hire-dossier";
import { EmploymentOffer } from "@/types/employment-offer";

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
 * Upserts a document based on a unique sourceKey to prevent duplicates.
 * Standardizes metadata and handles missing fields for reference-only docs.
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

  const payload = sanitizePayload({
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: userId
  });

  if (!snap.empty) {
    const docRef = snap.docs[0].ref;
    await updateDoc(docRef, payload);
    return snap.docs[0].id;
  } else {
    const docRef = doc(docsRef);
    const docId = docRef.id;
    await setDoc(docRef, {
      ...payload,
      id: docId,
      entityId,
      sourceKey,
      status: data.status || "valid",
      version: data.version || 1,
      createdAt: serverTimestamp(),
      createdBy: userId,
    });
    return docId;
  }
}

/**
 * Registers a generated contract PDF in the central documents registry.
 * Mirrors expiry for fixed-term contracts.
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
  contractType?: string | null;
  contractEndDate?: string | null;
  contractStartDate?: string | null;
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
    uploadedByDisplayName: "Système",
    expiresAt: params.contractType === 'Tempo determinato' ? params.contractEndDate : null,
    contractType: params.contractType,
    contractStartDate: params.contractStartDate,
    contractEndDate: params.contractEndDate
  };

  return await upsertDocumentBySourceKey(entityId, sourceKey, metadata, generatedPdfBy);
}

/**
 * Registers a signed contract reference/document in the central registry.
 * Mirrors expiry for fixed-term contracts.
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
  contractType?: string | null;
  contractEndDate?: string | null;
  contractStartDate?: string | null;
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
    version: 1,
    uploadedAt: signedDocumentUploadedAt,
    uploadedBy: signedDocumentUploadedBy,
    uploadedByDisplayName: "Utilisateur HR",
    expiresAt: params.contractType === 'Tempo determinato' ? params.contractEndDate : null,
    contractType: params.contractType,
    contractStartDate: params.contractStartDate,
    contractEndDate: params.contractEndDate
  };

  return await upsertDocumentBySourceKey(entityId, sourceKey, metadata, signedDocumentUploadedBy);
}

/**
 * Uploads a file to Firebase Storage and creates an HRDocument record in Firestore.
 */
export async function uploadHRDocument(
  entityId: string, 
  file: File, 
  metadata: Partial<HRDocument>, 
  actorUid: string,
  actorName?: string
) {
  if (!db || !storage) throw new Error("Firebase services not initialized");

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

  const safeFileName = file.name.replace(/\s+/g, '_');
  const storagePath = `entities/${entityId}/documents/${docId}/${safeFileName}`;
  const fileRef = ref(storage, storagePath);
  
  await uploadBytes(fileRef, file);
  
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
    rootDocumentId: metadata.rootDocumentId || docId,
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
 * Specialized upload for pre-hire checklist items.
 * Creates an HRDocument and updates the dossier checklist item atomically.
 */
export async function uploadPreHireDocument(params: {
  entityId: string;
  dossierId: string;
  item: PreHireDocument;
  file: File;
  offer: EmploymentOffer;
  actorUid: string;
  actorName?: string;
  expiresAt?: string;
}) {
  const { entityId, dossierId, item, file, offer, actorUid, actorName, expiresAt } = params;
  if (!db || !storage) throw new Error("Firebase services not initialized");

  // 1. Storage Upload
  const docRef = doc(collection(db, `entities/${entityId}/documents`));
  const docId = docRef.id;
  const extension = file.name.split('.').pop() || 'bin';
  const timestamp = Date.now();
  const storagePath = `entities/${entityId}/documents/${docId}/${item.type}_${timestamp}.${extension}`;
  const fileRef = ref(storage, storagePath);
  
  await uploadBytes(fileRef, file);

  // 2. Metadata Preparation
  const now = serverTimestamp();
  const sensitiveTypes = ["id_card", "tax_code", "iban", "residence", "residence_permit"];
  const isSensitive = sensitiveTypes.includes(item.type) || item.label.toLowerCase().includes("iban");

  const docData = {
    id: docId,
    entityId,
    title: item.label,
    documentType: "prehire_required_document",
    status: "valid",
    storagePath,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    
    personId: offer.personId || null,
    candidateId: offer.candidateId || null,
    employmentOfferId: offer.offerId,
    preHireDossierId: dossierId,
    checklistItemId: item.itemId,
    relatedModule: "preHireDossiers",
    relatedId: dossierId,
    
    version: 1,
    isSensitive,
    isRequired: true,
    expiresAt: expiresAt || undefined,
    
    uploadedAt: now,
    uploadedBy: actorUid,
    uploadedByDisplayName: actorName || null,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid
  };

  // 3. Atomic update
  const batch = writeBatch(db);
  
  batch.set(docRef, sanitizePayload(docData));

  const itemRef = doc(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`, item.itemId);
  batch.update(itemRef, sanitizePayload({
    fileId: docId,
    documentId: docId,
    fileName: file.name,
    status: "uploaded",
    expiresAt: expiresAt || undefined,
    uploadedAt: now,
    uploadedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid
  }));

  await batch.commit();

  // 4. Audit Log
  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "document.uploaded",
      resourceType: "document",
      resourceId: docId,
      details: { checklistItemId: item.itemId, offerId: offer.offerId, context: "pre-hire" }
    });
  } catch (e) {
    console.warn("[Audit] Failed to log pre-hire doc upload:", e);
  }

  return docId;
}

/**
 * Replaces an existing HR document with a new version.
 * Atomic transaction to maintain history links.
 */
export async function replaceHRDocument(
  entityId: string,
  oldDocumentId: string,
  file: File,
  actorUid: string,
  replacementReason: string,
  metadata: Partial<HRDocument>,
  actorName?: string
) {
  if (!db || !storage) throw new Error("Firebase services not initialized");

  // 1. Get old document
  const oldDocRef = doc(db, `entities/${entityId}/documents`, oldDocumentId);
  const oldDocSnap = await getDoc(oldDocRef);
  if (!oldDocSnap.exists()) throw new Error("Document d'origine introuvable.");
  const oldDoc = oldDocSnap.data() as HRDocument;

  if (oldDoc.status === "replaced" || oldDoc.status === "archived") {
    throw new Error("Ce document a déjà été remplacé ou archivé.");
  }

  // 2. Upload new file
  const newDocId = doc(collection(db, `entities/${entityId}/documents`)).id;
  const safeFileName = file.name.replace(/\s+/g, '_');
  const storagePath = `entities/${entityId}/documents/${newDocId}/${safeFileName}`;
  const fileRef = ref(storage, storagePath);
  
  await uploadBytes(fileRef, file);

  // 3. Atomic Transaction
  return await runTransaction(db, async (transaction) => {
    const newDocRef = doc(db, `entities/${entityId}/documents`, newDocId);
    const now = serverTimestamp();
    const version = (oldDoc.version || 1) + 1;
    const rootId = oldDoc.rootDocumentId || oldDoc.id;

    const newDocData: HRDocument = {
      ...oldDoc, // Copy links
      ...(metadata as any), // Override with new metadata (like expiry)
      id: newDocId,
      entityId,
      status: "valid",
      storagePath,
      fileName: safeFileName,
      mimeType: file.type,
      sizeBytes: file.size,
      version,
      replacesId: oldDocumentId,
      replacedById: null,
      rootDocumentId: rootId,
      replacementReason,
      uploadedAt: now,
      uploadedBy: actorUid,
      uploadedByDisplayName: actorName || actorUid,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
      sourceKey: null, // Clear source key for versions to allow history
    };

    // Create new doc
    transaction.set(newDocRef, sanitizePayload(newDocData));

    // Update old doc
    transaction.update(oldDocRef, {
      status: "replaced",
      replacedById: newDocId,
      replacedAt: now,
      replacedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid
    });

    // Timeline event
    if (oldDoc.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId: oldDoc.personId,
        type: "document.replaced",
        label: `Document renouvelé : ${DOCUMENT_TYPE_LABELS[oldDoc.documentType] || oldDoc.documentType}`,
        description: `Remplacement de "${oldDoc.title}" par une nouvelle version. Motif : ${replacementReason}`,
        sourceCollection: "documents",
        sourceId: newDocId,
        createdAt: now,
        createdBy: actorUid,
      });
    }

    return newDocId;
  }).then(async (id) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "document.replaced",
      resourceType: "document",
      resourceId: id,
      details: { oldId: oldDocumentId, reason: replacementReason }
    });
    return id;
  });
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
