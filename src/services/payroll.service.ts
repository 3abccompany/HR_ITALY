/**
 * @fileOverview Payroll service layer for Monthly Economic Calculation.
 * Handles attendance aggregation, pre-payroll reconciliation, and draft preparation.
 */

import { 
  Firestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  doc,
  getDoc
} from "firebase/firestore";
import { 
  PayrollAttendanceAggregation, 
  PayrollReconciliationWarning, 
  PayrollCalculation,
  PayrollRateSnapshot
} from "@/types/payroll";
import { AttendanceRecord } from "@/types/attendance";
import { TimeOffRequest } from "@/types/time-off";
import { resolveWorkSchedule } from "./work-schedule.service";
import { format, parseISO, startOfMonth, endOfMonth, addMonths, eachDayOfInterval, isWithinInterval } from "date-fns";

/**
 * Calculates the date range for a payroll month.
 */
export function getPayrollMonthRange(year: number, month: number) {
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
 * Aggregates validated attendance records for an entity/month.
 */
export async function aggregateMonthlyAttendance(
  db: Firestore, 
  entityId: string, 
  year: number, 
  month: number
): Promise<Record<string, PayrollAttendanceAggregation>> {
  const { startDateIso, nextMonthStartDateIso } = getPayrollMonthRange(year, month);
  
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

    // Split logic with legacy fallback
    const hasSplits = (data.dayHours || 0) > 0 || (data.nightHours || 0) > 0 || (data.overtimeHours || 0) > 0;
    
    if (vh > 0 && !hasSplits) {
      agg.ordinaryDayHours += vh;
      agg.hasLegacyFallback = true;
      agg.legacyFallbackReason = "Répartition jour/nuit manquante; total traité comme heures de jour ordinaires.";
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
  const { startDateIso, endDateIso } = getPayrollMonthRange(year, month);
  const warnings: PayrollReconciliationWarning[] = [];

  // 1. Load Approved Time Off for coverage check
  const timeOffRef = collection(db, `entities/${entityId}/timeOffRequests`);
  const toSnap = await getDocs(query(timeOffRef, where("status", "==", "approved")));
  const approvedRequests = toSnap.docs
    .map(d => d.data() as TimeOffRequest)
    .filter(r => r.startDate <= endDateIso && r.endDate >= startDateIso);

  // 2. Iterate through each employee with activity
  for (const empId of Object.keys(aggregations)) {
    const agg = aggregations[empId];
    
    // Get all attendance records for this employee/month for day-by-day check
    const attSnap = await getDocs(query(
      collection(db, `entities/${entityId}/attendances`),
      where("employeeId", "==", empId),
      where("attendanceDate", ">=", startDateIso),
      where("attendanceDate", "<=", endDateIso)
    ));
    const attMap = new Map(attSnap.docs.map(d => [d.data().attendanceDate, d.data() as AttendanceRecord]));

    // Check every day of the month
    const days = eachDayOfInterval({ start: parseISO(startDateIso), end: parseISO(endDateIso) });
    
    for (const day of days) {
      const dateIso = format(day, "yyyy-MM-dd");
      const schedule = await resolveWorkSchedule(db, entityId, empId, dateIso);
      const att = attMap.get(dateIso);
      const validatedHours = att?.validatedHours || 0;

      // Find overlapping approved time off for this day
      const dailyRequests = approvedRequests.filter(r => 
        empId === r.employeeId && dateIso >= r.startDate && dateIso <= r.endDate
      );

      let coveredHours = 0;
      dailyRequests.forEach(r => {
        if (r.unit === 'hours') {
          coveredHours += r.durationHours || 0;
        } else if (schedule.expectedDailyHours !== null) {
          // Day-based request covers the expected duration
          const factor = r.dayPart === 'full_day' ? 1 : 0.5;
          coveredHours += (schedule.expectedDailyHours * factor);
        }
      });

      // A) Missing Schedule
      if (!schedule.isReliable) {
        warnings.push({
          code: "missing_schedule",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Horaire contractuel introuvable pour cette date.",
          validatedHours
        });
      }

      const expected = schedule.expectedDailyHours || 0;

      // B) Over-expected hours (Potential overtime)
      if (schedule.isReliable && expected > 0 && validatedHours > expected) {
        warnings.push({
          code: "over_expected_hours",
          severity: "info",
          employeeId: empId,
          date: dateIso,
          message: "Heures travaillées supérieures à l'horaire prévu.",
          expectedDailyHours: expected,
          validatedHours,
          differenceHours: validatedHours - expected
        });
      }

      // C) Missing hours (Under-scheduled or unexcused absence)
      if (schedule.isReliable && expected > 0 && (validatedHours + coveredHours) < expected) {
        warnings.push({
          code: "missing_hours",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Heures manquantes non couvertes par une absence approuvée.",
          expectedDailyHours: expected,
          validatedHours,
          coveredHours,
          differenceHours: expected - (validatedHours + coveredHours)
        });
      }

      // D) Non-working day work
      if (schedule.isReliable && expected === 0 && validatedHours > 0) {
        warnings.push({
          code: "non_working_day_work",
          severity: "warning",
          employeeId: empId,
          date: dateIso,
          message: "Travail détecté sur un jour non travaillé.",
          expectedDailyHours: 0,
          validatedHours
        });
      }

      // E) Holiday Work
      if (att?.holidayFlag && (att.holidayWorkedHours || 0) > 0) {
        warnings.push({
          code: "holiday_work",
          severity: "info",
          employeeId: empId,
          date: dateIso,
          message: `Travail sur jour férié (${att.holidayName || 'Férié'}).`,
          validatedHours: att.holidayWorkedHours
        });
      }
    }

    // F) Legacy aggregation warning
    if (agg.hasLegacyFallback) {
      warnings.push({
        code: "legacy_attendance_split_missing",
        severity: "info",
        employeeId: empId,
        message: agg.legacyFallbackReason || "Répartition jour/nuit simplifiée."
      });
    }
  }

  return warnings;
}

/**
 * Resolves the rate snapshot for a specific employee and period.
 * Skeleton for Phase 4E-3C.
 */
export async function resolvePayrollRateSnapshot(
  db: Firestore,
  entityId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<PayrollRateSnapshot> {
  // Placeholder: In next phase, this will check payrollParameters, then contracts, then CCNL.
  return {
    source: "missing",
    ordinaryHourlyRate: 0
  };
}

/**
 * Prepares a monthly payroll draft dataset without economic values.
 */
export async function prepareMonthlyPayrollDraft(
  db: Firestore,
  entityId: string,
  year: number,
  month: number
): Promise<PayrollCalculation[]> {
  // 1. Aggregate Attendance
  const aggregations = await aggregateMonthlyAttendance(db, entityId, year, month);
  
  // 2. Build Reconciliation
  const allWarnings = await buildPrePayrollReconciliation(db, entityId, year, month, aggregations);

  // 3. Map to Calculation Objects
  const drafts: PayrollCalculation[] = Object.values(aggregations).map(agg => {
    const empId = agg.employeeId;
    const empWarnings = allWarnings.filter(w => w.employeeId === empId);

    return {
      id: `${empId}_${year}_${month}`,
      entityId,
      employeeId: empId,
      year,
      month,
      status: "draft",
      attendanceAggregation: agg,
      rateSnapshot: { source: "missing", ordinaryHourlyRate: 0 },
      reconciliationWarnings: empWarnings,
      ordinaryValue: 0,
      nightValue: 0,
      overtimeValue: 0,
      overtimeNightValue: 0,
      holidayWorkedValue: 0,
      mealTicketsValue: 0,
      mileageValue: 0,
      bonusValue: 0,
      grossEconomicTotal: 0,
      sourceAttendanceIds: agg.sourceAttendanceIds,
      createdAt: new Date()
    };
  });

  return drafts;
}
