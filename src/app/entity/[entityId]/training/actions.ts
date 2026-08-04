"use server";

import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "crypto";
import { createTrustedAuditLog } from "@/services/audit.server";
import {
  clearTrainingParticipantValidityFields,
  deriveTrainingParticipantValidity,
  isParticipantValidityEligible,
} from "@/services/training-validity.service";
import {
  buildTrainingTrainerAvailabilityRequestEmailContent,
  buildTrainingTrainerEmailContent,
  sendTrainingParticipantInvitationEmail,
  sendTrainingTrainerAvailabilityRequestEmail,
  sendTrainingTrainerEmail,
} from "@/services/email.service";
import type { TrainingParticipant, TrainingParticipantStatus, TrainingResultStatus, TrainingSession, TrainingSessionStatus } from "@/types/training";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const TRAINING_TRAINER_EMAIL_PERMISSION = "training.update";
const TRAINING_RESULT_UPDATE_PERMISSION = "training.update";
const TRAINING_CERTIFICATE_UPDATE_PERMISSION = "training.update";
const TRAINING_CERTIFICATE_READ_PERMISSION = "training.read";
const TRAINING_LIFECYCLE_UPDATE_PERMISSION = "training.update";
const TRAINING_PARTICIPANT_INVITATION_PERMISSION = "training.update";
const DOCUMENT_UPLOAD_PERMISSION = "documents.upload";
const DOCUMENT_READ_PERMISSION = "documents.read";
const TRAINING_RESULT_TIMEZONE = "Europe/Rome";
const MAX_CERTIFICATE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_CERTIFICATE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const TRAINING_PARTICIPANT_STATUSES: TrainingParticipantStatus[] = [
  "planned",
  "attended",
  "absent",
  "completed",
  "not_completed",
  "cancelled",
];
const TRAINING_RESULT_STATUSES: TrainingResultStatus[] = [
  "passed",
  "failed",
  "attended",
  "not_attended",
  "not_required",
];

type TrainingTrainerEmailPreview =
  | { success: true; to: string; subject: string; body: string; participantCount: number; lastSentAt?: string | null }
  | { success: false; error: string };

type TrainingTrainerEmailSendResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

type TrainingTrainerAvailabilityPreview =
  | { success: true; to: string; subject: string; body: string; requestedFor: TrainingTrainerAvailabilityScheduleSnapshot }
  | { success: false; error: string };

type TrainingTrainerAvailabilitySendResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

type TrainingParticipantResultUpdateResult =
  | { success: true }
  | { success: false; error: string };

type TrainingParticipantCertificateMutationResult =
  | { success: true; documentId: string }
  | { success: false; error: string };

type TrainingParticipantCertificateUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

type TrainingSessionLifecycleResult =
  | { success: true }
  | { success: false; error: string };

type TrainingParticipantInvitationChannelStatus = "sent" | "already_sent" | "failed" | "not_applicable" | "absent";
type TrainingParticipantInvitationFinalStatus = "invitation_sent" | "email_only" | "manual_required" | "partial_failure" | "already_sent";

type TrainingParticipantInvitationPreviewRow = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  accountLabel: string;
  emailLabel: string;
  plannedChannel: string;
};

type TrainingParticipantInvitationDeliveryRow = TrainingParticipantInvitationPreviewRow & {
  inApp: TrainingParticipantInvitationChannelStatus;
  email: TrainingParticipantInvitationChannelStatus;
  finalResult: TrainingParticipantInvitationFinalStatus;
  error?: string | null;
};

type TrainingParticipantInvitationPreviewResult =
  | { success: true; sessionId: string; rows: TrainingParticipantInvitationPreviewRow[] }
  | { success: false; error: string };

type TrainingParticipantInvitationSendResult =
  | { success: true; sessionId: string; rows: TrainingParticipantInvitationDeliveryRow[]; warning?: string }
  | { success: false; error: string };

type TrainingTrainerAvailabilityScheduleSnapshot = {
  trainerEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function buildTrainingParticipantInvitationFingerprint(session: TrainingSession) {
  return [
    session.startDate || "",
    session.endDate || "",
    session.startTime || "",
    session.endTime || "",
    session.location || "",
    session.deliveryMode || "",
  ].join("|");
}

function buildTrainingParticipantInvitationDedupKey(entityId: string, sessionId: string, employeeId: string, session: TrainingSession) {
  return [
    entityId,
    sessionId,
    employeeId,
    "training_participant_invitation",
    buildTrainingParticipantInvitationFingerprint(session),
  ].join("|");
}

function buildDeterministicId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function getTrainingParticipantInvitationActionUrl(entityId: string) {
  return `/entity/${entityId}/my-space/formations`;
}

function getEmployeeDisplayNameFromData(employeeId: string, employee: Record<string, any> | null | undefined) {
  const displayName = String(employee?.displayName || "").trim();
  if (displayName) return displayName;
  const fullName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim();
  return fullName || employeeId;
}

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

function formatDateForResultGate(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-");
  return day && month && year ? `${day}/${month}/${year}` : dateOnly;
}

function assertTrainingSessionEndedForResults(session: TrainingSession) {
  const effectiveEndDate = session.endDate || session.startDate;
  if (!session.endTime) {
    throw new Error("L’horaire de fin de la session doit être renseigné avant la saisie des résultats.");
  }

  const sessionEnd = zonedDateTimeToUtc(effectiveEndDate, session.endTime, TRAINING_RESULT_TIMEZONE);
  if (!sessionEnd) {
    throw new Error("La date ou l’horaire de fin de la session est invalide.");
  }

  if (new Date().getTime() < sessionEnd.getTime()) {
    throw new Error(`La session n’est pas encore terminée. Les résultats pourront être saisis après le ${formatDateForResultGate(effectiveEndDate)} à ${session.endTime}.`);
  }
}

export async function attachTrainingParticipantCertificateAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  employeeId: string;
}, formData: FormData): Promise<TrainingParticipantCertificateMutationResult> {
  let uploadedStoragePath: string | null = null;

  try {
    const { idToken, entityId, sessionId, employeeId } = params;
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");

    const { actorUid, user } = await authorizeTrainingParticipantCertificateWrite(entityId, idToken);
    const { file, buffer, safeFileName } = await extractCertificateFile(formData);
    const { participantRef, session, participant } = await loadTrainingParticipantCertificateContext(entityId, sessionId, employeeId);

    if (participant.certificateDocumentId) {
      throw new Error("Une attestation est déjà jointe. Utilisez l'action de remplacement.");
    }

    const documentRef = adminDb.collection("entities").doc(entityId).collection("documents").doc();
    const documentId = documentRef.id;
    const storagePath = `entities/${entityId}/documents/${documentId}/${safeFileName}`;
    uploadedStoragePath = storagePath;

    await adminBucket.file(storagePath).save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { entityId, documentId, module: "training", sessionId, employeeId },
      },
      resumable: false,
    });

    const now = FieldValue.serverTimestamp();
    const employeeName = participant.employeeDisplayNameSnapshot || employeeId;
    const batch = adminDb.batch();
    batch.set(documentRef, {
      id: documentId,
      entityId,
      title: `Attestation formation - ${employeeName} - ${session.title}`,
      documentType: "training_certificate",
      status: "valid",
      storagePath,
      fileName: safeFileName,
      mimeType: file.type,
      sizeBytes: file.size,
      employeeId,
      employeeDisplayName: participant.employeeDisplayNameSnapshot || null,
      personId: participant.personId || null,
      relatedModule: "trainings",
      relatedId: sessionId,
      relatedLabel: `${session.title} - ${employeeName}`,
      version: 1,
      rootDocumentId: documentId,
      isSensitive: false,
      isRequired: true,
      uploadedAt: now,
      uploadedBy: actorUid,
      uploadedByDisplayName: user.userDisplayName || user.displayName || actorUid,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
      source: "training_participant_certificate",
    });
    batch.update(participantRef, {
      certificateDocumentId: documentId,
      updatedAt: now,
      updatedBy: actorUid,
    });

    await batch.commit();
    uploadedStoragePath = null;

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingParticipant.certificateAttached",
        resourceType: "trainingParticipant",
        resourceId: `${sessionId}/${employeeId}`,
        details: { sessionId, employeeId, documentId },
      });
    } catch (auditErr) {
      console.warn("[Training Participant Certificate] Non-blocking audit failure:", auditErr);
    }

    return { success: true, documentId };
  } catch (err: any) {
    if (uploadedStoragePath && adminBucket) {
      await adminBucket.file(uploadedStoragePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    console.error("[Training Participant Certificate] Attach failed:", err);
    return { success: false, error: err.message || "Attestation impossible à joindre." };
  }
}

export async function replaceTrainingParticipantCertificateAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  employeeId: string;
  documentId: string;
}, formData: FormData): Promise<TrainingParticipantCertificateMutationResult> {
  let uploadedStoragePath: string | null = null;

  try {
    const { idToken, entityId, sessionId, employeeId, documentId } = params;
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");

    const { actorUid, user } = await authorizeTrainingParticipantCertificateWrite(entityId, idToken);
    const { file, buffer, safeFileName } = await extractCertificateFile(formData);
    const { participantRef, session, participant } = await loadTrainingParticipantCertificateContext(entityId, sessionId, employeeId);
    const { documentRef: oldDocumentRef, documentData: oldDocument } = await loadVerifiedParticipantCertificateDocument(entityId, participant, documentId);

    if (oldDocument.status === "replaced" || oldDocument.status === "archived") {
      throw new Error("Cette attestation a déjà été remplacée ou archivée.");
    }

    const newDocumentRef = adminDb.collection("entities").doc(entityId).collection("documents").doc();
    const newDocumentId = newDocumentRef.id;
    const storagePath = `entities/${entityId}/documents/${newDocumentId}/${safeFileName}`;
    uploadedStoragePath = storagePath;

    await adminBucket.file(storagePath).save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { entityId, documentId: newDocumentId, module: "training", sessionId, employeeId },
      },
      resumable: false,
    });

    const now = FieldValue.serverTimestamp();
    const employeeName = participant.employeeDisplayNameSnapshot || employeeId;
    const rootDocumentId = oldDocument.rootDocumentId || oldDocument.id || documentId;
    const version = Number(oldDocument.version || 1) + 1;
    const batch = adminDb.batch();
    batch.set(newDocumentRef, {
      ...oldDocument,
      id: newDocumentId,
      entityId,
      title: `Attestation formation - ${employeeName} - ${session.title}`,
      documentType: "training_certificate",
      status: "valid",
      storagePath,
      fileName: safeFileName,
      mimeType: file.type,
      sizeBytes: file.size,
      employeeId,
      employeeDisplayName: participant.employeeDisplayNameSnapshot || null,
      personId: participant.personId || null,
      relatedModule: "trainings",
      relatedId: sessionId,
      relatedLabel: `${session.title} - ${employeeName}`,
      version,
      replacesId: documentId,
      replacedById: null,
      rootDocumentId,
      replacementReason: "Remplacement de l'attestation de formation participant.",
      uploadedAt: now,
      uploadedBy: actorUid,
      uploadedByDisplayName: user.userDisplayName || user.displayName || actorUid,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
      source: "training_participant_certificate",
      sourceKey: null,
    });
    batch.update(oldDocumentRef, {
      status: "replaced",
      replacedById: newDocumentId,
      replacedAt: now,
      replacedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });
    batch.update(participantRef, {
      certificateDocumentId: newDocumentId,
      updatedAt: now,
      updatedBy: actorUid,
    });

    await batch.commit();
    uploadedStoragePath = null;

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingParticipant.certificateReplaced",
        resourceType: "trainingParticipant",
        resourceId: `${sessionId}/${employeeId}`,
        details: { sessionId, employeeId, oldDocumentId: documentId, newDocumentId },
      });
    } catch (auditErr) {
      console.warn("[Training Participant Certificate] Non-blocking audit failure:", auditErr);
    }

    return { success: true, documentId: newDocumentId };
  } catch (err: any) {
    if (uploadedStoragePath && adminBucket) {
      await adminBucket.file(uploadedStoragePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    console.error("[Training Participant Certificate] Replace failed:", err);
    return { success: false, error: err.message || "Remplacement de l'attestation impossible." };
  }
}

export async function getTrainingParticipantCertificateUrlAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  employeeId: string;
  documentId: string;
  download?: boolean;
}): Promise<TrainingParticipantCertificateUrlResult> {
  return buildParticipantCertificateSignedUrl({
    ...params,
    disposition: params.download ? "attachment" : "inline",
  });
}

export async function updateTrainingSessionLifecycleAction(params: {
  idToken: string;
  entityId: string;
  sessionId: string;
  targetStatus: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed">;
}): Promise<TrainingSessionLifecycleResult> {
  try {
    const { idToken, entityId, sessionId, targetStatus } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    if (!sessionId) throw new Error("Session de formation requise.");

    const { actorUid } = await authorizeTrainingSessionLifecycleUpdate(entityId, idToken);
    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      throw new Error("Session de formation introuvable.");
    }

    const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
    if (session.entityId !== entityId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    assertAllowedTrainingLifecycleTransition(session, targetStatus);

    await sessionRef.update({
      status: targetStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingSession.lifecycleUpdated",
        resourceType: "trainingSession",
        resourceId: sessionId,
        details: {
          previousStatus: session.status,
          targetStatus,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Session Lifecycle] Non-blocking audit failure:", auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Training Session Lifecycle] Update failed:", err);
    return { success: false, error: err.message || "Transition de session impossible." };
  }
}

export async function getTrainingTrainerAvailabilityRequestPreviewAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
}): Promise<TrainingTrainerAvailabilityPreview> {
  try {
    const { entityId, sessionId, idToken } = params;
    const { entity } = await authorizeTrainingTrainerEmail(entityId, idToken);
    const { session, trustedRecipientEmail, requestedFor } = await loadTrustedTrainingTrainerAvailabilityContext(entityId, sessionId);
    const rendered = await buildTrainingTrainerAvailabilityRequestEmailContent({ session, entity });

    return {
      success: true,
      to: trustedRecipientEmail,
      subject: rendered.subject,
      body: rendered.text,
      requestedFor,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Prévisualisation impossible." };
  }
}

export async function sendTrainingTrainerAvailabilityRequestAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
  subjectOverride?: string;
  bodyOverride?: string;
}): Promise<TrainingTrainerAvailabilitySendResult> {
  try {
    const { entityId, sessionId, idToken, subjectOverride, bodyOverride } = params;
    const { actorUid, entity } = await authorizeTrainingTrainerEmail(entityId, idToken);
    const { sessionRef, session, trustedRecipientEmail, requestedFor } = await loadTrustedTrainingTrainerAvailabilityContext(entityId, sessionId);

    const sendResult = await sendTrainingTrainerAvailabilityRequestEmail({
      entityId,
      to: trustedRecipientEmail,
      session,
      entity,
      subjectOverride,
      bodyOverride,
    });

    try {
      const logRef = adminDb.collection("entities").doc(entityId).collection("emailLogs").doc();
      const batch = adminDb.batch();
      batch.update(sessionRef, {
        trainerAvailabilityStatus: "awaiting_response",
        trainerAvailabilityRequestedAt: FieldValue.serverTimestamp(),
        trainerAvailabilityRequestedBy: actorUid,
        trainerAvailabilityRecipient: trustedRecipientEmail,
        trainerAvailabilityRequestedFor: requestedFor,
        trainerAvailabilityResponseAt: FieldValue.delete(),
        trainerAvailabilityResponseBy: FieldValue.delete(),
        trainerAvailabilityResponseNote: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      batch.set(logRef, {
        logId: logRef.id,
        entityId,
        module: "training",
        type: "trainer_availability_request",
        sessionId,
        to: trustedRecipientEmail,
        subject: sendResult.subject,
        body: sendResult.body,
        status: "sent",
        messageId: sendResult.messageId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });
      await batch.commit();
    } catch (logErr) {
      console.warn("[Training Trainer Availability] Post-send metadata/log failed:", logErr);
      return { success: true, warning: "Email envoyé, mais la journalisation post-envoi a échoué." };
    }

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingSession.trainerAvailabilityRequested",
        resourceType: "trainingSession",
        resourceId: sessionId,
        details: {
          sessionId,
          recipient: trustedRecipientEmail,
          requestedFor,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Trainer Availability] Non-blocking audit failure:", auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Training Trainer Availability] Send failed:", err);
    return { success: false, error: err.message || "Envoi impossible." };
  }
}

export async function recordTrainingTrainerAvailabilityResponseAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
  response: "available" | "unavailable";
  responseNote?: string | null;
}): Promise<TrainingSessionLifecycleResult> {
  try {
    const { entityId, sessionId, idToken, response, responseNote } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    if (!["available", "unavailable"].includes(response)) {
      throw new Error("Réponse du formateur invalide.");
    }

    const { actorUid } = await authorizeTrainingSessionLifecycleUpdate(entityId, idToken);
    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("Session de formation introuvable.");

    const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
    if (session.entityId !== entityId || session.trainerType !== "external") {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }
    if (session.status !== "draft") {
      throw new Error("La session doit rester en brouillon pour enregistrer la réponse du formateur.");
    }
    if (session.trainerAvailabilityStatus !== "awaiting_response") {
      throw new Error("Une demande de disponibilité doit d'abord être envoyée.");
    }

    const trimmedNote = typeof responseNote === "string" ? responseNote.trim() : "";
    await sessionRef.update({
      trainerAvailabilityStatus: response,
      trainerAvailabilityResponseAt: FieldValue.serverTimestamp(),
      trainerAvailabilityResponseBy: actorUid,
      trainerAvailabilityResponseNote: trimmedNote ? trimmedNote : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingSession.trainerAvailabilityResponded",
        resourceType: "trainingSession",
        resourceId: sessionId,
        details: {
          sessionId,
          response,
          hasNote: !!trimmedNote,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Trainer Availability] Non-blocking audit failure:", auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Training Trainer Availability] Response failed:", err);
    return { success: false, error: err.message || "Réponse impossible à enregistrer." };
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function authorizeTrainingTrainerEmail(entityId: string, idToken: string) {
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
  if (!permissions.includes(TRAINING_TRAINER_EMAIL_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, entity: entitySnap.data() || {} };
}

async function authorizeTrainingParticipantResultUpdate(entityId: string, idToken: string) {
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
  if (!permissions.includes(TRAINING_RESULT_UPDATE_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, permissions, user: userSnap.data() || {} };
}

async function authorizeTrainingParticipantCertificateWrite(entityId: string, idToken: string) {
  const authContext = await authorizeTrainingParticipantResultUpdate(entityId, idToken);
  if (!authContext.permissions.includes(TRAINING_CERTIFICATE_UPDATE_PERMISSION) || !authContext.permissions.includes(DOCUMENT_UPLOAD_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  return authContext;
}

async function authorizeTrainingParticipantCertificateRead(entityId: string, idToken: string) {
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
  if (!permissions.includes(TRAINING_CERTIFICATE_READ_PERMISSION) || !permissions.includes(DOCUMENT_READ_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, permissions };
}

async function authorizeTrainingSessionLifecycleUpdate(entityId: string, idToken: string) {
  const authContext = await authorizeTrainingParticipantResultUpdate(entityId, idToken);
  if (!authContext.permissions.includes(TRAINING_LIFECYCLE_UPDATE_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  return authContext;
}

async function authorizeTrainingParticipantInvitation(entityId: string, idToken: string) {
  const authContext = await authorizeTrainingParticipantResultUpdate(entityId, idToken);
  if (!authContext.permissions.includes(TRAINING_PARTICIPANT_INVITATION_PERMISSION)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  return authContext;
}

function assertAllowedTrainingLifecycleTransition(
  session: TrainingSession,
  targetStatus: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed">
) {
  if (targetStatus === "scheduled") {
    if (session.approvalStatus !== "approved" || session.status !== "draft") {
      throw new Error("Seule une session approuvée en brouillon peut être planifiée.");
    }
    assertSessionReadyForScheduling(session);
    if (session.trainerType === "external") {
      if (session.trainerAvailabilityStatus !== "available") {
        throw new Error("Le formateur externe doit être disponible avant la planification.");
      }
      if (!isTrainingAvailabilityScheduleSnapshotCurrent(session)) {
        throw new Error("Les informations de la session ont changé. Une nouvelle confirmation du formateur est nécessaire.");
      }
    }
    return;
  }

  if (targetStatus === "in_progress") {
    if (session.status !== "scheduled") {
      throw new Error("Seule une session planifiée peut être démarrée.");
    }
    return;
  }

  if (targetStatus === "completed") {
    if (session.status !== "in_progress") {
      throw new Error("Seule une session en cours peut être terminée.");
    }
    return;
  }

  throw new Error("Transition de session non autorisée.");
}

function assertSessionReadyForScheduling(session: TrainingSession) {
  const missing: string[] = [];
  if (!session.startDate) missing.push("date");
  if (!session.startTime || !session.endTime) missing.push("horaire");
  if (!session.location?.trim()) missing.push("lieu");
  if (session.trainerType === "external") {
    if (!session.trainerName?.trim()) missing.push("nom du formateur");
    if (!session.trainerEmail?.trim()) missing.push("email du formateur");
  } else if (!session.internalTrainerEmployeeId?.trim()) {
    missing.push("formateur interne");
  }

  if (missing.length > 0) {
    throw new Error(`Planification incomplète : ${missing.join(", ")}.`);
  }

  const startMinutes = parseTrainingTimeToMinutes(session.startTime || "");
  const endMinutes = parseTrainingTimeToMinutes(session.endTime || "");
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
    throw new Error("L'horaire de fin doit être postérieur à l'horaire de début.");
  }
}

function parseTrainingTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function assertValidTrainingParticipantStatus(status: unknown): asserts status is TrainingParticipantStatus {
  if (!TRAINING_PARTICIPANT_STATUSES.includes(status as TrainingParticipantStatus)) {
    throw new Error("Statut participant de formation invalide.");
  }
}

function assertValidTrainingResultStatus(status: unknown): asserts status is TrainingResultStatus | null | undefined {
  if (status != null && !TRAINING_RESULT_STATUSES.includes(status as TrainingResultStatus)) {
    throw new Error("Résultat de formation invalide.");
  }
}

function normalizeParticipantResult(
  participantStatus: TrainingParticipantStatus,
  resultStatus?: TrainingResultStatus | null
): TrainingResultStatus | null {
  if (participantStatus === "absent") return "not_attended";
  if (participantStatus === "cancelled") return "not_required";

  const value = resultStatus || null;
  assertValidTrainingResultStatus(value);

  if (participantStatus === "planned") {
    if (value) throw new Error("Aucun résultat ne peut être saisi pour une participation planifiée.");
    return null;
  }

  if (participantStatus === "attended") {
    if (value && !["attended", "passed", "failed", "not_required"].includes(value)) {
      throw new Error("Résultat incompatible avec une participation présente.");
    }
    return value;
  }

  if (participantStatus === "completed") {
    if (!value || !["passed", "failed", "attended", "not_required"].includes(value)) {
      throw new Error("Résultat requis pour une participation terminée.");
    }
    return value;
  }

  if (participantStatus === "not_completed") {
    if (!value || !["failed", "not_required"].includes(value)) {
      throw new Error("Résultat incompatible avec une participation non terminée.");
    }
    return value;
  }

  return value;
}

async function loadTrustedTrainingTrainerEmailContext(entityId: string, sessionId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  if (!sessionId) throw new Error("Session de formation requise.");

  const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error("Session de formation introuvable.");
  }

  const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
  if (session.entityId && session.entityId !== entityId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  if (session.trainerType !== "external") {
    throw new Error("Cette action est réservée aux formateurs externes.");
  }

  if (!session.trainerName?.trim()) {
    throw new Error("Nom du formateur externe requis.");
  }

  const trustedRecipientEmail = normalizeEmail(session.trainerEmail);
  if (!trustedRecipientEmail || !isValidEmail(trustedRecipientEmail)) {
    throw new Error("Email du formateur externe invalide ou manquant.");
  }

  if (session.approvalStatus !== "approved") {
    throw new Error("La session doit être approuvée avant l'envoi au formateur.");
  }

  if (session.status !== "scheduled") {
    throw new Error("La session doit être planifiée avant l'envoi au formateur.");
  }

  const participantsSnap = await sessionRef.collection("participants").get();
  const participants = participantsSnap.docs
    .map((participantDoc) => ({ ...(participantDoc.data() as TrainingParticipant), id: participantDoc.id }))
    .filter((participant) => (
      participant.entityId === entityId
      && participant.sessionId === sessionId
      && participant.participantStatus !== "cancelled"
    ));

  return { sessionRef, session, participants, trustedRecipientEmail };
}

async function loadTrustedTrainingTrainerAvailabilityContext(entityId: string, sessionId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  if (!sessionId) throw new Error("Session de formation requise.");

  const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error("Session de formation introuvable.");
  }

  const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
  if (session.entityId !== entityId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  if (session.trainerType !== "external") {
    throw new Error("Cette action est réservée aux formateurs externes.");
  }

  if (session.approvalStatus !== "approved") {
    throw new Error("La session doit être approuvée avant de contacter le formateur.");
  }

  if (session.status !== "draft") {
    throw new Error("La demande de disponibilité est disponible uniquement avant planification.");
  }

  assertSessionReadyForScheduling(session);

  const trustedRecipientEmail = normalizeEmail(session.trainerEmail);
  if (!trustedRecipientEmail || !isValidEmail(trustedRecipientEmail)) {
    throw new Error("Email du formateur externe invalide ou manquant.");
  }

  return {
    sessionRef,
    session,
    trustedRecipientEmail,
    requestedFor: buildTrainingAvailabilityScheduleSnapshot(session),
  };
}

function buildTrainingAvailabilityScheduleSnapshot(session: TrainingSession): TrainingTrainerAvailabilityScheduleSnapshot {
  return {
    trainerEmail: normalizeEmail(session.trainerEmail),
    startDate: session.startDate || null,
    endDate: session.endDate || null,
    startTime: session.startTime || null,
    endTime: session.endTime || null,
    location: session.location || null,
  };
}

function isTrainingAvailabilityScheduleSnapshotCurrent(session: TrainingSession) {
  const requestedFor = session.trainerAvailabilityRequestedFor;
  if (!requestedFor) return false;
  const current = buildTrainingAvailabilityScheduleSnapshot(session);
  return (
    normalizeEmail(requestedFor.trainerEmail) === current.trainerEmail
    && (requestedFor.startDate || null) === current.startDate
    && (requestedFor.endDate || null) === current.endDate
    && (requestedFor.startTime || null) === current.startTime
    && (requestedFor.endTime || null) === current.endTime
    && (requestedFor.location || null) === current.location
  );
}

function serializeDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  if (value._seconds) return new Date(value._seconds * 1000).toISOString();
  return null;
}

async function loadTrainingParticipantInvitationContext(entityId: string, sessionId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  if (!entityId || !sessionId) throw new Error(SAFE_FORBIDDEN_MESSAGE);

  const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
  const [sessionSnap, participantsSnap] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection("participants").get(),
  ]);

  if (!sessionSnap.exists) throw new Error("Session de formation introuvable.");
  const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
  if (session.entityId !== entityId || session.id !== sessionId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (session.status !== "scheduled") throw new Error("Les participants peuvent être notifiés uniquement pour une session planifiée.");

  const participants = participantsSnap.docs
    .map((docSnap) => ({ ...(docSnap.data() as TrainingParticipant), id: docSnap.id }))
    .filter((participant) => participant.participantStatus !== "cancelled");

  for (const participant of participants) {
    if (
      participant.entityId !== entityId
      || participant.sessionId !== sessionId
      || participant.employeeId !== participant.id
    ) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }
  }

  if (participants.length === 0) {
    throw new Error("Aucun participant à notifier.");
  }

  const employeeSnaps = await Promise.all(
    participants.map((participant) => (
      adminDb.collection("entities").doc(entityId).collection("employees").doc(participant.employeeId).get()
    ))
  );
  const employeesById = new Map<string, Record<string, any>>();
  employeeSnaps.forEach((employeeSnap) => {
    if (!employeeSnap.exists) return;
    const employee = employeeSnap.data() || {};
    if (employee.entityId === entityId) {
      employeesById.set(employeeSnap.id, { ...employee, employeeId: employeeSnap.id });
    }
  });

  return { sessionRef, session, participants, employeesById };
}

async function resolveTrainingParticipantInvitationRow(params: {
  entityId: string;
  session: TrainingSession;
  participant: TrainingParticipant;
  employee?: Record<string, any> | null;
}) {
  const { entityId, session, participant, employee } = params;
  const employeeId = participant.employeeId;
  const userId = String(employee?.userId || "").trim();
  const accountStatus = String(employee?.accountStatus || "").trim();
  const employeeEmail = normalizeEmail(employee?.email);
  const hasValidEmail = isValidEmail(employeeEmail);
  let activeAccountUid: string | null = null;

  if (userId && accountStatus !== "disabled") {
    const [userSnap, membershipSnap] = await Promise.all([
      adminDb.collection("users").doc(userId).get(),
      adminDb.collection("memberships").doc(`${userId}_${entityId}`).get(),
    ]);
    const userData = userSnap.data() || {};
    const membership = membershipSnap.data() || {};
    if (userSnap.exists && userData.status === "active" && membershipSnap.exists && membership.status === "active") {
      activeAccountUid = userId;
    }
  }

  const employeeName = participant.employeeDisplayNameSnapshot || getEmployeeDisplayNameFromData(employeeId, employee);
  const employeeCode = participant.employeeCodeSnapshot || String(employee?.employeeCode || "");
  const plannedChannel = activeAccountUid
    ? hasValidEmail ? "In-app + e-mail" : "Notification in-app"
    : hasValidEmail ? "E-mail uniquement" : "Contact manuel requis";

  return {
    employeeId,
    employeeName,
    employeeCode,
    email: hasValidEmail ? employeeEmail : null,
    activeAccountUid,
    dedupKey: buildTrainingParticipantInvitationDedupKey(entityId, session.id, employeeId, session),
    preview: {
      employeeId,
      employeeName,
      employeeCode,
      accountLabel: activeAccountUid ? "Compte actif" : "Aucun compte actif",
      emailLabel: hasValidEmail ? employeeEmail : "—",
      plannedChannel,
    },
  };
}

async function resolveTrainingParticipantInvitationRows(params: {
  entityId: string;
  session: TrainingSession;
  participants: TrainingParticipant[];
  employeesById: Map<string, Record<string, any>>;
}) {
  const { entityId, session, participants, employeesById } = params;
  return Promise.all(participants.map((participant) => (
    resolveTrainingParticipantInvitationRow({
      entityId,
      session,
      participant,
      employee: employeesById.get(participant.employeeId),
    })
  )));
}

function sanitizeFileName(name: string) {
  return (name || "attestation").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
}

async function extractCertificateFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("Fichier d'attestation requis.");
  }

  if (!ALLOWED_CERTIFICATE_MIME_TYPES.includes(file.type)) {
    throw new Error("Format de fichier non supporté. Veuillez utiliser PDF, PNG ou JPEG.");
  }

  if (file.size > MAX_CERTIFICATE_FILE_SIZE) {
    throw new Error("La taille max est de 10 Mo.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_CERTIFICATE_FILE_SIZE) {
    throw new Error("La taille max est de 10 Mo.");
  }

  return {
    file,
    buffer,
    safeFileName: sanitizeFileName(file.name),
  };
}

async function loadTrainingParticipantCertificateContext(entityId: string, sessionId: string, employeeId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  if (!sessionId || !employeeId) throw new Error("Participant de formation requis.");

  const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
  const participantRef = sessionRef.collection("participants").doc(employeeId);
  const [sessionSnap, participantSnap] = await Promise.all([
    sessionRef.get(),
    participantRef.get(),
  ]);

  if (!sessionSnap.exists) throw new Error("Session de formation introuvable.");
  if (!participantSnap.exists) throw new Error("Participant de formation introuvable.");

  const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
  const participant = { ...(participantSnap.data() as TrainingParticipant), id: participantSnap.id };

  if (
    session.entityId !== entityId
    || participant.entityId !== entityId
    || participant.sessionId !== sessionId
    || participant.employeeId !== employeeId
    || participant.id !== employeeId
  ) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { sessionRef, participantRef, session, participant };
}

async function loadVerifiedParticipantCertificateDocument(entityId: string, participant: TrainingParticipant, documentId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  if (!documentId || participant.certificateDocumentId !== documentId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const documentRef = adminDb.collection("entities").doc(entityId).collection("documents").doc(documentId);
  const documentSnap = await documentRef.get();
  if (!documentSnap.exists) throw new Error("Document d'attestation introuvable.");

  const documentData = documentSnap.data() || {};
  if (
    documentData.entityId !== entityId
    || documentData.documentType !== "training_certificate"
    || documentData.relatedModule !== "trainings"
    || !documentData.storagePath
  ) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { documentRef, documentData };
}

async function buildParticipantCertificateSignedUrl(params: {
  entityId: string;
  sessionId: string;
  employeeId: string;
  documentId: string;
  idToken: string;
  disposition: "inline" | "attachment";
}): Promise<TrainingParticipantCertificateUrlResult> {
  try {
    const { entityId, sessionId, employeeId, documentId, idToken, disposition } = params;
    if (!adminBucket) throw new Error("Service de stockage indisponible.");
    await authorizeTrainingParticipantCertificateRead(entityId, idToken);
    const { participant } = await loadTrainingParticipantCertificateContext(entityId, sessionId, employeeId);
    const { documentData } = await loadVerifiedParticipantCertificateDocument(entityId, participant, documentId);

    const file = adminBucket.file(documentData.storagePath);
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 10 * 60 * 1000,
      responseDisposition: `${disposition}; filename="${documentData.fileName || "attestation"}"`,
    });

    return { success: true, url };
  } catch (err: any) {
    console.error("[Training Participant Certificate] URL failed:", err);
    return { success: false, error: err.message || "Document indisponible." };
  }
}

export async function getTrainingTrainerEmailPreviewAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
}): Promise<TrainingTrainerEmailPreview> {
  try {
    const { entityId, sessionId, idToken } = params;
    const { entity } = await authorizeTrainingTrainerEmail(entityId, idToken);
    const { session, participants, trustedRecipientEmail } = await loadTrustedTrainingTrainerEmailContext(entityId, sessionId);
    const rendered = await buildTrainingTrainerEmailContent({ session, participants, entity });

    return {
      success: true,
      to: trustedRecipientEmail,
      subject: rendered.subject,
      body: rendered.text,
      participantCount: participants.length,
      lastSentAt: serializeDate(session.trainerEmailSentAt),
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Prévisualisation impossible." };
  }
}

export async function getTrainingParticipantInvitationsPreviewAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
}): Promise<TrainingParticipantInvitationPreviewResult> {
  try {
    const { entityId, sessionId, idToken } = params;
    await authorizeTrainingParticipantInvitation(entityId, idToken);
    const { session, participants, employeesById } = await loadTrainingParticipantInvitationContext(entityId, sessionId);
    const rows = await resolveTrainingParticipantInvitationRows({ entityId, session, participants, employeesById });

    return {
      success: true,
      sessionId,
      rows: rows.map((row) => row.preview),
    };
  } catch (err: any) {
    console.error("[Training Participant Invitation] Preview failed:", err);
    return { success: false, error: err.message || "Prévisualisation impossible." };
  }
}

export async function sendTrainingParticipantInvitationsAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
}): Promise<TrainingParticipantInvitationSendResult> {
  try {
    const { entityId, sessionId, idToken } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    const { actorUid } = await authorizeTrainingParticipantInvitation(entityId, idToken);
    const entitySnap = await adminDb.collection("entities").doc(entityId).get();
    const entity = entitySnap.data() || {};
    const { session, participants, employeesById } = await loadTrainingParticipantInvitationContext(entityId, sessionId);
    const rows = await resolveTrainingParticipantInvitationRows({ entityId, session, participants, employeesById });
    const actionUrl = getTrainingParticipantInvitationActionUrl(entityId);
    const deliveryRows: TrainingParticipantInvitationDeliveryRow[] = [];

    for (const row of rows) {
      const participant = participants.find((item) => item.employeeId === row.employeeId);
      if (!participant) continue;

      let inApp: TrainingParticipantInvitationChannelStatus = row.activeAccountUid ? "sent" : "not_applicable";
      let email: TrainingParticipantInvitationChannelStatus = row.email ? "sent" : "absent";
      let error: string | null = null;

      if (row.activeAccountUid) {
        const notificationId = buildDeterministicId(`${row.dedupKey}|in_app|${row.activeAccountUid}`);
        const notificationRef = adminDb.collection("entities").doc(entityId).collection("notifications").doc(notificationId);
        const notificationSnap = await notificationRef.get();
        if (notificationSnap.exists) {
          inApp = "already_sent";
        } else {
          await notificationRef.set({
            id: notificationId,
            entityId,
            targetUid: row.activeAccountUid,
            targetPermission: null,
            audience: "employee",
            category: "training",
            title: "Nouvelle formation planifiée",
            message: `Vous êtes inscrit(e) à la formation « ${session.title} ».`,
            severity: "info",
            sourceModule: "training",
            sourceId: sessionId,
            actionUrl,
            status: "unread",
            dedupKey: row.dedupKey,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actorUid,
          });
        }
      }

      if (row.email) {
        const emailLogId = buildDeterministicId(`${row.dedupKey}|email|${row.email}`);
        const emailLogRef = adminDb.collection("entities").doc(entityId).collection("emailLogs").doc(emailLogId);
        const claimResult = await adminDb.runTransaction(async (transaction) => {
          const snap = await transaction.get(emailLogRef);
          const data = snap.data() || {};
          if (snap.exists && (data.status === "sent" || data.status === "sending")) {
            return data.status as "sent" | "sending";
          }
          transaction.set(emailLogRef, {
            logId: emailLogId,
            entityId,
            module: "training",
            type: "participant_invitation",
            sessionId,
            employeeId: row.employeeId,
            to: row.email,
            status: "sending",
            dedupKey: row.dedupKey,
            attemptCount: FieldValue.increment(1),
            createdAt: data.createdAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: data.createdBy || actorUid,
            updatedBy: actorUid,
          }, { merge: true });
          return "claimed" as const;
        });

        if (claimResult === "sent" || claimResult === "sending") {
          email = "already_sent";
        } else {
          try {
            const sendResult = await sendTrainingParticipantInvitationEmail({
              entityId,
              to: row.email,
              session,
              participant,
              entity,
              actionUrl,
            });
            await emailLogRef.set({
              subject: sendResult.subject,
              body: sendResult.body,
              status: "sent",
              messageId: sendResult.messageId,
              from: sendResult.from,
              sentAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actorUid,
            }, { merge: true });
            email = "sent";
          } catch (emailErr: any) {
            error = emailErr.message || "Email impossible à envoyer.";
            await emailLogRef.set({
              status: "failed",
              error,
              failedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actorUid,
            }, { merge: true });
            email = "failed";
          }
        }
      }

      const finalResult: TrainingParticipantInvitationFinalStatus =
        inApp === "not_applicable" && email === "absent" ? "manual_required"
        : inApp === "not_applicable" && (email === "sent" || email === "already_sent") ? "email_only"
        : email === "failed" ? "partial_failure"
        : inApp === "already_sent" && (email === "already_sent" || email === "absent") ? "already_sent"
        : "invitation_sent";

      deliveryRows.push({
        ...row.preview,
        inApp,
        email,
        finalResult,
        error,
      });
    }

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingSession.participantsInvited",
        resourceType: "trainingSession",
        resourceId: sessionId,
        details: {
          sessionId,
          participantCount: deliveryRows.length,
          manualRequiredCount: deliveryRows.filter((row) => row.finalResult === "manual_required").length,
          emailFailedCount: deliveryRows.filter((row) => row.email === "failed").length,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Participant Invitation] Non-blocking audit failure:", auditErr);
    }

    return {
      success: true,
      sessionId,
      rows: deliveryRows,
      warning: deliveryRows.some((row) => row.email === "failed")
        ? "Certaines convocations par e-mail ont échoué et restent réessayables."
        : undefined,
    };
  } catch (err: any) {
    console.error("[Training Participant Invitation] Send failed:", err);
    return { success: false, error: err.message || "Notification impossible." };
  }
}

export async function sendTrainingTrainerEmailAction(params: {
  entityId: string;
  sessionId: string;
  idToken: string;
  subjectOverride?: string;
  bodyOverride?: string;
}): Promise<TrainingTrainerEmailSendResult> {
  try {
    const { entityId, sessionId, idToken, subjectOverride, bodyOverride } = params;
    const { actorUid, entity } = await authorizeTrainingTrainerEmail(entityId, idToken);
    const { sessionRef, session, participants, trustedRecipientEmail } = await loadTrustedTrainingTrainerEmailContext(entityId, sessionId);

    const sendResult = await sendTrainingTrainerEmail({
      entityId,
      to: trustedRecipientEmail,
      session,
      participants,
      entity,
      subjectOverride,
      bodyOverride,
    });

    try {
      const logRef = adminDb.collection("entities").doc(entityId).collection("emailLogs").doc();
      const batch = adminDb.batch();
      batch.update(sessionRef, {
        trainerEmailSentAt: FieldValue.serverTimestamp(),
        trainerEmailSentBy: actorUid,
        trainerEmailLastRecipient: trustedRecipientEmail,
        trainerEmailSendCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      batch.set(logRef, {
        logId: logRef.id,
        entityId,
        module: "training",
        type: "trainer_notification",
        sessionId,
        to: trustedRecipientEmail,
        subject: sendResult.subject,
        body: sendResult.body,
        status: "sent",
        messageId: sendResult.messageId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });
      await batch.commit();
    } catch (logErr) {
      console.warn("[Training Trainer Email] Post-send metadata/log failed:", logErr);
      return { success: true, warning: "Email envoyé, mais la journalisation post-envoi a échoué." };
    }

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingSession.trainerEmailSent",
        resourceType: "trainingSession",
        resourceId: sessionId,
        details: {
          sessionId,
          recipient: trustedRecipientEmail,
          participantCount: participants.length,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Trainer Email] Non-blocking audit failure:", auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Training Trainer Email] Send failed:", err);
    return { success: false, error: err.message || "Envoi impossible." };
  }
}

export async function updateTrainingParticipantResultAction(params: {
  entityId: string;
  sessionId: string;
  employeeId: string;
  idToken: string;
  participantStatus: TrainingParticipantStatus;
  resultStatus?: TrainingResultStatus | null;
  resultNotes?: string | null;
}): Promise<TrainingParticipantResultUpdateResult> {
  try {
    const { entityId, sessionId, employeeId, idToken, participantStatus, resultStatus, resultNotes } = params;
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    if (!sessionId || !employeeId) throw new Error("Participant de formation requis.");

    assertValidTrainingParticipantStatus(participantStatus);
    assertValidTrainingResultStatus(resultStatus);
    const normalizedResultStatus = normalizeParticipantResult(participantStatus, resultStatus);
    const { actorUid } = await authorizeTrainingParticipantResultUpdate(entityId, idToken);

    const sessionRef = adminDb.collection("entities").doc(entityId).collection("trainingSessions").doc(sessionId);
    const participantRef = sessionRef.collection("participants").doc(employeeId);
    const [sessionSnap, participantSnap] = await Promise.all([
      sessionRef.get(),
      participantRef.get(),
    ]);

    if (!sessionSnap.exists) {
      throw new Error("Session de formation introuvable.");
    }

    const session = { ...(sessionSnap.data() as TrainingSession), id: sessionSnap.id };
    if (session.entityId && session.entityId !== entityId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    if (!["scheduled", "in_progress", "completed"].includes(session.status)) {
      throw new Error("Les résultats ne peuvent être saisis que pour une session planifiée, en cours ou terminée.");
    }
    assertTrainingSessionEndedForResults(session);

    if (!participantSnap.exists) {
      throw new Error("Participant de formation introuvable.");
    }

    const participant = { ...(participantSnap.data() as TrainingParticipant), id: participantSnap.id };
    if (
      participant.entityId !== entityId
      || participant.sessionId !== sessionId
      || participant.employeeId !== employeeId
      || participant.id !== employeeId
    ) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    const trimmedNotes = typeof resultNotes === "string" ? resultNotes.trim() : "";
    const wasValidityEligible = isParticipantValidityEligible(participant.participantStatus, participant.resultStatus);
    const isValidityEligible = isParticipantValidityEligible(participantStatus, normalizedResultStatus);
    const completionTimestamp = participantStatus === "completed" && participant.participantStatus !== "completed"
      ? Timestamp.now()
      : participant.completedAt ?? null;
    const payload: Record<string, unknown> = {
      participantStatus,
      resultStatus: normalizedResultStatus,
      resultNotes: trimmedNotes ? trimmedNotes : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    };

    if (participantStatus === "completed") {
      if (participant.participantStatus !== "completed") {
        payload.completedAt = completionTimestamp;
        payload.completedBy = actorUid;
      }
      payload.cancelledAt = FieldValue.delete();
      payload.cancelledBy = FieldValue.delete();
      payload.cancellationReason = FieldValue.delete();
    } else {
      payload.completedAt = FieldValue.delete();
      payload.completedBy = FieldValue.delete();
    }

    if (participantStatus === "cancelled") {
      if (participant.participantStatus !== "cancelled") {
        payload.cancelledAt = FieldValue.serverTimestamp();
        payload.cancelledBy = actorUid;
      }
      payload.completedAt = FieldValue.delete();
      payload.completedBy = FieldValue.delete();
      payload.cancellationReason = trimmedNotes ? trimmedNotes : FieldValue.delete();
    } else {
      payload.cancelledAt = FieldValue.delete();
      payload.cancelledBy = FieldValue.delete();
      payload.cancellationReason = FieldValue.delete();
    }

    const validityDerivation = isValidityEligible && !wasValidityEligible
      ? deriveTrainingParticipantValidity({
          participantStatus,
          resultStatus: normalizedResultStatus,
          completionTimestamp,
          sessionPolicy: session,
        })
      : !isValidityEligible
        ? clearTrainingParticipantValidityFields()
        : { values: {}, fieldsToDelete: [] };

    Object.entries(validityDerivation.values).forEach(([field, value]) => {
      payload[field] = value;
    });
    validityDerivation.fieldsToDelete.forEach((field) => {
      payload[field] = FieldValue.delete();
    });

    await participantRef.update(payload);

    try {
      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "trainingParticipant.resultUpdated",
        resourceType: "trainingParticipant",
        resourceId: `${sessionId}/${employeeId}`,
        details: {
          sessionId,
          employeeId,
          participantStatus,
          resultStatus: normalizedResultStatus,
        },
      });
    } catch (auditErr) {
      console.warn("[Training Participant Result] Non-blocking audit failure:", auditErr);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Training Participant Result] Update failed:", err);
    return { success: false, error: err.message || "Mise à jour du résultat impossible." };
  }
}
