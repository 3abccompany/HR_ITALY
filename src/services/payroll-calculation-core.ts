import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  addMonths,
  addDays,
} from "date-fns";
import {
  allocateWeeklyOrdinaryOvertime,
  getAttendanceWeekContext,
  resolveWeeklyThresholdHours,
  type WeeklyOvertimeInput,
} from "@/lib/attendance/weekly-overtime";
import type {
  PayrollAttendanceAggregation,
  PayrollPayCalculationMode,
  PayrollRateSnapshot,
  PayrollReconciliationWarning,
  PayrollWeeklyBreakdown,
} from "@/types/payroll";
import type { AttendanceRecord } from "@/types/attendance";

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
    if (!p.timeIn || !p.timeOut || p.timeIn === "INVALID" || p.timeOut === "INVALID") return;

    const [hIn, mIn] = p.timeIn.split(":").map(Number);
    const [hOut, mOut] = p.timeOut.split(":").map(Number);

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
      isHoliday: isHoliday || false,
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

  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
  const timePoints = [start, ...sortedBoundaries, end];

  const result: ClassifiedSegment[] = [];

  for (let i = 0; i < timePoints.length - 1; i++) {
    const s = new Date(timePoints[i]);
    const e = new Date(timePoints[i + 1]);
    const duration = (e.getTime() - s.getTime()) / (1000 * 60 * 60);

    const mid = new Date(s.getTime() + (e.getTime() - s.getTime()) / 2);
    const h = mid.getHours();

    result.push({
      start: s,
      end: e,
      durationHours: Number(duration.toFixed(4)),
      isNight: h >= 22 || h < 6,
      isSunday: mid.getDay() === 0,
      isHoliday: segment.isHoliday,
    });
  }

  return result;
}

function classifyExclusiveSegment(seg: ClassifiedSegment): "holiday" | "sunday" | "night" | "day" {
  if (seg.isHoliday) return "holiday";
  if (seg.isSunday) return "sunday";
  if (seg.isNight) return "night";
  return "day";
}

interface PayrollOvertimeInput extends WeeklyOvertimeInput {
  segment: ClassifiedSegment;
}

export async function reconcileWeeklyOvertime(
  records: AttendanceRecord[],
  expectedWeeklyHours: number | null,
  holidaysMap: Map<string, string>,
  options: {
    getExpectedWeeklyHoursForDate?: (attendanceDate: string) => number | null;
    includedDateStart?: string;
    includedDateEnd?: string;
  } = {}
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
  if (expectedWeeklyHours === null && !options.getExpectedWeeklyHoursForDate) {
    return {
      weeklyReconciledOvertimeHours: 0,
      overtimeDayHours: 0,
      overtimeNightHours: 0,
      overtimeSundayHours: 0,
      overtimeHolidayHours: 0,
      sundayWorkedHours: 0,
      ordinaryNightHours: 0,
      weeklyBreakdown: [],
    };
  }

  const weeksMap = new Map<string, { weekStart: string; weekEnd: string; records: AttendanceRecord[] }>();
  records.forEach(r => {
    const ctx = getAttendanceWeekContext(r.attendanceDate);
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
    const weekThresholds = new Set<number>();
    weekRecords.forEach((record) => {
      const resolved = options.getExpectedWeeklyHoursForDate
        ? options.getExpectedWeeklyHoursForDate(record.attendanceDate)
        : expectedWeeklyHours;
      if (typeof resolved === "number" && Number.isFinite(resolved) && resolved > 0) {
        weekThresholds.add(resolved);
      }
    });

    const weekThreshold = weekThresholds.size === 1
      ? Array.from(weekThresholds)[0]
      : null;

    if (weekThreshold === null) {
      const weekWorked = weekRecords.reduce((sum, record) => sum + Math.max(0, record.validatedHours || 0), 0);
      const weekRawSup = weekRecords.reduce((s, r) => s + (r.overtimeHours || 0), 0);

      breakdown.push({
        weekKey,
        weekStart: weekData.weekStart,
        weekEnd: weekData.weekEnd,
        expectedWeeklyHours: null,
        workedHoursInWeek: Number(weekWorked.toFixed(2)),
        rawImportedOvertimeHours: Number(weekRawSup.toFixed(2)),
        weeklyOvertimeHours: 0,
        payableOvertimeHoursInPayrollMonth: 0,
        ordinaryNightHours: 0,
        overtimeDayHours: 0,
        overtimeNightHours: 0,
        overtimeSundayHours: 0,
        overtimeHolidayHours: 0,
        classificationStatus: "limited",
        classificationReason: weekThresholds.size > 1
          ? "contract_threshold_changed_inside_week"
          : "missing_weekly_threshold",
      });
      continue;
    }

    const weeklyInputs: PayrollOvertimeInput[] = [];
    weekRecords.forEach((r) => {
      const worked = getWorkedSegmentsFromRecord(r, holidaysMap);
      const splitSegments = worked.flatMap((ws) => splitSegmentByBoundaries(ws));

      if (splitSegments.length > 0) {
        splitSegments.forEach((segment, index) => {
          weeklyInputs.push({
            id: `${r.attendanceId || r.id || r.attendanceDate}_${index}`,
            date: r.attendanceDate,
            workedHours: segment.durationHours,
            sortKey: segment.start.getTime(),
            segment,
          });
        });
        return;
      }

      const fallbackHours = Math.max(0, r.validatedHours || 0);
      if (fallbackHours <= 0) return;

      const fallbackDate = parseISO(r.attendanceDate);
      const isHoliday = r.holidayFlag === true || holidaysMap.has(r.attendanceDate);
      weeklyInputs.push({
        id: `${r.attendanceId || r.id || r.attendanceDate}_day_total`,
        date: r.attendanceDate,
        workedHours: fallbackHours,
        sortKey: r.attendanceDate,
        segment: {
          start: fallbackDate,
          end: fallbackDate,
          durationHours: fallbackHours,
          isNight: false,
          isSunday: fallbackDate.getDay() === 0,
          isHoliday,
        },
      });
    });

    let weekWorked = 0;
    let weekOvDay = 0;
    let weekOvNight = 0;
    let weekOvSun = 0;
    let weekOvHol = 0;
    let weekSundayWorked = 0;
    let weekOrdNight = 0;
    const weekRawSup = weekRecords.reduce((s, r) => s + (r.overtimeHours || 0), 0);

    const allocationResult = allocateWeeklyOrdinaryOvertime(weeklyInputs, weekThreshold);
    const allocationsById = new Map(allocationResult.allocations.map((allocation) => [allocation.id, allocation]));

    for (const input of weeklyInputs) {
      const allocation = allocationsById.get(input.id);
      if (!allocation) continue;
      const isIncludedDate =
        (!options.includedDateStart || input.date >= options.includedDateStart) &&
        (!options.includedDateEnd || input.date <= options.includedDateEnd);

      const seg = input.segment;
      if (seg.isSunday && allocation.workedHours > 0) {
        if (isIncludedDate) weekSundayWorked += allocation.workedHours;
      }

      if (isIncludedDate && allocation.ordinaryHours > 0) {
        if (seg.isNight) weekOrdNight += allocation.ordinaryHours;
      }

      if (isIncludedDate && allocation.overtimeHours > 0) {
        const cat = classifyExclusiveSegment(seg);
        if (cat === "holiday") weekOvHol += allocation.overtimeHours;
        else if (cat === "sunday") weekOvSun += allocation.overtimeHours;
        else if (cat === "night") weekOvNight += allocation.overtimeHours;
        else weekOvDay += allocation.overtimeHours;
      }

      weekWorked += allocation.workedHours;
    }

    const weekOv = Math.max(0, weekWorked - weekThreshold);
    const payableWeekOv = weekOvDay + weekOvNight + weekOvSun + weekOvHol;

    breakdown.push({
      weekKey,
      weekStart: weekData.weekStart,
      weekEnd: weekData.weekEnd,
      expectedWeeklyHours: weekThreshold,
      workedHoursInWeek: Number(weekWorked.toFixed(2)),
      rawImportedOvertimeHours: Number(weekRawSup.toFixed(2)),
      weeklyOvertimeHours: Number(weekOv.toFixed(2)),
      payableOvertimeHoursInPayrollMonth: Number(payableWeekOv.toFixed(2)),
      ordinaryNightHours: Number(weekOrdNight.toFixed(2)),
      overtimeDayHours: Number(weekOvDay.toFixed(2)),
      overtimeNightHours: Number(weekOvNight.toFixed(2)),
      overtimeSundayHours: Number(weekOvSun.toFixed(2)),
      overtimeHolidayHours: Number(weekOvHol.toFixed(2)),
      classificationStatus: "classified",
    });

    totalOvertime += payableWeekOv;
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
    weeklyBreakdown: breakdown,
  };
}

export function sanitizeForFirestore(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj === undefined ? null : obj;
  }

  if (seen.has(obj)) return "[Circular]";

  if (
    obj instanceof Date ||
    obj.constructor?.name === "Timestamp" ||
    obj.constructor?.name === "FieldValue" ||
    (obj as any)._methodName === "serverTimestamp" ||
    typeof (obj as any).toDate === "function"
  ) {
    return obj;
  }

  const isArray = Array.isArray(obj);
  const isPlainObject = Object.prototype.toString.call(obj) === "[object Object]";

  if (!isArray && !isPlainObject) {
    return typeof obj.toString === "function" ? obj.toString() : "[Opaque Object]";
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
    nextMonthStartDateIso: format(nextMonthStart, "yyyy-MM-dd"),
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

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resolveSupportedPayCalculationMode(
  mode?: PayrollPayCalculationMode | null
): PayrollPayCalculationMode | undefined {
  return mode === "monthly" || mode === "hourly" || mode === "actual_worked_hours"
    ? mode
    : undefined;
}

export { resolveWeeklyThresholdHours };

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
        message: `Majoration ${label} non configurée pour ${applicableHours.toFixed(2)} heure(s).`,
      });
    }
  };

  if (isMonthly && rate.grossMonthly == null) {
    warnings.push({
      code: "missing_monthly_gross",
      severity: "blocking",
      employeeId: agg.employeeId,
      message: "Salaire brut mensuel introuvable dans le paramètre salarié, le Livello et le contrat.",
    });
  }

  if (isActualWorkedHours && rateValue <= 0) {
    warnings.push({
      code: "missing_payroll_rate",
      severity: "blocking",
      employeeId: agg.employeeId,
      message: "Taux horaire ordinaire introuvable pour le mode heures réellement travaillées.",
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

  const ordinaryHolidayHours = Math.max(0, (agg.holidayWorkedHours || 0) - (agg.overtimeHolidayHours || 0));
  const holidayWorkedValue = isActualWorkedHours
    ? roundMoney(ordinaryHolidayHours * rateValue * pOvHol)
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
    grossEconomicTotal,
  };

  if (isActualWorkedHours) {
    result.baseWorkedValue = baseWorkedValue;
    result.paidHolidayHours = paidHolidayHours;
    result.paidHolidayValue = paidHolidayValue;
    result.calculationFormulaVersion = "actual_worked_hours_v1";
  }

  return result;
}
