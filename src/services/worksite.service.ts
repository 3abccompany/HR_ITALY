
import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy
} from "firebase/firestore";
import { Worksite } from "@/types/worksite";
import { createAuditLog } from "./audit.service";

export async function createWorksite(entityId: string, data: Partial<Worksite>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const worksiteRef = doc(collection(db, `entities/${entityId}/worksites`));
  const worksiteId = worksiteRef.id;

  const worksiteData: Worksite = {
    worksiteId,
    entityId,
    name: data.name || "",
    code: data.code || "",
    type: data.type || "operational_site",
    address: data.address || "",
    city: data.city || "",
    province: data.province || "",
    country: data.country || "France",
    status: "active",
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(worksiteRef, worksiteData);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "worksite.created",
    resourceType: "worksite",
    resourceId: worksiteId,
    details: { name: worksiteData.name, code: worksiteData.code }
  });

  return worksiteId;
}

export async function updateWorksite(entityId: string, worksiteId: string, data: Partial<Worksite>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const worksiteRef = doc(db, `entities/${entityId}/worksites`, worksiteId);
  await updateDoc(worksiteRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "worksite.updated",
    resourceType: "worksite",
    resourceId: worksiteId,
    details: data
  });
}

export async function archiveWorksite(entityId: string, worksiteId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const worksiteRef = doc(db, `entities/${entityId}/worksites`, worksiteId);
  await updateDoc(worksiteRef, {
    status: "archived",
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "worksite.archived",
    resourceType: "worksite",
    resourceId: worksiteId,
  });
}

export async function listActiveWorksites(entityId: string): Promise<Worksite[]> {
  if (!db) return [];
  const q = query(
    collection(db, `entities/${entityId}/worksites`),
    where("status", "==", "active"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as Worksite);
}
