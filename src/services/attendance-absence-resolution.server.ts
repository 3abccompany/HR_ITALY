import "server-only";

import { eachDayOfInterval, format, parseISO } from "date-fns";
import type {
  AttendanceAbsenceResolutionSnapshot,
  AttendanceRecord,
} from "@/types/attendance";
import type { TimeOffRequest } from "@/types/time-off";

export const ATTENDANCE_ABSENCE_RESOLUTION_SNAPSHOT_VERSION = 1;

export type AttendanceAbsenceResolutionMutation = "approved" | "rejected" | "cancelled";

export interface AttendanceAbsenceResolutionSummary {
  matched: number;
  updated: number;
  unchanged: number;
  skippedNoAttendance: number;
  skippedWorkedRecord: number;
  skippedAmbiguous: number;
  failed: number;
}

export interface PlannedAttendanceAbsenceResolutionUpdate {
  attendanceId: string;
  attendanceDate: string;
  nextAbsenceResolution: AttendanceAbsenceResolutionSnapshot | null;
}

export interface AttendanceAbsenceResolutionPlan {
  updates: PlannedAttendanceAbsenceResolutionUpdate[];
  summary: AttendanceAbsenceResolutionSummary;
}

const emptySummary = (): AttendanceAbsenceResolutionSummary => ({
  matched: 0,
  updated: 0,
  unchanged: 0,
  skippedNoAttendance: 0,
  skippedWorkedRecord: 0,
  skippedAmbiguous: 0,
  failed: 0,
});

function normalizeDate(value: string): string | null {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "yyyy-MM-dd");
}

function datesCoveredByRequest(request: Pick<TimeOffRequest, "startDate" | "endDate">): string[] {
  const start = normalizeDate(request.startDate);
  const end = normalizeDate(request.endDate);
  if (!start || !end) return [];

  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (startDate > endDate) return [];

  return eachDayOfInterval({ start: startDate, end: endDate }).map((date) => format(date, "yyyy-MM-dd"));
}

function hasWorkedHours(record: AttendanceRecord): boolean {
  return Number(record.validatedHours || 0) > 0;
}

function isAbsenceCandidate(record: AttendanceRecord): boolean {
  return !hasWorkedHours(record) && (
    !!record.absenceCode
    || Number(record.validatedHours || 0) === 0
    || !!record.anomalyMessages?.includes("Absence à analyser")
  );
}

function sameSnapshot(
  current: AttendanceAbsenceResolutionSnapshot | null | undefined,
  next: AttendanceAbsenceResolutionSnapshot | null,
): boolean {
  if (!current && !next) return true;
  if (!current || !next) return false;
  return current.status === next.status
    && current.source === next.source
    && current.snapshotVersion === next.snapshotVersion
    && (current.type || null) === (next.type || null)
    && (current.code || null) === (next.code || null)
    && (current.sourceRequestId || null) === (next.sourceRequestId || null);
}

function requestCoversDate(request: Pick<TimeOffRequest, "startDate" | "endDate">, date: string): boolean {
  return request.startDate <= date && request.endDate >= date;
}

function hasOverlappingRequest(params: {
  request: Pick<TimeOffRequest, "requestId" | "employeeId" | "startDate" | "endDate">;
  attendanceDate: string;
  overlappingRequests?: Pick<TimeOffRequest, "requestId" | "employeeId" | "status" | "startDate" | "endDate">[];
}): boolean {
  const { request, attendanceDate, overlappingRequests = [] } = params;

  return overlappingRequests.some((candidate) => (
    candidate.requestId !== request.requestId
    && candidate.employeeId === request.employeeId
    && candidate.status !== "cancelled"
    && requestCoversDate(candidate, attendanceDate)
  ));
}

function canReplaceWithRequestSnapshot(record: AttendanceRecord, requestId: string): boolean {
  const current = record.absenceResolution;
  if (!current) return true;
  if (current.source === "time_off_request" && current.sourceRequestId === requestId) return true;
  if (current.status === "unresolved") return true;
  return false;
}

export function buildTimeOffAbsenceResolutionSnapshot(
  request: Pick<TimeOffRequest, "requestId" | "requestType">,
  status: "justified" | "rejected",
  resolvedAt: Date | null = null,
): AttendanceAbsenceResolutionSnapshot {
  return {
    status,
    source: "time_off_request",
    snapshotVersion: ATTENDANCE_ABSENCE_RESOLUTION_SNAPSHOT_VERSION,
    type: request.requestType,
    code: null,
    sourceRequestId: request.requestId,
    resolvedAt,
  };
}

export function buildFallbackAbsenceResolutionSnapshot(
  record: Pick<AttendanceRecord, "absenceCode">,
  resolvedAt: Date | null = null,
): AttendanceAbsenceResolutionSnapshot | null {
  if (record.absenceCode) {
    return {
      status: "imported",
      source: "attendance_import",
      snapshotVersion: ATTENDANCE_ABSENCE_RESOLUTION_SNAPSHOT_VERSION,
      code: record.absenceCode,
      resolvedAt,
    };
  }

  return {
    status: "unresolved",
    source: "system_reconciliation",
    snapshotVersion: ATTENDANCE_ABSENCE_RESOLUTION_SNAPSHOT_VERSION,
    resolvedAt,
  };
}

export function planAttendanceAbsenceResolutionForTimeOffRequest(params: {
  request: Pick<TimeOffRequest, "requestId" | "entityId" | "employeeId" | "requestType" | "startDate" | "endDate">;
  attendanceRecords: AttendanceRecord[];
  mutation: AttendanceAbsenceResolutionMutation;
  overlappingRequests?: Pick<TimeOffRequest, "requestId" | "employeeId" | "status" | "startDate" | "endDate">[];
  resolvedAt?: Date | null;
}): AttendanceAbsenceResolutionPlan {
  const { request, attendanceRecords, mutation, overlappingRequests, resolvedAt = null } = params;
  const summary = emptySummary();
  const updates: PlannedAttendanceAbsenceResolutionUpdate[] = [];
  const dates = datesCoveredByRequest(request);

  for (const attendanceDate of dates) {
    try {
      const candidates = attendanceRecords.filter((record) => (
        record.entityId === request.entityId
        && record.employeeId === request.employeeId
        && record.attendanceDate === attendanceDate
      ));

      if (candidates.length === 0) {
        summary.skippedNoAttendance += 1;
        continue;
      }

      if (candidates.length > 1) {
        summary.skippedAmbiguous += 1;
        continue;
      }

      const record = candidates[0];
      summary.matched += 1;

      if (hasWorkedHours(record)) {
        summary.skippedWorkedRecord += 1;
        continue;
      }

      if (!isAbsenceCandidate(record)) {
        summary.unchanged += 1;
        continue;
      }

      if (
        mutation !== "cancelled"
        && hasOverlappingRequest({ request, attendanceDate, overlappingRequests })
        && record.absenceResolution?.sourceRequestId !== request.requestId
      ) {
        summary.skippedAmbiguous += 1;
        continue;
      }

      if (mutation === "cancelled") {
        if (
          record.absenceResolution?.source !== "time_off_request"
          || record.absenceResolution.sourceRequestId !== request.requestId
        ) {
          summary.unchanged += 1;
          continue;
        }

        const nextAbsenceResolution = buildFallbackAbsenceResolutionSnapshot(record, resolvedAt);
        if (sameSnapshot(record.absenceResolution, nextAbsenceResolution)) {
          summary.unchanged += 1;
          continue;
        }

        updates.push({
          attendanceId: record.attendanceId || record.id,
          attendanceDate,
          nextAbsenceResolution,
        });
        summary.updated += 1;
        continue;
      }

      if (!canReplaceWithRequestSnapshot(record, request.requestId)) {
        summary.skippedAmbiguous += 1;
        continue;
      }

      const nextAbsenceResolution = buildTimeOffAbsenceResolutionSnapshot(
        request,
        mutation === "approved" ? "justified" : "rejected",
        resolvedAt,
      );

      if (sameSnapshot(record.absenceResolution, nextAbsenceResolution)) {
        summary.unchanged += 1;
        continue;
      }

      updates.push({
        attendanceId: record.attendanceId || record.id,
        attendanceDate,
        nextAbsenceResolution,
      });
      summary.updated += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return { updates, summary };
}
