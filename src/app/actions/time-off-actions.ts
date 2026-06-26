'use server';

import { adminDb, adminAuth, adminBucket } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { 
  TimeOffRequest, 
  TimeOffRequestType, 
  BalanceCounterType,
  getCounterTypeForRequestType
} from "@/types/time-off";

/**
 * Server helper to calculate duration in days, excluding Sundays.
 * Inclusive range.
 */
function calculateDuration(startDate: string, endDate: string, dayPart: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;

  if (dayPart !== "full_day" && startDate === endDate) {
    if (start.getDay() === 0) return 0; // Sunday
    return 0.5;
  }
  
  let count = 0;
  const current = new Date(start.getTime());
  while (current <= end) {
    if (current.getDay() !== 0) { // 0 is Sunday
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Server helper to calculate duration in hours.
 */
function calculateHourlyDuration(start: string, end: string): number {
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const startMins = sH * 60 + sM;
  const endMins = eH * 60 + eM;
  return Math.max(0, (endMins - startMins) / 60);
}

/**
 * Validates the user and retrieves the employee record.
 */
async function getVerifiedEmployee(entityId: string, idToken: string) {
  const decodedToken = await adminAuth.verifyIdToken(idToken);
  const uid = decodedToken.uid;

  const employeeSnap = await adminDb.collection("entities").doc(entityId).collection("employees")
    .where("userId", "==", uid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (employeeSnap.empty) {
    throw new Error("EMPLOYEE_NOT_FOUND: Aucun profil employé actif trouvé pour cet utilisateur.");
  }

  return { uid, employee: employeeSnap.docs[0].data(), employeeRef: employeeSnap.docs[0].ref };
}

/**
 * Action: Submits a new time-off request from the employee.
 */
export async function submitTimeOffRequestAction(params: {
  entityId: string;
  idToken: string;
  payload: {
    requestType: TimeOffRequestType;
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
    durationHours?: number;
    dayPart: any;
    reason?: string;
  };
}) {
  const { entityId, idToken, payload } = params;
  if (!adminDb) throw new Error("Admin SDK not initialized");

  const { uid, employee } = await getVerifiedEmployee(entityId, idToken);

  const counterType = getCounterTypeForRequestType(payload.requestType);
  const isHourly = ["rol_permission", "ex_holiday_permission"].includes(payload.requestType);
  const isSickness = payload.requestType === 'sickness';
  
  // Server-side duration calculation (Hardened)
  const duration = isHourly 
    ? calculateHourlyDuration(payload.startTime || "09:00", payload.endTime || "10:00") 
    : calculateDuration(payload.startDate, payload.endDate, payload.dayPart);

  if (duration <= 0) throw new Error("Durée invalide ou calculée à 0 (ex: Dimanche uniquement).");

  const year = parseInt(payload.startDate.split('-')[0]);
  const balanceId = `${employee.employeeId}_${year}`;
  const balanceRef = adminDb.collection("entities").doc(entityId).collection("leaveBalances").doc(balanceId);
  const requestRef = adminDb.collection("entities").doc(entityId).collection("timeOffRequests").doc();

  return await adminDb.runTransaction(async (transaction) => {
    // 1. Check Balance
    const balanceSnap = await transaction.get(balanceRef);
    
    if (counterType && balanceSnap.exists) {
      const balance = balanceSnap.data()!;
      if (balance.counters?.[counterType]) {
        const remaining = balance.counters[counterType].remaining;
        if (duration > remaining) {
          throw new Error(`Solde insuffisant pour cette demande (${duration.toFixed(2)} ${isHourly ? 'h' : 'j'} demandés, ${remaining.toFixed(2)} disponibles).`);
        }
      }
    }

    // 2. Check Overlap
    const overlapSnap = await adminDb.collection("entities").doc(entityId).collection("timeOffRequests")
      .where("employeeId", "==", employee.employeeId)
      .where("status", "in", ["submitted", "approved"])
      .get();

    const isOverlapping = overlapSnap.docs.some(docSnap => {
      const r = docSnap.data();
      const datesOverlap = (r.startDate <= (isHourly ? payload.startDate : payload.endDate) && r.endDate >= payload.startDate);
      if (!datesOverlap) return false;

      // Both are hourly on the same date -> check for time intersection
      if (r.unit === 'hours' && isHourly && r.startDate === payload.startDate) {
         return (payload.startTime! < r.endTime && payload.endTime! > r.startTime);
      }

      // Any date overlap involving a day-based request (either existing or new) is a conflict
      return true;
    });

    if (isOverlapping) throw new Error("Une demande existe déjà pour cette période ou ce créneau.");

    // 3. Create Request
    const requestData = {
      requestId: requestRef.id,
      entityId,
      employeeId: employee.employeeId,
      personId: employee.personId,
      employeeName: employee.displayName,
      requestKind: isSickness ? "absence" : "leave", 
      requestType: payload.requestType,
      source: "employee_created",
      status: "submitted",
      startDate: payload.startDate,
      endDate: isHourly ? payload.startDate : payload.endDate,
      startTime: isHourly ? (payload.startTime || null) : null,
      endTime: isHourly ? (payload.endTime || null) : null,
      dayPart: isHourly ? "full_day" : payload.dayPart,
      durationDays: isHourly ? 0 : duration,
      durationHours: isHourly ? duration : null,
      unit: isHourly ? "hours" : "days",
      balanceCounterType: counterType,
      reason: payload.reason || null,
      requiresJustification: isSickness,
      justificationStatus: isSickness ? "missing" : "not_required",
      justificationDocumentIds: [],
      createdByUid: uid,
      createdByRole: "employee",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(requestRef, requestData);

    // 4. Update Balance Pending Counter
    if (counterType && balanceSnap.exists) {
      const fieldPath = `counters.${counterType}.pending`;
      const update: any = {
        [fieldPath]: FieldValue.increment(duration),
        updatedAt: FieldValue.serverTimestamp()
      };
      if (counterType === "paid_leave") {
        update.pendingDays = FieldValue.increment(duration);
      }
      transaction.update(balanceRef, update);
    }

    return { requestId: requestRef.id };
  });
}

/**
 * Action: Cancels an existing pending request.
 */
export async function cancelTimeOffRequestAction(params: {
  entityId: string;
  idToken: string;
  requestId: string;
}) {
  const { entityId, idToken, requestId } = params;
  const { uid, employee } = await getVerifiedEmployee(entityId, idToken);

  const requestRef = adminDb.collection("entities").doc(entityId).collection("timeOffRequests").doc(requestId);

  return await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists) throw new Error("Demande introuvable.");
    const request = snap.data()!;

    if (request.employeeId !== employee.employeeId) throw new Error("Action non autorisée.");
    if (request.status !== "submitted") throw new Error("Seule une demande en attente peut être annulée par l'employé.");

    const duration = request.unit === "days" ? request.durationDays : request.durationHours;
    const counterType = request.balanceCounterType;
    const year = parseInt(request.startDate.split('-')[0]);
    const balanceRef = adminDb.collection("entities").doc(entityId).collection("leaveBalances").doc(`${employee.employeeId}_${year}`);

    // 1. Update Status
    transaction.update(requestRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledByUid: uid,
      cancelledByRole: "employee",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 2. Decrement Pending Balance
    if (counterType) {
      const balanceSnap = await transaction.get(balanceRef);
      if (balanceSnap.exists) {
        const fieldPath = `counters.${counterType}.pending`;
        const update: any = {
          [fieldPath]: FieldValue.increment(-duration),
          updatedAt: FieldValue.serverTimestamp()
        };
        if (counterType === "paid_leave") {
          update.pendingDays = FieldValue.increment(-duration);
        }
        transaction.update(balanceRef, update);
      }
    }

    return { success: true };
  });
}

/**
 * Action: Uploads a sickness justification via Admin SDK.
 * Bypasses client-side permission restrictions for employees.
 */
export async function uploadSicknessJustificationAction(params: {
  entityId: string;
  requestId: string;
  idToken: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
}) {
  const { entityId, requestId, idToken, fileBase64, fileName, mimeType } = params;
  if (!adminDb || !adminAuth || !adminBucket) throw new Error("Service indisponible.");

  const { uid, employee } = await getVerifiedEmployee(entityId, idToken);

  const requestRef = adminDb.collection("entities").doc(entityId).collection("timeOffRequests").doc(requestId);

  return await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists) throw new Error("Demande introuvable.");
    const request = snap.data()!;

    // Security: Ownership and workflow checks
    if (request.employeeId !== employee.employeeId) throw new Error("Action non autorisée.");
    if (request.requestType !== 'sickness' && request.requestType !== 'work_accident') {
      throw new Error("Ce type de demande ne supporte pas de justificatif médical direct.");
    }
    if (request.status !== 'submitted') {
      throw new Error("Impossible d'ajouter un document à une demande déjà traitée ou annulée.");
    }

    // 1. Process File
    const base64Data = fileBase64.split(',')[1] || fileBase64;
    const buffer = Buffer.from(base64Data, 'base64');
    const docId = adminDb.collection("entities").doc(entityId).collection("documents").doc().id;
    const storagePath = `entities/${entityId}/documents/${docId}/${fileName}`;
    const file = adminBucket.file(storagePath);

    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        metadata: {
          requestId,
          employeeId: employee.employeeId,
          personId: employee.personId,
          uploadedBy: uid
        }
      }
    });

    // 2. Create HRDocument metadata
    const docRef = adminDb.collection("entities").doc(entityId).collection("documents").doc(docId);
    const now = FieldValue.serverTimestamp();
    const docData = {
      id: docId,
      entityId,
      title: `Justificatif médical - ${employee.displayName}`,
      documentType: request.requestType === 'sickness' ? "medical_certificate" : "work_accident_justification",
      status: "valid",
      storagePath,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      employeeId: employee.employeeId,
      employeeDisplayName: employee.displayName,
      personId: employee.personId,
      relatedModule: "timeOffRequests",
      relatedId: requestId,
      version: 1,
      isSensitive: true,
      isRequired: true,
      uploadedAt: now,
      uploadedBy: uid,
      uploadedByDisplayName: employee.displayName,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid
    };

    transaction.set(docRef, docData);

    // 3. Update Request Link
    transaction.update(requestRef, {
      justificationStatus: "provided",
      justificationDocumentIds: FieldValue.arrayUnion(docId),
      updatedAt: now
    });

    return { success: true, documentId: docId };
  });
}
