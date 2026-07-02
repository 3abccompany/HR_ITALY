import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  writeBatch, 
  serverTimestamp, 
  FieldValue 
} from "firebase/firestore";
import { 
  AttendanceRecord, 
  AttendancePunch, 
  AttendanceImportBatch,
  AttendancePreviewRow
} from "@/types/attendance";
import { createAuditLog } from "./audit.service";

/**
 * Deterministic ID generation to prevent duplicates for same employee/date.
 */
export function buildAttendanceId(employeeId: string, attendanceDate: string): string {
  return `${employeeId}_${attendanceDate}`;
}

/**
 * Split results for an attendance calculation.
 */
export interface AttendanceSplits {
  total: number;
  day: number;
  night: number;
  overtime: number;
  holiday: number;
}

/**
 * Calculates total hours and Day/Night/Overtime splits for a set of punches.
 * Day period: 06:00 -> 22:00
 * Night period: 22:00 -> 06:00
 * Overtime: > 8h total
 */
export function calculateAttendanceSplits(
  punches: AttendancePunch[], 
  pauseMinutes: number = 0,
  isHoliday: boolean = false,
  ordinaryThreshold: number = 8
): AttendanceSplits {
  let grossDayMinutes = 0;
  let grossNightMinutes = 0;

  const DAY_START = 6 * 60;   // 06:00
  const DAY_END = 22 * 60;     // 22:00
  const TOTAL_MINS = 24 * 60;  // 1440

  punches.forEach(p => {
    if (!p.timeIn || !p.timeOut || p.timeIn === "INVALID" || p.timeOut === "INVALID") return;

    const inParts = p.timeIn.split(':');
    const outParts = p.timeOut.split(':');
    if (inParts.length !== 2 || outParts.length !== 2) return;

    const hIn = parseInt(inParts[0], 10);
    const mIn = parseInt(inParts[1], 10);
    const hOut = parseInt(outParts[0], 10);
    const mOut = parseInt(outParts[1], 10);

    if (isNaN(hIn) || isNaN(mIn) || isNaN(hOut) || isNaN(mOut)) return;

    let start = hIn * 60 + mIn;
    let end = hOut * 60 + mOut;

    // Standardize intervals for Day/Night calculation
    const intervals: { s: number, e: number }[] = [];
    if (end < start) {
      // Overnight shift
      intervals.push({ s: start, e: TOTAL_MINS });
      intervals.push({ s: 0, e: end });
    } else {
      intervals.push({ s: start, e: end });
    }

    intervals.forEach(range => {
      // Overlap with Day [360, 1320]
      const dayOverlap = Math.max(0, Math.min(range.e, DAY_END) - Math.max(range.s, DAY_START));
      const totalOverlap = range.e - range.s;
      
      grossDayMinutes += dayOverlap;
      grossNightMinutes += (totalOverlap - dayOverlap);
    });
  });

  const grossTotalMinutes = grossDayMinutes + grossNightMinutes;
  const netTotalMinutes = Math.max(0, grossTotalMinutes - pauseMinutes);
  
  // Deduct pause proportionally from day/night
  let netDayMinutes = grossDayMinutes;
  let netNightMinutes = grossNightMinutes;

  if (grossTotalMinutes > 0 && pauseMinutes > 0) {
    const ratio = pauseMinutes / grossTotalMinutes;
    netDayMinutes = Math.max(0, grossDayMinutes - (grossDayMinutes * ratio));
    netNightMinutes = Math.max(0, grossNightMinutes - (grossNightMinutes * ratio));
  }

  const total = Number((netTotalMinutes / 60).toFixed(2));
  const day = Number((netDayMinutes / 60).toFixed(2));
  const night = Number((netNightMinutes / 60).toFixed(2));
  const overtime = Number(Math.max(0, total - ordinaryThreshold).toFixed(2));
  const holiday = isHoliday ? total : 0;

  return { total, day, night, overtime, holiday };
}

/**
 * @deprecated Use calculateAttendanceSplits for full breakdown
 */
export function calculatePunchHours(punches: AttendancePunch[], pauseMinutes: number = 0): number {
  const result = calculateAttendanceSplits(punches, pauseMinutes);
  return result.total;
}

/**
 * Basic data integrity check for an attendance record.
 */
export function validateAttendanceRecordBasic(record: Partial<AttendanceRecord>): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!record.employeeId) errors.push("ID employé manquant");
  if (!record.employeeCode) errors.push("Matricule manquant");
  if (!record.attendanceDate) errors.push("Date manquante");
  if (!record.entityId) errors.push("ID entité manquant");
  
  if (record.pauseMinutes !== undefined && record.pauseMinutes < 0) {
    errors.push("La pause ne peut pas être négative");
  }

  const hasPunches = record.punches && record.punches.some(p => p.timeIn && p.timeOut);
  if (!hasPunches && !record.absenceCode) {
    errors.push("L'enregistrement doit contenir au moins un pointage ou un code d'absence");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a preview row and assigns status/messages.
 */
export function validatePreviewRow(row: AttendancePreviewRow, employeesMap: Map<string, any>): AttendancePreviewRow {
  const messages: string[] = [];
  let status: "valid" | "warning" | "error" = "valid";

  // 1. Identity Check
  if (!row.employeeCode) {
    status = "error";
    messages.push("Code employé manquant.");
  } else if (!employeesMap.has(row.employeeCode)) {
    status = "error";
    messages.push(`Code employé '${row.employeeCode}' introuvable dans ce tenant.`);
  }

  // 2. Date Check
  if (!row.date || row.date === "INVALID") {
    status = "error";
    messages.push("Date invalide ou manquante.");
  }

  // 3. Time Parsing/Calculation Integrity
  const invalidPunches = row.punches?.some(p => p.timeIn === "INVALID" || p.timeOut === "INVALID");
  if (invalidPunches) {
    status = "error";
    messages.push("Format horaire invalide (attendu HH:mm).");
  }

  // 4. Pause Validation
  const pause = row.pauseMinutes;
  if (isNaN(pause) || pause < 0) {
    status = "error";
    messages.push("Pause invalide (doit être un nombre positif).");
  }

  // 5. Hours Check
  if (row.validatedHours < 0 || row.calculatedHours < 0) {
    status = "error";
    messages.push("Le total d'heures ne peut pas être négatif.");
  }

  if (row.validatedHours > 12) {
    if (status !== 'error') status = "warning";
    messages.push("Alerte: Durée de travail journalière élevée (> 12h).");
  }

  // 6. Overlap Check
  if (row.validatedHours > 0 && row.absenceCode) {
    if (status !== 'error') status = "warning";
    messages.push("Alerte: Heures travaillées et code d'absence présents sur la même journée.");
  }

  const ABSENCE_CODES = [
    "paid_leave", "paid_permission", "unpaid_permission", 
    "sickness", "justified_absence", "expectation", "other"
  ];

  if (row.absenceCode && !ABSENCE_CODES.includes(row.absenceCode)) {
    status = "error";
    messages.push(`Code absence '${row.absenceCode}' non reconnu.`);
  }

  const emp = employeesMap.get(row.employeeCode);

  return {
    ...row,
    status,
    messages,
    employeeId: emp?.employeeId,
    personId: emp?.personId || null
  };
}

/**
 * Creates an import batch metadata record.
 */
export async function createAttendanceImportBatch(entityId: string, data: Partial<AttendanceImportBatch>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const batchRef = doc(collection(db, `entities/${entityId}/attendanceImportBatches`));
  const importBatchId = batchRef.id;

  const payload = {
    ...data,
    importBatchId,
    entityId,
    status: data.status || "previewed",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  };

  await setDoc(batchRef, payload);
  return importBatchId;
}

/**
 * Bulk insertion of attendance records using Firestore batches.
 */
export async function createAttendanceRecordsBatch(
  entityId: string, 
  records: Partial<AttendanceRecord>[], 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  if (records.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  records.forEach(r => {
    const attendanceId = r.attendanceId || buildAttendanceId(r.employeeId!, r.attendanceDate!);
    const ref = doc(db!, `entities/${entityId}/attendances`, attendanceId);

    const payload: Partial<AttendanceRecord> = {
      ...r,
      attendanceId,
      entityId,
      status: r.status || "draft_imported",
      source: r.source || "excel_import",
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };

    batch.set(ref, payload, { merge: true });
  });

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "attendances.batch_import",
    resourceType: "attendance",
    resourceId: records.length.toString(),
    details: { count: records.length }
  });
}
