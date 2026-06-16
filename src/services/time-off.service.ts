import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  orderBy,
  Query
} from "firebase/firestore";
import { TimeOffRequest, DayPart } from "@/types/time-off";
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
export async function checkTimeOffOverlap(entityId: string, employeeId: string, startDate: string, endDate: string) {
  if (!db) return false;
  
  const q = query(
    collection(db, `entities/${entityId}/timeOffRequests`),
    where("employeeId", "==", employeeId),
    where("status", "in", ["submitted", "approved"])
  ) as Query<TimeOffRequest>;
  
  const snap = await getDocs(q);
  const requests = snap.docs.map(d => d.data());
  
  return requests.some(req => {
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

  const payload: TimeOffRequest = {
    ...(data as any),
    requestId,
    entityId,
    source: "hr_created",
    status: "submitted",
    dayPart: data.dayPart || "full_day",
    durationDays: duration,
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
    details: { employeeId: data.employeeId, duration }
  });

  return requestId;
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
