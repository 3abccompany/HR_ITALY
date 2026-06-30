import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  serverTimestamp,
  runTransaction
} from "firebase/firestore";
import { SafetyDpiAssignment } from "@/types/safety-dpi";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { createNotification } from "./notification.service";

/**
 * Utility to remove undefined properties from an object to prevent Firestore errors.
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

export async function createDpiAssignment(entityId: string, data: Partial<SafetyDpiAssignment>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const assignmentRef = doc(collection(db, `entities/${entityId}/safetyDpiAssignments`));
  const assignmentId = assignmentRef.id;

  const payload: Partial<SafetyDpiAssignment> = {
    ...data,
    assignmentId,
    entityId,
    status: data.status || "assigned",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Create Assignment
      transaction.set(assignmentRef, sanitizePayload(payload));

      // 2. Timeline Event
      if (data.personId) {
        const timelineRef = doc(collection(db!, `entities/${entityId}/personTimeline`));
        transaction.set(timelineRef, {
          eventId: timelineRef.id,
          entityId,
          personId: data.personId,
          type: "dpi.assigned",
          label: "EPI / DPI remis",
          description: `Remise de : ${data.dpiName} (${data.quantity}). Prochain remplacement prévu le ${data.plannedReplacementDate}.`,
          sourceCollection: "safetyDpiAssignments",
          sourceId: assignmentId,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        });
      }
    });

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "safetyDpi.created",
      resourceType: "safetyDpiAssignment",
      resourceId: assignmentId,
      details: { dpiName: data.dpiName, employeeId: data.employeeId }
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
              category: "safety",
              severity: "info",
              title: "EPI/DPI remis",
              message: "Un équipement de protection vous a été affecté.",
              actionUrl: `/entity/${entityId}/my-space`,
              dedupKey: `safety_assigned:${assignmentId}`
            });
          }
        } catch (notifErr) {
          console.warn("[Notification] Safety notification failed (silent):", notifErr);
        }
      })();
    }

    return assignmentId;
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: assignmentRef.path,
        operation: 'create',
        requestResourceData: payload,
        debugLabel: 'createDpiAssignment'
      }));
    }
    throw err;
  }
}

export async function updateDpiAssignment(entityId: string, assignmentId: string, data: Partial<SafetyDpiAssignment>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const assignmentRef = doc(db, `entities/${entityId}/safetyDpiAssignments`, assignmentId);
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await updateDoc(assignmentRef, sanitizePayload(payload));

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "safetyDpi.updated",
      resourceType: "safetyDpiAssignment",
      resourceId: assignmentId,
      details: { changes: Object.keys(data) }
    });
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: assignmentRef.path,
        operation: 'update',
        requestResourceData: payload,
        debugLabel: 'updateDpiAssignment'
      }));
    }
    throw err;
  }
}

export async function archiveDpiAssignment(entityId: string, assignmentId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const assignmentRef = doc(db, `entities/${entityId}/safetyDpiAssignments`, assignmentId);
  await updateDoc(assignmentRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "safetyDpi.archived",
    resourceType: "safetyDpiAssignment",
    resourceId: assignmentId,
  });
}
