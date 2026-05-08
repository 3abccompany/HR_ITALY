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
  writeBatch,
  increment
} from "firebase/firestore";
import { JobProfile, JobProfileCatalogItem, CatalogItemType } from "@/types/job-profile";
import { createAuditLog } from "./audit.service";

/**
 * Creates or updates catalog items based on labels used in a job profile.
 */
async function syncCatalogItems(entityId: string, type: CatalogItemType, labels: string[], actorUid: string) {
  if (!db) return;
  const batch = writeBatch(db);
  const catalogRef = collection(db, `entities/${entityId}/jobProfileCatalogItems`);

  for (const label of labels) {
    // Check if item exists (simple case-insensitive check could be added if needed)
    const q = query(catalogRef, where("type", "==", type), where("label", "==", label));
    const snap = await getDocs(q);

    if (snap.empty) {
      const newItemRef = doc(catalogRef);
      const item: JobProfileCatalogItem = {
        itemId: newItemRef.id,
        entityId,
        type,
        label,
        status: "active",
        usageCount: 1,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      };
      batch.set(newItemRef, item);
      
      // Log item creation
      await createAuditLog({
        userId: actorUid,
        entityId,
        action: "jobProfileCatalogItem.created",
        resourceType: "jobProfileCatalogItem",
        resourceId: newItemRef.id,
        details: { label, type }
      });
    } else {
      // Increment usage count
      batch.update(snap.docs[0].ref, {
        usageCount: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
    }
  }
  await batch.commit();
}

export async function createJobProfile(entityId: string, data: Partial<JobProfile>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const profileRef = doc(collection(db, `entities/${entityId}/jobProfiles`));
  const jobProfileId = profileRef.id;

  const profileData: JobProfile = {
    ...(data as any),
    jobProfileId,
    entityId,
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(profileRef, profileData);

  // Sync reusable sections to catalog
  const catalogTypes: { field: keyof JobProfile, type: CatalogItemType }[] = [
    { field: 'missionsAndResponsibilities', type: 'missionResponsibility' },
    { field: 'objectives', type: 'objective' },
    { field: 'initialAndProfessionalTraining', type: 'trainingRequirement' },
    { field: 'professionalExperience', type: 'professionalExperience' },
    { field: 'softSkills', type: 'softSkill' }
  ];

  for (const mapping of catalogTypes) {
    const labels = (data[mapping.field] as string[]) || [];
    if (labels.length > 0) {
      await syncCatalogItems(entityId, mapping.type, labels, actorUid);
    }
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.created",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
    details: { jobTitle: profileData.jobTitleName }
  });

  return jobProfileId;
}

export async function updateJobProfile(entityId: string, jobProfileId: string, data: Partial<JobProfile>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const profileRef = doc(db, `entities/${entityId}/jobProfiles`, jobProfileId);

  await updateDoc(profileRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // Note: We don't re-sync catalog items on update for this MVP to avoid complex usageCount logic, 
  // but we could trigger it for strictly NEW items added in the update.

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.updated",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
    details: data
  });
}

export async function disableJobProfile(entityId: string, jobProfileId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const profileRef = doc(db, `entities/${entityId}/jobProfiles`, jobProfileId);
  
  await updateDoc(profileRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.disabled",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
  });
}

export async function reactivateJobProfile(entityId: string, jobProfileId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const profileRef = doc(db, `entities/${entityId}/jobProfiles`, jobProfileId);
  
  await updateDoc(profileRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.reactivated",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
  });
}
