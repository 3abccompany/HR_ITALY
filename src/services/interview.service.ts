import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp, 
  updateDoc,
  getDoc,
  setDoc,
  arrayUnion
} from "firebase/firestore";
import { Interview, InterviewDecision } from "@/types/interview";
import { Candidate } from "@/types/candidate";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

/**
 * Schedules a new interview.
 * Uses a transaction to validate candidate state and promotes status to 'interview_scheduled'.
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

    // Strict eligibility check for Milestone 7J
    if (candidateData.status !== "interview_to_schedule") {
      throw new Error(`Ce candidat n'est pas éligible à la planification d'un entretien (Statut actuel: ${candidateData.status})`);
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

    // 2. Update Candidate Status and Tracking
    transaction.update(candidateRef, {
      status: "interview_scheduled",
      latestInterviewId: interviewId,
      interviewIds: arrayUnion(interviewId),
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    // 3. Timeline Event
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId: candidateData.personId,
      type: "interview.scheduled",
      label: "Entretien planifié",
      description: `Entretien ${interviewData.interviewType} planifié pour le poste de ${interviewData.positionApplied}`,
      sourceCollection: "interviews",
      sourceId: interviewId,
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    });

    // 4. Update optional read models safely
    const viewRef = doc(db, `entities/${entityId}/candidateViews`, data.candidateId);
    transaction.set(viewRef, {
      status: "interview_scheduled",
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }, { merge: true });

    return interviewId;
  }).then(async (id) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "interview.scheduled",
      resourceType: "interview",
      resourceId: id,
      details: { candidateId: data.candidateId }
    });
    return id;
  }).catch((err) => {
    // If it's a permission error, emit for the developer overlay
    if (err.code === 'permission-denied') {
      const permissionError = new FirestorePermissionError({
        path: `entities/${entityId}/interviews`,
        operation: 'create',
      } satisfies SecurityRuleContext);
      errorEmitter.emit('permission-error', permissionError);
    }
    throw err;
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
  
  updateDoc(interviewRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }).catch(async (serverError) => {
    const permissionError = new FirestorePermissionError({
      path: interviewRef.path,
      operation: 'update',
      requestResourceData: data,
    } satisfies SecurityRuleContext);
    errorEmitter.emit('permission-error', permissionError);
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
  }).catch(async (serverError) => {
    const permissionError = new FirestorePermissionError({
      path: interviewRef.path,
      operation: 'update',
      requestResourceData: decisionData,
    } satisfies SecurityRuleContext);
    errorEmitter.emit('permission-error', permissionError);
  });

  // 2. Update Candidate status based on interview outcome
  const candidateRef = doc(db, `entities/${entityId}/candidates`, interview.candidateId);
  updateDoc(candidateRef, {
    status: "interview_completed",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }).catch(err => console.warn("Candidate status sync after interview failed", err));

  // 3. Create personTimeline event (History)
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

  setDoc(newTimelineRef, timelineData).catch(async (err) => {
    const permissionError = new FirestorePermissionError({
      path: newTimelineRef.path,
      operation: 'create',
      requestResourceData: timelineData,
    } satisfies SecurityRuleContext);
    errorEmitter.emit('permission-error', permissionError);
  });

  // 4. Audit log
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

  updateDoc(interviewRef, {
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

  updateDoc(interviewRef, {
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
