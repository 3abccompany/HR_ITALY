import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  serverTimestamp
} from "firebase/firestore";
import { JobTitle } from "@/types/organization";
import { createAuditLog } from "./audit.service";

export async function createJobTitle(
  entityId: string, 
  data: Partial<JobTitle> & { departmentId: string; departmentName: string }, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const jtRef = doc(collection(db, `entities/${entityId}/jobTitles`));
  const jobTitleId = jtRef.id;

  const jobTitleData: JobTitle = {
    jobTitleId,
    entityId,
    departmentId: data.departmentId,
    departmentName: data.departmentName,
    title: data.title || "",
    description: data.description || "",
    status: "active",
    notes: data.notes || "",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(jtRef, jobTitleData);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobTitle.created",
    resourceType: "jobTitle",
    resourceId: jobTitleId,
    details: { title: jobTitleData.title, dept: jobTitleData.departmentName }
  });

  return jobTitleId;
}

export async function updateJobTitle(
  entityId: string, 
  jobTitleId: string, 
  data: Partial<JobTitle>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const jtRef = doc(db, `entities/${entityId}/jobTitles`, jobTitleId);
  
  await updateDoc(jtRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobTitle.updated",
    resourceType: "jobTitle",
    resourceId: jobTitleId,
    details: data
  });
}

export async function disableJobTitle(entityId: string, jobTitleId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const jtRef = doc(db, `entities/${entityId}/jobTitles`, jobTitleId);
  await updateDoc(jtRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobTitle.disabled",
    resourceType: "jobTitle",
    resourceId: jobTitleId,
  });
}

export async function reactivateJobTitle(entityId: string, jobTitleId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const jtRef = doc(db, `entities/${entityId}/jobTitles`, jobTitleId);
  await updateDoc(jtRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobTitle.reactivated",
    resourceType: "jobTitle",
    resourceId: jobTitleId,
  });
}
