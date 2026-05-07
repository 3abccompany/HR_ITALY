import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc,
  getDocs, 
  serverTimestamp, 
  query, 
  orderBy 
} from "firebase/firestore";
import { Entity } from "@/types/entity";
import { createAuditLog } from "./audit.service";

export async function createEntity(data: Omit<Entity, 'entityId' | 'status' | 'createdAt' | 'updatedAt'>) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityCollectionRef = collection(db, "entities");
  const newEntityRef = doc(entityCollectionRef);
  const documentId = newEntityRef.id;

  const entityData: Entity = {
    ...data,
    entityId: documentId,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(newEntityRef, entityData);

  try {
    await createAuditLog({
      userId: data.createdBy,
      entityId: documentId,
      action: "entity.created",
      resourceType: "entity",
      resourceId: documentId,
      details: { name: data.nomEntreprise || data.name, type: data.type }
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }

  return documentId;
}

export async function updateEntity(documentId: string, data: Partial<Entity>) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", documentId);
  const userId = data.updatedBy || "system";

  await updateDoc(entityRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  try {
    await createAuditLog({
      userId: userId,
      entityId: documentId,
      action: "entity.updated",
      resourceType: "entity",
      resourceId: documentId,
      details: data
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }
}

export async function disableEntity(documentId: string, userId: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", documentId);
  const actorUid = userId || "system";
  
  try {
    await updateDoc(entityRef, {
      status: "inactive",
      disabledAt: serverTimestamp(),
      disabledBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  } catch (error) {
    throw error;
  }

  try {
    await createAuditLog({
      userId: actorUid,
      entityId: documentId,
      action: "entity.disabled",
      resourceType: "entity",
      resourceId: documentId,
    });
  } catch (auditErr) {
    console.warn("Failed to write audit log for entity disable:", auditErr);
  }
}

export async function reactivateEntity(documentId: string, userId: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", documentId);
  const actorUid = userId || "system";
  
  await updateDoc(entityRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  try {
    await createAuditLog({
      userId: actorUid,
      entityId: documentId,
      action: "entity.reactivated",
      resourceType: "entity",
      resourceId: documentId,
    });
  } catch (auditErr) {
    console.warn("Failed to write audit log for entity reactivation:", auditErr);
  }
}

export async function getAllEntities(): Promise<Entity[]> {
  if (!db) return [];
  const q = query(collection(db, "entities"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Entity));
}

export async function getEntityById(entityId: string): Promise<Entity | null> {
  if (!db) return null;
  const entityRef = doc(db, "entities", entityId);
  const snap = await getDoc(entityRef);
  return snap.exists() ? (snap.data() as Entity) : null;
}
