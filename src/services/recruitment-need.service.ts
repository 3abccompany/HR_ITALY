import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  serverTimestamp 
} from "firebase/firestore";
import { RecruitmentNeed, RecruitmentNeedStatus } from "@/types/recruitment-need";
import { createAuditLog } from "./audit.service";

/**
 * Utility to remove undefined properties from an object to prevent Firestore errors.
 * Preserves FieldValue and Timestamp instances to avoid stripping server directives.
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

export async function createRecruitmentNeed(entityId: string, data: Partial<RecruitmentNeed>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const needRef = doc(collection(db, `entities/${entityId}/recruitmentNeeds`));
  const needId = needRef.id;

  const requestedHeadcount = Number(data.requestedHeadcount) || 1;

  const needData: RecruitmentNeed = {
    ...(data as any),
    needId,
    entityId,
    status: "open",
    requestedHeadcount,
    fulfilledHeadcount: 0,
    remainingHeadcount: requestedHeadcount,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(needRef, sanitizePayload(needData));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "recruitmentNeed.created",
    resourceType: "recruitmentNeed",
    resourceId: needId,
    details: { jobTitle: needData.jobTitleName, headcount: requestedHeadcount }
  });

  return needId;
}

export async function updateRecruitmentNeed(entityId: string, needId: string, data: Partial<RecruitmentNeed>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, needId);
  
  const snap = await getDoc(needRef);
  if (!snap.exists()) throw new Error("Recruitment need not found");
  const current = snap.data() as RecruitmentNeed;

  const requestedHeadcount = Number(data.requestedHeadcount ?? current.requestedHeadcount);
  const fulfilledHeadcount = current.fulfilledHeadcount || 0;
  const remainingHeadcount = requestedHeadcount - fulfilledHeadcount;

  let status: RecruitmentNeedStatus = (data.status as RecruitmentNeedStatus) || current.status;
  
  // Auto-status logic if not explicitly forced to terminal states
  if (!["cancelled", "archived", "draft"].includes(status)) {
    if (fulfilledHeadcount === 0 && remainingHeadcount > 0) status = "open";
    else if (fulfilledHeadcount > 0 && remainingHeadcount > 0) status = "partially_fulfilled";
    else if (remainingHeadcount <= 0) status = "fulfilled";
  }

  const updatedData = {
    ...data,
    requestedHeadcount,
    remainingHeadcount,
    status,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await updateDoc(needRef, sanitizePayload(updatedData));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "recruitmentNeed.updated",
    resourceType: "recruitmentNeed",
    resourceId: needId,
  });
}

export async function cancelRecruitmentNeed(entityId: string, needId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, needId);
  
  await updateDoc(needRef, {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "recruitmentNeed.cancelled",
    resourceType: "recruitmentNeed",
    resourceId: needId,
  });
}

export async function archiveRecruitmentNeed(entityId: string, needId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, needId);
  
  await updateDoc(needRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "recruitmentNeed.archived",
    resourceType: "recruitmentNeed",
    resourceId: needId,
  });
}
