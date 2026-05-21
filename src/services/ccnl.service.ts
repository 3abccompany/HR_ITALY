
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
  serverTimestamp 
} from "firebase/firestore";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { createAuditLog } from "./audit.service";

/**
 * CCNL Registry Services
 */

export async function createCcnl(entityId: string, data: Partial<CCNL>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ccnlRef = doc(collection(db, `entities/${entityId}/ccnls`));
  const ccnlId = ccnlRef.id;

  const payload: CCNL = {
    ...(data as any),
    ccnlId,
    entityId,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(ccnlRef, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnl.created",
    resourceType: "ccnl",
    resourceId: ccnlId,
    details: { name: payload.name }
  });

  return ccnlId;
}

export async function updateCcnl(entityId: string, ccnlId: string, data: Partial<CCNL>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ccnlRef = doc(db, `entities/${entityId}/ccnls`, ccnlId);
  await updateDoc(ccnlRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnl.updated",
    resourceType: "ccnl",
    resourceId: ccnlId,
  });
}

export async function archiveCcnl(entityId: string, ccnlId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ccnlRef = doc(db, `entities/${entityId}/ccnls`, ccnlId);
  await updateDoc(ccnlRef, {
    status: "archived",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnl.archived",
    resourceType: "ccnl",
    resourceId: ccnlId,
  });
}

/**
 * CCNL Level Services
 */

export async function createCcnlLevel(entityId: string, ccnlId: string, data: Partial<CCNLLevel>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const levelRef = doc(collection(db, `entities/${entityId}/ccnls/${ccnlId}/levels`));
  const levelId = levelRef.id;

  const payload: CCNLLevel = {
    ...(data as any),
    levelId,
    ccnlId,
    entityId,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(levelRef, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnlLevel.created",
    resourceType: "ccnlLevel",
    resourceId: levelId,
    details: { ccnlId, levelCode: payload.levelCode }
  });

  return levelId;
}

export async function updateCcnlLevel(entityId: string, ccnlId: string, levelId: string, data: Partial<CCNLLevel>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const levelRef = doc(db, `entities/${entityId}/ccnls/${ccnlId}/levels`, levelId);
  await updateDoc(levelRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnlLevel.updated",
    resourceType: "ccnlLevel",
    resourceId: levelId,
  });
}

export async function archiveCcnlLevel(entityId: string, ccnlId: string, levelId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const levelRef = doc(db, `entities/${entityId}/ccnls/${ccnlId}/levels`, levelId);
  await updateDoc(levelRef, {
    status: "archived",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "ccnlLevel.archived",
    resourceType: "ccnlLevel",
    resourceId: levelId,
  });
}
