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
  arrayUnion,
  runTransaction,
  increment
} from "firebase/firestore";
import { TimeOffRequest, DayPart, TimeOffStatus, JustificationStatus, LeaveBalance } from "@/types/time-off";
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
 * Atomic helper to get or create a leave balance for an employee/year.
 * Must be called in the READ phase of a transaction if used inside runTransaction.
 */
async function getOrCreateLeaveBalance(transaction: any, entityId: string, employeeId: string, year: number, actorUid: string, actorRole: string) {
  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);
  const snap = await transaction.get(balanceRef);

  if (snap.exists()) {
    return { ref: balanceRef, data: snap.data() as LeaveBalance };
  }

  const initialBalance: LeaveBalance = {
    entityId,
    employeeId,
    year,
    entitlementDays: 0,
    carriedOverDays: 0,
    usedDays: 0,
    pendingDays: 0,
    remainingDays: 0,
    updatedAt: serverTimestamp(),
    updatedByUid: actorUid,
    updatedByRole: actorRole
  };

  transaction.set(balanceRef, initialBalance);
  return { ref: balanceRef, data: initialBalance };
}

/**
 * RH Action: Manually initialize or edit a leave balance.
 */
export async function updateLeaveBalanceManual(
  entityId: string, 
  employeeId: string, 
  year: number, 
  data: { entitlementDays: number, carriedOverDays: number },
  actorUid: string,
  actorRole: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db, `entities/${entityId}/leaveBalances`, balanceId);

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(balanceRef);
    const existing = snap.exists() ? (snap.data() as LeaveBalance) : { usedDays: 0, pendingDays: 0 };

    const remainingDays = data.entitlementDays + data.carriedOverDays - (existing.usedDays || 0);

    const payload: Partial<LeaveBalance> = {
      entityId,
      employeeId,
      year,
      entitlementDays: data.entitlementDays,
      carriedOverDays: data.carriedOverDays,
      remainingDays,
      updatedAt: serverTimestamp(),
      updatedByUid: actorUid,
      updatedByRole: actorRole
    };

    transaction.set(balanceRef, payload, { merge: true });

    return { balanceId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "leaveBalance.manual_update",
      resourceType: "leaveBalance",
      resourceId: res.balanceId,
      details: data
    });
    return res;
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

  const duration = calculateDuration(data.startDate, data.endDate, data.dayPart || "full_day");
  const requestType = data.requestType || 'other';
  const year = parseInt(data.startDate.split('-')[0]);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS (Must happen before any writes)
    let balanceRef = null;
    if (requestType === "paid_leave") {
      const balanceInfo = await getOrCreateLeaveBalance(transaction, entityId, data.employeeId, year, actorUid, actorRole);
      balanceRef = balanceInfo.ref;
    }

    // 2. LOGIC / DATA PREP
    const requestRef = doc(collection(db!, `entities/${entityId}/timeOffRequests`));
    const requestId = requestRef.id;

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

    // 3. ALL WRITES
    transaction.set(requestRef, payload);

    if (balanceRef) {
      transaction.update(balanceRef, {
        pendingDays: increment(duration),
        updatedAt: serverTimestamp()
      });
    }

    return requestId;
  }).then(async (requestId) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.created_by_hr",
      resourceType: "timeOffRequest",
      resourceId: requestId,
      details: { employeeId: data.employeeId, duration, requestType }
    });
    return requestId;
  });
}

/**
 * Approves a time-off request.
 */
export async function approveTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (request.status !== "submitted") {
      throw new Error(`Action impossible : la demande est en statut "${request.status}".`);
    }

    const isSickness = ["sickness", "work_accident"].includes(request.requestType);
    if ((request.requiresJustification || isSickness) && request.justificationStatus !== "provided") {
      throw new Error("Justificatif requis avant approbation.");
    }

    const now = serverTimestamp();
    const year = parseInt(request.startDate.split('-')[0]);

    // Update Balance if paid_leave
    if (request.requestType === "paid_leave") {
      const { ref: balanceRef, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      
      const newRemaining = (balance.entitlementDays || 0) + (balance.carriedOverDays || 0) - ((balance.usedDays || 0) + request.durationDays);
      if (newRemaining < 0) {
        throw new Error("Solde de congé insuffisant.");
      }

      transaction.update(balanceRef, {
        pendingDays: increment(-request.durationDays),
        usedDays: increment(request.durationDays),
        remainingDays: newRemaining,
        updatedAt: now
      });
    }

    transaction.update(requestRef, {
      status: "approved",
      approvedAt: now,
      approvedByUid: actorUid,
      approvedByRole: actorRole,
      updatedAt: now,
    });
  }).then(async () => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.approved",
      resourceType: "timeOffRequest",
      resourceId: requestId,
    });
  });
}

/**
 * Rejects a time-off request.
 */
export async function rejectTimeOffRequest(entityId: string, requestId: string, rejectionReason: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!rejectionReason.trim()) throw new Error("Le motif du refus est obligatoire.");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (request.status !== "submitted") throw new Error("Statut invalide.");

    const now = serverTimestamp();
    const year = parseInt(request.startDate.split('-')[0]);

    if (request.requestType === "paid_leave") {
      const { ref: balanceRef } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      transaction.update(balanceRef, {
        pendingDays: increment(-request.durationDays),
        updatedAt: now
      });
    }

    transaction.update(requestRef, {
      status: "rejected",
      rejectionReason: rejectionReason.trim(),
      rejectedAt: now,
      rejectedByUid: actorUid,
      rejectedByRole: actorRole,
      updatedAt: now,
    });
  }).then(async () => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.rejected",
      resourceType: "timeOffRequest",
      resourceId: requestId,
    });
  });
}

/**
 * Cancels a time-off request.
 */
export async function cancelTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string, cancelReason?: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (!["submitted", "approved"].includes(request.status)) throw new Error("Statut invalide.");

    const now = serverTimestamp();
    const year = parseInt(request.startDate.split('-')[0]);

    if (request.requestType === "paid_leave") {
      const { ref: balanceRef, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      
      if (request.status === "submitted") {
        transaction.update(balanceRef, {
          pendingDays: increment(-request.durationDays),
          updatedAt: now
        });
      } else if (request.status === "approved") {
        const newUsed = Math.max(0, (balance.usedDays || 0) - request.durationDays);
        transaction.update(balanceRef, {
          usedDays: newUsed,
          remainingDays: (balance.entitlementDays || 0) + (balance.carriedOverDays || 0) - newUsed,
          updatedAt: now
        });
      }
    }

    transaction.update(requestRef, {
      status: "cancelled",
      cancelReason: cancelReason?.trim() || null,
      cancelledAt: now,
      cancelledByUid: actorUid,
      cancelledByRole: actorRole,
      updatedAt: now,
    });
  }).then(async () => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.cancelled",
      resourceType: "timeOffRequest",
      resourceId: requestId,
    });
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
