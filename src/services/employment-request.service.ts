import { db } from "@/lib/firebase/client";
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
  Timestamp,
} from "firebase/firestore";
import { EmploymentRequest, EmploymentRequestStatus, EmploymentRequestType } from "@/types/employment-request";
import { EmploymentOffer } from "@/types/employment-offer";
import { HRDocument, HRDocumentType } from "@/types/hr-document";
import { createAuditLog } from "./audit.service";
import { replaceHRDocumentWithLinkedUpdates } from "./document.service";

const UNILAV_RECEIPT_REPLACEMENT_TYPES: Partial<Record<EmploymentRequestType, {
  receiptDocumentType: HRDocumentType;
  mandatoryCommunicationType: "UNILAV_ASSUNZIONE" | "UNILAV_PROROGA" | "UNILAV_TRASFORMAZIONE";
}>> = {
  unilav: {
    receiptDocumentType: "cpi_receipt",
    mandatoryCommunicationType: "UNILAV_ASSUNZIONE",
  },
  unilav_proroga: {
    receiptDocumentType: "unilav_receipt",
    mandatoryCommunicationType: "UNILAV_PROROGA",
  },
  unilav_trasformazione: {
    receiptDocumentType: "cpi_receipt",
    mandatoryCommunicationType: "UNILAV_TRASFORMAZIONE",
  },
};

/**
 * Normalizes payload for Firestore.
 * Preserves FieldValue and Timestamp instances.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

export async function listEmploymentRequests(entityId: string) {
  if (!db) return [];
  const q = query(
    collection(db, `entities/${entityId}/employmentRequests`), 
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as EmploymentRequest));
}

export async function getEmploymentRequest(entityId: string, requestId: string) {
  if (!db) return null;
  const snap = await getDoc(doc(db, `entities/${entityId}/employmentRequests`, requestId));
  return snap.exists() ? (snap.data() as EmploymentRequest) : null;
}

/**
 * Standalone foundation: Mirror an accepted offer into a new EmploymentRequest record.
 * Duplicate prevention uses deterministic ID: unilav_{offerId}
 */
export async function createEmploymentRequestFromOfferIfMissing(params: {
  entityId: string;
  offer: EmploymentOffer;
  mandatoryCommunicationId?: string | null;
  actorUid: string;
}) {
  const { entityId, offer, mandatoryCommunicationId, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestId = `unilav_${offer.offerId}`;
  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  
  const existing = await getDoc(requestRef);
  if (existing.exists()) {
    return { id: requestId, alreadyExists: true };
  }

  const requestData: EmploymentRequest = {
    id: requestId,
    entityId,
    offerId: offer.offerId,
    personId: offer.personId,
    candidateId: offer.candidateId,
    candidateDisplayName: offer.candidateDisplayName || null,
    candidateEmail: offer.candidateEmail || null,
    candidatePhone: offer.candidatePhone || null,
    employeeId: offer.employeeId || null,
    contractId: offer.contractId || null,
    mandatoryCommunicationId: mandatoryCommunicationId || null,
    
    source: "offer",
    type: "unilav",
    status: "draft",

    plannedHireDate: offer.proposedStartDate || "",
    jobRoleId: offer.jobTitleName || "",
    worksiteId: offer.worksiteId || "",
    contractType: offer.contractType || null,
    
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(requestRef, sanitizePayload(requestData));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentRequest.mirroredFromOffer",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { offerId: offer.offerId }
  });

  return { id: requestId, alreadyExists: false };
}

/**
 * Create a new Proroga (CDD Renewal) UniLav request.
 */
export async function createProrogaRequestForRenewal(params: {
  entityId: string;
  employeeId: string;
  personId: string;
  newContractId: string;
  oldContractId: string;
  candidateDisplayName: string;
  plannedStartDate: string;
  jobRoleId: string;
  worksiteId: string;
  contractType: string;
  actorUid: string;
}) {
  const { entityId, employeeId, personId, newContractId, oldContractId, candidateDisplayName, plannedStartDate, jobRoleId, worksiteId, contractType, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestId = `proroga_${newContractId}`;
  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);

  const requestData: EmploymentRequest = {
    id: requestId,
    entityId,
    personId,
    employeeId,
    contractId: newContractId,
    previousContractId: oldContractId,
    candidateDisplayName,
    
    source: "contract_renewal",
    type: "unilav_proroga",
    status: "draft",

    plannedHireDate: plannedStartDate,
    jobRoleId,
    worksiteId,
    contractType,
    
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(requestRef, sanitizePayload(requestData));
  return requestId;
}

/**
 * Update consultant information on an employment request.
 */
export async function updateConsultantAssignment(params: {
  entityId: string;
  requestId: string;
  consultantId?: string | null;
  consultantName: string;
  consultantEmail: string;
  actorUid: string;
}) {
  const { entityId, requestId, consultantId, consultantName, consultantEmail, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Dossier introuvable.");
  const request = snap.data() as EmploymentRequest;

  if (request.status === "completed" || request.status === "cancelled") {
    throw new Error("Impossible de modifier un dossier clôturé ou annulé.");
  }

  await updateDoc(requestRef, {
    consultantId: consultantId || null,
    consultantName: consultantName.trim(),
    consultantEmail: consultantEmail.trim().toLowerCase(),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentRequest.consultantAssigned",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { consultantName }
  });

  return { success: true };
}

/**
 * Marks a request as transmitted to the consultant.
 */
export async function markAsSentToConsultant(params: {
  entityId: string;
  requestId: string;
  sendMode: "email" | "portal" | "manual" | "draft_only";
  actorUid: string;
}) {
  const { entityId, requestId, sendMode, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Dossier introuvable.");
  const request = snap.data() as EmploymentRequest;

  if (request.status === "completed" || request.status === "cancelled") {
    throw new Error("Action impossible sur un dossier clôturé.");
  }

  if (sendMode !== "manual" && (!request.consultantName || !request.consultantEmail)) {
    throw new Error("Veuillez renseigner le consultant avant l'envoi.");
  }

  const now = serverTimestamp();
  const updateData: Partial<EmploymentRequest> = {
    status: "sent_to_consultant",
    sendMode,
    sentAt: now,
    sentBy: actorUid,
    requestDate: request.requestDate || new Date().toISOString().split('T')[0],
    updatedAt: now,
    updatedBy: actorUid,
  };

  await updateDoc(requestRef, sanitizePayload(updateData));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentRequest.sentToConsultant",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { sendMode }
  });

  return { success: true };
}

/**
 * Records the official CPI communication results and mirrors to legacy if needed.
 */
export async function recordCpiCommunication(params: {
  entityId: string;
  requestId: string;
  cpiCommunicationDate: string;
  protocolCode: string;
  actorUid: string;
}) {
  const { entityId, requestId, cpiCommunicationDate, protocolCode, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Dossier introuvable.");
  const request = snap.data() as EmploymentRequest;

  if (request.status === "completed" || request.status === "cancelled") {
    throw new Error("Dossier clôturé.");
  }

  const now = serverTimestamp();
  
  // 1. Update primary EmploymentRequest record
  await updateDoc(requestRef, sanitizePayload({
    status: "communication_done",
    cpiCommunicationDate,
    protocolCode: protocolCode.trim(),
    updatedAt: now,
    updatedBy: actorUid,
  }));

  // 2. Legacy Mirroring (Non-blocking)
  if (request.mandatoryCommunicationId) {
    try {
      const legacyRef = doc(db, `entities/${entityId}/mandatoryCommunications`, request.mandatoryCommunicationId);
      await updateDoc(legacyRef, {
        protocolNumber: protocolCode.trim(),
        submittedAt: Timestamp.fromDate(new Date(cpiCommunicationDate)),
        status: "receipt_received",
        updatedAt: now,
        updatedBy: actorUid
      });
    } catch (err) {
      console.warn("[Legacy Sync] Failed to update mandatoryCommunication:", err);
    }
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "cpi.communicationRecorded",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { protocolCode }
  });

  return { success: true };
}

/**
 * Links a GED document ID as the official CPI receipt.
 */
export async function linkReceiptToEmploymentRequest(params: {
  entityId: string;
  requestId: string;
  documentId: string;
  actorUid: string;
}) {
  const { entityId, requestId, documentId, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Dossier introuvable.");
  const request = snap.data() as EmploymentRequest;

  if (request.status === "completed" || request.status === "cancelled") {
    throw new Error("Action impossible sur un dossier clôturé.");
  }

  await updateDoc(requestRef, sanitizePayload({
    receiptDocumentId: documentId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "cpi.receiptLinked",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { documentId }
  });

  return { success: true };
}

export async function replaceEmploymentRequestReceipt(params: {
  entityId: string;
  requestId: string;
  currentReceiptDocumentId: string;
  file: File;
  protocolCode: string;
  cpiCommunicationDate: string;
  actorUid: string;
  actorName?: string;
}) {
  const {
    entityId,
    requestId,
    currentReceiptDocumentId,
    file,
    protocolCode,
    cpiCommunicationDate,
    actorUid,
    actorName,
  } = params;

  if (!db) throw new Error("Firestore not initialized");

  if (!file) throw new Error("Nouveau récépissé PDF requis.");
  if (file.type !== "application/pdf") {
    throw new Error("Format invalide. Veuillez envoyer un fichier PDF.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Fichier trop volumineux. Max 10 Mo.");
  }
  if (!protocolCode?.trim() || !cpiCommunicationDate?.trim()) {
    throw new Error("Veuillez renseigner le protocole et la date.");
  }

  const requestRefPath = `entities/${entityId}/employmentRequests/${requestId}`;
  const requestSnap = await getDoc(doc(db, requestRefPath));
  if (!requestSnap.exists()) throw new Error("Dossier introuvable.");
  const request = requestSnap.data() as EmploymentRequest;

  if (request.entityId !== entityId) {
    throw new Error("Le dossier n'appartient pas à cette entité.");
  }
  const replacementConfig = UNILAV_RECEIPT_REPLACEMENT_TYPES[request.type];
  if (!replacementConfig) {
    throw new Error("Le remplacement du récépissé est disponible uniquement pour les communications UniLav prises en charge.");
  }
  if (request.status === "cancelled") {
    throw new Error("Action impossible sur un dossier annulé.");
  }
  if (!request.receiptDocumentId) {
    throw new Error("Aucun récépissé officiel existant à remplacer.");
  }
  if (request.receiptDocumentId !== currentReceiptDocumentId) {
    throw new Error("Le récépissé courant a changé. Rechargez la page avant de réessayer.");
  }

  const receiptRefPath = `entities/${entityId}/documents/${currentReceiptDocumentId}`;
  const receiptSnap = await getDoc(doc(db, receiptRefPath));
  if (!receiptSnap.exists()) throw new Error("Récépissé courant introuvable.");
  const receipt = receiptSnap.data() as HRDocument;

  if (receipt.entityId !== entityId) {
    throw new Error("Le récépissé courant n'appartient pas à cette entité.");
  }
  if (receipt.relatedModule !== "employmentRequests" || receipt.relatedId !== requestId) {
    throw new Error("Le document courant n'est pas lié à ce dossier CPI.");
  }
  if (receipt.documentType !== replacementConfig.receiptDocumentType) {
    throw new Error("Le document courant ne correspond pas au type de récépissé attendu pour cette communication UniLav.");
  }

  const now = serverTimestamp();
  const trimmedProtocol = protocolCode.trim();
  const trimmedDate = cpiCommunicationDate.trim();
  const parsedCommunicationDate = new Date(trimmedDate);
  if (Number.isNaN(parsedCommunicationDate.getTime())) {
    throw new Error("Date de communication invalide.");
  }

  const linkedUpdates: { path: string; data: Record<string, any> }[] = [
    {
      path: requestRefPath,
      data: {
        receiptDocumentId: "__NEW_DOCUMENT_ID__",
        protocolCode: trimmedProtocol,
        cpiCommunicationDate: trimmedDate,
        updatedAt: now,
        updatedBy: actorUid,
      },
    },
  ];

  if (request.mandatoryCommunicationId) {
    const mandatoryCommunicationRefPath = `entities/${entityId}/mandatoryCommunications/${request.mandatoryCommunicationId}`;
    const mandatoryCommunicationSnap = await getDoc(doc(db, mandatoryCommunicationRefPath));
    if (!mandatoryCommunicationSnap.exists()) {
      throw new Error("Communication obligatoire liée introuvable.");
    }
    const mandatoryCommunication = mandatoryCommunicationSnap.data() as any;
    if (mandatoryCommunication.entityId !== entityId) {
      throw new Error("La communication obligatoire liée n'appartient pas à cette entité.");
    }
    if (mandatoryCommunication.type && mandatoryCommunication.type !== replacementConfig.mandatoryCommunicationType) {
      throw new Error("La communication obligatoire liée ne correspond pas au type de ce dossier UniLav.");
    }
    if (
      mandatoryCommunication.employmentRequestId &&
      mandatoryCommunication.employmentRequestId !== requestId
    ) {
      throw new Error("La communication obligatoire liée ne correspond pas à ce dossier.");
    }
    if (
      mandatoryCommunication.employmentOfferId &&
      request.offerId &&
      mandatoryCommunication.employmentOfferId !== request.offerId
    ) {
      throw new Error("La communication obligatoire liée ne correspond pas à l'offre de ce dossier.");
    }

    linkedUpdates.push({
      path: mandatoryCommunicationRefPath,
      data: {
        protocolNumber: trimmedProtocol,
        submittedAt: Timestamp.fromDate(parsedCommunicationDate),
        status: "receipt_received",
        updatedAt: now,
        updatedBy: actorUid,
      },
    });
  }

  const newDocumentId = await replaceHRDocumentWithLinkedUpdates({
    entityId,
    oldDocumentId: currentReceiptDocumentId,
    file,
    actorUid,
    actorName,
    replacementReason: "Correction du récépissé officiel UniLav/CPI",
    metadata: {
      title: `Récépissé ${request.candidateDisplayName || "CPI"} - ${trimmedProtocol}`,
      documentType: replacementConfig.receiptDocumentType,
      relatedModule: "employmentRequests",
      relatedId: requestId,
      personId: request.personId,
      candidateId: request.candidateId,
      employeeId: request.employeeId,
      contractId: request.contractId,
      status: "valid",
    },
    linkedUpdates,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "cpi.receiptReplaced",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: {
      previousReceiptDocumentId: currentReceiptDocumentId,
      newReceiptDocumentId: newDocumentId,
      previousProtocolCode: request.protocolCode || null,
      newProtocolCode: trimmedProtocol,
      previousCommunicationDate: request.cpiCommunicationDate || null,
      newCommunicationDate: trimmedDate,
    },
  }).catch(() => {
    console.warn("[CPI Receipt Replacement] Audit log failed after successful replacement.");
  });

  return { success: true, documentId: newDocumentId };
}

/**
 * Finalizes the CPI dossier and marks it as completed.
 * Validates that all mandatory fields (protocol, date, receipt) are present.
 */
export async function completeEmploymentRequest(params: {
  entityId: string;
  requestId: string;
  actorUid: string;
}) {
  const { entityId, requestId, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Dossier introuvable.");
  const request = snap.data() as EmploymentRequest;

  if (request.status === "completed") return { success: true };

  // Validation
  if (!request.protocolCode || !request.cpiCommunicationDate || !request.receiptDocumentId) {
    throw new Error("MISSING_DATA: Le protocole, la date et le récépissé sont obligatoires pour clôturer le dossier.");
  }

  const now = serverTimestamp();
  await updateDoc(requestRef, sanitizePayload({
    status: "completed",
    completedAt: now,
    completedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  }));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentRequest.completed",
    resourceType: "employmentRequest",
    resourceId: requestId,
    details: { protocolCode: request.protocolCode }
  });

  // Timeline entry for the person
  if (request.personId) {
    try {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      await setDoc(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: request.personId,
        type: "employment_request.completed",
        label: "Communication CPI finalisée",
        description: `Le dossier d'embauche CPI a été clôturé avec le protocole ${request.protocolCode}.`,
        sourceCollection: "employmentRequests",
        sourceId: requestId,
        createdAt: now,
        createdBy: actorUid,
      }));
    } catch (e) {
      console.warn("[Timeline Sync] Failed to record completion event:", e);
    }
  }

  return { success: true };
}
