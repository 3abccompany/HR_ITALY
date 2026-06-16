import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  orderBy,
  Query,
  updateDoc,
  arrayUnion
} from "firebase/firestore";
import { TimeOffRequest, DayPart, TimeOffStatus, JustificationStatus } from "@/types/time-off";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { createAuditLog } from "./audit.service";

/**
 * Calculates the duration of a time-off request in days.
 * - Same day + half day = 0.5
 * - Inclusive calendar days otherwise
 */
export function calculateDuration(startDate: string, endDate: string, dayPart: DayPart): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  if (dayPart !== "full_day" && startDate === endDate) {
    return 0.5;
  }
  
  return Math.max(0, differenceInCalendarDays(end, start) + 1);
}

/**
 * Checks for overlapping requests for the same employee.
 */
export async function checkTimeOffOverlap(entityId: string, employeeId: string, startDate: string, endDate: string, excludeRequestId?: string) {
  if (!db) return false;
  
  const q = query(
    collection(db, `entities/${entityId}/timeOffRequests`),
    where("employeeId", "==", employeeId),
    where("status", "in", ["submitted", "approved"])
  ) as Query<TimeOffRequest>;
  
  const snap = await getDocs(q);
  const requests = snap.docs.map(d => d.data());
  
  return requests.some(req => {
    if (excludeRequestId && req.requestId === excludeRequestId) return false;
    return (req.startDate <= endDate && req.endDate >= startDate);
  });
}

/**
 * Creates a time-off request (RH/Admin source).
 */
export async function createTimeOffRequestForEmployee(
  entityId: string, 
  data: Partial<TimeOffRequest> & { employeeId: string, startDate: string, endDate: string, employeeName: string }, 
  actorUid: string,
  actorRole: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const isOverlapping = await checkTimeOffOverlap(entityId, data.employeeId, data.startDate, data.endDate);
  if (isOverlapping) {
    throw new Error("OVERLAP_DETECTED: L'employé a déjà une demande en cours ou validée sur cette période.");
  }

  const requestRef = doc(collection(db, `entities/${entityId}/timeOffRequests`));
  const requestId = requestRef.id;

  const duration = calculateDuration(data.startDate, data.endDate, data.dayPart || "full_day");

  // Determine justification requirements - FORCE for specific types
  const requestType = data.requestType || 'other';
  let requiresJustification = data.requiresJustification ?? false;

  if (["sickness", "work_accident"].includes(requestType)) {
    requiresJustification = true;
  }

  const justificationStatus: JustificationStatus = requiresJustification ? "missing" : "not_required";

  const payload: TimeOffRequest = {
    ...(data as any),
    requestId,
    entityId,
    source: "hr_created",
    status: "submitted",
    dayPart: data.dayPart || "full_day",
    durationDays: duration,
    requiresJustification,
    justificationStatus,
    justificationNote: data.justificationNote || null,
    justificationDocumentIds: [],
    createdByUid: actorUid,
    createdByRole: actorRole,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(requestRef, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.created_by_hr",
    resourceType: "timeOffRequest",
    resourceId: requestId,
    details: { employeeId: data.employeeId, duration, requiresJustification }
  });

  return requestId;
}

/**
 * Approves a time-off request.
 * BLOCKS approval if a required justification is missing.
 */
export async function approveTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  // State Guard
  if (request.status !== "submitted") {
    throw new Error(`Action impossible : la demande est en statut "${request.status}" (attendu: "submitted").`);
  }

  // Compliance Guard: Required justification check
  const isSickness = ["sickness", "work_accident"].includes(request.requestType);
  const isJustificationRequired = request.requiresJustification === true || isSickness;
  const hasDocument = request.justificationDocumentIds && request.justificationDocumentIds.length > 0;
  const hasStatusProvided = request.justificationStatus === "provided";

  if (isJustificationRequired && (!hasDocument || !hasStatusProvided)) {
    throw new Error("Justificatif requis avant approbation.");
  }

  await updateDoc(requestRef, {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedByUid: actorUid,
    approvedByRole: actorRole,
    updatedAt: serverTimestamp(),
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.approved",
    resourceType: "timeOffRequest",
    resourceId: requestId,
  });
}

/**
 * Rejects a time-off request with a mandatory reason.
 */
export async function rejectTimeOffRequest(entityId: string, requestId: string, rejectionReason: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!rejectionReason.trim()) throw new Error("Le motif du refus est obligatoire.");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  // State Guard
  if (request.status !== "submitted") {
    throw new Error(`Action impossible : la demande est en statut "${request.status}" (attendu: "submitted").`);
  }

  await updateDoc(requestRef, {
    status: "rejected",
    rejectionReason: rejectionReason.trim(),
    rejectedAt: serverTimestamp(),
    rejectedByUid: actorUid,
    rejectedByRole: actorRole,
    updatedAt: serverTimestamp(),
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.rejected",
    resourceType: "timeOffRequest",
    resourceId: requestId,
    details: { rejectionReason }
  });
}

/**
 * Cancels a time-off request.
 * Allowed for 'submitted' and 'approved' requests.
 */
export async function cancelTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string, cancelReason?: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  // State Guard
  if (!["submitted", "approved"].includes(request.status)) {
    throw new Error(`Action impossible : la demande est déjà en statut terminal "${request.status}".`);
  }

  await updateDoc(requestRef, {
    status: "cancelled",
    cancelReason: cancelReason?.trim() || null,
    cancelledAt: serverTimestamp(),
    cancelledByUid: actorUid,
    cancelledByRole: actorRole,
    updatedAt: serverTimestamp(),
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.cancelled",
    resourceType: "timeOffRequest",
    resourceId: requestId,
    details: { previousStatus: request.status }
  });
}

/**
 * Links an uploaded document to a time-off request as a justification.
 */
export async function addJustificationDocumentToRequest(
  entityId: string,
  requestId: string,
  documentId: string,
  note?: string,
  actorUid?: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  
  await updateDoc(requestRef, {
    justificationDocumentIds: arrayUnion(documentId),
    justificationStatus: "provided",
    justificationNote: note || null,
    updatedAt: serverTimestamp(),
    ...(actorUid && { updatedBy: actorUid })
  });

  if (actorUid) {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.justification_added",
      resourceType: "timeOffRequest",
      resourceId: requestId,
      details: { documentId }
    });
  }
}

export async function listTimeOffRequests(entityId: string) {
  if (!db) return [];
  const q = query(
    collection(db, `entities/${entityId}/timeOffRequests`),
    orderBy("createdAt", "desc")
  ) as Query<TimeOffRequest>;
  
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}
