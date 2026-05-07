import { db } from "@/lib/firebase/client";
import { collection, doc, setDoc, getDocs, serverTimestamp, query, orderBy } from "firebase/firestore";
import { Entity, EntityType } from "@/types/entity";

export async function createEntity(input: {
  name: string;
  legalName: string;
  type: EntityType;
  createdBy: string;
}) {
  const entityCollectionRef = collection(db, "entities");
  const newEntityRef = doc(entityCollectionRef);
  const entityId = newEntityRef.id;

  const entityData: Entity = {
    entityId,
    name: input.name,
    legalName: input.legalName,
    type: input.type,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
    updatedAt: serverTimestamp(),
  };

  await setDoc(newEntityRef, entityData);
  return entityId;
}

export async function getAllEntities(): Promise<Entity[]> {
  const q = query(collection(db, "entities"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Entity);
}
