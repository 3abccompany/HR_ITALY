import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  where,
  serverTimestamp,
  Query
} from "firebase/firestore";
import { MedicalVisit } from "@/types/medical-visit";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { createNotification } from "./notification.service";

/**
 * Removes undefined properties from an object before Firestore write.
 * Preserves FieldValue and Timestamp instances.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

export async function createMedicalVisit(entityId: string, data: Partial<MedicalVisit>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const visitRef = doc(collection(db, `entities/${entityId}/medicalVisits`));
  const visitId = visitRef.id;

  const payload: Partial<MedicalVisit> = {
    ...data,
    id: visitId,
    entityId,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await setDoc(visitRef, sanitizePayload(payload));
    
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "medicalVisit.created",
      resourceType: "medicalVisit",
      resourceId: visitId,
      details: { visitType: data.visitType, employeeId: data.employeeId }
    });

    // Notify Employee (Non-blocking)
    if (data.employeeId) {
      const empId = data.employeeId;
      void (async () => {
        try {
          const empSnap = await getDoc(doc(db!, `entities/${entityId}/employees`, empId));
          const empData = empSnap.data();
          if (empData?.userId) {
            await createNotification(entityId, {
              targetUid: empData.userId,
              audience: "employee",
              category: "medical",
              severity: "info",
              title: "Visite médicale planifiée",
              message: "Votre visite médicale a été planifiée.",
              actionUrl: `/entity/${entityId}/my-space`,
              dedupKey: `medical_visit_planned:${visitId}`
            });
          }
        } catch (notifErr) {
          console.warn("[Notification] Medical visit notification failed (silent):", notifErr);
        }
      })();
    }

    return visitId;
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: visitRef.path,
        operation: 'create',
        requestResourceData: payload,
        debugLabel: 'createMedicalVisit'
      }));
    }
    throw err;
  }
}

export async function updateMedicalVisit(entityId: string, visitId: string, data: Partial<MedicalVisit>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const visitRef = doc(db, `entities/${entityId}/medicalVisits`, visitId);
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await updateDoc(visitRef, sanitizePayload(payload));

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "medicalVisit.updated",
      resourceType: "medicalVisit",
      resourceId: visitId,
      details: { changes: Object.keys(data) }
    });
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: visitRef.path,
        operation: 'update',
        requestResourceData: payload,
        debugLabel: 'updateMedicalVisit'
      }));
    }
    throw err;
  }
}

export async function archiveMedicalVisit(entityId: string, visitId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const visitRef = doc(db, `entities/${entityId}/medicalVisits`, visitId);
  await updateDoc(visitRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "medicalVisit.archived",
    resourceType: "medicalVisit",
    resourceId: visitId,
  });
}
