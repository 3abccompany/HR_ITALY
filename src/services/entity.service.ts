import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
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
  const entityId = newEntityRef.id;

  const entityData: Entity = {
    ...data,
    entityId,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(newEntityRef, entityData);

  await createAuditLog({
    userId: data.createdBy,
    entityId: entityId,
    action: "entity.created",
    resourceType: "entity",
    resourceId: entityId,
    details: { nomEntreprise: data.nomEntreprise, type: data.type }
  });

  return entityId;
}

export async function updateEntity(entityId: string, data: Partial<Entity>) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", entityId);
  const userId = data.updatedBy || "system";

  await updateDoc(entityRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  await createAuditLog({
    userId: userId,
    entityId: entityId,
    action: "entity.updated",
    resourceType: "entity",
    resourceId: entityId,
    details: data
  });
}

export async function disableEntity(entityId: string, userId: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", entityId);
  
  await updateDoc(entityRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: userId,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });

  await createAuditLog({
    userId: userId,
    entityId: entityId,
    action: "entity.disabled",
    resourceType: "entity",
    resourceId: entityId,
  });
}

export async function getAllEntities(): Promise<Entity[]> {
  if (!db) return [];
  const q = query(collection(db, "entities"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Entity);
}
