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
  runTransaction
} from "firebase/firestore";
import { EmploymentRequest, EmploymentRequestStatus } from "@/types/employment-request";
import { EmploymentOffer } from "@/types/employment-offer";
import { createAuditLog } from "./audit.service";

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
    employeeId: offer.employeeId || null,
    contractId: offer.contractId || null,
    mandatoryCommunicationId: mandatoryCommunicationId || null,
    
    source: "offer",
    type: "unilav",
    status: "draft",

    plannedHireDate: offer.proposedStartDate || "",
    jobRoleId: offer.jobTitleName || "",
    worksiteId: offer.worksiteId || "",
    
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
