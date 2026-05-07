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
  return entityId;
}

export async function updateEntity(entityId: string, data: Partial<Entity>) {
  if (!db) throw new Error("Firestore not initialized");
  
  const entityRef = doc(db, "entities", entityId);
  await updateDoc(entityRef, {
    ...data,
    updatedAt: serverTimestamp(),
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
  });
}

export async function getAllEntities(): Promise<Entity[]> {
  if (!db) return [];
  const q = query(collection(db, "entities"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Entity);
}
