import "server-only";

import { eachDayOfInterval, format, parseISO } from "date-fns";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { AttendanceRecord } from "@/types/attendance";
import type { CCNL, CCNLLevel } from "@/types/ccnl";
import type { Contract } from "@/types/contract";
import type { Employee } from "@/types/employee";
import type {
  PayrollAttendanceAggregation,
  PayrollCalculation,
  PayrollParameter,
  PayrollRateSnapshot,
  PayrollReconciliationWarning,
} from "@/types/payroll";
import type { TimeOffRequest } from "@/types/time-off";
import type { ResolvedWorkSchedule, WeekdayName } from "@/types/work-schedule";
import {
  calculatePayrollEconomicValues,
  getPayrollMonthRange,
  reconcileWeeklyOvertime,
  resolveSupportedPayCalculationMode,
  roundMoney,
  sanitizeForFirestore,
} from "./payroll-calculation-core";
import { createTrustedAuditLog } from "./audit.server";

const RELIABLE_ATTENDANCE_STATUSES = ["validated", "corrected", "locked"];
const MAX_BATCH_WRITES = 450;

export type TrustedPayrollCalculationResult = {
  year: number;
  month: number;
  totalEmployees: number;
  savedCount: number;
  skippedCount: number;
  failedCount: number;
  warningsCount: number;
};

function getAdminDatabase(): Firestore {
  if (!adminDb) {
    throw new Error("PAYROLL_CALCULATION_ADMIN_UNAVAILABLE");
  }
  return adminDb;
}

function normalizeScheduleValue(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;

  if (typeof val === "number") {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }

  if (typeof val === "string") {
    const clean = val.replace(",", ".").trim();
    const parsed = parseFloat(clean);
    return !isNaN(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function getWeekdayName(dateIso: string): WeekdayName | null {
  const parts = dateIso.split("-");
  if (parts.length !== 3) return null;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return null;

  const days: WeekdayName[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return days[date.getDay()];
}

async function resolveWorkScheduleAdmin(
  db: Firestore,
  entityId: string,
  employeeId: string,
  dateIso: string
): Promise<ResolvedWorkSchedule> {
  const weekday = getWeekdayName(dateIso);
  if (!weekday) {
    return { expectedDailyHours: null, source: "invalid_date", isReliable: false, weekday: undefined };
  }

  try {
    const empSnap = await db.collection("entities").doc(entityId).collection("employees").doc(employeeId).get();
    if (!empSnap.exists) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday };
    }
    const emp = empSnap.data() as Employee;

    const activeContractId = emp.activeContractId;
    if (!activeContractId) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday };
    }

    const contractSnap = await db.collection("entities").doc(entityId).collection("contracts").doc(activeContractId).get();
    if (!contractSnap.exists) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday, contractId: activeContractId };
    }
    const contract = contractSnap.data() as Contract;

    const { ccnlId, levelId } = contract;
    if (!ccnlId) {
      return { expectedDailyHours: null, source: "missing_ccnl", isReliable: false, weekday, contractId: activeContractId };
    }

    const ccnlSnap = await db.collection("entities").doc(entityId).collection("ccnls").doc(ccnlId).get();
    const ccnlData = ccnlSnap.exists ? ccnlSnap.data() as CCNL : null;

    if (levelId) {
      const levelSnap = await db
        .collection("entities")
        .doc(entityId)
        .collection("ccnls")
        .doc(ccnlId)
        .collection("levels")
        .doc(levelId)
        .get();

      if (levelSnap.exists) {
        const level = levelSnap.data() as CCNLLevel;
        const levelValue = level.weeklySchedule ? normalizeScheduleValue((level.weeklySchedule as any)[weekday]) : null;

        if (levelValue !== null) {
          return {
            expectedDailyHours: levelValue,
            source: "level_schedule",
            isReliable: true,
            weekday,
            contractId: activeContractId,
            ccnlId,
            ccnlLevelId: levelId,
          };
        }
      }
    }

    if (ccnlData && ccnlData.weeklySchedule) {
      const rootValue = normalizeScheduleValue((ccnlData.weeklySchedule as any)[weekday]);
      if (rootValue !== null) {
        return {
          expectedDailyHours: rootValue,
          source: "ccnl_schedule",
          isReliable: true,
          weekday,
          contractId: activeContractId,
          ccnlId,
        };
      }
    }

    return {
      expectedDailyHours: null,
      source: "missing_schedule",
      isReliable: false,
      weekday,
      contractId: activeContractId,
      ccnlId,
    };
  } catch (err: any) {
    return {
      expectedDailyHours: null,
      source: "missing_schedule",
      isReliable: false,
      weekday,
      warning: `Technical error: ${err?.message || "unknown"}`,
    };
  }
}

async function resolvePaidHolidayHoursForActualWorkedModeAdmin(
  db: Firestore,
  entityId: string,
  employeeId: string,
  holidayDates: string[]
): Promise<number> {
  let paidHolidayHours = 0;

  for (const holidayDate of holidayDates) {
    const schedule = await resolveWorkScheduleAdmin(db, entityId, employeeId, holidayDate);
    if (schedule.isReliable && typeof schedule.expectedDailyHours === "number") {
      paidHolidayHours += Math.max(0, schedule.expectedDailyHours);
    }
  }

  return Number(paidHolidayHours.toFixed(2));
}

async function aggregateMonthlyAttendanceAdmin(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  holidaysMap: Map<string, string>
): Promise<Record<string, PayrollAttendanceAggregation>> {
  const { startDateIso, nextMonthStartDateIso } = await getPayrollMonthRange(year, month);
  const snap = await db
    .collection("entities")
    .doc(entityId)
    .collection("attendances")
    .where("attendanceDate", ">=", startDateIso)
    .where("attendanceDate", "<", nextMonthStartDateIso)
    .get();

  const aggregations: Record<string, PayrollAttendanceAggregation> = {};

  snap.docs.forEach(d => {
    const data = d.data() as AttendanceRecord;
    if (!RELIABLE_ATTENDANCE_STATUSES.includes(data.status)) return;

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
        sourceAttendanceIds: [],
      };
    }

    const agg = aggregations[empId];
    agg.sourceAttendanceIds.push(d.id);

    const vh = data.validatedHours || 0;
    if (vh > 0) agg.workedDays++;
    const attendanceDate = new Date(`${data.attendanceDate}T00:00:00`);
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

    const isHoliday = data.holidayFlag === true || holidaysMap.has(data.attendanceDate);
    const hw = data.holidayWorkedHours || (isHoliday ? vh : 0);
    agg.holidayWorkedHours += hw;
  });

  return aggregations;
}

async function buildPrePayrollReconciliationAdmin(
  db: Firestore,
  entityId: string,
  year: number,
  month: number,
  aggregations: Record<string, PayrollAttendanceAggregation>
): Promise<PayrollReconciliationWarning[]> {
  const { startDateIso, endDateIso } = await getPayrollMonthRange(year, month);
  const warnings: PayrollReconciliationWarning[] = [];

  const toSnap = await db
    .collection("entities")
    .doc(entityId)
    .collection("timeOffRequests")
    .where("status", "==", "approved")
    .get();

  toSnap.docs
    .map(d => d.data() as TimeOffRequest)
    .filter(r => r.startDate <= endDateIso && r.endDate >= startDateIso);

  for (const empId of Object.keys(aggregations)) {
    const { startDateIso: s, endDateIso: e } = await getPayrollMonthRange(year, month);
    const days = eachDayOfInterval({ start: parseISO(s), end: parseISO(e) })
      .map(day => format(day, "yyyy-MM-dd"));

    for (const dateIso of days) {
      const schedule = await resolveWorkScheduleAdmin(db, entityId, empId, dateIso);

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

async function resolvePayrollRateSnapshotAdmin(
  db: Firestore,
  entityId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<PayrollRateSnapshot> {
  const { startDateIso, endDateIso } = await getPayrollMonthRange(year, month);
  const [empRefSnap, paramsSnap] = await Promise.all([
    db.collection("entities").doc(entityId).collection("employees").doc(employeeId).get(),
    db
      .collection("entities")
      .doc(entityId)
      .collection("payrollParameters")
      .where("employeeId", "==", employeeId)
      .where("status", "==", "active")
      .where("effectiveFrom", "<=", endDateIso)
      .orderBy("effectiveFrom", "desc")
      .get(),
  ]);

  if (!empRefSnap.exists) return { source: "missing", ordinaryHourlyRate: 0 };
  const emp = empRefSnap.data() as Employee;
  if (!emp.activeContractId) return { source: "missing", ordinaryHourlyRate: 0 };

  const activeParamDoc = paramsSnap.docs.find((parameterDoc) => {
    const parameter = parameterDoc.data() as PayrollParameter;
    return !parameter.effectiveTo || parameter.effectiveTo >= startDateIso;
  });
  const activeParam = activeParamDoc
    ? { ...activeParamDoc.data(), id: activeParamDoc.id } as PayrollParameter
    : null;

  const contractSnap = await db
    .collection("entities")
    .doc(entityId)
    .collection("contracts")
    .doc(emp.activeContractId)
    .get();

  if (!contractSnap.exists) return { source: "missing", ordinaryHourlyRate: 0 };
  const contract = contractSnap.data() as Contract;

  let ccnlData: CCNL | null = null;
  let levelData: CCNLLevel | null = null;

  if (contract.ccnlId) {
    const ccnlSnap = await db.collection("entities").doc(entityId).collection("ccnls").doc(contract.ccnlId).get();
    if (ccnlSnap.exists) ccnlData = ccnlSnap.data() as CCNL;
  }

  if (contract.ccnlId && contract.levelId) {
    const levelSnap = await db
      .collection("entities")
      .doc(entityId)
      .collection("ccnls")
      .doc(contract.ccnlId)
      .collection("levels")
      .doc(contract.levelId)
      .get();
    if (levelSnap.exists) levelData = levelSnap.data() as CCNLLevel;
  }

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

  let expectedWeeklyHours: number | null = null;
  const isValidNum = (v: any): v is number => typeof v === "number" && v > 0;

  if (isValidNum(contract.weeklyHours)) {
    expectedWeeklyHours = contract.weeklyHours;
  } else if (ccnlData && isValidNum(ccnlData.standardWeeklyHours)) {
    expectedWeeklyHours = ccnlData.standardWeeklyHours;
  } else if (ccnlData && ccnlData.weeklySchedule) {
    const s = ccnlData.weeklySchedule;
    const sum = (s.monday || 0) + (s.tuesday || 0) + (s.wednesday || 0) + (s.thursday || 0) + (s.friday || 0) + (s.saturday || 0) + (s.sunday || 0);
    if (sum > 0) expectedWeeklyHours = sum;
  }

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

async function saveMonthlyPayrollCalculationsAdmin(
  db: Firestore,
  entityId: string,
  calculations: PayrollCalculation[],
  actorUid: string
) {
  let savedCount = 0;

  for (let index = 0; index < calculations.length; index += MAX_BATCH_WRITES) {
    const chunk = calculations.slice(index, index + MAX_BATCH_WRITES);
    const batch = db.batch();

    chunk.forEach((calc) => {
      const calcRef = db.collection("entities").doc(entityId).collection("payrollCalculations").doc(calc.id);
      const sanitizedCalc = sanitizeForFirestore(calc);
      batch.set(calcRef, {
        ...sanitizedCalc,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      }, { merge: true });
    });

    await batch.commit();
    savedCount += chunk.length;
  }

  return { savedCount, skippedCount: 0 };
}

export async function calculateTrustedMonthlyPayroll(params: {
  entityId: string;
  year: number;
  month: number;
  actorUid: string;
}): Promise<TrustedPayrollCalculationResult> {
  const db = getAdminDatabase();
  const { entityId, year, month, actorUid } = params;

  const { startDateIso, endDateIso, nextMonthStartDateIso } = await getPayrollMonthRange(year, month);

  const hSnap = await db
    .collection("entities")
    .doc(entityId)
    .collection("holidays")
    .where("date", ">=", startDateIso)
    .where("date", "<=", endDateIso)
    .get();

  const holidaysMap = new Map<string, string>();
  hSnap.docs.forEach(d => {
    const h = d.data();
    if (h.status === "active") {
      holidaysMap.set(h.date, h.name);
    }
  });

  const aggregations = await aggregateMonthlyAttendanceAdmin(db, entityId, year, month, holidaysMap);

  const allWarnings = await buildPrePayrollReconciliationAdmin(db, entityId, year, month, aggregations);

  const finalCalculations: PayrollCalculation[] = [];
  let failedCount = 0;

  for (const empId of Object.keys(aggregations)) {
      try {
        const agg = aggregations[empId];
        const rate = await resolvePayrollRateSnapshotAdmin(db, entityId, empId, year, month);
        const empWarnings = allWarnings.filter(w => w.employeeId === empId);
        const paidHolidayHours =
          rate.payCalculationMode === "actual_worked_hours"
            ? await resolvePaidHolidayHoursForActualWorkedModeAdmin(
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
            message: "Seuil hebdomadaire non détecté. Réconciliation SUP bloquée.",
          });
          agg.overtimeHours = 0;
          agg.weeklyBreakdown = [];
        } else {
          const attSnap = await db
            .collection("entities")
            .doc(entityId)
            .collection("attendances")
            .where("employeeId", "==", empId)
            .where("attendanceDate", ">=", startDateIso)
            .where("attendanceDate", "<", nextMonthStartDateIso)
            .get();

          const records = attSnap.docs
            .map(d => ({ ...d.data(), id: d.id } as AttendanceRecord))
            .filter(r => RELIABLE_ATTENDANCE_STATUSES.includes(r.status));

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
          paidHolidayHours,
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
          updatedBy: actorUid,
        });
      } catch {
        failedCount++;
      }
    }

    const saveResults = await saveMonthlyPayrollCalculationsAdmin(db, entityId, finalCalculations, actorUid);

    const warningsCount = finalCalculations.reduce(
      (total, calculation) => total + calculation.reconciliationWarnings.length,
      0
    );

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "payroll.calculated",
        resourceType: "payrollCalculation",
        resourceId: `${year}_${month}`,
        details: {
          year,
          month,
          employeesCalculated: finalCalculations.length,
          calculationsSaved: saveResults.savedCount,
          warningsCount,
          failedCount,
          totalGrossEconomicAmount: roundMoney(
            finalCalculations.reduce(
              (total, calculation) => total + calculation.grossEconomicTotal,
              0
            )
          ),
        },
      });
    } catch {
      // Audit failures remain non-blocking and must not affect Payroll calculation results.
    }

    if (Object.keys(aggregations).length > 0 && finalCalculations.length === 0) {
      throw new Error("PAYROLL_CALCULATION_ALL_EMPLOYEES_FAILED");
    }

  return {
    year,
    month,
    totalEmployees: Object.keys(aggregations).length,
    savedCount: saveResults.savedCount,
    skippedCount: saveResults.skippedCount,
    failedCount,
    warningsCount,
  };
}
