import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp, 
  updateDoc,
  getDoc,
  setDoc
} from "firebase/firestore";
import { Candidate, CandidateStatus } from "@/types/candidate";
import { Person } from "@/types/person";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

/**
 * Utility to remove undefined properties from an object to prevent Firestore errors.
 * Preserves FieldValue and Timestamp instances to avoid stripping server directives.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

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
      source: data.source || "manual",
      positionApplied: data.positionApplied || "",
      department: data.department || "",
      departmentId: data.departmentId || "",
      recruitmentNeedId: data.recruitmentNeedId || "",
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
    transaction.update(personRef, sanitizePayload({
      currentLifecycleStatus: "candidate",
      currentCandidateId: candidateId,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));

    // 3. Timeline Event
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, sanitizePayload({
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
    }));

    return candidateId;
  }).then(async (id) => {
    createAuditLog({
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

  updateDoc(candidateRef, sanitizePayload({
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  })).catch(async (serverError) => {
    const permissionError = new FirestorePermissionError({
      path: candidateRef.path,
      operation: 'update',
      requestResourceData: data,
    } satisfies SecurityRuleContext);
    errorEmitter.emit('permission-error', permissionError);
  });

  // Handle Person Link consistency for terminal statuses using safe set merge
  const terminalStatuses: CandidateStatus[] = ["rejected", "archived", "inactive"];
  const personRef = doc(db, `entities/${entityId}/persons`, currentCandidate.personId);
  
  if (data.status && (terminalStatuses.includes(data.status as CandidateStatus) || data.status === "hired")) {
    setDoc(personRef, sanitizePayload({
      currentLifecycleStatus: data.status === "hired" ? "employee" : "person",
      currentCandidateId: null,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }), { merge: true }).catch(err => console.warn("Person sync failed", err));
  } else if (data.status && !terminalStatuses.includes(data.status as CandidateStatus)) {
    setDoc(personRef, sanitizePayload({
      currentLifecycleStatus: "candidate",
      currentCandidateId: candidateId,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }), { merge: true }).catch(err => console.warn("Person sync failed", err));
  }

  createAuditLog({
    userId: actorUid,
    entityId,
    action: "candidate.updated",
    resourceType: "candidate",
    resourceId: candidateId,
    details: sanitizePayload(data)
  });
}

/**
 * Transition candidate through recruitment workflow stages.
 */
export async function updateCandidateStatus(params: {
  entityId: string;
  candidateId: string;
  personId: string;
  nextStatus: CandidateStatus;
  notes?: string;
  rejectionReason?: string;
  actorUid: string;
}) {
  const { entityId, candidateId, personId, nextStatus, notes, rejectionReason, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  const snap = await getDoc(candidateRef);
  if (!snap.exists()) throw new Error("Candidat introuvable.");
  const candidate = snap.data() as Candidate;

  if (candidate.personId !== personId) throw new Error("Incohérence d'identité.");

  // Terminal state check
  if (candidate.status === "hired" && nextStatus !== "hired") {
    throw new Error("Impossible de modifier le statut d'un candidat déjà embauché.");
  }

  if (nextStatus === "rejected" && !rejectionReason) {
    throw new Error("Un motif de rejet est obligatoire.");
  }

  const updateData: Partial<Candidate> = {
    status: nextStatus,
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  if (notes) updateData.reviewNotes = notes;
  if (rejectionReason) updateData.rejectionReason = rejectionReason;

  // Specific tracking timestamps
  if (nextStatus === "under_review") {
    updateData.reviewedAt = serverTimestamp();
    updateData.reviewedBy = actorUid;
  } else if (nextStatus === "shortlisted") {
    updateData.shortlistedAt = serverTimestamp();
    updateData.shortlistedBy = actorUid;
  } else if (nextStatus === "rejected") {
    updateData.rejectedAt = serverTimestamp();
    updateData.rejectedBy = actorUid;
  } else if (nextStatus === "accepted") {
    updateData.acceptedAt = serverTimestamp();
    updateData.acceptedBy = actorUid;
  }

  // 1. Update main candidate document
  updateDoc(candidateRef, sanitizePayload(updateData)).catch(async (serverError) => {
    const permissionError = new FirestorePermissionError({
      path: candidateRef.path,
      operation: 'update',
      requestResourceData: updateData,
    } satisfies SecurityRuleContext);
    errorEmitter.emit('permission-error', permissionError);
  });

  // 2. Sync Person record (use setDoc merge to be safe against missing docs)
  const personRef = doc(db, `entities/${entityId}/persons`, personId);
  const personUpdate = {
    currentLifecycleStatus: nextStatus === "accepted" || nextStatus === "hired" ? "employee" : "candidate",
    currentCandidateId: candidateId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };
  setDoc(personRef, sanitizePayload(personUpdate), { merge: true }).catch(err => {
    console.warn("Secondary Person sync failed (non-critical):", err);
  });

  // 3. Update optional read models safely
  const viewRef = doc(db, `entities/${entityId}/candidateViews`, candidateId);
  setDoc(viewRef, sanitizePayload({ 
    status: nextStatus, 
    updatedAt: serverTimestamp(), 
    updatedBy: actorUid 
  }), { merge: true }).catch(err => {
    console.debug("Secondary candidateView sync skipped or failed (non-critical):", err);
  });

  // 4. Timeline Event Mapping
  const typeMap: Record<string, string> = {
    under_review: "candidate.review_started",
    shortlisted: "candidate.shortlisted",
    rejected: "candidate.rejected",
    interview_to_schedule: "candidate.interview_to_schedule",
    accepted: "candidate.accepted",
    archived: "candidate.archived"
  };

  const labelMap: Record<string, string> = {
    under_review: "Candidature en revue",
    shortlisted: "Candidat présélectionné",
    rejected: "Candidature refusée",
    interview_to_schedule: "Entretien à planifier",
    accepted: "Candidat accepté",
    archived: "Candidature archivée"
  };

  if (typeMap[nextStatus]) {
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    const timelineData = {
      eventId: timelineRef.id,
      entityId,
      personId,
      type: typeMap[nextStatus],
      label: labelMap[nextStatus],
      description: rejectionReason ? `Motif du rejet : ${rejectionReason}` : `Statut mis à jour vers : ${nextStatus}`,
      sourceCollection: "candidates",
      sourceId: candidateId,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    };
    
    setDoc(timelineRef, sanitizePayload(timelineData)).catch(async (err) => {
      const permissionError = new FirestorePermissionError({
        path: timelineRef.path,
        operation: 'create',
        requestResourceData: timelineData,
      } satisfies SecurityRuleContext);
      errorEmitter.emit('permission-error', permissionError);
    });
  }

  // 5. Audit logging - Santized to remove undefined values
  createAuditLog({
    userId: actorUid,
    entityId,
    action: `candidate.${nextStatus}`,
    resourceType: "candidate",
    resourceId: candidateId,
    details: sanitizePayload({ nextStatus, rejectionReason })
  });

  return { success: true };
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

  updateDoc(candidateRef, sanitizePayload({
    status: "inactive",
    previousStatus: cand.status,
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  // Clear Person link using safe set merge
  const personRef = doc(db, `entities/${entityId}/persons`, cand.personId);
  setDoc(personRef, sanitizePayload({
    currentLifecycleStatus: "person",
    currentCandidateId: null,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }), { merge: true }).catch(err => console.warn("Person sync failed", err));

  createAuditLog({
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

  const targetStatus = cand.previousStatus || "under_review";

  updateDoc(candidateRef, sanitizePayload({
    status: targetStatus,
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  // Restore Person link if eligible using safe set merge
  const personRef = doc(db, `entities/${entityId}/persons`, cand.personId);
  setDoc(personRef, sanitizePayload({
    currentLifecycleStatus: "candidate",
    currentCandidateId: candidateId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }), { merge: true }).catch(err => console.warn("Person sync failed", err));

  createAuditLog({
    userId: actorUid,
    entityId,
    action: "candidate.reactivated",
    resourceType: "candidate",
    resourceId: candidateId,
  });
}
