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
import { TimeOffRequest, DayPart, TimeOffStatus, JustificationStatus, LeaveBalance, TimeOffRequestType } from "@/types/time-off";
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
 * Internal helper to resolve the CCNL source snapshot for an employee.
 * Must be called in the READ phase of a transaction.
 */
async function resolveCcnlSnapshot(transaction: any, entityId: string, employeeId: string) {
  const employeeRef = doc(db!, `entities/${entityId}/employees`, employeeId);
  const empSnap = await transaction.get(employeeRef);
  const empData = empSnap.data();
  
  if (empData?.activeContractId) {
    const contractRef = doc(db!, `entities/${entityId}/contracts`, empData.activeContractId);
    const contractSnap = await transaction.get(contractRef);
    if (contractSnap.exists()) {
      const c = contractSnap.data();
      return {
        ccnlId: c.ccnlId || null,
        ccnlName: c.ccnlName || null,
        levelId: c.levelId || null,
        levelCode: c.levelCode || null,
        contractId: empData.activeContractId,
        source: "contract" as const,
        capturedAt: serverTimestamp()
      };
    }
  }

  return { 
    source: "manual" as const, 
    capturedAt: serverTimestamp() 
  };
}

/**
 * Atomic helper to get or create a leave balance for an employee/year.
 * Must be called in the READ phase of a transaction.
 */
async function getOrCreateLeaveBalance(transaction: any, entityId: string, employeeId: string, year: number, actorUid: string, actorRole: string) {
  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);
  const snap = await transaction.get(balanceRef);

  if (snap.exists()) {
    return { ref: balanceRef, data: snap.data() as LeaveBalance };
  }

  // If not exists, read context for the snapshot
  const ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, employeeId);

  const initialBalance: LeaveBalance = {
    entityId,
    employeeId,
    year,
    entitlementDays: 0,
    carriedOverDays: 0,
    usedDays: 0,
    pendingDays: 0,
    remainingDays: 0,
    ccnlSnapshot,
    updatedAt: serverTimestamp(),
    updatedByUid: actorUid,
    updatedByRole: actorRole
  };

  transaction.set(balanceRef, initialBalance);
  return { ref: balanceRef, data: initialBalance };
}

/**
 * RH Action: Manually initialize or edit a balance.
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

  const balanceRef = doc(db, `entities/${entityId}/leaveBalances`, `${employeeId}_${year}`);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const [balanceSnap, ccnlSnapshot] = await Promise.all([
      transaction.get(balanceRef),
      resolveCcnlSnapshot(transaction, entityId, employeeId)
    ]);

    const existing = balanceSnap.exists() ? (balanceSnap.data() as LeaveBalance) : { usedDays: 0, pendingDays: 0 };
    const remainingDays = data.entitlementDays + data.carriedOverDays - (existing.usedDays || 0);

    const payload: Partial<LeaveBalance> = {
      entityId,
      employeeId,
      year,
      entitlementDays: data.entitlementDays,
      carriedOverDays: data.carriedOverDays,
      remainingDays,
      ccnlSnapshot,
      updatedAt: serverTimestamp(),
      updatedByUid: actorUid,
      updatedByRole: actorRole
    };

    // 2. ALL WRITES AFTER
    transaction.set(balanceRef, payload, { merge: true });
    return { balanceId: balanceRef.id };
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
  const requestType = (data.requestType as TimeOffRequestType) || 'other';
  const year = parseInt(data.startDate.split('-')[0]);

  const requestRef = doc(collection(db!, `entities/${entityId}/timeOffRequests`));
  const requestId = requestRef.id;

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    let balanceRef = null;
    let ccnlSnapshot = null;

    if (requestType === "paid_leave") {
      const balanceInfo = await getOrCreateLeaveBalance(transaction, entityId, data.employeeId, year, actorUid, actorRole);
      balanceRef = balanceInfo.ref;
    } else {
      // Still capture snapshot for audit even if it doesn't affect balance
      ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, data.employeeId);
    }

    // 2. DATA PREP
    const requiresJustification = ["sickness", "work_accident"].includes(requestType) ? true : (data.requiresJustification ?? false);
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

    // 3. ALL WRITES AFTER
    transaction.set(requestRef, payload);
    if (balanceRef) {
      transaction.update(balanceRef, {
        pendingDays: increment(duration),
        updatedAt: serverTimestamp()
      });
    }

    return requestId;
  }).then(async (reqId) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.created_by_hr",
      resourceType: "timeOffRequest",
      resourceId: reqId,
      details: { employeeId: data.employeeId, duration, requestType }
    });
    return reqId;
  });
}

/**
 * Approves a time-off request.
 */
export async function approveTimeOffRequest(entityId: string, requestId: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (request.status !== "submitted") {
      throw new Error(`Action impossible : la demande est en statut "${request.status}".`);
    }

    const isSickness = ["sickness", "work_accident"].includes(request.requestType);
    const requiresJustification = request.requiresJustification || isSickness;
    if (requiresJustification && (request.justificationStatus !== "provided" || !request.justificationDocumentIds?.length)) {
      throw new Error("Justificatif requis avant approbation.");
    }

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    if (request.requestType === "paid_leave") {
      const { ref, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      const currentUsed = balance.usedDays || 0;
      const currentPending = balance.pendingDays || 0;
      const entitlement = (balance.entitlementDays || 0) + (balance.carriedOverDays || 0);
      
      const newRemaining = entitlement - (currentUsed + request.durationDays);
      if (newRemaining < 0) throw new Error("Solde de congé insuffisant.");
      balanceRef = ref;
    }

    // 2. ALL WRITES AFTER
    const now = serverTimestamp();
    transaction.update(requestRef, {
      status: "approved",
      approvedAt: now,
      approvedByUid: actorUid,
      approvedByRole: actorRole,
      updatedAt: now,
    });

    if (balanceRef) {
      transaction.update(balanceRef, {
        pendingDays: increment(-request.durationDays),
        usedDays: increment(request.durationDays),
        remainingDays: increment(-request.durationDays),
        updatedAt: now
      });
    }
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
    // 1. ALL READS FIRST
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (request.status !== "submitted") throw new Error("Statut invalide.");

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    if (request.requestType === "paid_leave") {
      const { ref } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
    }

    // 2. ALL WRITES AFTER
    const now = serverTimestamp();
    transaction.update(requestRef, {
      status: "rejected",
      rejectionReason: rejectionReason.trim(),
      rejectedAt: now,
      rejectedByUid: actorUid,
      rejectedByRole: actorRole,
      updatedAt: now,
    });

    if (balanceRef) {
      transaction.update(balanceRef, {
        pendingDays: increment(-request.durationDays),
        updatedAt: now
      });
    }
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
    // 1. ALL READS FIRST
    const snap = await transaction.get(requestRef);
    if (!snap.exists()) throw new Error("Demande introuvable.");
    const request = snap.data() as TimeOffRequest;

    if (!["submitted", "approved"].includes(request.status)) throw new Error("Statut invalide.");

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    if (request.requestType === "paid_leave") {
      const { ref } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
    }

    // 2. ALL WRITES AFTER
    const previousStatus = request.status;
    const now = serverTimestamp();

    transaction.update(requestRef, {
      status: "cancelled",
      cancelReason: cancelReason?.trim() || null,
      cancelledAt: now,
      cancelledByUid: actorUid,
      cancelledByRole: actorRole,
      updatedAt: now,
    });

    if (balanceRef) {
      if (previousStatus === "submitted") {
        transaction.update(balanceRef, {
          pendingDays: increment(-request.durationDays),
          updatedAt: now
        });
      } else if (previousStatus === "approved") {
        transaction.update(balanceRef, {
          usedDays: increment(-request.durationDays),
          remainingDays: increment(request.durationDays),
          updatedAt: now
        });
      }
    }
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
