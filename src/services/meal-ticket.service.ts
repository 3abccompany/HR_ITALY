import { db } from "@/lib/firebase/client";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { AttendanceRecord } from "@/types/attendance";
import { Contract } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Holiday } from "@/types/holiday";
import {
  MealTicketExcludedBreakdown,
  MealTicketExcludedDayDetail,
  MealTicketMonthlySummary,
  MealTicketPolicy,
} from "@/types/meal-ticket";
import { TimeOffRequest } from "@/types/time-off";
import { createAuditLog } from "./audit.service";

type PeriodInput = {
  year: number;
  month: number;
  startDate?: string;
  endDate?: string;
};

type SummaryInput = {
  entityId: string;
  employee: Pick<Employee, "employeeId" | "displayName" | "activeContractId">;
  year: number;
  month: number;
  policy: MealTicketPolicy | null;
  attendanceRecords: AttendanceRecord[];
  timeOffRequests?: TimeOffRequest[];
  holidays?: Holiday[];
  generatedBy?: string;
};

const VALID_ATTENDANCE_STATUSES = new Set(["validated", "corrected", "locked"]);

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function getMealTicketMonthRange(year: number, month: number) {
  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function overlapsPeriod(policy: MealTicketPolicy, startDate: string, endDate: string) {
  return policy.effectiveFrom <= endDate && (!policy.effectiveTo || policy.effectiveTo >= startDate);
}

function dayBefore(date: string) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() - 1);
  return value.toISOString().slice(0, 10);
}

function chooseLatestPolicy(policies: MealTicketPolicy[], startDate: string, endDate: string) {
  return policies
    .filter((policy) => policy.status === "active" && overlapsPeriod(policy, startDate, endDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
}

function expandRequestDates(request: TimeOffRequest, startDate: string, endDate: string) {
  const dates = new Set<string>();
  let cursor = new Date(`${request.startDate}T00:00:00`);
  const last = new Date(`${request.endDate}T00:00:00`);

  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10);
    if (iso >= startDate && iso <= endDate) {
      dates.add(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export async function resolveMealTicketPolicyForEmployee(
  entityId: string,
  employeeId: string,
  contractId: string | null | undefined,
  period: PeriodInput
): Promise<MealTicketPolicy | null> {
  if (!db) throw new Error("Firestore not initialized");

  const { startDate, endDate } = {
    ...getMealTicketMonthRange(period.year, period.month),
    ...period,
  };

  const policiesRef = collection(db, `entities/${entityId}/mealTicketPolicies`);
  const snap = await getDocs(query(policiesRef, where("status", "==", "active")));
  const policies = snap.docs.map((d) => ({ ...d.data(), id: d.id } as MealTicketPolicy));

  const employeePolicy = chooseLatestPolicy(
    policies.filter((policy) => policy.scope === "employee" && policy.employeeId === employeeId),
    startDate,
    endDate
  );
  if (employeePolicy) return employeePolicy;

  const contractPolicy = chooseLatestPolicy(
    policies.filter((policy) => policy.scope === "contract" && !!contractId && policy.contractId === contractId),
    startDate,
    endDate
  );
  if (contractPolicy) return contractPolicy;

  return chooseLatestPolicy(
    policies.filter((policy) => policy.scope === "entity"),
    startDate,
    endDate
  );
}

export function resolveMealTicketPolicyFromList(
  policies: MealTicketPolicy[],
  employeeId: string,
  contractId: string | null | undefined,
  period: PeriodInput
) {
  const { startDate, endDate } = {
    ...getMealTicketMonthRange(period.year, period.month),
    ...period,
  };

  return (
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "employee" && policy.employeeId === employeeId),
      startDate,
      endDate
    ) ||
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "contract" && !!contractId && policy.contractId === contractId),
      startDate,
      endDate
    ) ||
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "entity"),
      startDate,
      endDate
    )
  );
}

export function calculateMealTicketMonthlySummary({
  entityId,
  employee,
  year,
  month,
  policy,
  attendanceRecords,
  timeOffRequests = [],
  holidays = [],
  generatedBy,
}: SummaryInput): MealTicketMonthlySummary {
  const { startDate, endDate } = getMealTicketMonthRange(year, month);
  const breakdown: MealTicketExcludedBreakdown = {
    absences: 0,
    leave: 0,
    holidaysNotWorked: 0,
    nonWorkedDays: 0,
    invalidOrDraftAttendance: 0,
  };
  const excludedDates: MealTicketExcludedDayDetail[] = [];
  const eligibleDates: string[] = [];
  const sourceAttendanceIds: string[] = [];
  const warnings: string[] = [];

  if (!policy) {
    warnings.push("Aucune politique buoni pasto active pour cette période.");
  }

  const valuePerTicket = policy?.valuePerTicket ?? 0;
  const minimumHours = policy?.minimumWorkedHoursForEligibility ?? 0;
  const holidayDates = new Set(
    holidays
      .filter((holiday) => holiday.status === "active" && holiday.date >= startDate && holiday.date <= endDate)
      .map((holiday) => holiday.date)
  );

  const leaveDates = new Set<string>();
  for (const request of timeOffRequests) {
    if (request.employeeId !== employee.employeeId || request.status !== "approved") continue;
    for (const date of expandRequestDates(request, startDate, endDate)) {
      leaveDates.add(date);
    }
  }

  const employeeAttendance = attendanceRecords
    .filter((record) => record.employeeId === employee.employeeId)
    .filter((record) => record.attendanceDate >= startDate && record.attendanceDate <= endDate)
    .sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate));

  const workedHolidayDates = new Set<string>();

  for (const record of employeeAttendance) {
    const attendanceId = record.attendanceId || record.id;
    const workedHours = Number(record.validatedHours || 0);
    const isValidStatus = VALID_ATTENDANCE_STATUSES.has(record.status);
    const isHoliday = record.holidayFlag === true || holidayDates.has(record.attendanceDate);
    const isLeave = leaveDates.has(record.attendanceDate);
    const isAbsence = !!record.absenceCode;

    if (isValidStatus) {
      sourceAttendanceIds.push(attendanceId);
    } else {
      breakdown.invalidOrDraftAttendance += 1;
      excludedDates.push({
        date: record.attendanceDate,
        reason: "invalid_or_draft_attendance",
        attendanceId,
        validatedHours: workedHours,
      });
      continue;
    }

    if (isHoliday && workedHours > 0) {
      workedHolidayDates.add(record.attendanceDate);
    }

    if (!policy) continue;

    if (policy.excludeLeaveDays && isLeave) {
      breakdown.leave += 1;
      excludedDates.push({ date: record.attendanceDate, reason: "leave", attendanceId, validatedHours: workedHours });
      continue;
    }

    if (policy.excludeAbsenceDays && isAbsence) {
      breakdown.absences += 1;
      excludedDates.push({ date: record.attendanceDate, reason: "absence", attendanceId, validatedHours: workedHours });
      continue;
    }

    if (isHoliday && !policy.includeHolidayWorkedDays) {
      breakdown.holidaysNotWorked += 1;
      excludedDates.push({
        date: record.attendanceDate,
        reason: workedHours > 0 ? "holiday_worked_not_included" : "holiday_not_worked",
        attendanceId,
        validatedHours: workedHours,
      });
      continue;
    }

    if (workedHours < minimumHours) {
      if (isHoliday) {
        breakdown.holidaysNotWorked += 1;
        excludedDates.push({ date: record.attendanceDate, reason: "holiday_not_worked", attendanceId, validatedHours: workedHours });
      } else {
        breakdown.nonWorkedDays += 1;
        excludedDates.push({ date: record.attendanceDate, reason: "non_worked_day", attendanceId, validatedHours: workedHours });
      }
      continue;
    }

    eligibleDates.push(record.attendanceDate);
  }

  for (const holidayDate of holidayDates) {
    if (!workedHolidayDates.has(holidayDate) && !employeeAttendance.some((record) => record.attendanceDate === holidayDate)) {
      breakdown.holidaysNotWorked += 1;
      excludedDates.push({ date: holidayDate, reason: "holiday_not_worked" });
    }
  }

  if (employeeAttendance.length === 0) {
    warnings.push("Aucune présence trouvée pour cette période.");
  }

  if (breakdown.invalidOrDraftAttendance > 0) {
    warnings.push("Certaines présences brouillon ou non valides ont été ignorées.");
  }

  const eligibleDays = eligibleDates.length;
  const excludedDays = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    id: `${employee.employeeId}_${year}_${pad2(month)}_preview`,
    entityId,
    employeeId: employee.employeeId,
    employeeName: employee.displayName,
    year,
    month,
    policyId: policy?.id,
    valuePerTicket,
    eligibleDays,
    excludedDays,
    excludedBreakdown: breakdown,
    totalValue: Math.round(eligibleDays * valuePerTicket * 100) / 100,
    sourceAttendanceIds,
    eligibleDates,
    excludedDates,
    warnings,
    generatedAt: new Date(),
    generatedBy,
    status: "preview",
  };
}

export async function saveEntityMealTicketPolicy(
  entityId: string,
  data: Pick<
    MealTicketPolicy,
    | "effectiveFrom"
    | "effectiveTo"
    | "valuePerTicket"
    | "minimumWorkedHoursForEligibility"
    | "includeHolidayWorkedDays"
    | "excludeLeaveDays"
    | "excludeAbsenceDays"
    | "status"
  >,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const policiesRef = collection(db, `entities/${entityId}/mealTicketPolicies`);
  const existingSnap = await getDocs(
    query(
      policiesRef,
      where("scope", "==", "entity"),
      where("status", "==", "active")
    )
  );

  const overlappingPolicies = existingSnap.docs
    .map((d) => ({ ...d.data(), id: d.id } as MealTicketPolicy))
    .filter((policy) => overlapsPeriod(policy, data.effectiveFrom, data.effectiveTo || "9999-12-31"));

  const cannotAutoClose = overlappingPolicies.find((policy) => policy.effectiveFrom >= data.effectiveFrom);
  if (data.status === "active" && cannotAutoClose) {
    throw new Error(
      "Une politique active existe déjà sur cette période. Choisissez une date d'effet postérieure à la politique actuelle ou désactivez l'ancienne période."
    );
  }

  const policyRef = doc(policiesRef);
  const policyId = policyRef.id;
  const payload: MealTicketPolicy = {
    id: policyId,
    entityId,
    scope: "entity",
    employeeId: null,
    contractId: null,
    ...data,
    effectiveTo: data.effectiveTo || null,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  };

  const batch = writeBatch(db);
  const closeDate = dayBefore(data.effectiveFrom);

  if (data.status === "active") {
    for (const policy of overlappingPolicies) {
      if (!policy.id) continue;
      batch.set(
        doc(db, `entities/${entityId}/mealTicketPolicies`, policy.id),
        {
          effectiveTo: closeDate,
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true }
      );
    }
  }

  batch.set(policyRef, payload);
  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "meal_ticket.policy_version_created",
    resourceType: "mealTicketPolicy",
    resourceId: policyId,
    details: {
      scope: "entity",
      valuePerTicket: data.valuePerTicket,
      minimumWorkedHoursForEligibility: data.minimumWorkedHoursForEligibility,
      status: data.status,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo || null,
      closedPreviousPolicyIds: data.status === "active" ? overlappingPolicies.map((policy) => policy.id).filter(Boolean) : [],
    },
  });

  return policyId;
}

export type MealTicketContractSnapshot = Pick<Contract, "contractId">;
