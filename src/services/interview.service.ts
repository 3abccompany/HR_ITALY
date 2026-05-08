
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
import { Interview, InterviewDecision } from "@/types/interview";
import { Candidate } from "@/types/candidate";
import { createAuditLog } from "./audit.service";

/**
 * Schedules a new interview.
 * Uses a transaction to validate candidate state and promotes status to 'interview' if needed.
 */
export async function scheduleInterview(
  entityId: string, 
  data: Partial<Interview> & { candidateId: string }, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  return await runTransaction(db, async (transaction) => {
    const candidateRef = doc(db, `entities/${entityId}/candidates`, data.candidateId);
    const candidateSnap = await transaction.get(candidateRef);

    if (!candidateSnap.exists()) throw new Error("Le candidat n'existe pas.");
    const candidateData = candidateSnap.data() as Candidate;

    const invalidStatuses = ["inactive", "archived", "hired", "rejected", "withdrawn"];
    if (invalidStatuses.includes(candidateData.status)) {
      throw new Error(`Impossible de planifier un entretien pour un candidat avec le statut : ${candidateData.status}`);
    }

    const interviewRef = doc(collection(db, `entities/${entityId}/interviews`));
    const interviewId = interviewRef.id;

    const interviewData: Interview = {
      interviewId,
      entityId,
      personId: candidateData.personId,
      candidateId: data.candidateId,
      candidateDisplayName: candidateData.displayName,
      positionApplied: candidateData.positionApplied,
      scheduledAt: data.scheduledAt || new Date().toISOString(),
      interviewType: data.interviewType || "video",
      interviewerName: data.interviewerName || "",
      interviewerUid: data.interviewerUid || "",
      location: data.location || "",
      status: "scheduled",
      decision: "pending",
      hiredEmployeeId: null,
      notes: data.notes || "",
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    };

    // 1. Create Interview
    transaction.set(interviewRef, interviewData);

    // 2. Update Candidate Status if in initial stages
    if (candidateData.status === "new" || candidateData.status === "screening") {
      transaction.update(candidateRef, {
        status: "interview",
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
    }

    // 3. Timeline Event
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId: candidateData.personId,
      type: "interview.scheduled",
      label: "Entretien planifié",
      description: `Entretien ${interviewData.interviewType} pour le poste de ${interviewData.positionApplied}`,
      sourceCollection: "interviews",
      sourceId: interviewId,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    });

    return interviewId;
  }).then(async (id) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "interview.created",
      resourceType: "interview",
      resourceId: id,
      details: { candidateId: data.candidateId }
    });
    return id;
  });
}

/**
 * Updates interview details.
 */
export async function updateInterview(
  entityId: string, 
  interviewId: string, 
  data: Partial<Interview>, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  
  await updateDoc(interviewRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "interview.updated",
    resourceType: "interview",
    resourceId: interviewId,
    details: data
  });
}

/**
 * Records an interview decision and marks it as completed.
 * ANTI-BACKFILL: Never creates an employee here.
 */
export async function recordInterviewDecision(
  entityId: string,
  interviewId: string,
  decisionData: { decision: InterviewDecision; feedback?: string; score?: number },
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  
  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  const interviewSnap = await getDoc(interviewRef);
  if (!interviewSnap.exists()) throw new Error("Entretien introuvable.");
  const interview = interviewSnap.data() as Interview;

  // 1. Update the interview document
  await updateDoc(interviewRef, {
    ...decisionData,
    status: "completed",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  // 2. Create personTimeline event (History)
  const newTimelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
  const timelineData = {
    eventId: newTimelineRef.id,
    entityId,
    personId: interview.personId,
    type: "interview.completed",
    label: "Entretien terminé",
    description: `Résultat de l'entretien : ${decisionData.decision}. Score : ${decisionData.score || 'N/A'}`,
    sourceCollection: "interviews",
    sourceId: interviewId,
    metadata: { decision: decisionData.decision },
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  };

  try {
    await setDoc(newTimelineRef, timelineData);
  } catch(e) {
    console.warn("Failed to write timeline for decision", e);
  }

  // 3. Audit log
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "interview.decisionRecorded",
    resourceType: "interview",
    resourceId: interviewId,
    details: decisionData
  });
}

/**
 * Disables an interview record.
 */
export async function disableInterview(entityId: string, interviewId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  const snap = await getDoc(interviewRef);
  if (!snap.exists()) return;
  const interview = snap.data() as Interview;

  await updateDoc(interviewRef, {
    status: "inactive",
    previousStatus: interview.status,
    disabledAt: serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "interview.disabled",
    resourceType: "interview",
    resourceId: interviewId,
  });
}

/**
 * Reactivates an interview record.
 */
export async function reactivateInterview(entityId: string, interviewId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  const snap = await getDoc(interviewRef);
  if (!snap.exists()) return;
  const interview = snap.data() as Interview;

  const targetStatus = interview.previousStatus || "scheduled";

  await updateDoc(interviewRef, {
    status: targetStatus,
    reactivatedAt: serverTimestamp(),
    reactivatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "interview.reactivated",
    resourceType: "interview",
    resourceId: interviewId,
  });
}
