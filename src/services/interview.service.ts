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
import { Candidate, CandidateStatus } from "@/types/candidate";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { sendInterviewEmailAction } from "./email.service";

/**
 * Utility to remove undefined properties from an object to prevent Firestore errors.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
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
 * Schedules a new interview.
 * Uses a transaction to validate candidate state and promotes status to 'interview_scheduled'.
 */
export async function scheduleInterview(
  entityId: string, 
  data: Partial<Interview> & { candidateId: string }, 
  actorUid: string,
  emailConfig?: {
    enabled: boolean;
    subject: string;
    message: string;
    companyName: string;
  }
) {
  if (!db) throw new Error("Firestore not initialized");

  console.debug(`[Interview Service] Starting scheduling for candidate: ${data.candidateId}`);

  let interviewId: string;
  let candidateEmail: string = "";

  try {
    const result = await runTransaction(db, async (transaction) => {
      console.debug("[Interview Service] Step 1: Fetching candidate");
      const candidateRef = doc(db, `entities/${entityId}/candidates`, data.candidateId);
      const candidateSnap = await transaction.get(candidateRef);

      if (!candidateSnap.exists()) throw new Error("Le candidat n'existe pas.");
      const candidateData = candidateSnap.data() as Candidate;
      candidateEmail = candidateData.email;

      if (candidateData.status !== "interview_to_schedule") {
        throw new Error(`Ce candidat n'est pas éligible à la planification d'un entretien (Statut actuel: ${candidateData.status})`);
      }

      const interviewRef = doc(collection(db, `entities/${entityId}/interviews`));
      interviewId = interviewRef.id;

      const emailStatus = emailConfig?.enabled ? "queued" : "not_requested";

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
        
        // Email Notification
        emailNotificationEnabled: !!emailConfig?.enabled,
        emailTo: candidateEmail,
        emailSubjectSnapshot: emailConfig?.subject,
        emailMessageSnapshot: emailConfig?.message,
        emailStatus: emailStatus,

        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      };

      // 1. Create Interview
      console.debug(`[Interview Service] Step 2: Creating interview ${interviewId}`);
      transaction.set(interviewRef, interviewData);

      // 2. Update Candidate
      console.debug("[Interview Service] Step 3: Updating candidate status");
      transaction.update(candidateRef, {
        status: "interview_scheduled",
        latestInterviewId: interviewId,
        interviewIds: arrayUnion(interviewId),
        statusUpdatedAt: serverTimestamp(),
        statusUpdatedBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });

      // 3. Email Log if enabled
      if (emailConfig?.enabled) {
        console.debug("[Interview Service] Step 4: Queuing email log");
        const logRef = doc(collection(db, `entities/${entityId}/emailLogs`));
        transaction.set(logRef, {
          logId: logRef.id,
          entityId,
          candidateId: data.candidateId,
          personId: candidateData.personId,
          interviewId,
          to: candidateEmail,
          subject: emailConfig.subject,
          body: emailConfig.message,
          status: "queued",
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        });
      }

      // 4. Timeline Event
      console.debug("[Interview Service] Step 5: Creating timeline event");
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

      // 5. Update Views
      console.debug("[Interview Service] Step 6: Updating candidate views (safe set)");
      const viewRef = doc(db, `entities/${entityId}/candidateViews`, data.candidateId);
      transaction.set(viewRef, {
        status: "interview_scheduled",
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }, { merge: true });

      return { interviewId, candidateDisplayName: candidateData.displayName };
    });

    // Post-Transaction: Trigger Email Send (Updated with confirmation logic)
    if (emailConfig?.enabled && candidateEmail) {
      console.debug("[Interview Service] Step 7: Triggering async server email send");
      const dateObj = new Date(data.scheduledAt || "");
      const interviewDate = dateObj.toLocaleDateString('fr-FR', { dateStyle: 'long' });
      const interviewTime = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      sendInterviewEmailAction({
        entityId,
        interviewId: result.interviewId,
        to: candidateEmail,
        subject: emailConfig.subject,
        message: emailConfig.message,
        templateData: {
          candidateName: result.candidateDisplayName,
          jobTitle: data.positionApplied || "Poste ouvert",
          companyName: emailConfig.companyName,
          interviewDate,
          interviewTime,
          locationOrLink: data.location || "Sur site",
          recruiterName: data.interviewerName || "Équipe RH",
          confirmationLink: "" // Will be generated inside the server action
        }
      }).catch(err => {
        console.error("[Interview Service] Non-critical email trigger failure:", err);
      });
    }

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "interview.scheduled",
      resourceType: "interview",
      resourceId: result.interviewId,
      details: { candidateId: data.candidateId, emailNotification: !!emailConfig?.enabled }
    });

    return result.interviewId;
  } catch (serverError: any) {
    console.error("[Interview Service] Transaction Failed:", serverError);
    if (serverError.code === 'permission-denied') {
      const permissionError = new FirestorePermissionError({
        path: `entities/${entityId}/interviews/...`,
        operation: 'write',
        requestResourceData: { candidateId: data.candidateId },
      } satisfies SecurityRuleContext);
      errorEmitter.emit('permission-error', permissionError);
    }
    throw serverError;
  }
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
  
  return await runTransaction(db, async (transaction) => {
    const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
    const interviewSnap = await transaction.get(interviewRef);
    if (!interviewSnap.exists()) throw new Error("Entretien introuvable.");
    const interview = interviewSnap.data() as Interview;

    const candidateRef = doc(db, `entities/${entityId}/candidates`, interview.candidateId);
    const candidateSnap = await transaction.get(candidateRef);
    if (!candidateSnap.exists()) throw new Error("Candidat introuvable.");

    let nextStatus: CandidateStatus = "interview_completed";
    if (decisionData.decision === "accepted") {
      nextStatus = "accepted";
    } else if (decisionData.decision === "rejected") {
      nextStatus = "rejected";
    }

    transaction.update(interviewRef, sanitizePayload({
      ...decisionData,
      status: "completed",
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));

    transaction.update(candidateRef, {
      status: nextStatus,
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId: interview.personId,
      type: "interview.completed",
      label: "Entretien terminé",
      description: `Résultat de l'entretien : ${decisionData.decision}. Score : ${decisionData.score || 'N/A'}`,
      sourceCollection: "interviews",
      sourceId: interviewId,
      metadata: sanitizePayload({ decision: decisionData.decision }),
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    });

    if (nextStatus === "accepted" || nextStatus === "rejected") {
      const decisionTimelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(decisionTimelineRef, {
        eventId: decisionTimelineRef.id,
        entityId,
        personId: interview.personId,
        type: nextStatus === "accepted" ? "candidate.accepted" : "candidate.rejected",
        label: nextStatus === "accepted" ? "Candidat retenu" : "Candidature refusée",
        description: nextStatus === "accepted" ? "Validé suite à l'entretien." : "Refusé suite à l'entretien.",
        sourceCollection: "candidates",
        sourceId: interview.candidateId,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      });
    }

    const viewRef = doc(db, `entities/${entityId}/candidateViews`, interview.candidateId);
    transaction.set(viewRef, {
      status: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }, { merge: true });

    return { interviewId, candidateId: interview.candidateId, nextStatus };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "interview.decisionRecorded",
      resourceType: "interview",
      resourceId: interviewId,
      details: sanitizePayload({ ...decisionData, candidateStatus: res.nextStatus })
    });
    return res;
  });
}

export async function updateInterview(entityId: string, interviewId: string, data: Partial<Interview>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  await updateDoc(interviewRef, sanitizePayload({ ...data, updatedAt: serverTimestamp(), updatedBy: actorUid }));
}

export async function disableInterview(entityId: string, interviewId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  await updateDoc(interviewRef, { status: "inactive", updatedAt: serverTimestamp(), updatedBy: actorUid });
}

export async function reactivateInterview(entityId: string, interviewId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const interviewRef = doc(db, `entities/${entityId}/interviews`, interviewId);
  await updateDoc(interviewRef, { status: "scheduled", updatedAt: serverTimestamp(), updatedBy: actorUid });
}
