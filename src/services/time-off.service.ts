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
import { 
  TimeOffRequest, 
  DayPart, 
  TimeOffStatus, 
  JustificationStatus, 
  LeaveBalance, 
  TimeOffRequestType,
  LeaveBalanceCounter
} from "@/types/time-off";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { createAuditLog } from "./audit.service";
import { CCNL, CCNLLevel } from "@/types/ccnl";

/**
 * Normalizes a leave balance document by mapping legacy flat fields 
 * into the new multi-counter structure if missing.
 */
export function normalizeBalance(balance: any): LeaveBalance {
  const b = balance as LeaveBalance;
  
  if (b.counters) return b;

  // Migration logic for old flat balances
  const paidLeaveCounter: LeaveBalanceCounter = {
    entitlement: b.entitlementDays || 0,
    carriedOver: b.carriedOverDays || 0,
    accrued: 0,
    used: b.usedDays || 0,
    pending: b.pendingDays || 0,
    remaining: b.remainingDays || 0,
    unit: "days"
  };

  const zeroCounter = (unit: "hours" | "days"): LeaveBalanceCounter => ({
    entitlement: 0,
    carriedOver: 0,
    accrued: 0,
    used: 0,
    pending: 0,
    remaining: 0,
    unit
  });

  return {
    ...b,
    counters: {
      paid_leave: paidLeaveCounter,
      rol: zeroCounter("hours"),
      ex_holidays: zeroCounter("hours")
    }
  };
}

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
 * Defaults values from CCNL registry if creating new.
 */
async function getOrCreateLeaveBalance(transaction: any, entityId: string, employeeId: string, year: number, actorUid: string, actorRole: string) {
  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);
  const snap = await transaction.get(balanceRef);

  if (snap.exists()) {
    return { ref: balanceRef, data: normalizeBalance(snap.data()) };
  }

  // If not exists, read context for the snapshot
  const ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, employeeId);
  
  // Try to load default entitlements from CCNL/Level
  let defaultFerie = 0;
  let defaultRol = 0;
  let defaultExHolidays = 0;

  if (ccnlSnapshot.ccnlId && ccnlSnapshot.levelId) {
     const levelRef = doc(db!, `entities/${entityId}/ccnls/${ccnlSnapshot.ccnlId}/levels`, ccnlSnapshot.levelId);
     const levelSnap = await transaction.get(levelRef);
     if (levelSnap.exists()) {
        const levelData = levelSnap.data() as CCNLLevel;
        defaultFerie = levelData.annualPaidLeaveDays || 0;
        defaultRol = levelData.annualRolHours || 0;
        defaultExHolidays = levelData.annualExHolidayHours || 0;
     }
  }

  const initialBalance: LeaveBalance = {
    entityId,
    employeeId,
    year,
    ccnlSnapshot,
    counters: {
      paid_leave: { entitlement: defaultFerie, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: defaultFerie, unit: "days" },
      rol: { entitlement: defaultRol, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: defaultRol, unit: "hours" },
      ex_holidays: { entitlement: defaultExHolidays, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: defaultExHolidays, unit: "hours" }
    },
    // Mirror flat fields for legacy support
    entitlementDays: defaultFerie,
    carriedOverDays: 0,
    usedDays: 0,
    pendingDays: 0,
    remainingDays: defaultFerie,
    updatedAt: serverTimestamp(),
    updatedByUid: actorUid,
    updatedByRole: actorRole
  };

  transaction.set(balanceRef, initialBalance);
  return { ref: balanceRef, data: initialBalance };
}

/**
 * RH Action: Manually initialize or edit a balance.
 * Supports multi-counter updates.
 */
export async function updateLeaveBalanceManual(
  entityId: string, 
  employeeId: string, 
  year: number, 
  data: { 
    paid_leave: { entitlement: number, carriedOver: number, accrued: number },
    rol: { entitlement: number, carriedOver: number, accrued: number },
    ex_holidays: { entitlement: number, carriedOver: number, accrued: number }
  },
  actorUid: string,
  actorRole: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db, `entities/${entityId}/leaveBalances`, balanceId);

  return await runTransaction(db, async (transaction) => {
    const [balanceSnap, ccnlSnapshot] = await Promise.all([
      transaction.get(balanceRef),
      resolveCcnlSnapshot(transaction, entityId, employeeId)
    ]);

    const existingFull = balanceSnap.exists() ? normalizeBalance(balanceSnap.data()) : null;
    const existing = existingFull?.counters || {
       paid_leave: { used: 0, pending: 0 },
       rol: { used: 0, pending: 0 },
       ex_holidays: { used: 0, pending: 0 }
    };

    const counters: Record<string, LeaveBalanceCounter> = {
      paid_leave: {
        ...data.paid_leave,
        used: existing.paid_leave?.used || 0,
        pending: existing.paid_leave?.pending || 0,
        remaining: data.paid_leave.entitlement + data.paid_leave.carriedOver + data.paid_leave.accrued - (existing.paid_leave?.used || 0),
        unit: "days"
      },
      rol: {
        ...data.rol,
        used: existing.rol?.used || 0,
        pending: existing.rol?.pending || 0,
        remaining: data.rol.entitlement + data.rol.carriedOver + data.rol.accrued - (existing.rol?.used || 0),
        unit: "hours"
      },
      ex_holidays: {
        ...data.ex_holidays,
        used: existing.ex_holidays?.used || 0,
        pending: existing.ex_holidays?.pending || 0,
        remaining: data.ex_holidays.entitlement + data.ex_holidays.carriedOver + data.ex_holidays.accrued - (existing.ex_holidays?.used || 0),
        unit: "hours"
      }
    };

    const payload: Partial<LeaveBalance> = {
      entityId,
      employeeId,
      year,
      ccnlSnapshot,
      counters,
      // Mirror legacy fields
      entitlementDays: counters.paid_leave.entitlement,
      carriedOverDays: counters.paid_leave.carriedOver,
      usedDays: counters.paid_leave.used,
      pendingDays: counters.paid_leave.pending,
      remainingDays: counters.paid_leave.remaining,
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

  const duration = calculateDuration(data.startDate, data.endDate, data.dayPart || "full_day");
  const requestType = (data.requestType as TimeOffRequestType) || 'other';
  const year = parseInt(data.startDate.split('-')[0]);

  const requestRef = doc(collection(db!, `entities/${entityId}/timeOffRequests`));
  const requestId = requestRef.id;

  const employeeRef = doc(db!, `entities/${entityId}/employees`, data.employeeId);
  const balanceId = `${data.employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const isOverlapping = await checkTimeOffOverlap(entityId, data.employeeId, data.startDate, data.endDate);
    if (isOverlapping) {
      throw new Error("OVERLAP_DETECTED: L'employé a déjà une demande en cours ou validée sur cette période.");
    }

    const { ref: bRef, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, data.employeeId, year, actorUid, actorRole);

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
    
    // Only update balance if paid_leave
    if (requestType === "paid_leave" && balance.counters) {
      const counters = { ...balance.counters };
      counters.paid_leave.pending += duration;
      
      transaction.update(bRef, {
        counters,
        pendingDays: increment(duration), // Legacy mirror
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
    let normalizedBalance: LeaveBalance | null = null;

    if (request.requestType === "paid_leave") {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      
      const currentCounter = data.counters?.paid_leave;
      if (!currentCounter) throw new Error("Erreur technique: structure de solde corrompue.");

      const entitlement = currentCounter.entitlement + currentCounter.carriedOver + currentCounter.accrued;
      const newRemaining = entitlement - (currentCounter.used + request.durationDays);
      
      if (newRemaining < 0) throw new Error("Solde de congé insuffisant.");
      
      balanceRef = ref;
      normalizedBalance = data;
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

    if (balanceRef && normalizedBalance?.counters) {
      const counters = { ...normalizedBalance.counters };
      counters.paid_leave.pending -= request.durationDays;
      counters.paid_leave.used += request.durationDays;
      counters.paid_leave.remaining -= request.durationDays;

      transaction.update(balanceRef, {
        counters,
        pendingDays: increment(-request.durationDays), // Legacy mirror
        usedDays: increment(request.durationDays),    // Legacy mirror
        remainingDays: increment(-request.durationDays), // Legacy mirror
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
    let normalizedBalance: LeaveBalance | null = null;
    if (request.requestType === "paid_leave") {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
      normalizedBalance = data;
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

    if (balanceRef && normalizedBalance?.counters) {
      const counters = { ...normalizedBalance.counters };
      counters.paid_leave.pending -= request.durationDays;

      transaction.update(balanceRef, {
        counters,
        pendingDays: increment(-request.durationDays), // Legacy mirror
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
    let normalizedBalance: LeaveBalance | null = null;
    if (request.requestType === "paid_leave") {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
      normalizedBalance = data;
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

    if (balanceRef && normalizedBalance?.counters) {
      const counters = { ...normalizedBalance.counters };
      if (previousStatus === "submitted") {
        counters.paid_leave.pending -= request.durationDays;
        transaction.update(balanceRef, {
          counters,
          pendingDays: increment(-request.durationDays), // Legacy mirror
          updatedAt: now
        });
      } else if (previousStatus === "approved") {
        counters.paid_leave.used -= request.durationDays;
        counters.paid_leave.remaining += request.durationDays;
        transaction.update(balanceRef, {
          counters,
          usedDays: increment(-request.durationDays),      // Legacy mirror
          remainingDays: increment(request.durationDays), // Legacy mirror
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
