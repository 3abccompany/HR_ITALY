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
  updateDoc
} from "firebase/firestore";
import { TimeOffRequest, DayPart, TimeOffStatus, JustificationStatus } from "@/types/time-off";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { createAuditLog } from "./audit.service";

/**
 * Calculates the duration of a time-off request in days.
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

  // Determine justification requirements if not explicitly set
  let requiresJustification = data.requiresJustification ?? false;
  const requestType = data.requestType || 'other';

  if (data.requiresJustification === undefined) {
    if (["sickness", "work_accident"].includes(requestType)) {
      requiresJustification = true;
    } else if (["paid_leave", "unpaid_leave", "unjustified_absence"].includes(requestType)) {
      requiresJustification = false;
    }
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
 */
export async function approveTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  if (request.status !== "submitted") {
    throw new Error(`Statut invalide pour approbation : ${request.status}`);
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
 * Rejects a time-off request with a reason.
 */
export async function rejectTimeOffRequest(entityId: string, requestId: string, rejectionReason: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!rejectionReason.trim()) throw new Error("Le motif du refus est obligatoire.");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  if (request.status !== "submitted") {
    throw new Error(`Statut invalide pour rejet : ${request.status}`);
  }

  await updateDoc(requestRef, {
    status: "rejected",
    rejectionReason,
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
 */
export async function cancelTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string, cancelReason?: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Demande introuvable.");
  const request = snap.data() as TimeOffRequest;

  if (request.status === "rejected" || request.status === "cancelled") {
    throw new Error(`Cette demande est déjà en statut terminal : ${request.status}`);
  }

  await updateDoc(requestRef, {
    status: "cancelled",
    cancelReason: cancelReason || null,
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
  });
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
