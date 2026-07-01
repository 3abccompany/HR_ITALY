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
  AttendanceImportBatch 
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
