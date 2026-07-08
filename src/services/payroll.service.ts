'use server';

/**
 * @fileOverview Payroll service layer for Monthly Economic Calculation.
 * Handles attendance aggregation, pre-payroll reconciliation, and economic calculation.
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
  limit,
  Timestamp,
  FieldValue,
  arrayUnion
} from "firebase/firestore";
import { 
  PayrollAttendanceAggregation, 
  PayrollReconciliationWarning, 
  PayrollCalculation,
  PayrollRateSnapshot,
  PayrollParameter,
  PayrollCalculationStatus,
  PayrollWeeklyBreakdown
} from "@/types/payroll";
import { AttendanceRecord, AttendancePunch } from "@/types/attendance";
import { TimeOffRequest } from "@/types/time-off";
import { resolveWorkSchedule } from "./work-schedule.service";
import { 
  format, 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  addMonths, 
  eachMonthOfInterval, 
  eachDayOfInterval, 
  startOfWeek, 
  endOfWeek, 
  addDays 
} from "date-fns";
import { fr } from "date-fns/locale";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { getDefaultAccrualRules, resolveAccrualRulesForCcnlLevel } from "./ccnl.service";
import { createNotification } from "./notification.service";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";

// --- Internal Overtime Reconciliation Helpers ---

/**
 * Identifies the ISO week context for a given date.
 * Thresholds for overtime are calculated on a Monday-Sunday basis.
 */
function getWeekContext(dateIso: string) {
  const date = parseISO(dateIso);
  const start = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(date, { weekStartsOn: 1 });   // Sunday
  
  return {
    weekKey: `${format(start, 'yyyy')}-W${format(start, 'II')}`,
    weekStart: format(start, 'yyyy-MM-dd'),
    weekEnd: format(end, 'yyyy-MM-dd')
  };
}

/**
 * Continuous period of work extracted from a single punch.
 */
interface WorkedSegment {
  start: Date;
  end: Date;
  isHoliday: boolean;
}

/**
 * Granular piece of work resulting from splitting at regulatory boundaries.
 */
interface ClassifiedSegment {
  start: Date;
  end: Date;
  durationHours: number;
  isNight: boolean;
  isSunday: boolean;
  isHoliday: boolean;
}

/**
 * Transforms AttendanceRecord punches into absolute datetime segments.
 * Correctly handles overnight shifts where timeOut is logically the next day.
 */
function getWorkedSegmentsFromRecord(record: AttendanceRecord): WorkedSegment[] {
  const baseDate = parseISO(record.attendanceDate);
  const segments: WorkedSegment[] = [];

  record.punches?.forEach(p => {
    if (!p.timeIn || !p.timeOut || p.timeIn === 'INVALID' || p.timeOut === 'INVALID') return;

    const [hIn, mIn] = p.timeIn.split(':').map(Number);
    const [hOut, mOut] = p.timeOut.split(':').map(Number);

    if (isNaN(hIn) || isNaN(mIn) || isNaN(hOut) || isNaN(mOut)) return;

    const start = new Date(baseDate);
    start.setHours(hIn, mIn, 0, 0);

    let end = new Date(baseDate);
    end.setHours(hOut, mOut, 0, 0);

    // Overnight shift detection (e.g. 22:00 -> 04:00)
    if (end < start) {
      end = addDays(end, 1);
    }

    segments.push({
      start,
      end,
      isHoliday: record.holidayFlag || false
    });
  });

  return segments;
}

/**
 * Slices a worked segment into smaller chunks at specific transition points:
 * - Midnight (00:00)
 * - Night Start (22:00)
 * - Night End (06:00)
 * 
 * This ensures that each slice can be classified exclusively.
 */
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

  // Check boundaries for day of punch and potential following day
  [segment.start, addDays(segment.start, 1)].forEach(d => {
    [0, 6, 22].forEach(h => addBoundary(d, h));
  });

  // Numeric sort to ensure chronological processing
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
  const timePoints = [start, ...sortedBoundaries, end];
  
  const result: ClassifiedSegment[] = [];

  for (let i = 0; i < timePoints.length - 1; i++) {
    const s = new Date(timePoints[i]);
    const e = new Date(timePoints[i+1]);
    const duration = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
    
    // Evaluate properties at segment midpoint
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

/**
 * Determines the primary premium category for a segment based on exclusive priority:
 * Holiday > Sunday > Night > Day.
 */
function classifyExclusiveSegment(seg: ClassifiedSegment): 'holiday' | 'sunday' | 'night' | 'day' {
  if (seg.isHoliday) return 'holiday';
  if (seg.isSunday) return 'sunday';
  if (seg.isNight) return 'night';
  return 'day';
}

/**
 * Performs weekly overtime reconciliation based on ISO weeks.
 * Chronologically identifies which hours exceed the weekly threshold.
 */
async function reconcileWeeklyOvertime(
  records: AttendanceRecord[],
  expectedWeeklyHours: number | null
): Promise<{
  weeklyReconciledOvertimeHours: number;
  overtimeDayHours: number;
  overtimeNightHours: number;
  overtimeSundayHours: number;
  overtimeHolidayHours: number;
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
      ordinaryNightHours: 0,
      weeklyBreakdown: []
    };
  }

  // 1. Group records by ISO week
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
  let totalOrdNight = 0;
  const breakdown: PayrollWeeklyBreakdown[] = [];

  // 2. Process each week
  for (const [weekKey, weekData] of Array.from(weeksMap.entries())) {
    const weekRecords = [...weekData.records].sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate));
    
    // Build chronological segments
    const allSegments: ClassifiedSegment[] = [];
    weekRecords.forEach(r => {
      const worked = getWorkedSegmentsFromRecord(r);
      worked.forEach(ws => {
        allSegments.push(...splitSegmentByBoundaries(ws));
      });
    });

    // Chronological sort across the entire week
    allSegments.sort((a, b) => a.start.getTime() - b.start.getTime());

    let weekWorked = 0;
    let weekOvDay = 0;
    let weekOvNight = 0;
    let weekOvSun = 0;
    let weekOvHol = 0;
    let weekOrdNight = 0;
    const weekRawSup = weekRecords.reduce((s, r) => s + (r.overtimeHours || 0), 0);

    for (const seg of allSegments) {
      const remaining = seg.durationHours;
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
    totalOrdNight += weekOrdNight;
  }

  return {
    weeklyReconciledOvertimeHours: Number(totalOvertime.toFixed(2)),
    overtimeDayHours: Number(totalOvDay.toFixed(2)),
    overtimeNightHours: Number(totalOvNight.toFixed(2)),
    overtimeSundayHours: Number(totalOvSun.toFixed(2)),
    overtimeHolidayHours: Number(totalOvHol.toFixed(2)),
    ordinaryNightHours: Number(totalOrdNight.toFixed(2)),
    weeklyBreakdown: breakdown
  };
}

// --- Main Service Logic ---

/**
 * Restrictive sanitizer for Firestore persistence.
 * Prevents stack overflows by strictly limiting recursion to plain objects and arrays.
 * Handles cycle detection with WeakSet.
 */
function sanitizeForFirestore(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj === undefined ? null : obj;
  }
  
  // Guard against infinite recursion
  if (seen.has(obj)) return "[Circular]";

  // Base Cases: Types Firestore natively understands
  if (
    obj instanceof Date || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'FieldValue' || 
    obj._methodName === 'serverTimestamp' ||
    typeof (obj as any).toDate === 'function'
  ) {
    return obj;
  }

  // STRICT: Only recurse if it's a plain object literal or Array.
  // Prevents traversing complex class instances (e.g. Error, internal SDK states).
  const isArray = Array.isArray(obj);
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

/**
 * Calculates the date range for a payroll month.
 */
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

/**
 * Helper to convert percentage to multiplier (e.g. 25 -> 1.25)
 */
export async function percentageToMultiplier(percent?: number | null): Promise<number> {
  if (percent === undefined || percent === null || isNaN(percent) || percent < 0) return 1;
  if (percent === 0) return 1;
  return 1 + (percent / 100);
}

/**
 * Helper to get pure premium decimal (e.g. 25 -> 0.25)
 */
export async function percentageToDecimal(percent?: number | null): Promise<number> {
  if (percent === undefined || percent === null || isNaN(percent) || percent < 0) return 0;
  return percent / 100;
}

/**
 * Round monetary value to 2 decimal places.
 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Aggregates validated attendance records for an entity/month.
 */
export async function aggregateMonthlyAttendance(
  db: Firestore, 
  entityId: string, 
  year: number, 
  month: number
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
        workedDays: 0,
        sourceAttendanceIds: []
      };
    }

    const agg = aggregations[empId];
    agg.sourceAttendanceIds.push(d.id);
    
    const vh = data.validatedHours || 0;
    if (vh > 0) agg.workedDays++;

    // Initial splits (Legacy Daily Fallback)
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
    agg.holidayWorkedHours += data.holidayWorkedHours || 0;
  });

  return aggregations;
}

/**
 * Builds pre-payroll reconciliation warnings for employees.
 */
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
    const agg = aggregations[empId];
    
    const attSnap = await getDocs(query(
      collection(db, `entities/${entityId}/attendances`),
      where("employeeId", "==", empId),
      where("attendanceDate", ">=", startDateIso),
      where("attendanceDate", "<=", endDateIso)
    ));
    const attMap = new Map(attSnap.docs.map(d => [d.data().attendanceDate, d.data() as AttendanceRecord]));

    const days = eachDayOfInterval({ start: parseISO(startDateIso), end: parseISO(endDateIso) });
    
    for (const day of days) {
      const dateIso = format(day, "yyyy-MM-dd");
      const schedule = await resolveWorkSchedule(db, entityId, empId, dateIso);
      const att = attMap.get(dateIso);
      const validatedHours = att?.validatedHours || 0;

      const dailyRequests = approvedRequests.filter(r => 
        empId === r.employeeId && dateIso >= r.startDate && dateIso <= r.endDate
      );

      let coveredHours = 0;
      dailyRequests.forEach(r => {
        if (r.unit === 'hours') {
          coveredHours += r.durationHours || 0;
        } else if (schedule.expectedDailyHours !== null) {
          const factor = r.dayPart !== 'full_day' ? 0.5 : 1;
          coveredHours += (schedule.expectedDailyHours * factor);
        }
      });

      if (!schedule.isReliable) {
        warnings.push({
          code: "missing_schedule",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Horaire contractuel introuvable.",
          validatedHours
        });
      }

      const expected = schedule.expectedDailyHours || 0;

      if (schedule.isReliable && expected > 0 && validatedHours > expected) {
        warnings.push({
          code: "over_expected_hours",
          severity: "info",
          employeeId: empId,
          date: dateIso,
          message: "Heures travaillées supérieures au prévu.",
          expectedDailyHours: expected,
          validatedHours,
          differenceHours: validatedHours - expected
        });
      }

      if (schedule.isReliable && expected > 0 && (validatedHours + coveredHours) < expected) {
        warnings.push({
          code: "missing_hours",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Heures manquantes non justifiées.",
          expectedDailyHours: expected,
          validatedHours,
          coveredHours,
          differenceHours: expected - (validatedHours + coveredHours)
        });
      }
    }
  }

  return warnings;
}

/**
 * Resolves the rate snapshot for a specific employee and period.
 */
export async function resolvePayrollRateSnapshot(
  db: Firestore,
  entityId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<PayrollRateSnapshot> {
  const { startDateIso } = await getPayrollMonthRange(year, month);

  const paramsRef = collection(db, `entities/${entityId}/payrollParameters`);
  const paramsQuery = query(
    paramsRef, 
    where("employeeId", "==", employeeId),
    where("status", "==", "active"),
    where("effectiveFrom", "<=", startDateIso),
    orderBy("effectiveFrom", "desc"),
    limit(1)
  );
  const paramsSnap = await getDocs(paramsQuery);
  const p = paramsSnap.empty ? null : paramsSnap.docs[0].data() as PayrollParameter;

  const empRef = doc(db, `entities/${entityId}/employees`, employeeId);
  const empSnap = await getDoc(empRef);
  if (!empSnap.exists()) return { source: "missing", ordinaryHourlyRate: 0 };
  
  const emp = empSnap.data() as Employee;
  if (!emp.activeContractId) return { source: "missing", ordinaryHourlyRate: 0 };

  const contractRef = doc(db, `entities/${entityId}/contracts`, emp.activeContractId);
  const contractSnap = await getDoc(contractRef);
  if (!contractSnap.exists()) return { source: "missing", ordinaryHourlyRate: 0 };
  
  const contract = contractSnap.data() as Contract;
  const { ccnlId, levelId } = contract;

  let levelData: CCNLLevel | null = null;
  let ccnlData: CCNL | null = null;

  if (ccnlId) {
    const ccnlRef = doc(db, `entities/${entityId}/ccnls`, ccnlId);
    const ccnlSnap = await getDoc(ccnlRef);
    if (ccnlSnap.exists()) ccnlData = ccnlSnap.data() as CCNL;
    
    if (levelId) {
      const levelRef = doc(db, `entities/${entityId}/ccnls/${ccnlId}/levels`, levelId);
      const levelSnap = await getDoc(levelRef);
      if (levelSnap.exists()) levelData = levelSnap.data() as CCNLLevel;
    }
  }

  const ordinaryHourlyRate = p?.ordinaryHourlyRate ?? levelData?.minimumGrossHourly ?? 0;
  const grossMonthly = p?.grossMonthly ?? levelData?.minimumGrossMonthly ?? contract.grossMonthly ?? null;
  const payCalculationMode = p?.payCalculationMode ?? (grossMonthly ? "monthly" : "hourly");

  // Logic priority for expected weekly hours: 
  // 1. Contract > 2. CCNL Root Standard > 3. CCNL Root Schedule Sum
  const isValid = (v: any): v is number => typeof v === 'number' && v > 0;
  let expectedWeeklyHours: number | null = null;

  if (isValid(contract.weeklyHours)) {
    expectedWeeklyHours = contract.weeklyHours;
  } else if (ccnlData && isValid(ccnlData.standardWeeklyHours)) {
    expectedWeeklyHours = ccnlData.standardWeeklyHours;
  } else if (ccnlData && ccnlData.weeklySchedule) {
    const s = ccnlData.weeklySchedule;
    const sum = (s.monday || 0) + (s.tuesday || 0) + (s.wednesday || 0) + (s.thursday || 0) + (s.friday || 0) + (s.saturday || 0) + (s.sunday || 0);
    if (sum > 0) expectedWeeklyHours = sum;
  }

  return {
    source: p ? "payroll_parameter" : (levelData ? "ccnl_level" : "contract"),
    payCalculationMode,
    ordinaryHourlyRate,
    grossMonthly,
    levelCode: levelData?.levelCode ?? contract.levelCode ?? null,
    expectedWeeklyHours,
    nightPremiumPercent: p?.nightPremiumPercent ?? levelData?.nightPremiumPercent ?? null,
    overtimePremiumPercent: p?.overtimePremiumPercent ?? levelData?.overtimePremiumPercent ?? null,
    overtimeNightPremiumPercent: p?.overtimeNightPremiumPercent ?? levelData?.overtimeNightPremiumPercent ?? null,
    holidayPremiumPercent: p?.holidayPremiumPercent ?? levelData?.holidayPremiumPercent ?? null,
    sundayPremiumPercent: p?.sundayPremiumPercent ?? levelData?.sundayPremiumPercent ?? null,
    ccnlId: ccnlId || undefined,
    ccnlLevelId: levelId || undefined,
    contractId: emp.activeContractId,
    payrollParameterId: p ? paramsSnap.docs[0].id : undefined
  };
}

/**
 * Calculates financial values for a calculation object.
 */
export async function calculatePayrollEconomicValues(
  agg: PayrollAttendanceAggregation,
  rate: PayrollRateSnapshot,
  warnings: PayrollReconciliationWarning[] = [],
  extras: { mealTickets?: number; mileage?: number; bonus?: number } = {}
): Promise<{
  baseGrossValue: number;
  ordinaryValue: number;
  nightValue: number;
  overtimeValue: number;
  overtimeDayValue: number;
  overtimeNightValue: number;
  overtimeSundayValue: number;
  overtimeHolidayValue: number;
  holidayWorkedValue: number;
  deductionValue: number;
  mealTicketsValue: number;
  mileageValue: number;
  bonusValue: number;
  grossEconomicTotal: number;
}> {
  const rateValue = rate.ordinaryHourlyRate || 0;
  const isMonthly = rate.payCalculationMode === "monthly";
  
  const nightDec = await percentageToDecimal(rate.nightPremiumPercent);
  
  const ovDayHours = agg.overtimeDayHours || 0;
  const ovNightHours = agg.overtimeNightHours || 0;
  const ovSundayHours = agg.overtimeSundayHours || 0;
  const ovHolidayHours = agg.overtimeHolidayHours || 0;

  const otMult = await percentageToMultiplier(rate.overtimePremiumPercent);
  const otNightMult = await percentageToMultiplier(rate.overtimeNightPremiumPercent);
  const sunMult = await percentageToMultiplier(rate.sundayPremiumPercent);
  const holMult = await percentageToMultiplier(rate.holidayPremiumPercent);

  let baseGrossValue = 0;
  if (isMonthly) {
    baseGrossValue = roundMoney(rate.grossMonthly || 0);
  } else {
    baseGrossValue = roundMoney(agg.ordinaryDayHours * rateValue);
  }

  const nightValue = roundMoney(agg.ordinaryNightHours * rateValue * nightDec);

  const overtimeDayValue = roundMoney(ovDayHours * rateValue * otMult);
  const overtimeNightValue = roundMoney(ovNightHours * rateValue * otNightMult);
  const overtimeSundayValue = roundMoney(ovSundayHours * rateValue * sunMult);
  const overtimeHolidayValue = roundMoney(ovHolidayHours * rateValue * holMult);
  
  const totalOvertimeValue = roundMoney(overtimeDayValue + overtimeNightValue + overtimeSundayValue + overtimeHolidayValue);

  let deductionValue = 0;
  const missingHoursWarnings = warnings.filter(w => w.code === "missing_hours" && w.differenceHours && w.differenceHours > 0);
  const totalMissingHours = missingHoursWarnings.reduce((sum, w) => sum + (w.differenceHours || 0), 0);
  
  if (totalMissingHours > 0) {
    deductionValue = roundMoney(totalMissingHours * rateValue);
  }

  const mealTicketsValue = roundMoney(extras.mealTickets || 0);
  const mileageValue = roundMoney(extras.mileage || 0);
  const bonusValue = roundMoney(extras.bonus || 0);

  const grossEconomicTotal = roundMoney(
    baseGrossValue - deductionValue + nightValue + totalOvertimeValue +
    mealTicketsValue + mileageValue + bonusValue
  );

  return {
    baseGrossValue,
    ordinaryValue: isMonthly ? baseGrossValue : roundMoney((agg.ordinaryDayHours + agg.ordinaryNightHours) * rateValue),
    nightValue,
    overtimeValue: totalOvertimeValue,
    overtimeDayValue,
    overtimeNightValue,
    overtimeSundayValue,
    overtimeHolidayValue,
    holidayWorkedValue: overtimeHolidayValue,
    deductionValue,
    mealTicketsValue,
    mileageValue,
    bonusValue,
    grossEconomicTotal
  };
}

/**
 * Persists payroll calculations to Firestore.
 */
export async function saveMonthlyPayrollCalculations(
  db: Firestore,
  entityId: string,
  calculations: PayrollCalculation[],
  actorUid: string
) {
  const results = { created: 0, updated: 0, skipped: 0, skippedReasons: [] as string[] };

  for (const calc of calculations) {
    const calcRef = doc(db, `entities/${entityId}/payrollCalculations`, calc.id);
    const existingSnap = await getDoc(calcRef);

    const sanitizedCalc = sanitizeForFirestore(calc);

    if (existingSnap.exists()) {
      const existing = existingSnap.data() as PayrollCalculation;
      const terminalStatuses = ["approved", "exported", "locked"];
      if (terminalStatuses.includes(existing.status)) {
        results.skipped++;
        results.skippedReasons.push(`${calc.employeeId}: Verrouillé.`);
        continue;
      }
      await updateDoc(calcRef, {
        ...sanitizedCalc,
        calculatedAt: serverTimestamp(),
        calculatedBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
      results.updated++;
    } else {
      await setDoc(calcRef, {
        ...sanitizedCalc,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        calculatedAt: serverTimestamp(),
        calculatedBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
      results.created++;
    }
  }

  return results;
}

/**
 * Main service entry point: Aggregates, reconciles, calculates and persists.
 * Isolated per-employee calculation to ensure batch stability.
 */
export async function calculateAndSaveMonthlyPayroll(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  actorUid: string
) {
  const { startDateIso, nextMonthStartDateIso } = await getPayrollMonthRange(year, month);
  
  const aggregations = await aggregateMonthlyAttendance(db, entityId, year, month);
  const allWarnings = await buildPrePayrollReconciliation(db, entityId, year, month, aggregations);
  
  const finalCalculations: PayrollCalculation[] = [];
  let blockingCount = 0;
  let warningCount = 0;
  let failedCount = 0;

  for (const empId of Object.keys(aggregations)) {
    try {
      const agg = aggregations[empId];
      const rate = await resolvePayrollRateSnapshot(db, entityId, empId, year, month);
      const empWarnings = allWarnings.filter(w => w.employeeId === empId);

      const threshold = rate.expectedWeeklyHours;

      if (threshold === null || threshold === undefined) {
         empWarnings.push({
           code: "missing_weekly_schedule",
           severity: "warning",
           employeeId: empId,
           message: "Seuil hebdomadaire non détecté. Réconciliation SUP bloquée."
         });
         agg.rawImportedOvertimeHours = agg.overtimeHours;
         agg.weeklyReconciledOvertimeHours = 0;
         agg.overtimeHours = 0; 
         agg.overtimeClassificationSource = "not_available";
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

         const reconciliation = await reconcileWeeklyOvertime(records, threshold);
         
         agg.rawImportedOvertimeHours = agg.overtimeHours;
         agg.weeklyReconciledOvertimeHours = reconciliation.weeklyReconciledOvertimeHours;
         agg.overtimeHours = reconciliation.weeklyReconciledOvertimeHours;
         agg.ordinaryNightHours = reconciliation.ordinaryNightHours;
         agg.overtimeDayHours = reconciliation.overtimeDayHours;
         agg.overtimeNightHours = reconciliation.overtimeNightHours;
         agg.overtimeSundayHours = reconciliation.overtimeSundayHours;
         agg.overtimeHolidayHours = reconciliation.overtimeHolidayHours;
         agg.overtimeClassificationSource = "weekly_reconciled";
         agg.weeklyBreakdown = reconciliation.weeklyBreakdown;

         if (agg.overtimeNightHours > 0 && !rate.overtimeNightPremiumPercent) {
            empWarnings.push({
              code: "missing_overtime_night_premium",
              severity: "blocking",
              employeeId: empId,
              message: "Majorations SUP de nuit manquantes."
            });
         }
      }

      if (!rate.ordinaryHourlyRate || rate.ordinaryHourlyRate === 0) {
        empWarnings.push({ code: "missing_payroll_rate", severity: "blocking", employeeId: empId, message: "Taux horaire manquant." });
      }

      const econ = await calculatePayrollEconomicValues(agg, rate, empWarnings);
      const isBlocked = empWarnings.some(w => w.severity === 'blocking');

      if (isBlocked) blockingCount++;
      warningCount += empWarnings.filter(w => w.severity === 'warning').length;

      finalCalculations.push({
        id: `${empId}_${year}_${month}`,
        entityId,
        employeeId: empId,
        year,
        month,
        status: isBlocked ? "draft" : "calculated",
        attendanceAggregation: agg,
        rateSnapshot: rate,
        reconciliationWarnings: empWarnings,
        ...econ,
        sourceAttendanceIds: agg.sourceAttendanceIds,
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

  return {
    totalEmployees: Object.keys(aggregations).length,
    ...saveResults,
    failedCount,
    blockingWarningsCount: blockingCount,
    warningCount,
    calculationIds: finalCalculations.map(c => c.id)
  };
}

