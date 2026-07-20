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
  PayrollParameter,
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
import {
  calculatePayrollEconomicValues as calculatePayrollEconomicValuesCore,
  getPayrollMonthRange,
  percentageToDecimal,
  percentageToMultiplier,
  reconcileWeeklyOvertime,
  resolveSupportedPayCalculationMode,
  roundMoney,
  sanitizeForFirestore,
} from "./payroll-calculation-core";

export {
  getPayrollMonthRange,
  percentageToDecimal,
  percentageToMultiplier,
} from "./payroll-calculation-core";

// --- Main Service Logic ---

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
  return calculatePayrollEconomicValuesCore(agg, rate, warnings, options);
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
