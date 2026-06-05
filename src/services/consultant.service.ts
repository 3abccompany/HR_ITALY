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
  serverTimestamp,
  where
} from "firebase/firestore";
import { Consultant } from "@/types/consultant";
import { createAuditLog } from "./audit.service";

export async function listConsultants(entityId: string) {
  if (!db) return [];
  const q = query(
    collection(db, `entities/${entityId}/consultants`), 
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Consultant));
}

export async function getConsultant(entityId: string, consultantId: string) {
  if (!db) return null;
  const snap = await getDoc(doc(db, `entities/${entityId}/consultants`, consultantId));
  return snap.exists() ? (snap.data() as Consultant) : null;
}

export async function createConsultant(entityId: string, data: Partial<Consultant>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const ref = doc(collection(db, `entities/${entityId}/consultants`));
  const consultantId = ref.id;

  const payload: Consultant = {
    ...(data as any),
    id: consultantId,
    entityId,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(ref, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "consultant.created",
    resourceType: "consultant",
    resourceId: consultantId,
    details: { name: payload.name }
  });

  return consultantId;
}

export async function updateConsultant(entityId: string, consultantId: string, data: Partial<Consultant>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const ref = doc(db, `entities/${entityId}/consultants`, consultantId);
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "consultant.updated",
    resourceType: "consultant",
    resourceId: consultantId,
  });
}

export async function archiveConsultant(entityId: string, consultantId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const ref = doc(db, `entities/${entityId}/consultants`, consultantId);
  await updateDoc(ref, {
    status: "archived",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "consultant.archived",
    resourceType: "consultant",
    resourceId: consultantId,
  });
}
