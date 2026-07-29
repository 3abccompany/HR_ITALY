import { format, parseISO, startOfWeek, endOfWeek } from "date-fns";
import type { WeeklySchedule } from "@/types/ccnl";

export interface WeeklyOvertimeInput {
  id: string;
  date: string;
  workedHours: number;
  sortKey?: string | number;
}

export interface WeeklyOvertimeAllocation {
  id: string;
  date: string;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  workedHours: number;
  ordinaryHours: number;
  overtimeHours: number;
  cumulativeWorkedBefore: number;
}

export interface WeeklyOvertimeWeekTotal {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  thresholdHours: number;
  workedHours: number;
  ordinaryHours: number;
  overtimeHours: number;
}

export interface WeeklyOvertimeResult {
  allocations: WeeklyOvertimeAllocation[];
  weeks: WeeklyOvertimeWeekTotal[];
}

export interface WeeklyThresholdSourceInput {
  contractWeeklyHours?: number | null;
  ccnlStandardWeeklyHours?: number | null;
  ccnlWeeklySchedule?: Partial<WeeklySchedule> | null;
  employeeWeeklyHours?: number | null;
}

export interface WeeklyThresholdContractInput {
  contractId?: string | null;
  employeeId: string;
  startDate?: string | null;
  endDate?: string | null;
  weeklyHours?: number | null;
  ccnlId?: string | null;
}

export interface WeeklyThresholdCcnlInput {
  ccnlId: string;
  standardWeeklyHours?: number | null;
  weeklySchedule?: Partial<WeeklySchedule> | null;
}

export interface ResolveDateAwareWeeklyThresholdInput {
  employeeId: string;
  attendanceDate: string;
  employeeWeeklyHours?: number | null;
  contracts: WeeklyThresholdContractInput[];
  ccnlsById?: Map<string, WeeklyThresholdCcnlInput>;
}

export interface DateAwareWeeklyThresholdResult {
  thresholdHours: number | null;
  contractId: string | null;
  ccnlId: string | null;
  source: "contract" | "ccnl_standard" | "ccnl_schedule" | "employee_legacy" | "missing";
}

const roundHours = (value: number) => Number(value.toFixed(2));

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function getAttendanceWeekContext(dateIso: string) {
  const date = parseISO(dateIso);
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });

  return {
    weekKey: `${format(start, "yyyy")}-W${format(start, "II")}`,
    weekStart: format(start, "yyyy-MM-dd"),
    weekEnd: format(end, "yyyy-MM-dd"),
  };
}

export function getAttendanceFullWeekRange(startDateIso: string, endDateIso: string) {
  const start = getAttendanceWeekContext(startDateIso).weekStart;
  const end = getAttendanceWeekContext(endDateIso).weekEnd;

  return { start, end };
}

export function resolveWeeklyThresholdHours(input: WeeklyThresholdSourceInput): number | null {
  if (isPositiveFinite(input.contractWeeklyHours)) {
    return input.contractWeeklyHours;
  }

  if (isPositiveFinite(input.ccnlStandardWeeklyHours)) {
    return input.ccnlStandardWeeklyHours;
  }

  const schedule = input.ccnlWeeklySchedule;
  if (schedule) {
    const total =
      (schedule.monday || 0) +
      (schedule.tuesday || 0) +
      (schedule.wednesday || 0) +
      (schedule.thursday || 0) +
      (schedule.friday || 0) +
      (schedule.saturday || 0) +
      (schedule.sunday || 0);

    if (total > 0) return roundHours(total);
  }

  if (isPositiveFinite(input.employeeWeeklyHours)) {
    return input.employeeWeeklyHours;
  }

  return null;
}

export function resolveApplicableContractForDate(
  contracts: WeeklyThresholdContractInput[],
  employeeId: string,
  attendanceDate: string
): WeeklyThresholdContractInput | null {
  const candidates = contracts
    .filter((contract) => contract.employeeId === employeeId)
    .filter((contract) => {
      if (!contract.startDate || contract.startDate > attendanceDate) return false;
      return !contract.endDate || contract.endDate >= attendanceDate;
    })
    .sort((a, b) => {
      const startCompare = (b.startDate || "").localeCompare(a.startDate || "");
      if (startCompare !== 0) return startCompare;
      return String(b.contractId || "").localeCompare(String(a.contractId || ""));
    });

  return candidates[0] || null;
}

export function resolveDateAwareWeeklyThreshold(
  input: ResolveDateAwareWeeklyThresholdInput
): DateAwareWeeklyThresholdResult {
  const contract = resolveApplicableContractForDate(
    input.contracts,
    input.employeeId,
    input.attendanceDate
  );
  const ccnl = contract?.ccnlId && input.ccnlsById
    ? input.ccnlsById.get(contract.ccnlId)
    : null;

  if (isPositiveFinite(contract?.weeklyHours)) {
    return {
      thresholdHours: contract.weeklyHours,
      contractId: contract.contractId || null,
      ccnlId: contract.ccnlId || null,
      source: "contract",
    };
  }

  if (isPositiveFinite(ccnl?.standardWeeklyHours)) {
    return {
      thresholdHours: ccnl.standardWeeklyHours,
      contractId: contract?.contractId || null,
      ccnlId: ccnl.ccnlId,
      source: "ccnl_standard",
    };
  }

  const ccnlScheduleThreshold = resolveWeeklyThresholdHours({
    ccnlWeeklySchedule: ccnl?.weeklySchedule,
  });
  if (ccnlScheduleThreshold !== null) {
    return {
      thresholdHours: ccnlScheduleThreshold,
      contractId: contract?.contractId || null,
      ccnlId: ccnl?.ccnlId || contract?.ccnlId || null,
      source: "ccnl_schedule",
    };
  }

  if (isPositiveFinite(input.employeeWeeklyHours)) {
    return {
      thresholdHours: input.employeeWeeklyHours,
      contractId: contract?.contractId || null,
      ccnlId: contract?.ccnlId || null,
      source: "employee_legacy",
    };
  }

  return {
    thresholdHours: null,
    contractId: contract?.contractId || null,
    ccnlId: contract?.ccnlId || null,
    source: "missing",
  };
}

export function allocateWeeklyOrdinaryOvertime(
  inputs: WeeklyOvertimeInput[],
  weeklyThresholdHours: number | null
): WeeklyOvertimeResult {
  if (!isPositiveFinite(weeklyThresholdHours)) {
    return { allocations: [], weeks: [] };
  }

  const grouped = new Map<string, { weekStart: string; weekEnd: string; inputs: WeeklyOvertimeInput[] }>();

  inputs.forEach((input) => {
    const workedHours = Math.max(0, Number(input.workedHours || 0));
    if (!input.date || workedHours <= 0) return;

    const context = getAttendanceWeekContext(input.date);
    if (!grouped.has(context.weekKey)) {
      grouped.set(context.weekKey, {
        weekStart: context.weekStart,
        weekEnd: context.weekEnd,
        inputs: [],
      });
    }

    grouped.get(context.weekKey)!.inputs.push({ ...input, workedHours });
  });

  const allocations: WeeklyOvertimeAllocation[] = [];
  const weeks: WeeklyOvertimeWeekTotal[] = [];

  Array.from(grouped.entries())
    .sort((a, b) => a[1].weekStart.localeCompare(b[1].weekStart))
    .forEach(([weekKey, week]) => {
      const ordered = [...week.inputs].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        const aKey = a.sortKey ?? a.id;
        const bKey = b.sortKey ?? b.id;
        return String(aKey).localeCompare(String(bKey));
      });

      let cumulativeWorked = 0;
      let weeklyWorked = 0;
      let weeklyOrdinary = 0;
      let weeklyOvertime = 0;

      ordered.forEach((input) => {
        const workedHours = roundHours(Math.max(0, Number(input.workedHours || 0)));
        const remainingOrdinary = Math.max(0, weeklyThresholdHours - cumulativeWorked);
        const ordinaryHours = roundHours(Math.min(workedHours, remainingOrdinary));
        const overtimeHours = roundHours(Math.max(0, workedHours - ordinaryHours));

        allocations.push({
          id: input.id,
          date: input.date,
          weekKey,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          workedHours,
          ordinaryHours,
          overtimeHours,
          cumulativeWorkedBefore: roundHours(cumulativeWorked),
        });

        cumulativeWorked += workedHours;
        weeklyWorked += workedHours;
        weeklyOrdinary += ordinaryHours;
        weeklyOvertime += overtimeHours;
      });

      weeks.push({
        weekKey,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        thresholdHours: weeklyThresholdHours,
        workedHours: roundHours(weeklyWorked),
        ordinaryHours: roundHours(weeklyOrdinary),
        overtimeHours: roundHours(weeklyOvertime),
      });
    });

  return { allocations, weeks };
}
