
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
import { JobProfile, JobProfileCatalogItem, CatalogItemType, JobProfileVersion } from "@/types/job-profile";
import { createAuditLog } from "./audit.service";

/**
 * Creates or updates catalog items based on labels used in a job profile.
 */
async function syncCatalogItems(entityId: string, type: CatalogItemType, labels: string[], actorUid: string) {
  if (!db) return;
  const batch = writeBatch(db);
  const catalogRef = collection(db, `entities/${entityId}/jobProfileCatalogItems`);

  for (const label of labels) {
    // Check if item exists
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
      
      await createAuditLog({
        userId: actorUid,
        entityId,
        action: "jobProfileCatalogItem.created",
        resourceType: "jobProfileCatalogItem",
        resourceId: newItemRef.id,
        details: { label, type }
      });
    } else {
      batch.update(snap.docs[0].ref, {
        usageCount: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
    }
  }
  await batch.commit();
}

/**
 * Internal helper to create a version snapshot
 */
async function createVersionSnapshot(entityId: string, jobProfileId: string, data: JobProfile, actorUid: string) {
  if (!db) return;
  const versionsRef = collection(db, `entities/${entityId}/jobProfiles/${jobProfileId}/versions`);
  const versionDocRef = doc(versionsRef);
  
  const versionData: JobProfileVersion = {
    versionId: versionDocRef.id,
    entityId,
    jobProfileId,
    version: data.version,
    versionLabel: data.versionLabel,
    snapshot: { ...data },
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    changeSummary: data.version === 1 ? "Version initiale" : "Mise à jour du document"
  };

  await setDoc(versionDocRef, versionData);
  
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.versionCreated",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
    details: { version: data.version, versionLabel: data.versionLabel }
  });
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
    version: 1,
    versionLabel: "V1",
    lastModifiedAt: serverTimestamp(),
    lastModifiedBy: actorUid,
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

  // Create initial snapshot
  await createVersionSnapshot(entityId, jobProfileId, profileData, actorUid);

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
  
  const snap = await getDoc(profileRef);
  if (!snap.exists()) throw new Error("Document introuvable");
  const current = snap.data() as JobProfile;

  const nextVersion = (current.version || 1) + 1;
  const nextLabel = `V${nextVersion}`;

  const updatedData = {
    ...data,
    version: nextVersion,
    versionLabel: nextLabel,
    lastModifiedAt: serverTimestamp(),
    lastModifiedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await updateDoc(profileRef, updatedData);

  // Create new snapshot with merged data
  const fullSnap = { ...current, ...updatedData } as JobProfile;
  await createVersionSnapshot(entityId, jobProfileId, fullSnap, actorUid);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "jobProfile.updated",
    resourceType: "jobProfile",
    resourceId: jobProfileId,
    details: { nextVersion, nextLabel }
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
