/**
 * @fileOverview Payroll service layer for Monthly Economic Calculation.
 * Handles attendance aggregation, pre-payroll reconciliation, and economic calculation.
 * 7L Fix: Dynamic resolution of rates and premiums from CCNL Root and Level.
 */

import { 
  Firestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  FieldValue,
  runTransaction
} from "firebase/firestore";
import { 
  PayrollAttendanceAggregation, 
  PayrollReconciliationWarning, 
  PayrollCalculation,
  PayrollRateSnapshot,
  PayrollWeeklyBreakdown,
  PayrollParameter,
  PayrollPayCalculationMode
} from "@/types/payroll";
import { AttendanceRecord } from "@/types/attendance";
import { TimeOffRequest } from "@/types/time-off";
import { resolveWorkSchedule } from "./work-schedule.service";
import { 
  format, 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  addMonths, 
  eachDayOfInterval, 
  startOfWeek, 
  endOfWeek, 
  addDays 
} from "date-fns";
import { fr } from "date-fns/locale";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { getDefaultAccrualRules, resolveAccrualRulesForCcnlLevel } from "./ccnl.service";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { createAuditLog } from "./audit.service";

// --- Internal Overtime Reconciliation Helpers ---

function getWeekContext(dateIso: string) {
  const date = parseISO(dateIso);
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  
  return {
    weekKey: `${format(start, 'yyyy')}-W${format(start, 'II')}`,
    weekStart: format(start, 'yyyy-MM-dd'),
    weekEnd: format(end, 'yyyy-MM-dd')
  };
}

interface WorkedSegment {
  start: Date;
  end: Date;
  isHoliday: boolean;
}

interface ClassifiedSegment {
  start: Date;
  end: Date;
  durationHours: number;
  isNight: boolean;
  isSunday: boolean;
  isHoliday: boolean;
}

function getWorkedSegmentsFromRecord(record: AttendanceRecord, holidaysMap: Map<string, string>): WorkedSegment[] {
  const baseDate = parseISO(record.attendanceDate);
  const segments: WorkedSegment[] = [];
  const isHoliday = record.holidayFlag || holidaysMap.has(record.attendanceDate);

  record.punches?.forEach(p => {
    if (!p.timeIn || !p.timeOut || p.timeIn === 'INVALID' || p.timeOut === 'INVALID') return;

    const [hIn, mIn] = p.timeIn.split(':').map(Number);
    const [hOut, mOut] = p.timeOut.split(':').map(Number);

    if (isNaN(hIn) || isNaN(mIn) || isNaN(hOut) || isNaN(mOut)) return;

    const start = new Date(baseDate);
    start.setHours(hIn, mIn, 0, 0);

    let end = new Date(baseDate);
    end.setHours(hOut, mOut, 0, 0);

    if (end < start) {
      end = addDays(end, 1);
    }

    segments.push({
      start,
      end,
      isHoliday: isHoliday || false
    });
  });

  return segments;
}

function splitSegmentByBoundaries(segment: WorkedSegment): ClassifiedSegment[] {
  const start = segment.start.getTime();
  const end = segment.end.getTime();
  const boundaries = new Set<number>();

  const addBoundary = (date: Date, hours: number) => {
    const b = new Date(date);
    b.setHours(hours, 0, 0, 0);
    const t = b.getTime();
    if (t > start && t < end) boundaries.add(t);
  };

  [segment.start, addDays(segment.start, 1)].forEach(d => {
    [0, 6, 22].forEach(h => addBoundary(d, h));
  });

  // Numeric sort to ensure chronological segments
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
  const timePoints = [start, ...sortedBoundaries, end];
  
  const result: ClassifiedSegment[] = [];

  for (let i = 0; i < timePoints.length - 1; i++) {
    const s = new Date(timePoints[i]);
    const e = new Date(timePoints[i+1]);
    const duration = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
    
    const mid = new Date(s.getTime() + (e.getTime() - s.getTime()) / 2);
    const h = mid.getHours();
    
    result.push({
      start: s,
      end: e,
      durationHours: Number(duration.toFixed(4)),
      isNight: h >= 22 || h < 6,
      isSunday: mid.getDay() === 0,
      isHoliday: segment.isHoliday
    });
  }

  return result;
}

function classifyExclusiveSegment(seg: ClassifiedSegment): 'holiday' | 'sunday' | 'night' | 'day' {
  if (seg.isHoliday) return 'holiday';
  if (seg.isSunday) return 'sunday';
  if (seg.isNight) return 'night';
  return 'day';
}

async function reconcileWeeklyOvertime(
  records: AttendanceRecord[],
  expectedWeeklyHours: number | null,
  holidaysMap: Map<string, string>
): Promise<{
  weeklyReconciledOvertimeHours: number;
  overtimeDayHours: number;
  overtimeNightHours: number;
  overtimeSundayHours: number;
  overtimeHolidayHours: number;
  sundayWorkedHours: number;
  ordinaryNightHours: number;
  weeklyBreakdown: PayrollWeeklyBreakdown[];
}> {
  if (expectedWeeklyHours === null) {
    return {
      weeklyReconciledOvertimeHours: 0,
      overtimeDayHours: 0,
      overtimeNightHours: 0,
      overtimeSundayHours: 0,
      overtimeHolidayHours: 0,
      sundayWorkedHours: 0,
      ordinaryNightHours: 0,
      weeklyBreakdown: []
    };
  }

  const weeksMap = new Map<string, { weekStart: string, weekEnd: string, records: AttendanceRecord[] }>();
  records.forEach(r => {
    const ctx = getWeekContext(r.attendanceDate);
    if (!weeksMap.has(ctx.weekKey)) {
      weeksMap.set(ctx.weekKey, { weekStart: ctx.weekStart, weekEnd: ctx.weekEnd, records: [] });
    }
    weeksMap.get(ctx.weekKey)!.records.push(r);
  });

  let totalOvertime = 0;
  let totalOvDay = 0;
  let totalOvNight = 0;
  let totalOvSun = 0;
  let totalOvHol = 0;
  let totalSundayWorked = 0;
  let totalOrdNight = 0;
  const breakdown: PayrollWeeklyBreakdown[] = [];

  for (const [weekKey, weekData] of Array.from(weeksMap.entries())) {
    const weekRecords = [...weekData.records].sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate));
    
    const allSegments: ClassifiedSegment[] = [];
    weekRecords.forEach(r => {
      const worked = getWorkedSegmentsFromRecord(r, holidaysMap);
      worked.forEach(ws => {
        allSegments.push(...splitSegmentByBoundaries(ws));
      });
    });

    allSegments.sort((a, b) => a.start.getTime() - b.start.getTime());

    let weekWorked = 0;
    let weekOvDay = 0;
    let weekOvNight = 0;
    let weekOvSun = 0;
    let weekOvHol = 0;
    let weekSundayWorked = 0;
    let weekOrdNight = 0;
    const weekRawSup = weekRecords.reduce((s, r) => s + (r.overtimeHours || 0), 0);

    for (const seg of allSegments) {
      const remaining = seg.durationHours;
      if (seg.isSunday && remaining > 0) {
        weekSundayWorked += remaining;
      }
      const portionBefore = Math.max(0, Math.min(remaining, expectedWeeklyHours - weekWorked));
      const portionAfter = remaining - portionBefore;
      
      if (portionBefore > 0) {
        if (seg.isNight) weekOrdNight += portionBefore;
      }

      if (portionAfter > 0) {
        const cat = classifyExclusiveSegment(seg);
        if (cat === 'holiday') weekOvHol += portionAfter;
        else if (cat === 'sunday') weekOvSun += portionAfter;
        else if (cat === 'night') weekOvNight += portionAfter;
        else weekOvDay += portionAfter;
      }

      weekWorked += remaining;
    }

    const weekOv = Math.max(0, weekWorked - expectedWeeklyHours);
    
    breakdown.push({
      weekKey,
      weekStart: weekData.weekStart,
      weekEnd: weekData.weekEnd,
      expectedWeeklyHours,
      workedHoursInWeek: Number(weekWorked.toFixed(2)),
      rawImportedOvertimeHours: Number(weekRawSup.toFixed(2)),
      weeklyOvertimeHours: Number(weekOv.toFixed(2)),
      ordinaryNightHours: Number(weekOrdNight.toFixed(2)),
      overtimeDayHours: Number(weekOvDay.toFixed(2)),
      overtimeNightHours: Number(weekOvNight.toFixed(2)),
      overtimeSundayHours: Number(weekOvSun.toFixed(2)),
      overtimeHolidayHours: Number(weekOvHol.toFixed(2)),
      classificationStatus: "classified"
    });

    totalOvertime += weekOv;
    totalOvDay += weekOvDay;
    totalOvNight += weekOvNight;
    totalOvSun += weekOvSun;
    totalOvHol += weekOvHol;
    totalSundayWorked += weekSundayWorked;
    totalOrdNight += weekOrdNight;
  }

  return {
    weeklyReconciledOvertimeHours: Number(totalOvertime.toFixed(2)),
    overtimeDayHours: Number(totalOvDay.toFixed(2)),
    overtimeNightHours: Number(totalOvNight.toFixed(2)),
    overtimeSundayHours: Number(totalOvSun.toFixed(2)),
    overtimeHolidayHours: Number(totalOvHol.toFixed(2)),
    sundayWorkedHours: Number(totalSundayWorked.toFixed(2)),
    ordinaryNightHours: Number(totalOrdNight.toFixed(2)),
    weeklyBreakdown: breakdown
  };
}

// --- Main Service Logic ---

/**
 * Hardened sanitizer that only recurses into plain objects and arrays.
 * Uses a WeakSet for cycle detection.
 * Preserves Date, Timestamp, and FieldValue identities.
 */
function sanitizeForFirestore(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj === undefined ? null : obj;
  }

  if (seen.has(obj)) return "[Circular]";

  // Base Cases: native Firestore types
  if (
    obj instanceof Date || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'FieldValue' || 
    (obj as any)._methodName === 'serverTimestamp' ||
    typeof (obj as any).toDate === 'function'
  ) {
    return obj;
  }

  const isArray = Array.isArray(obj);
  // Strict plain object check: must be {} or new Object()
  const isPlainObject = Object.prototype.toString.call(obj) === '[object Object]';
  
  if (!isArray && !isPlainObject) {
    return typeof obj.toString === 'function' ? obj.toString() : "[Opaque Object]";
  }

  seen.add(obj);

  if (isArray) {
    return obj.map(item => sanitizeForFirestore(item, seen));
  }

  const newObj: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      newObj[key] = sanitizeForFirestore(obj[key], seen);
    }
  }
  return newObj;
}

export async function getPayrollMonthRange(year: number, month: number) {
  if (month < 1 || month > 12) throw new Error("Mois invalide (1-12)");
  
  const startDate = startOfMonth(new Date(year, month - 1));
  const endDate = endOfMonth(startDate);
  const nextMonthStart = addMonths(startDate, 1);

  return {
    startDateIso: format(startDate, "yyyy-MM-dd"),
    endDateIso: format(endDate, "yyyy-MM-dd"),
    nextMonthStartDateIso: format(nextMonthStart, "yyyy-MM-dd")
  };
}

export async function percentageToMultiplier(percent?: number | null): Promise<number> {
  if (percent === undefined || percent === null || isNaN(percent) || percent < 0) return 1;
  if (percent === 0) return 1;
  return 1 + (percent / 100);
}

export async function percentageToDecimal(percent?: number | null): Promise<number> {
  if (percent === undefined || percent === null || isNaN(percent) || percent < 0) return 0;
  return percent / 100;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function resolveSupportedPayCalculationMode(
  mode?: PayrollPayCalculationMode | null
): PayrollPayCalculationMode | undefined {
  return mode === "monthly" || mode === "hourly" || mode === "actual_worked_hours"
    ? mode
    : undefined;
}

async function resolvePaidHolidayHoursForActualWorkedMode(
  db: Firestore,
  entityId: string,
  employeeId: string,
  holidayDates: string[]
): Promise<number> {
  let paidHolidayHours = 0;

  for (const holidayDate of holidayDates) {
    const schedule = await resolveWorkSchedule(db, entityId, employeeId, holidayDate);
    if (schedule.isReliable && typeof schedule.expectedDailyHours === "number") {
      paidHolidayHours += Math.max(0, schedule.expectedDailyHours);
    }
  }

  return Number(paidHolidayHours.toFixed(2));
}

export async function aggregateMonthlyAttendance(
  db: Firestore, 
  entityId: string, 
  year: number, 
  month: number,
  holidaysMap: Map<string, string>
): Promise<Record<string, PayrollAttendanceAggregation>> {
  const { startDateIso, nextMonthStartDateIso } = await getPayrollMonthRange(year, month);
  
  const attendanceRef = collection(db, `entities/${entityId}/attendances`);
  const q = query(
    attendanceRef,
    where("attendanceDate", ">=", startDateIso),
    where("attendanceDate", "<", nextMonthStartDateIso)
  );

  const snap = await getDocs(q);
  const reliableStatuses = ["validated", "corrected", "locked"];
  const aggregations: Record<string, PayrollAttendanceAggregation> = {};

  snap.docs.forEach(d => {
    const data = d.data() as AttendanceRecord;
    if (!reliableStatuses.includes(data.status)) return;

    const empId = data.employeeId;
    if (!aggregations[empId]) {
      aggregations[empId] = {
        employeeId: empId,
        year,
        month,
        totalValidatedHours: 0,
        ordinaryDayHours: 0,
        ordinaryNightHours: 0,
        overtimeHours: 0,
        holidayWorkedHours: 0,
        sundayWorkedHours: 0,
        workedDays: 0,
        sourceAttendanceIds: []
      };
    }

    const agg = aggregations[empId];
    agg.sourceAttendanceIds.push(d.id);
    
    const vh = data.validatedHours || 0;
    if (vh > 0) agg.workedDays++;
    const attendanceDate = parseISO(data.attendanceDate);
    if (!isNaN(attendanceDate.getTime()) && attendanceDate.getDay() === 0 && vh > 0) {
      agg.sundayWorkedHours = (agg.sundayWorkedHours || 0) + vh;
    }

    const hasSplits = (data.dayHours || 0) > 0 || (data.nightHours || 0) > 0 || (data.overtimeHours || 0) > 0;
    
    if (vh > 0 && !hasSplits) {
      agg.ordinaryDayHours += vh;
      agg.hasLegacyFallback = true;
      agg.legacyFallbackReason = "Granular day/night split missing.";
    } else {
      agg.ordinaryDayHours += data.dayHours || 0;
      agg.ordinaryNightHours += data.nightHours || 0;
      agg.overtimeHours += data.overtimeHours || 0;
    }

    agg.totalValidatedHours += vh;
    
    // Robust Holiday Worked Hours aggregation (Flag OR Registry match)
    const isHoliday = data.holidayFlag === true || holidaysMap.has(data.attendanceDate);
    const hw = data.holidayWorkedHours || (isHoliday ? vh : 0);
    agg.holidayWorkedHours += hw;
  });

  return aggregations;
}

export async function buildPrePayrollReconciliation(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  aggregations: Record<string, PayrollAttendanceAggregation>
): Promise<PayrollReconciliationWarning[]> {
  const { startDateIso, endDateIso } = await getPayrollMonthRange(year, month);
  const warnings: PayrollReconciliationWarning[] = [];

  const timeOffRef = collection(db, `entities/${entityId}/timeOffRequests`);
  const toSnap = await getDocs(query(timeOffRef, where("status", "==", "approved")));
  const approvedRequests = toSnap.docs
    .map(d => d.data() as TimeOffRequest)
    .filter(r => r.startDate <= endDateIso && r.endDate >= startDateIso);

  for (const empId of Object.keys(aggregations)) {
    const { startDateIso: s, endDateIso: e } = await getPayrollMonthRange(year, month);
    const days = eachDayOfInterval({ start: parseISO(s), end: parseISO(e) });
    
    for (const day of days) {
      const dateIso = format(day, "yyyy-MM-dd");
      const schedule = await resolveWorkSchedule(db, entityId, empId, dateIso);
      
      if (!schedule.isReliable) {
        warnings.push({
          code: "missing_schedule",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Horaire contractuel introuvable.",
        });
      }
    }
  }

  return warnings;
}

export async function resolvePayrollRateSnapshot(
  db: Firestore,
  entityId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<PayrollRateSnapshot> {
  const { startDateIso, endDateIso } = await getPayrollMonthRange(year, month);
  const [empRefSnap, paramsSnap] = await Promise.all([
    getDoc(doc(db, `entities/${entityId}/employees`, employeeId)),
    getDocs(query(
      collection(db, `entities/${entityId}/payrollParameters`),
      where("employeeId", "==", employeeId),
      where("status", "==", "active"),
      where("effectiveFrom", "<=", endDateIso),
      orderBy("effectiveFrom", "desc"),
    ))
  ]);

  if (!empRefSnap.exists()) return { source: "missing", ordinaryHourlyRate: 0 };
  const emp = empRefSnap.data() as Employee;
  if (!emp.activeContractId) return { source: "missing", ordinaryHourlyRate: 0 };

  const activeParamDoc = paramsSnap.docs.find((parameterDoc) => {
    const parameter = parameterDoc.data() as PayrollParameter;
    return !parameter.effectiveTo || parameter.effectiveTo >= startDateIso;
  });
  const activeParam = activeParamDoc
    ? { ...activeParamDoc.data(), id: activeParamDoc.id } as PayrollParameter
    : null;

  const contractSnap = await getDoc(
    doc(db, `entities/${entityId}/contracts`, emp.activeContractId)
  );

  if (!contractSnap.exists()) return { source: "missing", ordinaryHourlyRate: 0 };
  const contract = contractSnap.data() as Contract;

  let ccnlData: CCNL | null = null;
  let levelData: CCNLLevel | null = null;

  if (contract.ccnlId) {
    const ccnlSnap = await getDoc(doc(db, `entities/${entityId}/ccnls`, contract.ccnlId));
    if (ccnlSnap.exists()) ccnlData = ccnlSnap.data() as CCNL;
  }

  if (contract.ccnlId && contract.levelId) {
    const levelSnap = await getDoc(doc(db, `entities/${entityId}/ccnls/${contract.ccnlId}/levels`, contract.levelId));
    if (levelSnap.exists()) levelData = levelSnap.data() as CCNLLevel;
  }

  // 1. Rate Priority: PayrollParameter > Level Rate > (Monthly / Divisor)
  const isValidPositive = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

  let rate = isValidPositive(activeParam?.ordinaryHourlyRate)
    ? activeParam.ordinaryHourlyRate
    : isValidPositive(levelData?.minimumGrossHourly)
      ? levelData.minimumGrossHourly
      : 0;
  const divisor = ccnlData?.hourlyDivisor || 0;
  const monthly = isValidPositive(activeParam?.grossMonthly)
    ? activeParam.grossMonthly
    : isValidPositive(levelData?.minimumGrossMonthly)
      ? levelData.minimumGrossMonthly
      : isValidPositive(contract.grossMonthly)
        ? contract.grossMonthly
        : null;

  if (rate <= 0 && monthly !== null && divisor > 0) {
    rate = monthly / divisor;
  }

  // 2. Expected Weekly Hours priority: Contract > Root Standard > Root Schedule Sum
  let expectedWeeklyHours: number | null = null;
  const isValidNum = (v: any): v is number => typeof v === 'number' && v > 0;

  if (isValidNum(contract.weeklyHours)) {
    expectedWeeklyHours = contract.weeklyHours;
  } else if (ccnlData && isValidNum(ccnlData.standardWeeklyHours)) {
    expectedWeeklyHours = ccnlData.standardWeeklyHours;
  } else if (ccnlData && ccnlData.weeklySchedule) {
    const s = ccnlData.weeklySchedule;
    const sum = (s.monday || 0) + (s.tuesday || 0) + (s.wednesday || 0) + (s.thursday || 0) + (s.friday || 0) + (s.saturday || 0) + (s.sunday || 0);
    if (sum > 0) expectedWeeklyHours = sum;
  }

  // 3. Premium Priority: PayrollParameter > Level value > null
  const payCalculationMode =
    resolveSupportedPayCalculationMode(activeParam?.payCalculationMode) ??
    resolveSupportedPayCalculationMode(contract.payCalculationMode) ??
    "monthly";

  return {
    source: activeParam ? "payroll_parameter" : (levelData ? "ccnl_level" : "contract"),
    payCalculationMode,
    ordinaryHourlyRate: rate || 0,
    grossMonthly: monthly,
    levelCode: contract.levelCode || levelData?.levelCode || null,
    expectedWeeklyHours,
    contractId: emp.activeContractId,
    ccnlId: contract.ccnlId,
    ccnlLevelId: contract.levelId,
    payrollParameterId: activeParamDoc?.id,
    nightPremiumPercent: activeParam?.nightPremiumPercent ?? levelData?.nightPremiumPercent ?? null,
    overtimePremiumPercent: activeParam?.overtimePremiumPercent ?? levelData?.overtimePremiumPercent ?? null,
    overtimeNightPremiumPercent: activeParam?.overtimeNightPremiumPercent ?? levelData?.overtimeNightPremiumPercent ?? null,
    holidayPremiumPercent: activeParam?.holidayPremiumPercent ?? levelData?.holidayPremiumPercent ?? null,
    sundayPremiumPercent: activeParam?.sundayPremiumPercent ?? levelData?.sundayPremiumPercent ?? null,
  };
}

export async function calculatePayrollEconomicValues(
  agg: PayrollAttendanceAggregation,
  rate: PayrollRateSnapshot,
  warnings: PayrollReconciliationWarning[] = [],
  options: { paidHolidayHours?: number } = {}
): Promise<any> {
  const rateValue = rate.ordinaryHourlyRate || 0;
  const isMonthly = rate.payCalculationMode === "monthly";
  const isActualWorkedHours = rate.payCalculationMode === "actual_worked_hours";

  const addMissingPremiumWarning = (
    premium: number | null | undefined,
    applicableHours: number,
    label: string
  ) => {
    if (premium == null && applicableHours > 0) {
      warnings.push({
        code: "missing_premium_rule",
        severity: "warning",
        employeeId: agg.employeeId,
        message: `Majoration ${label} non configurée pour ${applicableHours.toFixed(2)} heure(s).`
      });
    }
  };

  if (isMonthly && rate.grossMonthly == null) {
    warnings.push({
      code: "missing_monthly_gross",
      severity: "blocking",
      employeeId: agg.employeeId,
      message: "Salaire brut mensuel introuvable dans le paramètre salarié, le Livello et le contrat."
    });
  }

  if (isActualWorkedHours && rateValue <= 0) {
    warnings.push({
      code: "missing_payroll_rate",
      severity: "blocking",
      employeeId: agg.employeeId,
      message: "Taux horaire ordinaire introuvable pour le mode heures réellement travaillées."
    });
  }

  addMissingPremiumWarning(rate.nightPremiumPercent, agg.ordinaryNightHours || 0, "de nuit");
  addMissingPremiumWarning(rate.overtimePremiumPercent, agg.overtimeDayHours || 0, "heures supplémentaires");
  addMissingPremiumWarning(rate.overtimeNightPremiumPercent, agg.overtimeNightHours || 0, "heures supplémentaires de nuit");
  const sundayPremiumHours = isActualWorkedHours
    ? (agg.sundayWorkedHours || 0)
    : (agg.overtimeSundayHours || 0);
  addMissingPremiumWarning(rate.sundayPremiumPercent, sundayPremiumHours, "dimanche");
  addMissingPremiumWarning(
    rate.holidayPremiumPercent,
    Math.max(agg.holidayWorkedHours || 0, agg.overtimeHolidayHours || 0),
    "jour férié"
  );
  
  let baseGrossValue = 0;
  const baseWorkedValue = roundMoney(agg.totalValidatedHours * rateValue);
  const paidHolidayHours = isActualWorkedHours ? options.paidHolidayHours ?? 0 : 0;
  const paidHolidayValue = isActualWorkedHours ? roundMoney(paidHolidayHours * rateValue) : 0;

  if (isMonthly) {
    baseGrossValue = roundMoney(rate.grossMonthly || 0);
  } else {
    baseGrossValue = baseWorkedValue;
  }

  const pNight = (rate.nightPremiumPercent || 0) / 100;
  const pOvDay = (rate.overtimePremiumPercent || 0) / 100;
  const pOvNight = (rate.overtimeNightPremiumPercent || 0) / 100;
  const pOvSun = (rate.sundayPremiumPercent || 0) / 100;
  const pOvHol = (rate.holidayPremiumPercent || 0) / 100;

  const nightValue = roundMoney(agg.ordinaryNightHours * rateValue * pNight);
  const overtimeDayValue = isActualWorkedHours
    ? roundMoney((agg.overtimeDayHours || 0) * rateValue * pOvDay)
    : roundMoney((agg.overtimeDayHours || 0) * rateValue * (1 + pOvDay));
  const overtimeNightValue = isActualWorkedHours
    ? roundMoney((agg.overtimeNightHours || 0) * rateValue * pOvNight)
    : roundMoney((agg.overtimeNightHours || 0) * rateValue * (1 + pOvNight));
  const overtimeSundayValue = isActualWorkedHours
    ? roundMoney(sundayPremiumHours * rateValue * pOvSun)
    : roundMoney((agg.overtimeSundayHours || 0) * rateValue * (1 + pOvSun));
  const overtimeHolidayValue = isActualWorkedHours
    ? roundMoney((agg.overtimeHolidayHours || 0) * rateValue * pOvHol)
    : roundMoney((agg.overtimeHolidayHours || 0) * rateValue * (1 + pOvHol));

  const overtimeValue = roundMoney(overtimeDayValue + overtimeNightValue + overtimeSundayValue + overtimeHolidayValue);

  // Calculate ordinary holiday value (total holiday hours minus those already paid as overtime)
  const ordinaryHolidayHours = Math.max(0, (agg.holidayWorkedHours || 0) - (agg.overtimeHolidayHours || 0));
  const holidayWorkedValue = isActualWorkedHours
    ? roundMoney((agg.holidayWorkedHours || 0) * rateValue * pOvHol)
    : roundMoney(ordinaryHolidayHours * rateValue * (1 + pOvHol));

  const grossEconomicTotal = roundMoney(
    baseGrossValue + paidHolidayValue + nightValue + overtimeValue + holidayWorkedValue
  );

  const result: any = {
    baseGrossValue,
    ordinaryValue: isMonthly ? baseGrossValue : baseWorkedValue,
    nightValue,
    overtimeValue,
    overtimeDayValue,
    overtimeNightValue,
    overtimeSundayValue,
    overtimeHolidayValue,
    holidayWorkedValue,
    deductionValue: 0,
    mealTicketsValue: 0,
    mileageValue: 0,
    bonusValue: 0,
    grossEconomicTotal
  };

  if (isActualWorkedHours) {
    result.baseWorkedValue = baseWorkedValue;
    result.paidHolidayHours = paidHolidayHours;
    result.paidHolidayValue = paidHolidayValue;
    result.calculationFormulaVersion = "actual_worked_hours_v1";
  }

  return result;
}

export async function saveMonthlyPayrollCalculations(
  db: Firestore,
  entityId: string,
  calculations: PayrollCalculation[],
  actorUid: string
) {
  const results = { created: 0, updated: 0, skipped: 0 };

  for (const calc of calculations) {
    const calcRef = doc(db, `entities/${entityId}/payrollCalculations`, calc.id);
    const sanitizedCalc = sanitizeForFirestore(calc);
    await setDoc(calcRef, {
      ...sanitizedCalc,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid
    }, { merge: true });
    results.created++;
  }

  return results;
}

export async function calculateAndSaveMonthlyPayroll(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  actorUid: string
) {
  const { startDateIso, endDateIso, nextMonthStartDateIso } = await getPayrollMonthRange(year, month);
  
  // Fetch Holidays from Registry for robust detection (Phase Fix)
  const holidaysRef = collection(db, `entities/${entityId}/holidays`);
  const hQuery = query(
    holidaysRef,
    where("date", ">=", startDateIso),
    where("date", "<=", endDateIso)
  );
  const hSnap = await getDocs(hQuery);
  const holidaysMap = new Map<string, string>();
  hSnap.docs.forEach(d => {
    const h = d.data();
    if (h.status === 'active') {
      holidaysMap.set(h.date, h.name);
    }
  });

  const aggregations = await aggregateMonthlyAttendance(db, entityId, year, month, holidaysMap);
  const allWarnings = await buildPrePayrollReconciliation(db, entityId, year, month, aggregations);
  
  const finalCalculations: PayrollCalculation[] = [];
  let failedCount = 0;

  for (const empId of Object.keys(aggregations)) {
    try {
      const agg = aggregations[empId];
      const rate = await resolvePayrollRateSnapshot(db, entityId, empId, year, month);
      const empWarnings = allWarnings.filter(w => w.employeeId === empId);
      const paidHolidayHours =
        rate.payCalculationMode === "actual_worked_hours"
          ? await resolvePaidHolidayHoursForActualWorkedMode(
              db,
              entityId,
              empId,
              Array.from(holidaysMap.keys())
            )
          : 0;

      const threshold = rate.expectedWeeklyHours;

      if (!threshold) {
         empWarnings.push({
           code: "missing_weekly_schedule",
           severity: "warning",
           employeeId: empId,
           message: "Seuil hebdomadaire non détecté. Réconciliation SUP bloquée."
         });
         agg.overtimeHours = 0; 
         agg.weeklyBreakdown = [];
      } else {
         const attRef = collection(db, `entities/${entityId}/attendances`);
         const attSnap = await getDocs(query(
           attRef,
           where("employeeId", "==", empId),
           where("attendanceDate", ">=", startDateIso),
           where("attendanceDate", "<", nextMonthStartDateIso)
         ));
         
         const reliableStatuses = ["validated", "corrected", "locked"];
         const records = attSnap.docs
           .map(d => ({ ...d.data(), id: d.id } as AttendanceRecord))
           .filter(r => reliableStatuses.includes(r.status));

         const reconciliation = await reconcileWeeklyOvertime(records, threshold, holidaysMap);
         
         agg.overtimeHours = reconciliation.weeklyReconciledOvertimeHours;
         agg.ordinaryNightHours = reconciliation.ordinaryNightHours;
         agg.overtimeDayHours = reconciliation.overtimeDayHours;
         agg.overtimeNightHours = reconciliation.overtimeNightHours;
         agg.overtimeSundayHours = reconciliation.overtimeSundayHours;
         agg.overtimeHolidayHours = reconciliation.overtimeHolidayHours;
         agg.sundayWorkedHours = reconciliation.sundayWorkedHours;
         agg.weeklyBreakdown = reconciliation.weeklyBreakdown;
      }

      const econ = await calculatePayrollEconomicValues(agg, rate, empWarnings, {
        paidHolidayHours
      });

      finalCalculations.push({
        id: `${empId}_${year}_${month}`,
        entityId,
        employeeId: empId,
        year,
        month,
        status: "calculated",
        attendanceAggregation: agg,
        rateSnapshot: rate,
        reconciliationWarnings: empWarnings,
        ...econ,
        sourceAttendanceIds: agg.sourceAttendanceIds,
        calculatedAt: new Date(),
        calculatedBy: actorUid,
        createdAt: new Date(),
        createdBy: actorUid,
        updatedAt: new Date(),
        updatedBy: actorUid
      });
    } catch (err: any) {
      failedCount++;
      console.error(`[Payroll:Isolation] Calculation failed for employee ${empId}:`, err.message);
    }
  }

  const saveResults = await saveMonthlyPayrollCalculations(db, entityId, finalCalculations, actorUid);

  try {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "payroll.calculated",
      resourceType: "payrollCalculation",
      resourceId: `${year}_${month}`,
      details: {
        year,
        month,
        employeesCalculated: finalCalculations.length,
        calculationsCreatedOrUpdated: saveResults.created + saveResults.updated,
        warningsCount: finalCalculations.reduce(
          (total, calculation) => total + calculation.reconciliationWarnings.length,
          0
        ),
        totalGrossEconomicAmount: roundMoney(
          finalCalculations.reduce(
            (total, calculation) => total + calculation.grossEconomicTotal,
            0
          )
        )
      }
    });
  } catch (auditError) {
    console.warn("[Payroll] Failed to write payroll calculation audit log:", auditError);
  }

  return {
    totalEmployees: Object.keys(aggregations).length,
    ...saveResults,
    failedCount
  };
}
