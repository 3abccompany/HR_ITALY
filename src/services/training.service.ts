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
  Query,
  runTransaction,
  writeBatch
} from "firebase/firestore";
import { Training } from "@/types/training";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

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

export async function createTraining(entityId: string, data: Partial<Training>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const trainingRef = doc(collection(db, `entities/${entityId}/trainings`));
  const trainingId = trainingRef.id;

  // Backward compatibility: ensure courseDate and startDate are consistent
  const startDate = data.startDate || data.courseDate || new Date().toISOString().split('T')[0];

  const payload: Partial<Training> = {
    ...data,
    id: trainingId,
    entityId,
    startDate,
    courseDate: startDate, // Maintain legacy field
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Create Training
      transaction.set(trainingRef, sanitizePayload(payload));

      // 2. Timeline Event
      if (data.personId) {
        const timelineRef = doc(collection(db!, `entities/${entityId}/personTimeline`));
        transaction.set(timelineRef, {
          eventId: timelineRef.id,
          entityId,
          personId: data.personId,
          type: "training.created",
          label: "Formation enregistrée",
          description: `Formation "${data.title}" (${data.trainingType}) enregistrée.`,
          sourceCollection: "trainings",
          sourceId: trainingId,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        });
      }
    });

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "training.created",
      resourceType: "training",
      resourceId: trainingId,
      details: { title: data.title, type: data.trainingType, employeeId: data.employeeId }
    });

    return trainingId;
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: trainingRef.path,
        operation: 'create',
        requestResourceData: payload,
        debugLabel: 'createTraining'
      }));
    }
    throw err;
  }
}

/**
 * Creates a batch of training records for multiple employees.
 * Each employee gets their own independent record, linked by a batchId.
 */
export async function createTrainingBatch(
  entityId: string, 
  payload: Partial<Training>, 
  employees: { employeeId: string; personId: string | null }[], 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  if (employees.length === 0) throw new Error("Aucun collaborateur sélectionné.");

  const batch = writeBatch(db);
  const now = serverTimestamp();
  const batchId = doc(collection(db, "temp")).id;
  const startDate = payload.startDate || payload.courseDate || new Date().toISOString().split('T')[0];

  const createdIds: string[] = [];

  for (const emp of employees) {
    const trainingRef = doc(collection(db, `entities/${entityId}/trainings`));
    const trainingId = trainingRef.id;
    createdIds.push(trainingId);

    const docData: Partial<Training> = {
      ...payload,
      id: trainingId,
      entityId,
      employeeId: emp.employeeId,
      personId: emp.personId,
      startDate,
      courseDate: startDate,
      batchId,
      createdFromBatch: true,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };

    batch.set(trainingRef, sanitizePayload(docData));

    // Individual Timeline Event
    if (emp.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      batch.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId: emp.personId,
        type: "training.created",
        label: "Formation enregistrée (groupe)",
        description: `Formation "${payload.title}" (${payload.trainingType}) enregistrée via session de groupe.`,
        sourceCollection: "trainings",
        sourceId: trainingId,
        createdAt: now,
        createdBy: actorUid,
      });
    }
  }

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "training.batch_created",
    resourceType: "training",
    resourceId: batchId,
    details: { count: employees.length, title: payload.title }
  });

  return { batchId, count: employees.length };
}

export async function updateTraining(entityId: string, trainingId: string, data: Partial<Training>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const trainingRef = doc(db, `entities/${entityId}/trainings`, trainingId);
  
  // Ensure startDate and legacy courseDate stay synchronized
  const updateData = { ...data };
  if (updateData.startDate) updateData.courseDate = updateData.startDate;
  if (!updateData.startDate && updateData.courseDate) updateData.startDate = updateData.courseDate;

  const payload = {
    ...updateData,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await updateDoc(trainingRef, sanitizePayload(payload));

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "training.updated",
      resourceType: "training",
      resourceId: trainingId,
      details: { changes: Object.keys(data) }
    });
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: trainingRef.path,
        operation: 'update',
        requestResourceData: payload,
        debugLabel: 'updateTraining'
      }));
    }
    throw err;
  }
}

export async function archiveTraining(entityId: string, trainingId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const trainingRef = doc(db, `entities/${entityId}/trainings`, trainingId);
  await updateDoc(trainingRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "training.archived",
    resourceType: "training",
    resourceId: trainingId,
  });
}
