
import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { Department } from "@/types/organization";
import { createAuditLog } from "./audit.service";

export async function createDepartment(
  entityId: string, 
  data: Partial<Department>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const deptRef = doc(collection(db, `entities/${entityId}/departments`));
  const departmentId = deptRef.id;

  const departmentData: Department = {
    departmentId,
    entityId,
    name: data.name || "",
    code: data.code || "",
    description: data.description || "",
    responsibleName: data.responsibleName || "",
    status: "active",
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(deptRef, departmentData);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "department.created",
    resourceType: "department",
    resourceId: departmentId,
    details: { name: departmentData.name, code: departmentData.code }
  });

  return departmentId;
}

export async function updateDepartment(
  entityId: string, 
  departmentId: string, 
  data: Partial<Department>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const deptRef = doc(db, `entities/${entityId}/departments`, departmentId);
  const snap = await getDoc(deptRef);
  if (!snap.exists()) throw new Error("Département introuvable.");
  const current = snap.data() as Department;

  const batch = writeBatch(db);
  
  // Update Department
  batch.update(deptRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // If name changed, sync JobTitles denormalized departmentName
  if (data.name && data.name !== current.name) {
    const jobTitlesRef = collection(db, `entities/${entityId}/jobTitles`);
    const q = query(jobTitlesRef, where("departmentId", "==", departmentId));
    const jtSnap = await getDocs(q);
    
    jtSnap.docs.forEach(jtDoc => {
      batch.update(jtDoc.ref, {
        departmentName: data.name,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
    });
  }

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "department.updated",
    resourceType: "department",
    resourceId: departmentId,
    details: data
  });
}

export async function disableDepartment(entityId: string, departmentId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const deptRef = doc(db, `entities/${entityId}/departments`, departmentId);
  await updateDoc(deptRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "department.disabled",
    resourceType: "department",
    resourceId: departmentId,
  });
}

export async function reactivateDepartment(entityId: string, departmentId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const deptRef = doc(db, `entities/${entityId}/departments`, departmentId);
  await updateDoc(deptRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "department.reactivated",
    resourceType: "department",
    resourceId: departmentId,
  });
}
