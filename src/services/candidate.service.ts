import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp, 
  updateDoc,
  getDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { Candidate, CandidateStatus } from "@/types/candidate";
import { Person } from "@/types/person";
import { createAuditLog } from "./audit.service";

/**
 * Creates a candidate linked to a person using a transaction.
 */
export async function createCandidate(
  entityId: string, 
  personId: string, 
  data: Partial<Candidate>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  return await runTransaction(db, async (transaction) => {
    const personRef = doc(db, `entities/${entityId}/persons`, personId);
    const personSnap = await transaction.get(personRef);

    if (!personSnap.exists()) throw new Error("La fiche identité n'existe pas.");
    const personData = personSnap.data() as Person;

    if (personData.status !== "active") throw new Error("La personne doit être active.");
    if (personData.currentEmployeeId) throw new Error("Cette personne est déjà employée.");
    if (personData.currentCandidateId) throw new Error("Cette personne a déjà une candidature active.");

    const candidateRef = doc(collection(db, `entities/${entityId}/candidates`));
    const candidateId = candidateRef.id;

    const candidateData: Candidate = {
      candidateId,
      entityId,
      personId,
      displayName: personData.displayName,
      email: personData.email,
      phone: personData.phone || "",
      source: data.source || "",
      positionApplied: data.positionApplied || "",
      department: data.department || "",
      applicationDate: data.applicationDate || new Date().toISOString().split('T')[0],
      availabilityDate: data.availabilityDate || "",
      expectedSalary: data.expectedSalary || "",
      status: "new",
      notes: data.notes || "",
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    };

    // 1. Create Candidate
    transaction.set(candidateRef, candidateData);

    // 2. Update Person
    transaction.update(personRef, {
      currentLifecycleStatus: "candidate",
      currentCandidateId: candidateId,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    // 3. Timeline Event
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId,
      type: "candidate.created",
      label: "Candidature créée",
      description: `Candidature pour le poste de ${candidateData.positionApplied}`,
      sourceCollection: "candidates",
      sourceId: candidateId,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    });

    return candidateId;
  }).then(async (id) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "candidate.created",
      resourceType: "candidate",
      resourceId: id,
      details: { personId, position: data.positionApplied }
    });
    return id;
  });
}

/**
 * Updates candidate details and maintains Person link consistency.
 */
export async function updateCandidate(
  entityId: string, 
  candidateId: string, 
  data: Partial<Candidate>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  const candidateSnap = await getDoc(candidateRef);
  if (!candidateSnap.exists()) throw new Error("Candidat introuvable.");
  const currentCandidate = candidateSnap.data() as Candidate;

  // Prevent manual "hired" status
  if (data.status === "hired" && currentCandidate.status !== "hired") {
    throw new Error("Le statut 'Hired' est réservé au processus d'embauche.");
  }

  await updateDoc(candidateRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // Handle Person Link consistency for terminal statuses
  const terminalStatuses: CandidateStatus[] = ["rejected", "withdrawn"];
  const personRef = doc(db, `entities/${entityId}/persons`, currentCandidate.personId);
  const personSnap = await getDoc(personRef);
  
  if (personSnap.exists()) {
    const personData = personSnap.data() as Person;
    
    if (data.status && terminalStatuses.includes(data.status as CandidateStatus)) {
       if (personData.currentCandidateId === candidateId) {
         await updateDoc(personRef, {
           currentLifecycleStatus: "person",
           currentCandidateId: null,
           updatedAt: serverTimestamp(),
           updatedBy: actorUid,
         });
       }
    } else if (data.status && !terminalStatuses.includes(data.status as CandidateStatus) && data.status !== "inactive") {
       if (!personData.currentCandidateId) {
         await updateDoc(personRef, {
           currentLifecycleStatus: "candidate",
           currentCandidateId: candidateId,
           updatedAt: serverTimestamp(),
           updatedBy: actorUid,
         });
       }
    }
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "candidate.updated",
    resourceType: "candidate",
    resourceId: candidateId,
    details: data
  });
}

/**
 * Disables a candidate record.
 */
export async function disableCandidate(entityId: string, candidateId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  const snap = await getDoc(candidateRef);
  if (!snap.exists()) return;
  const cand = snap.data() as Candidate;

  await updateDoc(candidateRef, {
    status: "inactive",
    previousStatus: cand.status,
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // Clear Person link
  const personRef = doc(db, `entities/${entityId}/persons`, cand.personId);
  const pSnap = await getDoc(personRef);
  if (pSnap.exists() && pSnap.data().currentCandidateId === candidateId) {
    await updateDoc(personRef, {
      currentLifecycleStatus: "person",
      currentCandidateId: null,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "candidate.disabled",
    resourceType: "candidate",
    resourceId: candidateId,
  });
}

/**
 * Reactivates a candidate record.
 */
export async function reactivateCandidate(entityId: string, candidateId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  const snap = await getDoc(candidateRef);
  if (!snap.exists()) return;
  const cand = snap.data() as Candidate;

  const targetStatus = cand.previousStatus || "screening";

  await updateDoc(candidateRef, {
    status: targetStatus,
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // Restore Person link if eligible
  const personRef = doc(db, `entities/${entityId}/persons`, cand.personId);
  const pSnap = await getDoc(personRef);
  if (pSnap.exists() && !pSnap.data().currentCandidateId) {
    await updateDoc(personRef, {
      currentLifecycleStatus: "candidate",
      currentCandidateId: candidateId,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "candidate.reactivated",
    resourceType: "candidate",
    resourceId: candidateId,
  });
}
