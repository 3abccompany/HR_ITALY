"use server";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { AttendanceRecord } from "@/types/attendance";
import type { TimeOffRequest, TimeOffRequestType } from "@/types/time-off";

type AttendanceAbsenceSummaryErrorCode =
  | "unauthenticated"
  | "inactive-user"
  | "entity-not-found"
  | "entity-inactive"
  | "membership-not-found"
  | "membership-inactive"
  | "forbidden-attendances-read"
  | "invalid-date-range"
  | "date-range-too-large"
  | "summary-load-failed";

export type AttendanceAbsenceSummaryStatus =
  | "justified"
  | "rejected"
  | "unjustified"
  | "unresolved";

export type AttendanceAbsenceSummary = {
  attendanceId: string;
  resolutionStatus: AttendanceAbsenceSummaryStatus;
  type?: TimeOffRequestType | null;
};

export type GetAttendanceAbsenceSummariesResult = {
  success: boolean;
  summaries?: AttendanceAbsenceSummary[];
  error?: string;
  code?: AttendanceAbsenceSummaryErrorCode;
};

type GetAttendanceAbsenceSummariesParams = {
  idToken: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
};

const MAX_RANGE_DAYS = 62;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResult(
  code: AttendanceAbsenceSummaryErrorCode,
  error: string
): GetAttendanceAbsenceSummariesResult {
  return { success: false, code, error };
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function getDateRange(params: Pick<GetAttendanceAbsenceSummariesParams, "dateFrom" | "dateTo">) {
  const dateFrom = safeString(params.dateFrom);
  const dateTo = safeString(params.dateTo);
  const from = parseDateOnly(dateFrom);
  const to = parseDateOnly(dateTo);

  if (!from || !to || from > to) {
    throw new AttendanceSummaryActionError("invalid-date-range", "Période invalide.");
  }

  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new AttendanceSummaryActionError("date-range-too-large", "Période trop large.");
  }

  return { dateFrom, dateTo };
}

class AttendanceSummaryActionError extends Error {
  constructor(
    public readonly code: AttendanceAbsenceSummaryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AttendanceSummaryActionError";
  }
}

function toActionError(error: unknown): GetAttendanceAbsenceSummariesResult {
  if (error instanceof AttendanceSummaryActionError) {
    return errorResult(error.code, error.message);
  }
  return errorResult("summary-load-failed", "Résumé des absences temporairement indisponible.");
}

async function authorizeAttendanceSummaryRead(params: Pick<GetAttendanceAbsenceSummariesParams, "idToken" | "entityId">) {
  if (!adminDb || !adminAuth) {
    throw new AttendanceSummaryActionError("summary-load-failed", "Service indisponible.");
  }

  const entityId = safeString(params.entityId);
  if (!entityId) {
    throw new AttendanceSummaryActionError("entity-not-found", "Entité introuvable.");
  }

  const idToken = safeString(params.idToken);
  if (!idToken) {
    throw new AttendanceSummaryActionError("unauthenticated", "Session requise.");
  }

  const decodedToken = await adminAuth.verifyIdToken(idToken);
  const uid = decodedToken.uid;

  const userSnapshot = await adminDb.collection("users").doc(uid).get();
  if (!userSnapshot.exists || userSnapshot.data()?.status !== "active") {
    throw new AttendanceSummaryActionError("inactive-user", "Utilisateur inactif.");
  }

  const entitySnapshot = await adminDb.collection("entities").doc(entityId).get();
  if (!entitySnapshot.exists) {
    throw new AttendanceSummaryActionError("entity-not-found", "Entité introuvable.");
  }
  if (entitySnapshot.data()?.status !== "active") {
    throw new AttendanceSummaryActionError("entity-inactive", "Entité inactive.");
  }

  if (userSnapshot.data()?.platformRole === "superAdmin") {
    return { uid, entityId };
  }

  const membershipId = `${uid}_${entityId}`;
  const membershipSnapshot = await adminDb.collection("memberships").doc(membershipId).get();
  if (!membershipSnapshot.exists) {
    throw new AttendanceSummaryActionError("membership-not-found", "Affectation introuvable.");
  }

  const membership = membershipSnapshot.data() || {};
  if (membership.status !== "active") {
    throw new AttendanceSummaryActionError("membership-inactive", "Affectation inactive.");
  }

  const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
  if (!permissions.includes("attendances.read")) {
    throw new AttendanceSummaryActionError("forbidden-attendances-read", "Autorisation présences requise.");
  }

  return { uid, entityId };
}

function requestCoversAttendance(request: TimeOffRequest, attendance: AttendanceRecord): boolean {
  return request.employeeId === attendance.employeeId
    && request.status !== "cancelled"
    && request.startDate <= attendance.attendanceDate
    && request.endDate >= attendance.attendanceDate;
}

function hasWorkedHours(attendance: AttendanceRecord): boolean {
  return Number(attendance.validatedHours || 0) > 0;
}

function summaryFromRequest(request: TimeOffRequest): AttendanceAbsenceSummaryStatus {
  if (request.status === "approved") {
    return request.requestType === "unjustified_absence" ? "unjustified" : "justified";
  }
  if (request.status === "rejected") return "rejected";
  return "unresolved";
}

export async function getAttendanceAbsenceSummariesAction(
  params: GetAttendanceAbsenceSummariesParams
): Promise<GetAttendanceAbsenceSummariesResult> {
  try {
    const { dateFrom, dateTo } = getDateRange(params);
    const { entityId } = await authorizeAttendanceSummaryRead(params);

    const attendanceSnapshot = await adminDb
      .collection("entities")
      .doc(entityId)
      .collection("attendances")
      .where("attendanceDate", ">=", dateFrom)
      .where("attendanceDate", "<=", dateTo)
      .get();

    const attendances = attendanceSnapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as AttendanceRecord));

    const absenceCandidates = attendances.filter((attendance) => !hasWorkedHours(attendance));
    if (absenceCandidates.length === 0) {
      return { success: true, summaries: [] };
    }

    const timeOffSnapshot = await adminDb
      .collection("entities")
      .doc(entityId)
      .collection("timeOffRequests")
      .where("endDate", ">=", dateFrom)
      .get();

    const timeOffRequests = timeOffSnapshot.docs
      .map((doc) => ({ ...doc.data(), requestId: doc.data().requestId || doc.id } as TimeOffRequest))
      .filter((request) => request.startDate <= dateTo && request.status !== "cancelled");

    const summaries: AttendanceAbsenceSummary[] = [];

    for (const attendance of absenceCandidates) {
      const matches = timeOffRequests.filter((request) => requestCoversAttendance(request, attendance));
      if (matches.length !== 1) continue;

      const request = matches[0];
      summaries.push({
        attendanceId: attendance.attendanceId || attendance.id,
        resolutionStatus: summaryFromRequest(request),
        type: request.requestType || null,
      });
    }

    return { success: true, summaries };
  } catch (error) {
    return toActionError(error);
  }
}
