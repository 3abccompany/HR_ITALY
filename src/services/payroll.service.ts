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
  Timestamp
} from "firebase/firestore";
import { 
  PayrollAttendanceAggregation, 
  PayrollReconciliationWarning, 
  PayrollCalculation,
  PayrollRateSnapshot,
  PayrollParameter,
  PayrollCalculationStatus
} from "@/types/payroll";
import { AttendanceRecord } from "@/types/attendance";
import { TimeOffRequest } from "@/types/time-off";
import { resolveWorkSchedule } from "./work-schedule.service";
import { format, parseISO, startOfMonth, endOfMonth, addMonths, eachDayOfInterval } from "date-fns";
import { fr } from "date-fns/locale";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";

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
 * Helper to convert percentage to multiplier (e.g. 25 -> 1.25)
 */
export function percentageToMultiplier(percent?: number | null): number {
  if (percent === undefined || percent === null || isNaN(percent) || percent < 0) return 1;
  if (percent === 0) return 1;
  return 1 + (percent / 100);
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
      agg.legacyFallbackReason = "Granular day/night split missing; validatedHours treated as ordinary day hours for MVP.";
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
          message: "Horaire contractuel introuvable pour cette date.",
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
          message: "Heures travaillées supérieures à l'horaire prévu.",
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
          message: "Heures manquantes non couvertes par une absence approuvée.",
          expectedDailyHours: expected,
          validatedHours,
          coveredHours,
          differenceHours: expected - (validatedHours + coveredHours)
        });
      }

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
 */
export async function resolvePayrollRateSnapshot(
  db: Firestore,
  entityId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<PayrollRateSnapshot> {
  const { startDateIso } = getPayrollMonthRange(year, month);

  // 1. Check Payroll Parameters (Most specific)
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
  
  if (!paramsSnap.empty) {
    const p = paramsSnap.docs[0].data() as PayrollParameter;
    return {
      source: "payroll_parameter",
      ordinaryHourlyRate: p.ordinaryHourlyRate,
      nightPremiumPercent: p.nightPremiumPercent,
      overtimePremiumPercent: p.overtimePremiumPercent,
      holidayPremiumPercent: p.holidayPremiumPercent,
      payrollParameterId: paramsSnap.docs[0].id
    };
  }

  // 2. Check Contract & CCNL (Default hierarchy)
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

  if (ccnlId) {
    const ccnlRef = doc(db, `entities/${entityId}/ccnls`, ccnlId);
    const ccnlSnap = await getDoc(ccnlRef);
    const ccnl = ccnlSnap.exists() ? ccnlSnap.data() as CCNL : null;

    if (levelId) {
      const levelRef = doc(db, `entities/${entityId}/ccnls/${ccnlId}/levels`, levelId);
      const levelSnap = await getDoc(levelRef);
      if (levelSnap.exists()) {
        const level = levelSnap.data() as CCNLLevel;
        return {
          source: "ccnl_level",
          ordinaryHourlyRate: level.minimumGrossHourly,
          nightPremiumPercent: level.nightPremiumPercent ?? ccnl?.nightPremiumPercent,
          overtimePremiumPercent: level.overtimePremiumPercent ?? ccnl?.overtimePremiumPercent,
          holidayPremiumPercent: level.holidayPremiumPercent ?? ccnl?.holidayPremiumPercent,
          ccnlId,
          ccnlLevelId: levelId,
          contractId: emp.activeContractId
        };
      }
    }

    if (ccnl) {
      return {
        source: "ccnl_root",
        ordinaryHourlyRate: 0, // Root usually doesn't have a single rate
        nightPremiumPercent: ccnl.nightPremiumPercent,
        overtimePremiumPercent: ccnl.overtimePremiumPercent,
        holidayPremiumPercent: ccnl.holidayPremiumPercent,
        ccnlId,
        contractId: emp.activeContractId
      };
    }
  }

  return { source: "missing", ordinaryHourlyRate: 0 };
}

/**
 * Calculates financial values for a calculation object.
 */
export function calculatePayrollEconomicValues(
  agg: PayrollAttendanceAggregation,
  rate: PayrollRateSnapshot,
  extras: { mealTickets?: number; mileage?: number; bonus?: number } = {}
) {
  const rateValue = rate.ordinaryHourlyRate || 0;
  
  const nightMult = percentageToMultiplier(rate.nightPremiumPercent);
  const otMult = percentageToMultiplier(rate.overtimePremiumPercent);
  const holMult = percentageToMultiplier(rate.holidayPremiumPercent);

  const ordinaryValue = roundMoney(agg.ordinaryDayHours * rateValue);
  const nightValue = roundMoney(agg.ordinaryNightHours * rateValue * nightMult);
  const overtimeValue = roundMoney(agg.overtimeHours * rateValue * otMult);
  const holidayWorkedValue = roundMoney(agg.holidayWorkedHours * rateValue * holMult);

  const mealTicketsValue = roundMoney(extras.mealTickets || 0);
  const mileageValue = roundMoney(extras.mileage || 0);
  const bonusValue = roundMoney(extras.bonus || 0);

  const grossEconomicTotal = roundMoney(
    ordinaryValue + nightValue + overtimeValue + holidayWorkedValue +
    mealTicketsValue + mileageValue + bonusValue
  );

  return {
    ordinaryValue,
    nightValue,
    overtimeValue,
    overtimeNightValue: 0,
    holidayWorkedValue,
    mealTicketsValue,
    mileageValue,
    bonusValue,
    grossEconomicTotal
  };
}

/**
 * Persists payroll calculations to Firestore.
 * Prevents overwriting approved/locked records.
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

    if (existingSnap.exists()) {
      const existing = existingSnap.data() as PayrollCalculation;
      const terminalStatuses = ["approved", "exported", "locked"];
      
      if (terminalStatuses.includes(existing.status)) {
        results.skipped++;
        results.skippedReasons.push(`${calc.employeeId}: Statut ${existing.status} (verrouillé).`);
        continue;
      }

      await updateDoc(calcRef, {
        ...calc,
        createdAt: existing.createdAt, // Preserve
        createdBy: existing.createdBy,
        calculatedAt: serverTimestamp(),
        calculatedBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
      results.updated++;
    } else {
      await setDoc(calcRef, {
        ...calc,
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
 */
export async function calculateAndSaveMonthlyPayroll(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  actorUid: string
) {
  // 1. Inputs
  const aggregations = await aggregateMonthlyAttendance(db, entityId, year, month);
  const allWarnings = await buildPrePayrollReconciliation(db, entityId, year, month, aggregations);
  
  const finalCalculations: PayrollCalculation[] = [];
  let blockingCount = 0;
  let warningCount = 0;

  // 2. Process each aggregated employee
  for (const empId of Object.keys(aggregations)) {
    const agg = aggregations[empId];
    const rate = await resolvePayrollRateSnapshot(db, entityId, empId, year, month);
    const empWarnings = allWarnings.filter(w => w.employeeId === empId);

    // Dynamic checks
    if (!rate.ordinaryHourlyRate || rate.ordinaryHourlyRate === 0) {
      empWarnings.push({
        code: "missing_payroll_rate",
        severity: "blocking",
        employeeId: empId,
        message: "Taux horaire ordinaire introuvable."
      });
    }

    const econ = calculatePayrollEconomicValues(agg, rate);
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
  }

  // 3. Persist
  const saveResults = await saveMonthlyPayrollCalculations(db, entityId, finalCalculations, actorUid);

  return {
    totalEmployees: Object.keys(aggregations).length,
    ...saveResults,
    blockingWarningsCount: blockingCount,
    warningCount,
    calculationIds: finalCalculations.map(c => c.id)
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
  const aggregations = await aggregateMonthlyAttendance(db, entityId, year, month);
  const allWarnings = await buildPrePayrollReconciliation(db, entityId, year, month, aggregations);

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
      createdAt: new Date(),
      createdBy: "system",
      updatedAt: new Date(),
      updatedBy: "system"
    };
  });

  return drafts;
}
