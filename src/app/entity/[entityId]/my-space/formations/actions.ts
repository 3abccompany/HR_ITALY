"use server";

import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type {
  TrainingAttendanceResponseStatus,
  TrainingParticipant,
  TrainingParticipantStatus,
  TrainingRenewalMode,
  TrainingResultStatus,
  TrainingSession,
  TrainingSessionStatus,
} from "@/types/training";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const TRAINING_RSVP_TIMEZONE = "Europe/Rome";

export type MyTrainingHistoryItem = {
  id: string;
  entityId: string;
  employeeId: string;
  sessionId: string;
  title: string;
  trainingType: string;
  providerName?: string | null;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationHours?: number | null;
  deliveryMode?: string | null;
  location?: string | null;
  trainerType?: string | null;
  trainerName?: string | null;
  status: TrainingSessionStatus;
  participantStatus: TrainingParticipantStatus;
  resultStatus?: TrainingResultStatus | null;
  certificateDocumentId?: string | null;
  attendanceResponseStatus?: TrainingAttendanceResponseStatus | null;
  attendanceDeclineReason?: string | null;
  renewalMode?: TrainingRenewalMode | null;
  renewalRequired?: boolean | null;
  renewalPeriodMonths?: number | null;
  validityRequired?: boolean | null;
  validityStartDate?: string | null;
  validityEndDate?: string | null;
  validitySource?: "participant_completion" | null;
  renewalModeSnapshot?: TrainingRenewalMode | null;
  renewalPeriodMonthsSnapshot?: number | null;
  validityWarningDaysSnapshot?: number | null;
  renewedBySessionId?: string | null;
};

type MyTrainingHistoryResult =
  | { success: true; employeeId: string; history: MyTrainingHistoryItem[] }
  | { success: false; error: string };

type MyTrainingCertificateUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

type TrainingInvitationResponseResult =
  | { success: true; attendanceResponseStatus: Exclude<TrainingAttendanceResponseStatus, "pending">; attendanceDeclineReason?: string | null }
  | { success: false; error: string };

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(dateOnly: string, time: string, timeZone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly || "");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!dateMatch || !timeMatch) return null;

  const naiveUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0
  );
  const firstPass = new Date(naiveUtc - getTimeZoneOffsetMs(new Date(naiveUtc), timeZone));
  return new Date(naiveUtc - getTimeZoneOffsetMs(firstPass, timeZone));
}

function formatDateForRsvpGate(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-");
  return day && month && year ? `${day}/${month}/${year}` : dateOnly;
}

function assertTrainingSessionNotStartedForRsvp(session: TrainingSession) {
  if (!session.startTime) {
    throw new Error("L'horaire de début de la session doit être renseigné avant la réponse.");
  }

  const sessionStart = zonedDateTimeToUtc(session.startDate, session.startTime, TRAINING_RSVP_TIMEZONE);
  if (!sessionStart) {
    throw new Error("La date ou l'horaire de début de la session est invalide.");
  }

  if (new Date().getTime() >= sessionStart.getTime()) {
    throw new Error(`La session a déjà commencé. Les réponses étaient possibles avant le ${formatDateForRsvpGate(session.startDate)} à ${session.startTime}.`);
  }
}

async function verifySelfServiceEmployee(entityId: string, idToken: string) {
  if (!entityId || !idToken || !adminAuth || !adminDb) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const uid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap, employeeSnap] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("entities").doc(entityId).get(),
    adminDb.collection("memberships").doc(`${uid}_${entityId}`).get(),
    adminDb
      .collection("entities")
      .doc(entityId)
      .collection("employees")
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .limit(2)
      .get(),
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

  if (employeeSnap.empty) {
    throw new Error("Aucun profil employé actif trouvé pour cet utilisateur.");
  }
  if (employeeSnap.size !== 1) {
    throw new Error("Plusieurs profils employés actifs sont liés à ce compte. Contactez RH.");
  }

  const employeeDoc = employeeSnap.docs[0];
  const employee = employeeDoc.data() || {};
  if (employee.entityId && employee.entityId !== entityId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  if (employee.userId !== uid) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { uid, employeeId: employeeDoc.id };
}

export async function getMyTrainingHistoryAction(params: {
  idToken: string;
  entityId: string;
}): Promise<MyTrainingHistoryResult> {
  try {
    const { idToken, entityId } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");

    const { employeeId } = await verifySelfServiceEmployee(entityId, idToken);
    const participantsSnap = await adminDb
      .collectionGroup("participants")
      .where("entityId", "==", entityId)
      .where("employeeId", "==", employeeId)
      .get();

    const history = await Promise.all(participantsSnap.docs.map(async (participantDoc) => {
      const participant = participantDoc.data() as TrainingParticipant;
      if (
        participant.entityId !== entityId
        || participant.employeeId !== employeeId
        || !participant.sessionId
      ) {
        return null;
      }

      const sessionSnap = await adminDb
        .collection("entities")
        .doc(entityId)
        .collection("trainingSessions")
        .doc(participant.sessionId)
        .get();
      if (!sessionSnap.exists) return null;

      const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
      if (session.entityId !== entityId || session.id !== participant.sessionId) {
        return null;
      }

      if (session.status === "draft") return null;
      if (session.status === "cancelled") return null;
      if (session.status === "archived" && participant.participantStatus !== "completed") return null;

      const item: MyTrainingHistoryItem = {
        id: `${participant.sessionId}:${participant.employeeId}`,
        entityId,
        employeeId,
        sessionId: participant.sessionId,
        title: session.title,
        trainingType: session.trainingType,
        providerName: session.providerName ?? null,
        startDate: session.startDate,
        endDate: session.endDate ?? null,
        startTime: session.startTime ?? null,
        endTime: session.endTime ?? null,
        durationHours: session.durationHours ?? null,
        deliveryMode: session.deliveryMode ?? null,
        location: session.location ?? null,
        trainerType: session.trainerType ?? null,
        trainerName: session.trainerName ?? null,
        status: session.status,
        participantStatus: participant.participantStatus,
        resultStatus: participant.resultStatus ?? null,
        certificateDocumentId: participant.certificateDocumentId ?? null,
        attendanceResponseStatus: participant.attendanceResponseStatus ?? null,
        attendanceDeclineReason: participant.attendanceDeclineReason ?? null,
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

      return item;
    }));

    const sortedHistory = history
      .filter((item): item is MyTrainingHistoryItem => item !== null)
      .sort((a, b) => {
        const dateA = Date.parse(a.startDate || "") || 0;
        const dateB = Date.parse(b.startDate || "") || 0;
        return dateB - dateA;
      });

    return { success: true, employeeId, history: sortedHistory };
  } catch (err: any) {
    console.error("[My Training History] Load failed:", err);
    return { success: false, error: err.message || "Impossible de charger vos formations." };
  }
}

export async function respondToTrainingInvitationAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  response: "confirmed" | "declined";
  declineReason?: string | null;
}): Promise<TrainingInvitationResponseResult> {
  try {
    const { idToken, entityId, sessionId, response } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    if (!sessionId) throw new Error("Session de formation requise.");
    if (response !== "confirmed" && response !== "declined") {
      throw new Error("Réponse invalide.");
    }

    const { uid, employeeId } = await verifySelfServiceEmployee(entityId, idToken);
    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const participantRef = sessionRef.collection("participants").doc(employeeId);
    const [sessionSnap, participantSnap] = await Promise.all([
      sessionRef.get(),
      participantRef.get(),
    ]);

    if (!sessionSnap.exists || !participantSnap.exists) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
    const participant = participantSnap.data() as TrainingParticipant;

    if (
      session.entityId !== entityId
      || session.id !== sessionId
      || participant.entityId !== entityId
      || participant.sessionId !== sessionId
      || participant.employeeId !== employeeId
    ) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    if (session.status !== "scheduled") {
      throw new Error("La réponse est possible uniquement pour une session planifiée à venir.");
    }

    assertTrainingSessionNotStartedForRsvp(session);

    const trimmedReason = String(params.declineReason || "").trim();
    const normalizedReason = response === "declined" && trimmedReason ? trimmedReason : null;
    const currentReason = participant.attendanceDeclineReason?.trim() || null;

    if (
      participant.attendanceResponseStatus === response
      && currentReason === normalizedReason
      && participant.attendanceRespondedBy === uid
    ) {
      return { success: true, attendanceResponseStatus: response, attendanceDeclineReason: normalizedReason };
    }

    await participantRef.update({
      attendanceResponseStatus: response,
      attendanceRespondedAt: FieldValue.serverTimestamp(),
      attendanceRespondedBy: uid,
      attendanceResponseUpdatedAt: FieldValue.serverTimestamp(),
      attendanceDeclineReason: normalizedReason || FieldValue.delete(),
    });

    return { success: true, attendanceResponseStatus: response, attendanceDeclineReason: normalizedReason };
  } catch (err: any) {
    console.error("[My Training RSVP] Update failed:", err);
    return { success: false, error: err.message || "Impossible d'enregistrer votre réponse." };
  }
}

export async function getMyTrainingCertificateUrlAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  download?: boolean;
}): Promise<MyTrainingCertificateUrlResult> {
  try {
    const { idToken, entityId, sessionId, download } = params;
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    if (!sessionId) throw new Error("Session de formation requise.");

    const { employeeId } = await verifySelfServiceEmployee(entityId, idToken);
    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const participantRef = sessionRef.collection("participants").doc(employeeId);
    const [sessionSnap, participantSnap] = await Promise.all([
      sessionRef.get(),
      participantRef.get(),
    ]);

    if (!sessionSnap.exists || !participantSnap.exists) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const session = sessionSnap.data() as TrainingSession;
    const participant = participantSnap.data() as TrainingParticipant;
    const documentId = participant.certificateDocumentId;

    if (
      session.entityId !== entityId
      || participant.entityId !== entityId
      || participant.sessionId !== sessionId
      || participant.employeeId !== employeeId
      || !documentId
    ) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const documentSnap = await adminDb.collection("entities").doc(entityId).collection("documents").doc(documentId).get();
    if (!documentSnap.exists) throw new Error(SAFE_FORBIDDEN_MESSAGE);

    const documentData = documentSnap.data() || {};
    if (
      documentData.entityId !== entityId
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
    console.error("[My Training Certificate] URL failed:", err);
    return { success: false, error: err.message || "Document indisponible." };
  }
}
