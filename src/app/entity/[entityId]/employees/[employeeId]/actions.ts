"use server";

import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import type {
  EmployeeTrainingHistoryItem,
  TrainingParticipant,
  TrainingSession,
} from "@/types/training";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const TRAINING_HISTORY_READ_PERMISSION = "training.read";
const DOCUMENT_READ_PERMISSION = "documents.read";

type EmployeeTrainingHistoryActionResult =
  | { success: true; history: EmployeeTrainingHistoryItem[] }
  | { success: false; error: string };

type EmployeeTrainingCertificateUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

async function authorizeEmployeeTrainingHistoryRead(entityId: string, idToken: string) {
  if (!entityId || !idToken || !adminAuth || !adminDb) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const actorUid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap] = await Promise.all([
    adminDb.collection("users").doc(actorUid).get(),
    adminDb.collection("entities").doc(entityId).get(),
    adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  if (!entitySnap.exists || entitySnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const membership = membershipSnap.data();
  if (!membershipSnap.exists || membership?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
  if (!permissions.includes(TRAINING_HISTORY_READ_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, permissions };
}

export async function getEmployeeTrainingHistoryAction(params: {
  idToken: string;
  entityId: string;
  employeeId: string;
}): Promise<EmployeeTrainingHistoryActionResult> {
  try {
    const { idToken, entityId, employeeId } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    if (!employeeId) throw new Error("Collaborateur requis.");

    await authorizeEmployeeTrainingHistoryRead(entityId, idToken);

    const employeeRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId);
    const employeeSnap = await employeeRef.get();
    if (!employeeSnap.exists) {
      throw new Error("Collaborateur introuvable.");
    }

    const employee = employeeSnap.data() || {};
    if (employee.entityId && employee.entityId !== entityId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const participantsSnap = await adminDb
      .collectionGroup("participants")
      .where("entityId", "==", entityId)
      .where("employeeId", "==", employeeId)
      .get();

    const history: Array<EmployeeTrainingHistoryItem | null> = await Promise.all(participantsSnap.docs.map(async (participantDoc) => {
      const participant = participantDoc.data() as TrainingParticipant;

      if (
        participant.entityId !== entityId
        || participant.employeeId !== employeeId
        || !participant.sessionId
      ) {
        return null;
      }

      const sessionRef = adminDb
        .collection("entities")
        .doc(entityId)
        .collection("trainingSessions")
        .doc(participant.sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) return null;

      const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
      if (session.entityId !== entityId || participant.sessionId !== sessionSnap.id) {
        return null;
      }

      const historyItem: EmployeeTrainingHistoryItem = {
        id: `${participant.sessionId}:${participant.employeeId}`,
        entityId,
        employeeId,
        source: "canonical",
        sessionId: participant.sessionId,
        participantId: participant.id || participant.employeeId,
        title: session.title,
        trainingType: session.trainingType,
        providerName: session.providerName ?? null,
        startDate: session.startDate,
        endDate: session.endDate ?? null,
        durationHours: session.durationHours ?? null,
        status: session.status,
        approvalStatus: session.approvalStatus,
        participantStatus: participant.participantStatus,
        resultStatus: participant.resultStatus ?? null,
        certificateDocumentId: participant.certificateDocumentId ?? null,
        renewalMode: session.renewalMode ?? null,
        renewalRequired: session.renewalRequired ?? null,
        renewalPeriodMonths: session.renewalPeriodMonths ?? null,
        validityRequired: participant.validityRequired ?? null,
        validityStartDate: participant.validityStartDate ?? null,
        validityEndDate: participant.validityEndDate ?? null,
        validitySource: participant.validitySource ?? null,
        renewalModeSnapshot: participant.renewalModeSnapshot ?? null,
        renewalPeriodMonthsSnapshot: participant.renewalPeriodMonthsSnapshot ?? null,
        validityWarningDaysSnapshot: participant.validityWarningDaysSnapshot ?? null,
        renewedBySessionId: participant.renewedBySessionId ?? null,
      };

      return historyItem;
    }));

    const sortedHistory = history
      .filter((item): item is EmployeeTrainingHistoryItem => item !== null)
      .sort((a, b) => {
        const dateA = Date.parse(a.startDate || "") || 0;
        const dateB = Date.parse(b.startDate || "") || 0;
        return dateB - dateA;
      });

    return { success: true, history: sortedHistory };
  } catch (err: any) {
    console.error("[Employee Training History] Load failed:", err);
    return { success: false, error: err.message || "Impossible de charger l'historique des formations." };
  }
}

export async function getEmployeeTrainingCertificateUrlAction(params: {
  idToken: string;
  entityId: string;
  employeeId: string;
  sessionId: string;
  documentId: string;
  download?: boolean;
}): Promise<EmployeeTrainingCertificateUrlResult> {
  try {
    const { idToken, entityId, employeeId, sessionId, documentId, download } = params;
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    if (!employeeId || !sessionId || !documentId) throw new Error("Document d'attestation requis.");

    const { permissions } = await authorizeEmployeeTrainingHistoryRead(entityId, idToken);
    if (!permissions.includes(DOCUMENT_READ_PERMISSION)) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const employeeRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId);
    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const participantRef = sessionRef.collection("participants").doc(employeeId);
    const documentRef = adminDb.collection("entities").doc(entityId).collection("documents").doc(documentId);
    const [employeeSnap, sessionSnap, participantSnap, documentSnap] = await Promise.all([
      employeeRef.get(),
      sessionRef.get(),
      participantRef.get(),
      documentRef.get(),
    ]);

    if (!employeeSnap.exists || !sessionSnap.exists || !participantSnap.exists || !documentSnap.exists) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const employee = employeeSnap.data() || {};
    const session = sessionSnap.data() as TrainingSession;
    const participant = participantSnap.data() as TrainingParticipant;
    const documentData = documentSnap.data() || {};

    if (
      (employee.entityId && employee.entityId !== entityId)
      || session.entityId !== entityId
      || participant.entityId !== entityId
      || participant.sessionId !== sessionId
      || participant.employeeId !== employeeId
      || participant.certificateDocumentId !== documentId
      || documentData.entityId !== entityId
      || documentData.documentType !== "training_certificate"
      || documentData.relatedModule !== "trainings"
      || !documentData.storagePath
    ) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const [url] = await adminBucket.file(documentData.storagePath).getSignedUrl({
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
      responseDisposition: `${download ? "attachment" : "inline"}; filename="${documentData.fileName || "attestation"}"`,
    });

    return { success: true, url };
  } catch (err: any) {
    console.error("[Employee Training Certificate] URL failed:", err);
    return { success: false, error: err.message || "Document indisponible." };
  }
}
