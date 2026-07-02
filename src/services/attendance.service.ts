import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  writeBatch, 
  serverTimestamp, 
  FieldValue,
  getDocs,
  query,
  where,
  documentId
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
 * Performs a real draft import of attendance records into Firestore.
 * Standardizes mapping, checks for duplicates, and executes batch writes.
 */
export async function executeAttendanceImport(params: {
  entityId: string;
  actorUid: string;
  previewRows: AttendancePreviewRow[];
  batchMetadata: Partial<AttendanceImportBatch>;
}) {
  const { entityId, actorUid, previewRows, batchMetadata } = params;
  if (!db) throw new Error("Firestore not initialized");

  // 1. Internal Duplicate Check (within file)
  const keysInFile = new Set<string>();
  for (const row of previewRows) {
    const key = `${row.employeeId}_${row.date}`;
    if (keysInFile.has(key)) {
      throw new Error(`DOUBLON_INTERNE: Plusieurs entrées trouvées pour le collaborateur ${row.employeeName} à la date du ${row.date}.`);
    }
    keysInFile.add(key);
  }

  // 2. Database Pre-flight Check (existing records)
  // Check for existing records in chunks of 30 (Firestore limit for 'in')
  const allIds = Array.from(keysInFile);
  for (let i = 0; i < allIds.length; i += 30) {
    const chunk = allIds.slice(i, i + 30);
    const q = query(
      collection(db, `entities/${entityId}/attendances`),
      where(documentId(), "in", chunk)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existingId = snap.docs[0].id;
      const [empId, date] = existingId.split('_');
      throw new Error(`CONFLIT_EXISTANT: Un enregistrement de présence existe déjà pour le collaborateur ${empId} à la date du ${date}.`);
    }
  }

  // 3. Prepare Batch
  const batchId = doc(collection(db, "temp")).id;
  const batchRef = doc(db, `entities/${entityId}/attendanceImportBatches`, batchId);
  const now = serverTimestamp();

  const mainBatch = writeBatch(db);

  // Set Batch Metadata
  const finalBatchData: AttendanceImportBatch = {
    ...(batchMetadata as any),
    batchId,
    entityId,
    status: "imported", // Or draft_imported if already defined
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  mainBatch.set(batchRef, finalBatchData);

  // 4. Chunked Writes for Records
  // Using multiple batches if count > 450
  const chunks: AttendancePreviewRow[][] = [];
  for (let i = 0; i < previewRows.length; i += 450) {
    chunks.push(previewRows.slice(i, i + 450));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkBatch = i === 0 ? mainBatch : writeBatch(db);
    const currentRows = chunks[i];

    currentRows.forEach(row => {
      const attendanceId = buildAttendanceId(row.employeeId!, row.date);
      const recordRef = doc(db!, `entities/${entityId}/attendances`, attendanceId);

      const record: AttendanceRecord = {
        attendanceId,
        entityId,
        employeeId: row.employeeId!,
        personId: row.personId || null,
        employeeCode: row.employeeCode,
        employeeDisplayName: row.employeeName,
        attendanceDate: row.date,
        
        worksiteName: row.worksite || null,
        departmentName: row.department || null,
        
        punches: row.punches || [],
        pauseMinutes: row.pauseMinutes || 0,
        calculatedHours: row.calculatedHours,
        validatedHours: row.validatedHours,
        dayHours: row.dayHours,
        nightHours: row.nightHours,
        overtimeHours: row.overtimeHours,
        holidayWorkedHours: row.holidayWorkedHours,
        
        absenceCode: row.absenceCode || null,
        holidayFlag: row.isHoliday,
        notes: row.notes || "",
        
        anomalyFlag: row.status === "warning",
        anomalyMessages: row.messages,
        
        status: "draft_imported",
        source: "excel_import",
        importBatchId: batchId,
        
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
        shiftType: "day" // Default required by type
      };

      chunkBatch.set(recordRef, record);
    });

    await chunkBatch.commit();
  }

  // 5. Audit Log
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "attendance.batch_imported",
    resourceType: "attendanceImportBatch",
    resourceId: batchId,
    details: { 
      rows: previewRows.length, 
      period: `${batchMetadata.periodStart} to ${batchMetadata.periodEnd}`,
      totalHours: batchMetadata.totalWorkedHours
    }
  });

  return { batchId, count: previewRows.length };
}

/**
 * Creates an import batch metadata record.
 * @deprecated Use executeAttendanceImport for atomic transactional logic.
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
 * @deprecated Use executeAttendanceImport for atomic transactional logic.
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
