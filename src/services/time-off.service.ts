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
  Timestamp,
  FieldValue
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
  MonthlyAccrualStatus,
  TIME_OFF_TYPE_LABELS,
  TimeOffDurationMode
} from "@/types/time-off";
import { differenceInCalendarDays, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, eachDayOfInterval, format } from "date-fns";
import { createAuditLog } from "./audit.service";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { getDefaultAccrualRules, resolveAccrualRulesForCcnlLevel } from "./ccnl.service";
import { createNotification } from "./notification.service";
import { Employee } from "@/types/employee";
import { AttendanceRecord } from "@/types/attendance";
import { resolveWorkSchedule } from "./work-schedule.service";

/**
 * Normalizes an object by removing undefined properties to satisfy Firestore.
 * Preserves FieldValue and Timestamp identities.
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

/**
 * Calculates the duration of a time-off request in days, excluding Sundays.
 * Date range is inclusive.
 */
export function calculateDuration(startDate: string, endDate: string, dayPart: DayPart): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;

  // Special case: half day
  if (dayPart !== "full_day" && startDate === endDate) {
    if (start.getDay() === 0) return 0; // Sunday
    return 0.5;
  }

  let count = 0;
  const current = new Date(start.getTime());
  
  while (current <= end) {
    if (current.getDay() !== 0) { // 0 is Sunday
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Calculates duration in hours.
 */
export function calculateHourlyDuration(start: string, end: string): number {
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const startTotal = sH * 60 + sM;
  const endTotal = eH * 60 + eM;
  return Math.max(0, (endTotal - startTotal) / 60);
}

/**
 * Checks for overlapping requests for the same employee.
 * Now supports time-granular checks for hourly requests.
 */
export async function checkTimeOffOverlap(
  entityId: string, 
  employeeId: string, 
  startDate: string, 
  endDate: string, 
  startTime?: string | null, 
  endTime?: string | null,
  excludeRequestId?: string
) {
  if (!db) return false;
  
  const q = query(
    collection(db, `entities/${entityId}/timeOffRequests`),
    where("employeeId", "==", employeeId),
    where("status", "in", ["submitted", "approved"])
  ) as Query<TimeOffRequest>;
  
  const snap = await getDocs(q);
  const requests = snap.docs.map(d => d.data());
  
  return requests.some(r => {
    if (excludeRequestId && r.requestId === excludeRequestId) return false;
    
    const datesOverlap = (r.startDate <= endDate && r.endDate >= startDate);
    if (!datesOverlap) return false;

    // Both are hourly on the same date -> check for intersection
    if (r.unit === 'hours' && startTime && endTime && r.startDate === startDate) {
       // Conflict if (StartA < EndB) AND (EndA > StartB)
       return (startTime < r.endTime! && endTime > r.startTime!);
    }

    // Any date overlap involving a day-based request (either existing or new) is a conflict
    return true;
  });
}

/**
 * Internal helper to resolve the CCNL source snapshot for an employee.
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
 */
async function getOrCreateLeaveBalance(transaction: any, entityId: string, employeeId: string, year: number, actorUid: string, actorRole: string) {
  const balanceId = `${employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);
  const snap = await transaction.get(balanceRef);

  if (snap.exists()) {
    return { ref: balanceRef, data: normalizeBalance(snap.data()) };
  }

  const ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, employeeId);
  
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
      paid_leave: { entitlement: defaultFerie, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: 0, unit: "days" },
      rol: { entitlement: defaultRol, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: 0, unit: "hours" },
      ex_holidays: { entitlement: defaultExHolidays, carriedOver: 0, accrued: 0, used: 0, pending: 0, remaining: 0, unit: "hours" }
    },
    entitlementDays: defaultFerie,
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
    const balanceSnap = await transaction.get(balanceRef);
    const ccnlSnapshot = await resolveCcnlSnapshot(transaction, entityId, employeeId);

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
        remaining: data.paid_leave.carriedOver + data.paid_leave.accrued - (existing.paid_leave?.used || 0),
        unit: "days"
      },
      rol: {
        ...data.rol,
        used: existing.rol?.used || 0,
        pending: existing.rol?.pending || 0,
        remaining: data.rol.carriedOver + data.rol.accrued - (existing.rol?.used || 0),
        unit: "hours"
      },
      ex_holidays: {
        ...data.ex_holidays,
        used: existing.ex_holidays?.used || 0,
        pending: existing.ex_holidays?.pending || 0,
        remaining: data.ex_holidays.carriedOver + data.ex_holidays.accrued - (existing.ex_holidays?.used || 0),
        unit: "hours"
      }
    };

    const payload: Partial<LeaveBalance> = {
      entityId,
      employeeId,
      year,
      ccnlSnapshot,
      counters,
      entitlementDays: data.paid_leave.entitlement,
      carriedOverDays: data.paid_leave.carriedOver,
      usedDays: counters.paid_leave.used,
      pendingDays: counters.paid_leave.pending,
      remainingDays: counters.paid_leave.remaining,
      updatedAt: serverTimestamp(),
      updatedByUid: actorUid,
      updatedByRole: actorRole
    };

    transaction.set(balanceRef, sanitizePayload(payload), { merge: true });
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
 * Phase 2J-A: Mark existing monthly accruals as needing review.
 */
export async function markMonthlyAccrualImpactedByRequest(entityId: string, request: TimeOffRequest) {
  if (!db) return;
  
  const start = parseISO(request.startDate);
  const end = parseISO(request.endDate);
  
  const impactedMonths = eachMonthOfInterval({ start, end });
  const employeeId = request.employeeId;

  for (const mDate of impactedMonths) {
    const year = mDate.getFullYear();
    const month = mDate.getMonth() + 1;
    const accrualId = `${employeeId}_${year}_${month.toString().padStart(2, '0')}`;
    const accrualRef = doc(db, `entities/${entityId}/monthlyAccruals`, accrualId);
    
    try {
      const snap = await getDoc(accrualRef);
      if (snap.exists()) {
        const data = snap.data() as MonthlyAccrual;
        if (data.status === 'cancelled') continue;

        const isPosted = data.status === 'posted';
        const impactReason = `Modification de la demande ${request.requestId} (${request.requestType})`;

        await updateDoc(accrualRef, {
          needsReview: true,
          hasDiscrepancy: isPosted ? true : (data.hasDiscrepancy || false),
          impactedByRequestIds: arrayUnion(request.requestId),
          lastImpactDetectedAt: serverTimestamp(),
          reviewReason: impactReason,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn(`[Impact Detection] Failed for ${accrualId}:`, e);
    }
  }
}

/**
 * RH Action: Manually initialize or edit a balance.
 * Updated Phase 4E-2C: Integrates contractual work schedule for ROL/Ex-Fest duration calculation.
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
  const isRolOrExFest = requestType === "rol_permission" || requestType === "ex_holiday_permission";
  
  const isHourlyMode = data.durationMode === "hourly" || (!data.durationMode && ["rol_permission", "ex_holiday_permission"].includes(requestType));
  const unit = isRolOrExFest ? "hours" : "days";
  
  const year = parseInt(data.startDate.split('-')[0]);
  const requestRef = doc(collection(db!, `entities/${entityId}/timeOffRequests`));
  const requestId = requestRef.id;

  const balanceId = `${data.employeeId}_${year}`;
  const balanceRef = doc(db!, `entities/${entityId}/leaveBalances`, balanceId);

  const resolvedSource = data.source || (actorRole === 'employee' ? "employee_created" : "hr_created");
  const requiresJustification = ["sickness", "work_accident"].includes(requestType) ? true : (data.requiresJustification ?? false);

  return await runTransaction(db, async (transaction) => {
    // 1. Fetch Employee for contractual context
    const empRef = doc(db!, `entities/${entityId}/employees`, data.employeeId);
    const empSnap = await transaction.get(empRef);
    if (!empSnap.exists()) throw new Error("EMPLOYEE_NOT_FOUND");
    const empData = empSnap.data() as Employee;

    // 2. Resolve Work Schedule for ROL/Ex-Fest if in full/half day mode
    let duration = 0;
    let resolvedExpectedHours: number | null = null;
    let scheduleSource: string | null = null;
    let scheduleWarning: string | null = null;

    if (isRolOrExFest) {
      const schedule = await resolveWorkSchedule(db!, entityId, data.employeeId, data.startDate);
      resolvedExpectedHours = schedule.expectedDailyHours;
      scheduleSource = schedule.source;

      if (data.durationMode === "full_day" || data.durationMode === "half_day") {
        if (!schedule.isReliable || resolvedExpectedHours === null) {
          throw new Error("HORAIRE_INVALIDE: Horaire contractuel introuvable pour cette date. Veuillez configurer le planning ou utiliser le mode horaire.");
        }
        if (resolvedExpectedHours === 0) {
          throw new Error("JOUR_NON_TRAVAILLE: Impossible de poser une journée complète ou demi-journée sur un jour non travaillé (0h).");
        }
        
        duration = data.durationMode === "full_day" ? resolvedExpectedHours : (resolvedExpectedHours / 2);
      } else {
        // Hourly mode: use explicit times
        if (!data.startTime || !data.endTime) throw new Error("HEURES_REQUISES: Veuillez renseigner l'heure de début et de fin.");
        duration = calculateHourlyDuration(data.startTime, data.endTime);
        if (!schedule.isReliable) {
          scheduleWarning = "Horaire contractuel non détecté pour vérification contextuelle.";
        }
      }
    } else {
      // Day-based calculation (Paid leave, sickness, etc.)
      duration = calculateDuration(data.startDate, data.endDate, data.dayPart || "full_day");
    }

    if (duration <= 0) {
      throw new Error("DUREE_INVALIDE: La durée calculée est de 0.");
    }

    const isOverlapping = await checkTimeOffOverlap(entityId, data.employeeId, data.startDate, data.endDate, data.startTime, data.endTime);
    if (isOverlapping) {
      throw new Error("OVERLAP_DETECTED: L'employé a déjà une demande en cours ou validée sur cette période.");
    }

    const { ref: bRef, data: balance } = await getOrCreateLeaveBalance(transaction, entityId, data.employeeId, year, actorUid, actorRole);

    if (counterType && balance.counters) {
      const remaining = balance.counters[counterType].remaining;
      if (duration > remaining) {
        throw new Error(`Solde ${counterType === 'paid_leave' ? 'de congé' : counterType.toUpperCase()} insuffisant (${duration.toFixed(2)} ${unit} demandés, ${remaining.toFixed(2)} restants).`);
      }
    }

    const justificationStatus: JustificationStatus = requiresJustification ? "missing" : "not_required";

    const payload: Partial<TimeOffRequest> = {
      ...data,
      requestId,
      entityId,
      source: resolvedSource,
      status: "submitted",
      durationDays: isRolOrExFest ? 0 : duration,
      durationHours: isRolOrExFest ? duration : undefined,
      unit,
      balanceCounterType: counterType,
      expectedDailyHoursSnapshot: resolvedExpectedHours || undefined,
      expectedDailyHoursSource: scheduleSource || undefined,
      scheduleWarning: scheduleWarning || undefined,
      requiresJustification,
      justificationStatus,
      justificationDocumentIds: [],
      createdByUid: actorUid,
      createdByRole: actorRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(requestRef, sanitizePayload(payload));
    
    if (counterType && balance.counters) {
      const counters = { ...balance.counters };
      counters[counterType].pending += duration;
      
      const balanceUpdate: any = {
        counters,
        updatedAt: serverTimestamp()
      };

      if (counterType === "paid_leave") {
        balanceUpdate.pendingDays = increment(duration);
      }

      transaction.update(bRef, balanceUpdate);
    }

    return requestId;
  }).then(async (reqId) => {
    // Notifications...
    try {
      await createNotification(entityId, {
        targetPermission: "leaveRequests.read",
        audience: "hr",
        category: "absence",
        severity: "info",
        title: "Nouvelle demande d'absence",
        message: `Une nouvelle demande d'absence (${TIME_OFF_TYPE_LABELS[requestType]}) nécessite un traitement.`,
        actionUrl: `/entity/${entityId}/absences`,
        dedupKey: `absence:${reqId}:submitted`
      });
    } catch (e) {}

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: resolvedSource === 'employee_created' ? "timeOff.created_by_employee" : "timeOff.created_by_hr",
      resourceType: "timeOffRequest",
      resourceId: reqId,
      details: { employeeId: data.employeeId, duration, unit, requestType, mode: data.durationMode }
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

  const result = await runTransaction(db, async (transaction) => {
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
      const actualAvailable = currentCounter.carriedOver + currentCounter.accrued;
      const newRemaining = actualAvailable - (currentCounter.used + duration);
      
      if (newRemaining < 0) {
         throw new Error(`Solde ${counterType === 'paid_leave' ? 'de congé' : counterType.toUpperCase()} insuffisant.`);
      }
    }

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

      if (counterType === "paid_leave") {
        balanceUpdate.pendingDays = increment(-duration);
        balanceUpdate.usedDays = increment(duration);
        balanceUpdate.remainingDays = increment(-duration);
      }

      transaction.update(balanceRef, balanceUpdate);
    }

    return request;
  });

  // Post-transaction tasks
  await markMonthlyAccrualImpactedByRequest(entityId, result);

  // Notify...
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.approved",
    resourceType: "timeOffRequest",
    resourceId: requestId,
  });
}

/**
 * Rejects a time-off request.
 */
export async function rejectTimeOffRequest(entityId: string, requestId: string, rejectionReason: string, actorUid: string, actorRole: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!rejectionReason.trim()) throw new Error("Le motif du refus est obligatoire.");

  const requestRef = doc(db, `entities/${entityId}/timeOffRequests`, requestId);

  const result = await runTransaction(db, async (transaction) => {
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

    if (request.status !== "submitted") throw new Error("Statut invalide.");

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
    
    return request;
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "timeOff.rejected",
    resourceType: "timeOffRequest",
    resourceId: requestId,
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

    if (!["submitted", "approved"].includes(request.status)) throw new Error("Statut invalide.");

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

    return request;
  }).then(async (req) => {
    await markMonthlyAccrualImpactedByRequest(entityId, req as TimeOffRequest);

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
 * Phase 2H: Calculates a monthly accrual for an employee.
 * Supports: time_off_estimate (Default) and attendance_validated.
 */
export async function runMonthlyAccrualCalculation(params: {
  entityId: string;
  year: number;
  month: number;
  employeeId?: string;
  usefulDaysMode: "time_off_estimate" | "manual" | "attendance_validated";
  manualUsefulDays?: number;
  actorUid: string;
}) {
  const { entityId, year, month, employeeId, usefulDaysMode, manualUsefulDays, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const results: { empId: string; status: string; qualified: boolean }[] = [];
  
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
  const startStr = periodStart.toISOString().split('T')[0];
  const endStr = periodEnd.toISOString().split('T')[0];

  for (const empId of targets) {
    try {
      await runTransaction(db, async (transaction) => {
        const empRef = doc(db!, `entities/${entityId}/employees`, empId);
        const empSnap = await transaction.get(empRef);
        if (!empSnap.exists()) return;
        const employee = empSnap.data() as Employee;

        const accrualId = `${empId}_${year}_${month.toString().padStart(2, '0')}`;
        const accrualRef = doc(db!, `entities/${entityId}/monthlyAccruals`, accrualId);
        const existingSnap = await transaction.get(accrualRef);
        
        if (existingSnap.exists()) {
           const existing = existingSnap.data() as MonthlyAccrual;
           if (existing.status === "confirmed" || existing.status === "posted") {
             return; // Skip confirmed/posted rows to preserve manual work
           }
        }

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

        // 1. Load relevant TimeOffRequests
        const requestsQ = query(
          collection(db!, `entities/${entityId}/timeOffRequests`),
          where("employeeId", "==", empId),
          where("status", "==", "approved")
        );
        const requestsSnap = await getDocs(requestsQ);
        const monthRequests = requestsSnap.docs.filter(d => {
          const r = d.data() as any;
          return (r.startDate <= endStr && r.endDate >= startStr);
        }).map(d => ({ ...d.data(), id: d.id } as any as TimeOffRequest));

        // 2. Useful Days Calculation
        const uniqueUsefulDates = new Set<string>();
        const sourceAttendanceIds: string[] = [];
        const sourceRequestIds: string[] = [];
        const blockingReasons: MonthlyAccrual["blockingReasons"] = [];
        const calculationWarnings: string[] = [];
        
        let blockingFound = false;
        let blockingTypes: string[] = [];

        // Evaluate Requests (Source of Truth for absences and blocking reasons)
        const assimilatedTypes = ["paid_leave", "sickness", "work_accident", "permission"];
        
        monthRequests.forEach(r => {
           const isBlocking = rules.blockingAbsenceTypes?.includes(r.requestType);
           const isAssimilated = assimilatedTypes.includes(r.requestType);

           if (isBlocking) {
             blockingFound = true;
             blockingTypes.push(r.requestType);
             blockingReasons.push({
               requestId: r.requestId,
               type: r.requestType,
               label: TIME_OFF_TYPE_LABELS[r.requestType] || r.requestType,
               startDate: r.startDate,
               endDate: r.endDate
             });
             sourceRequestIds.push(r.requestId);
           }

           if (isAssimilated) {
              sourceRequestIds.push(r.requestId);
              // Count every overlapping day in the month
              const start = parseISO(r.startDate > startStr ? r.startDate : startStr);
              const end = parseISO(r.endDate < endStr ? r.endDate : endStr);
              eachDayOfInterval({ start, end }).forEach(d => {
                uniqueUsefulDates.add(format(d, "yyyy-MM-dd"));
              });
           }
        });

        let usefulDaysCount = 0;

        if (usefulDaysMode === "manual") {
           usefulDaysCount = manualUsefulDays || 0;
        } else if (usefulDaysMode === "attendance_validated") {
           // Fetch validated attendances
           // Index suggested: attendances (employeeId ASC, attendanceDate ASC)
           const attendanceQ = query(
             collection(db!, `entities/${entityId}/attendances`),
             where("employeeId", "==", empId),
             where("attendanceDate", ">=", startStr),
             where("attendanceDate", "<=", endStr)
           ) as Query<AttendanceRecord>;
           
           const attSnap = await getDocs(attendanceQ);
           const reliableStatuses = ["validated", "corrected", "locked"];
           
           attSnap.docs.forEach(d => {
              const att = d.data();
              if (reliableStatuses.includes(att.status) && (att.validatedHours || 0) > 0) {
                 uniqueUsefulDates.add(att.attendanceDate);
                 sourceAttendanceIds.push(d.id);
              }
           });
           
           usefulDaysCount = uniqueUsefulDates.size;
           
           if (attSnap.size < 20) {
              calculationWarnings.push("Données de présence possiblement incomplètes pour ce mois.");
           }
        } else {
           // Default: time_off_estimate (legacy branch)
           let estCount = 22;
           monthRequests.forEach(r => {
              if (["unpaid_leave", "unjustified_absence"].includes(r.requestType)) {
                 estCount -= r.durationDays;
              }
           });
           usefulDaysCount = estCount;
           calculationWarnings.push("Calcul basé sur une estimation (standard 22j).");
        }

        const isQualified = usefulDaysCount >= (rules.usefulDaysThreshold || 14) && !blockingFound;

        let prorationFactor = 1.0;
        let notes = "";
        if (employee.hireDate && rules.prorationMethod === "hired_before_15_full_month") {
          const hireDate = new Date(employee.hireDate);
          if (hireDate.getFullYear() === year && (hireDate.getMonth() + 1) === month) {
            if (hireDate.getDate() > 15) {
              prorationFactor = 0;
              notes += "Prorata : Embauche après le 15 du mois. ";
            }
          }
        }

        const annualPaidLeave = levelData?.annualPaidLeaveDays || ccnlData?.annualPaidLeaveDays || 0;
        const annualRol = levelData?.annualRolHours || ccnlData?.annualRolHours || 0;
        const annualExHolidays = levelData?.annualExHolidayHours || ccnlData?.annualExHolidayHours || 0;

        const accrued = {
          paid_leave: isQualified && rules.accrualPaidLeaveEnabled ? (annualPaidLeave / 12) * prorationFactor : 0,
          rol: isQualified && rules.accrualRolEnabled ? (annualRol / 12) * prorationFactor : 0,
          ex_holidays: isQualified && rules.accrualExHolidaysEnabled ? (annualExHolidays / 12) * prorationFactor : 0
        };

        if (blockingFound) {
           notes += `Bloqué par motif d'absence. `;
        } else if (usefulDaysCount < (rules.usefulDaysThreshold || 14)) {
           notes += `Jours utiles insuffisants: ${usefulDaysCount}/${rules.usefulDaysThreshold || 14}. `;
        }

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
          calculationMode: usefulDaysMode,
          sourceAttendanceIds,
          sourceRequestIds,
          blockingReasons,
          calculationWarnings,
          needsReview: false,
          hasDiscrepancy: false,
          impactedByRequestIds: [],
          lastImpactDetectedAt: null,
          reviewReason: null,
          createdAt: serverTimestamp(),
          createdByUid: actorUid,
          updatedAt: serverTimestamp(),
          updatedByUid: actorUid
        };

        transaction.set(accrualRef, sanitizePayload(payload), { merge: true });
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
    details: { targetsCount: targets.length, month, year, mode: usefulDaysMode }
  });

  return results;
}

/**
 * Phase 2I: Posts a confirmed monthly accrual to the annual leave balance.
 */
export async function postMonthlyAccrualToBalance(
  entityId: string,
  accrualId: string,
  actorUid: string,
  actorRole: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const accrualRef = doc(db, `entities/${entityId}/monthlyAccruals`, accrualId);

  return await runTransaction(db, async (transaction) => {
    const accrualSnap = await transaction.get(accrualRef);
    if (!accrualSnap.exists()) throw new Error("Maturation introuvable.");
    const accrualData = accrualSnap.data() as MonthlyAccrual;

    const balanceId = `${accrualData.employeeId}_${accrualData.year}`;
    const balanceRef = doc(db, `entities/${entityId}/leaveBalances`, balanceId);
    const balanceSnap = await transaction.get(balanceRef);

    if (accrualData.status === "posted") throw new Error("Cette maturation a déjà été postée au solde.");
    if (accrualData.status !== "confirmed") throw new Error("La maturation doit être confirmée avant d’être postée.");
    if (!accrualData.isAccrualQualified) throw new Error("Cette maturation n’est pas qualifiée.");
    
    if (accrualData.needsReview) {
      throw new Error("Cette maturation doit être revue avant d’être postée.");
    }

    const hasValues = (accrualData.accrued.paid_leave > 0 || accrualData.accrued.rol > 0 || accrualData.accrued.ex_holidays > 0);
    if (!hasValues) throw new Error("Aucune valeur de maturation à poster.");

    let balance: LeaveBalance;
    if (!balanceSnap.exists()) {
       const initial = await getOrCreateLeaveBalance(transaction, entityId, accrualData.employeeId, accrualData.year, actorUid, actorRole);
       balance = initial.data;
    } else {
       balance = normalizeBalance(balanceSnap.data());
    }

    const counters = { ...balance.counters! };
    
    const countersToProcess: (keyof typeof counters)[] = ["paid_leave", "rol", "ex_holidays"];
    countersToProcess.forEach(type => {
      const addedValue = accrualData.accrued[type as keyof typeof accrualData.accrued] || 0;
      const c = counters[type];
      c.accrued += addedValue;
      c.remaining = c.carriedOver + c.accrued - c.used;
    });

    const now = serverTimestamp();
    const balanceUpdate: any = {
      counters,
      updatedAt: now,
      updatedByUid: actorUid,
      updatedByRole: actorRole,
      entitlementDays: counters.paid_leave.entitlement,
      carriedOverDays: counters.paid_leave.carriedOver,
      usedDays: counters.paid_leave.used,
      pendingDays: counters.paid_leave.pending,
      remainingDays: counters.paid_leave.remaining,
    };

    transaction.set(balanceRef, sanitizePayload(balanceUpdate), { merge: true });
    transaction.update(accrualRef, {
      status: "posted",
      postedAt: now,
      postedByUid: actorUid,
      postedToBalanceId: balanceId,
      postedValues: accrualData.accrued,
      updatedAt: now,
      updatedByUid: actorUid
    });

    return { balanceId, year: accrualData.year, month: accrualData.month };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "monthlyAccrual.posted",
      resourceType: "monthlyAccrual",
      resourceId: accrualId,
      details: { balanceId: res.balanceId, year: res.year, month: res.month }
    });
  });
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
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as any as TimeOffRequest));
}
