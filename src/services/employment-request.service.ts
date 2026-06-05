import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  serverTimestamp,
} from "firebase/firestore";
import { EmploymentRequest } from "@/types/employment-request";
import { EmploymentOffer } from "@/types/employment-offer";
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
