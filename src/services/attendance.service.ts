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
 * Calculates total hours for a set of punches.
 * Handles overnight shifts if timeOut < timeIn.
 */
export function calculatePunchHours(punches: AttendancePunch[], pauseMinutes: number = 0): number {
  let totalMinutes = 0;

  punches.forEach(p => {
    if (!p.timeIn || !p.timeOut) return;

    const [hIn, mIn] = p.timeIn.split(':').map(Number);
    const [hOut, mOut] = p.timeOut.split(':').map(Number);

    if (isNaN(hIn) || isNaN(mIn) || isNaN(hOut) || isNaN(mOut)) return;

    let start = hIn * 60 + mIn;
    let end = hOut * 60 + mOut;

    // If exit is before entry, assume it crosses midnight (Overnight)
    if (end < start) {
      end += 24 * 60;
    }

    totalMinutes += (end - start);
  });

  const netMinutes = Math.max(0, totalMinutes - pauseMinutes);
  return Number((netMinutes / 60).toFixed(2));
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
  if (!row.date) {
    status = "error";
    messages.push("Date manquante ou invalide.");
  }

  // 3. Pause Validation
  const pause = row.pauseMinutes;
  if (isNaN(pause) || pause < 0) {
    status = "error";
    messages.push("Pause invalide (doit être un nombre positif).");
  }

  // Calculate gross duration if punches exist to verify pause
  let grossMinutes = 0;
  if (row.punches && row.punches.length > 0) {
    let hasCompletePunches = false;
    row.punches.forEach(p => {
      if (!p.timeIn || !p.timeOut) return;
      if (typeof p.timeIn !== 'string' || typeof p.timeOut !== 'string') return;
      if (!p.timeIn.includes(':') || !p.timeOut.includes(':')) return;

      const [hIn, mIn] = p.timeIn.split(':').map(Number);
      const [hOut, mOut] = p.timeOut.split(':').map(Number);
      
      if (!isNaN(hIn) && !isNaN(mIn) && !isNaN(hOut) && !isNaN(mOut)) {
        hasCompletePunches = true;
        let start = hIn * 60 + mIn;
        let end = hOut * 60 + mOut;
        if (end < start) end += 24 * 60; // night shift
        grossMinutes += (end - start);
      }
    });

    if (hasCompletePunches) {
      if (pause > grossMinutes) {
        status = "error";
        messages.push("Pause supérieure à la durée travaillée.");
      } else if (pause > 120) {
        if (status !== 'error') status = "warning";
        messages.push("Alerte: Pause supérieure à 2h.");
      }
    }
  }

  // 4. Hours Check
  if (row.validatedHours < 0 || row.calculatedHours < 0) {
    status = "error";
    messages.push("Le total d'heures ne peut pas être négatif.");
  }

  if (row.validatedHours > 12) {
    if (status !== 'error') status = "warning";
    messages.push("Alerte: Durée de travail journalière élevée (> 12h).");
  }

  // 5. Overlap Check
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

  return {
    ...row,
    status,
    messages,
    employeeId: employeesMap.get(row.employeeCode)?.employeeId
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
