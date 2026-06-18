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
  increment,
  Timestamp
} from "firebase/firestore";
import { 
  TimeOffRequest, 
  DayPart, 
  TimeOffStatus, 
  JustificationStatus, 
  LeaveBalance, 
  TimeOffRequestType,
  LeaveBalanceCounter,
  normalizeBalance,
  getCounterTypeForRequestType,
  MonthlyAccrual,
  MonthlyAccrualStatus
} from "@/types/time-off";
import { differenceInCalendarDays, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { createAuditLog } from "./audit.service";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { getDefaultAccrualRules, resolveAccrualRulesForCcnlLevel } from "./ccnl.service";

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
        defaultFerie = (levelData as any).annualPaidLeaveDays || 0;
        defaultRol = (levelData as any).annualRolHours || 0;
        defaultExHolidays = (levelData as any).annualExHolidayHours || 0;
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
    // 1. ALL READS FIRST
    const balanceSnap = await transaction.get(balanceRef);
    const ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, employeeId);

    // 2. DATA PREP
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

    // 3. ALL WRITES AFTER
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

  const requestType = (data.requestType as TimeOffRequestType) || 'other';
  const counterType = getCounterTypeForRequestType(requestType);
  const unit = (requestType === "paid_leave") ? "days" : "hours";
  
  const duration = (unit === "days") 
    ? calculateDuration(data.startDate, data.endDate, data.dayPart || "full_day")
    : Number(data.durationHours || 0);

  const year = parseInt(data.startDate.split('-')[0]);

  const requestRef = doc(collection(db!, `entities/${entityId}/timeOffRequests`));
  const requestId = requestRef.id;

  const balanceId = `${data.employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const isOverlapping = await checkTimeOffOverlap(entityId, data.employeeId, data.startDate, data.endDate);
    if (isOverlapping) {
      throw new Error("OVERLAP_DETECTED: L'employé a déjà une demande en cours ou validée sur cette période.");
    }

    const { ref: bRef, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, data.employeeId, year, actorUid, actorRole);

    // 2. DATA PREP & VALIDATION
    if (counterType && balance.counters) {
      const remaining = balance.counters[counterType].remaining;
      if (duration > remaining) {
        throw new Error(`Solde ${counterType === 'paid_leave' ? 'de congé' : counterType.toUpperCase()} insuffisant.`);
      }
    }

    const requiresJustification = ["sickness", "work_accident"].includes(requestType) ? true : (data.requiresJustification ?? false);
    const justificationStatus: JustificationStatus = requiresJustification ? "missing" : "not_required";

    const payload: TimeOffRequest = {
      ...(data as any),
      requestId,
      entityId,
      source: "hr_created",
      status: "submitted",
      dayPart: data.dayPart || "full_day",
      durationDays: unit === "days" ? duration : 0,
      durationHours: unit === "hours" ? duration : undefined,
      unit,
      balanceCounterType: counterType,
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
    
    // Update balance if applicable
    if (counterType && balance.counters) {
      const counters = { ...balance.counters };
      counters[counterType].pending += duration;
      
      const balanceUpdate: any = {
        counters,
        updatedAt: serverTimestamp()
      };

      // Legacy mirror for paid_leave
      if (counterType === "paid_leave") {
        balanceUpdate.pendingDays = increment(duration);
      }

      transaction.update(bRef, balanceUpdate);
    }

    return requestId;
  }).then(async (reqId) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "timeOff.created_by_hr",
      resourceType: "timeOffRequest",
      resourceId: reqId,
      details: { employeeId: data.employeeId, duration, unit, requestType }
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

    const counterType = request.balanceCounterType;
    const duration = (request.unit === "days") ? request.durationDays : (request.durationHours || 0);

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    let normalizedBalance: LeaveBalance | null = null;

    if (counterType) {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
      normalizedBalance = data;
    }

    // 2. VALIDATIONS
    if (request.status !== "submitted") {
      throw new Error(`Action impossible : la demande est en statut "${request.status}".`);
    }

    const isSickness = ["sickness", "work_accident"].includes(request.requestType);
    const requiresJustification = request.requiresJustification || isSickness;
    if (requiresJustification && (request.justificationStatus !== "provided" || !request.justificationDocumentIds?.length)) {
      throw new Error("Justificatif requis avant approbation.");
    }

    if (counterType && normalizedBalance?.counters) {
      const currentCounter = normalizedBalance.counters[counterType];
      const totalEntitlement = currentCounter.entitlement + currentCounter.carriedOver + currentCounter.accrued;
      const newRemaining = totalEntitlement - (currentCounter.used + duration);
      
      if (newRemaining < 0) {
         throw new Error(`Solde ${counterType === 'paid_leave' ? 'de congé' : counterType.toUpperCase()} insuffisant.`);
      }
    }

    // 3. ALL WRITES AFTER
    const now = serverTimestamp();
    transaction.update(requestRef, {
      status: "approved",
      approvedAt: now,
      approvedByUid: actorUid,
      approvedByRole: actorRole,
      updatedAt: now,
    });

    if (balanceRef && normalizedBalance?.counters && counterType) {
      const counters = { ...normalizedBalance.counters };
      counters[counterType].pending -= duration;
      counters[counterType].used += duration;
      counters[counterType].remaining -= duration;

      const balanceUpdate: any = {
        counters,
        updatedAt: now
      };

      // Legacy mirror for paid_leave
      if (counterType === "paid_leave") {
        balanceUpdate.pendingDays = increment(-duration);
        balanceUpdate.usedDays = increment(duration);
        balanceUpdate.remainingDays = increment(-duration);
      }

      transaction.update(balanceRef, balanceUpdate);
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

    const counterType = request.balanceCounterType;
    const duration = (request.unit === "days") ? request.durationDays : (request.durationHours || 0);

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    let normalizedBalance: LeaveBalance | null = null;
    
    if (counterType) {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
      normalizedBalance = data;
    }

    // 2. VALIDATIONS
    if (request.status !== "submitted") throw new Error("Statut invalide.");

    // 3. ALL WRITES AFTER
    const now = serverTimestamp();
    transaction.update(requestRef, {
      status: "rejected",
      rejectionReason: rejectionReason.trim(),
      rejectedAt: now,
      rejectedByUid: actorUid,
      rejectedByRole: actorRole,
      updatedAt: now,
    });

    if (balanceRef && normalizedBalance?.counters && counterType) {
      const counters = { ...normalizedBalance.counters };
      counters[counterType].pending -= duration;

      const balanceUpdate: any = {
        counters,
        updatedAt: now
      };

      if (counterType === "paid_leave") {
        balanceUpdate.pendingDays = increment(-duration);
      }

      transaction.update(balanceRef, balanceUpdate);
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

    const counterType = request.balanceCounterType;
    const duration = (request.unit === "days") ? request.durationDays : (request.durationHours || 0);

    const year = parseInt(request.startDate.split('-')[0]);
    let balanceRef = null;
    let normalizedBalance: LeaveBalance | null = null;
    
    if (counterType) {
      const { ref, data } = await getOrCreateLeaveBalance(transaction, entityId, request.employeeId, year, actorUid, actorRole);
      balanceRef = ref;
      normalizedBalance = data;
    }

    // 2. VALIDATIONS
    if (!["submitted", "approved"].includes(request.status)) throw new Error("Statut invalide.");

    // 3. ALL WRITES AFTER
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

    if (balanceRef && normalizedBalance?.counters && counterType) {
      const counters = { ...normalizedBalance.counters };
      const balanceUpdate: any = {
        counters,
        updatedAt: now
      };

      if (previousStatus === "submitted") {
        counters[counterType].pending -= duration;
        if (counterType === "paid_leave") {
           balanceUpdate.pendingDays = increment(-duration);
        }
      } else if (previousStatus === "approved") {
        counters[counterType].used -= duration;
        counters[counterType].remaining += duration;
        if (counterType === "paid_leave") {
           balanceUpdate.usedDays = increment(-duration);
           balanceUpdate.remainingDays = increment(duration);
        }
      }
      
      transaction.update(balanceRef, balanceUpdate);
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

/**
 * Phase 2H: Calculates a draft monthly accrual for an employee.
 * Uses approved timeOffRequests to estimate useful days.
 */
export async function runMonthlyAccrualCalculation(params: {
  entityId: string;
  year: number;
  month: number;
  employeeId?: string; // If missing, runs for all active employees
  usefulDaysMode: "time_off_estimate" | "manual";
  manualUsefulDays?: number;
  actorUid: string;
}) {
  const { entityId, year, month, employeeId, usefulDaysMode, manualUsefulDays, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const results: { empId: string; status: string; qualified: boolean }[] = [];
  
  // 1. Identify target employees
  let targets: string[] = [];
  if (employeeId) {
    targets = [employeeId];
  } else {
    const q = query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active"));
    const snap = await getDocs(q);
    targets = snap.docs.map(d => d.id);
  }

  if (targets.length === 0) throw new Error("Aucun employé actif trouvé.");

  const periodStart = startOfMonth(new Date(year, month - 1));
  const periodEnd = endOfMonth(periodStart);
  const periodKey = `${year}-${month.toString().padStart(2, '0')}`;

  for (const empId of targets) {
    try {
      await runTransaction(db, async (transaction) => {
        // --- READ PHASE ---
        const empRef = doc(db!, `entities/${entityId}/employees`, empId);
        const empSnap = await transaction.get(empRef);
        if (!empSnap.exists()) return;
        const employee = empSnap.data();

        // Overwrite check
        const accrualId = `${empId}_${year}_${month.toString().padStart(2, '0')}`;
        const accrualRef = doc(db!, `entities/${entityId}/monthlyAccruals`, accrualId);
        const existingSnap = await transaction.get(accrualRef);
        if (existingSnap.exists() && existingSnap.data().status === "confirmed") {
          throw new Error(`La maturation mensuelle est déjà confirmée pour ${employee.displayName} (${periodKey}).`);
        }

        // Resolve CCNL context
        const ccnlContext = await resolveCcnlSnapshot(transaction, entityId, empId);
        let rules = getDefaultAccrualRules();
        let ccnlData: any = null;
        let levelData: any = null;

        if (ccnlContext.ccnlId && ccnlContext.levelId) {
          const cRef = doc(db!, `entities/${entityId}/ccnls`, ccnlContext.ccnlId);
          const lRef = doc(db!, `entities/${entityId}/ccnls/${ccnlContext.ccnlId}/levels`, ccnlContext.levelId);
          const [cSnap, lSnap] = await Promise.all([transaction.get(cRef), transaction.get(lRef)]);
          
          if (cSnap.exists()) {
            ccnlData = cSnap.data();
            rules = resolveAccrualRulesForCcnlLevel(ccnlData as CCNL, ccnlContext.levelId);
          }
          if (lSnap.exists()) {
            levelData = lSnap.data();
          }
        }

        // Fetch requests for the month
        const requestsQ = query(
          collection(db!, `entities/${entityId}/timeOffRequests`),
          where("employeeId", "==", empId),
          where("status", "==", "approved")
        );
        const requestsSnap = await getDocs(requestsQ); // Read-only query outside transaction is safer for large lists
        const monthRequests = requestsSnap.docs.filter(d => {
          const r = d.data();
          return (r.startDate <= periodEnd.toISOString().split('T')[0] && r.endDate >= periodStart.toISOString().split('T')[0]);
        }).map(d => d.data() as TimeOffRequest);

        // --- CALCULATION PHASE ---
        let usefulDaysCount = 22; // Default assumption for standard work month
        let blockingFound = false;
        let blockingTypes: string[] = [];
        let notes = "";

        if (usefulDaysMode === "manual" && manualUsefulDays !== undefined) {
          usefulDaysCount = manualUsefulDays;
        } else {
          // Estimate from time off
          monthRequests.forEach(r => {
            if (rules.blockingAbsenceTypes?.includes(r.requestType)) {
              blockingFound = true;
              blockingTypes.push(r.requestType);
            }
            // Simple useful days logic: subtract approved blocking days or unpaid days
            if (["unpaid_leave", "unjustified_absence"].includes(r.requestType)) {
               usefulDaysCount -= r.durationDays;
            }
          });
        }

        const isQualified = usefulDaysCount >= (rules.usefulDaysThreshold || 14) && !blockingFound;

        // Proration check
        let prorationFactor = 1.0;
        if (employee.hireDate && rules.prorationMethod === "hired_before_15_full_month") {
          const hireDate = new Date(employee.hireDate);
          if (hireDate.getFullYear() === year && (hireDate.getMonth() + 1) === month) {
            if (hireDate.getDate() > 15) {
              prorationFactor = 0;
              notes += "Prorata : Embauche après le 15 du mois (Accrual = 0). ";
            }
          }
        }

        // Entitlement resolution hierarchy: Level -> Root -> 0
        const annualPaidLeave = levelData?.annualPaidLeaveDays || ccnlData?.annualPaidLeaveDays || 0;
        const annualRol = levelData?.annualRolHours || ccnlData?.annualRolHours || 0;
        const annualExHolidays = levelData?.annualExHolidayHours || ccnlData?.annualExHolidayHours || 0;

        if (isQualified) {
          if (rules.accrualPaidLeaveEnabled && annualPaidLeave === 0) notes += "Droits annuels CCNL manquants pour congés. ";
          if (rules.accrualRolEnabled && annualRol === 0) notes += "Droits annuels CCNL manquants pour ROL. ";
          if (rules.accrualExHolidaysEnabled && annualExHolidays === 0) notes += "Droits annuels CCNL manquants pour ex festività. ";
        }

        const accrued = {
          paid_leave: isQualified && rules.accrualPaidLeaveEnabled ? (annualPaidLeave / 12) * prorationFactor : 0,
          rol: isQualified && rules.accrualRolEnabled ? (annualRol / 12) * prorationFactor : 0,
          ex_holidays: isQualified && rules.accrualExHolidaysEnabled ? (annualExHolidays / 12) * prorationFactor : 0
        };

        if (rules.prorationMethod === "pro_rata_temporis") {
           notes += "Prorata détaillé non appliqué dans Phase 2H. ";
        }

        // --- WRITE PHASE ---
        const payload: MonthlyAccrual = {
          id: accrualId,
          entityId,
          employeeId: empId,
          employeeName: employee.displayName,
          year,
          month,
          periodKey,
          contractId: ccnlContext.contractId,
          ccnlSnapshot: ccnlContext.ccnlId ? {
            ccnlId: ccnlContext.ccnlId,
            ccnlName: ccnlContext.ccnlName || "N/A",
            levelId: ccnlContext.levelId || "N/A",
            levelCode: ccnlContext.levelCode || "N/A"
          } : null,
          ruleSnapshot: {
            usefulDaysThreshold: rules.usefulDaysThreshold || 14,
            prorationMethod: rules.prorationMethod || "none",
            blockingAbsenceTypes: rules.blockingAbsenceTypes || []
          },
          usefulDaysCount,
          usefulDaysSource: usefulDaysMode,
          blockingReasonFound: blockingFound,
          blockingReasonTypes: Array.from(new Set(blockingTypes)),
          isAccrualQualified: isQualified && prorationFactor > 0,
          accrued,
          status: "draft",
          calculationNotes: notes.trim() || null,
          createdAt: serverTimestamp(),
          createdByUid: actorUid,
          updatedAt: serverTimestamp(),
          updatedByUid: actorUid
        };

        transaction.set(accrualRef, payload, { merge: true });
        results.push({ empId, status: "calculated", qualified: isQualified });
      });
    } catch (err: any) {
      console.error(`Accrual calculation failed for ${empId}:`, err.message);
    }
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "monthlyAccrual.calculated",
    resourceType: "monthlyAccrual",
    resourceId: periodKey,
    details: { targetsCount: targets.length, month, year }
  });

  return results;
}

export async function updateMonthlyAccrualStatus(entityId: string, accrualId: string, status: "confirmed" | "cancelled", actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = doc(db, `entities/${entityId}/monthlyAccruals`, accrualId);
  await updateDoc(ref, {
    status,
    updatedAt: serverTimestamp(),
    updatedByUid: actorUid
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
