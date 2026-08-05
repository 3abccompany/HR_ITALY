"use server";

import crypto from "crypto";
import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createTrustedAuditLog } from "@/services/audit.server";
import {
  sendMedicalEmployeeVisitInvitationEmail,
  sendMedicalProviderAvailabilityRequestEmail,
} from "@/services/email.service";
import { MEDICAL_VISIT_TYPE_LABELS } from "@/types/medical-visit";
import type {
  MedicalFitnessStatus,
  MedicalVisitProviderType,
  MedicalVisitRequestStatus,
  MedicalVisitRequestUrgency,
  MedicalVisitStatus,
  MedicalVisitType,
} from "@/types/medical-visit";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const MEDICAL_CREATE_PERMISSION = "medicalVisits.create";
const MEDICAL_UPDATE_PERMISSION = "medicalVisits.update";
const MEDICAL_READ_PERMISSION = "medicalVisits.read";
const DOCUMENT_UPLOAD_PERMISSION = "documents.upload";
const DOCUMENT_READ_PERMISSION = "documents.read";
const MAX_CERTIFICATE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_CERTIFICATE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MATERIALIZATION_PARTICIPANT_LIMIT = 240;

const MEDICAL_VISIT_TYPES: MedicalVisitType[] = [
  "preventive",
  "pre_employment_preventive",
  "periodic",
  "job_change",
  "worker_request",
  "return_after_long_absence",
  "extraordinary",
  "other",
];

const MEDICAL_FITNESS_STATUSES: MedicalFitnessStatus[] = [
  "fit",
  "fit_with_prescriptions",
  "temporarily_unfit",
  "unfit",
  "pending_result",
];

const MEDICAL_VISIT_STATUSES: MedicalVisitStatus[] = [
  "scheduled",
  "completed",
  "pending_result",
  "cancelled",
  "archived",
];

const MEDICAL_VISIT_REQUEST_STATUSES: MedicalVisitRequestStatus[] = [
  "draft",
  "provider_request_sent",
  "awaiting_provider_response",
  "slots_received",
  "assignments_ready",
  "employees_planned",
  "completed",
  "cancelled",
];

const MEDICAL_VISIT_PROVIDER_TYPES: MedicalVisitProviderType[] = ["doctor", "medical_center"];
const MEDICAL_VISIT_REQUEST_URGENCIES: MedicalVisitRequestUrgency[] = ["normal", "urgent", "critical"];

const SCHEDULE_UPDATE_STATUSES: MedicalVisitStatus[] = [
  "scheduled",
  "pending_result",
  "cancelled",
];

const RESULT_UPDATE_STATUSES: MedicalVisitStatus[] = [
  "scheduled",
  "completed",
  "pending_result",
  "cancelled",
];

type MedicalVisitActionResult =
  | { success: true; visitId: string }
  | { success: false; error: string };

type MedicalVisitMutationResult =
  | { success: true }
  | { success: false; error: string };

type MedicalCertificateMutationResult =
  | { success: true; documentId: string }
  | { success: false; error: string };

type MedicalCertificateUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

type MedicalVisitRequestSummary = {
  id: string;
  entityId: string;
  visitType: MedicalVisitType;
  providerType: MedicalVisitProviderType;
  providerName: string;
  providerEmail: string;
  medicalCenter: string | null;
  desiredStartDate: string;
  desiredEndDate: string;
  urgency: MedicalVisitRequestUrgency;
  constraints: string | null;
  status: MedicalVisitRequestStatus;
  participantCount: number;
  createdAt: string | null;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string;
  providerRequestSentAt?: string | null;
  providerRequestSentBy?: string | null;
  providerRequestSentByName?: string | null;
  providerRequestSentByDisplayName?: string | null;
  providerRequestSentRecipient?: string | null;
  providerRequestSentSubject?: string | null;
  providerRequestSendCount?: number;
  providerResponseRecordedAt?: string | null;
  providerResponseRecordedBy?: string | null;
  providerResponseRecordedByName?: string | null;
  slotCount?: number;
  assignedParticipantCount?: number;
  unassignedParticipantCount?: number;
  individualVisitsCreatedAt?: string | null;
  individualVisitsCreatedBy?: string | null;
  individualVisitsCreatedByName?: string | null;
  individualVisitsCount?: number;
  employeeInvitationsLastSentAt?: string | null;
  employeeInvitationsLastSentBy?: string | null;
  employeeInvitationsLastSentByName?: string | null;
  employeeInvitationAttemptCount?: number;
  employeeNotificationSentCount?: number;
  employeeEmailSentCount?: number;
  employeeManualContactCount?: number;
  employeeInvitationEligibleCount?: number;
  employeeInvitationSkippedCount?: number;
  employeeInvitationFailureCount?: number;
};

type MedicalVisitRequestParticipantDto = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  personId: string | null;
  contractId: string | null;
  selectionStatus: string;
  assignedSlotId: string | null;
  assignedStartTime: string | null;
  assignedEndTime: string | null;
  appointmentDurationMinutes: number | null;
  appointmentSequence: number | null;
  resultingMedicalVisitId: string | null;
  resultingMedicalVisitStatus: "not_created" | "created" | "incoherent";
  notificationStatus: string;
  notificationSentAt: string | null;
  notificationRecipientUid: string | null;
  notificationId: string | null;
  emailStatus: string;
  emailSentAt: string | null;
  emailRecipient: string | null;
  emailLogId: string | null;
  invitationLastAttemptAt: string | null;
  invitationLastAttemptBy: string | null;
  invitationLastAttemptByName: string | null;
  invitationErrorCode: string | null;
  invitationSendCount: number;
  createdAt: string | null;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string;
};

type MedicalVisitProviderSlotDto = {
  id: string;
  slotId: string;
  entityId: string;
  requestId: string;
  date: string;
  startTime: string;
  endTime: string | null;
  location: string;
  capacity: number | null;
  instructions: string | null;
  createdAt: string | null;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string;
};

type MedicalVisitRequestSaveResult =
  | { success: true; requestId: string }
  | { success: false; error: string };

type MedicalVisitRequestListResult =
  | { success: true; requests: MedicalVisitRequestSummary[] }
  | { success: false; error: string };

type MedicalVisitRequestDetailsResult =
  | { success: true; request: MedicalVisitRequestSummary; participants: MedicalVisitRequestParticipantDto[]; slots: MedicalVisitProviderSlotDto[] }
  | { success: false; error: string };

type MedicalProviderEmailPreviewResult =
  | { success: true; preview: { recipient: string; subject: string; message: string; summary: string[] } }
  | { success: false; error: string };

type MedicalProviderEmailSendResult =
  | { success: true; requestId: string; sendCount: number; alreadySent?: boolean }
  | { success: false; error: string };

type MedicalProviderSlotInput = {
  slotId?: string | null;
  date: string;
  startTime: string;
  endTime?: string | null;
  location: string;
  capacity?: number | null;
  instructions?: string | null;
};

type MedicalProviderSlotMutationResult =
  | { success: true; requestId: string }
  | { success: false; error: string };

type MedicalProviderSlotDeleteResult =
  | { success: true; requestId: string }
  | { success: false; error: string };

type MedicalParticipantSlotAssignmentInput = {
  employeeId: string;
  slotId: string | null;
  appointmentStartTime: string | null;
  appointmentEndTime: string | null;
};

type MedicalParticipantSlotAssignmentResult =
  | { success: true; requestId: string; status: MedicalVisitRequestStatus }
  | { success: false; error: string };

type MedicalVisitMaterializationResult =
  | {
      success: true;
      requestId: string;
      visitIds: string[];
      createdCount: number;
      existingCount: number;
      materializedAt: string;
      materializedByName: string;
    }
  | { success: false; error: string };

type MedicalEmployeeInvitationClassification =
  | "notification_and_email"
  | "notification_only"
  | "email_only"
  | "manual_contact_required";

type MedicalEmployeeInvitationChannelStatus =
  | "planned"
  | "sent"
  | "already_sent"
  | "failed"
  | "skipped"
  | "not_applicable";

type MedicalEmployeeInvitationEligibilityStatus =
  | "eligible"
  | "skipped_visit_completed"
  | "skipped_visit_cancelled"
  | "skipped_visit_archived"
  | "skipped_visit_pending_result"
  | "skipped_visit_ineligible_status";

type MedicalEmployeeInvitationPreviewRow = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  medicalVisitId: string;
  visitDate: string;
  visitDateLabel: string;
  visitStartTime: string;
  visitEndTime: string;
  providerName: string;
  location: string;
  instructions: string | null;
  hasActiveAccount: boolean;
  hasValidEmail: boolean;
  emailRecipient: string | null;
  classification: MedicalEmployeeInvitationClassification;
  classificationLabel: string;
  eligibilityStatus: MedicalEmployeeInvitationEligibilityStatus;
  eligibilityLabel: string;
  eligible: boolean;
  notificationStatus: string;
  emailStatus: string;
  sampleMessage: string;
};

type MedicalEmployeeInvitationPreviewResult =
  | {
      success: true;
      requestId: string;
      rows: MedicalEmployeeInvitationPreviewRow[];
      summary: {
        notificationAndEmail: number;
        notificationOnly: number;
        emailOnly: number;
        manualContactRequired: number;
        eligibleCount: number;
        skippedCount: number;
      };
    }
  | { success: false; error: string };

type MedicalEmployeeInvitationSendResultRow = MedicalEmployeeInvitationPreviewRow & {
  notificationDeliveryStatus: MedicalEmployeeInvitationChannelStatus;
  emailDeliveryStatus: MedicalEmployeeInvitationChannelStatus;
  deliveryResultStatus: string;
  notificationId: string | null;
  emailLogId: string | null;
  error: string | null;
};

type MedicalEmployeeInvitationSendResult =
  | {
      success: true;
      requestId: string;
      rows: MedicalEmployeeInvitationSendResultRow[];
      summary: {
        processedCount: number;
        notificationSentCount: number;
        emailSentCount: number;
        manualContactCount: number;
        eligibleCount: number;
        skippedCount: number;
        failureCount: number;
      };
    }
  | { success: false; error: string };

type MedicalVisitRequestSaveInput = {
  idToken: string;
  entityId: string;
  requestId?: string | null;
  visitType: MedicalVisitType;
  providerType: MedicalVisitProviderType;
  providerName: string;
  providerEmail: string;
  medicalCenter?: string | null;
  desiredStartDate: string;
  desiredEndDate: string;
  urgency: MedicalVisitRequestUrgency;
  constraints?: string | null;
  employeeIds: string[];
};

type MedicalVisitCreateInput = {
  idToken: string;
  entityId: string;
  employeeId: string;
  visitType: MedicalVisitType;
  visitDate: string;
  doctorName: string;
  medicalCenter?: string | null;
  status?: MedicalVisitStatus;
};

type MedicalVisitScheduleInput = {
  idToken: string;
  entityId: string;
  visitId: string;
  visitType: MedicalVisitType;
  visitDate: string;
  doctorName: string;
  medicalCenter?: string | null;
  status: MedicalVisitStatus;
};

type MedicalVisitResultInput = {
  idToken: string;
  entityId: string;
  visitId: string;
  fitnessStatus: MedicalFitnessStatus;
  nextVisitDate?: string | null;
  status: MedicalVisitStatus;
  prescriptions?: string | null;
  restrictions?: string | null;
  notes?: string | null;
};

function isValidDateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function saveMedicalVisitRequestWithParticipantsAction(
  input: MedicalVisitRequestSaveInput
): Promise<MedicalVisitRequestSaveResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(input as Record<string, unknown>, [
      "idToken",
      "entityId",
      "requestId",
      "visitType",
      "providerType",
      "providerName",
      "providerEmail",
      "medicalCenter",
      "desiredStartDate",
      "desiredEndDate",
      "urgency",
      "constraints",
      "employeeIds",
    ]);

    const isEditing = !!input.requestId;
    const { actorUid } = await authorizeMedicalAction(
      input.entityId,
      input.idToken,
      isEditing ? MEDICAL_UPDATE_PERMISSION : MEDICAL_CREATE_PERMISSION
    );

    const visitType = assertAllowed(input.visitType, MEDICAL_VISIT_TYPES, "Type de visite");
    const providerType = assertAllowed(input.providerType, MEDICAL_VISIT_PROVIDER_TYPES, "Type de prestataire");
    const providerName = requireString(input.providerName, "Nom du prestataire", 180);
    const providerEmail = normalizeEmail(input.providerEmail);
    const medicalCenter = normalizeOptionalString(input.medicalCenter, 180);
    const desiredStartDate = requireDateOnly(input.desiredStartDate, "Début de période souhaitée");
    const desiredEndDate = requireDateOnly(input.desiredEndDate, "Fin de période souhaitée");
    if (desiredEndDate < desiredStartDate) throw new Error("La fin de période souhaitée doit être postérieure ou égale au début.");
    const urgency = assertAllowed(input.urgency, MEDICAL_VISIT_REQUEST_URGENCIES, "Urgence");
    const constraints = normalizeOptionalString(input.constraints, 2000);
    const employeeIds = normalizeUniqueEmployeeIds(input.employeeIds);
    if (employeeIds.length > 350) {
      throw new Error("Trop de collaborateurs sélectionnés pour une seule transaction. Réduisez la sélection.");
    }

    const entityRef = adminDb.collection("entities").doc(input.entityId);
    const requestRef = input.requestId
      ? entityRef.collection("medicalVisitRequests").doc(input.requestId)
      : entityRef.collection("medicalVisitRequests").doc();
    const requestId = requestRef.id;

    await adminDb.runTransaction(async (transaction) => {
      const requestSnapPromise = input.requestId ? transaction.get(requestRef) : Promise.resolve(null);
      const employeeRefs = employeeIds.map((employeeId) => entityRef.collection("employees").doc(employeeId));
      const employeeSnapsPromise = Promise.all(employeeRefs.map((ref) => transaction.get(ref)));
      const existingParticipantsPromise = input.requestId
        ? transaction.get(requestRef.collection("participants"))
        : Promise.resolve(null);

      const [requestSnap, employeeSnaps, existingParticipantsSnap] = await Promise.all([
        requestSnapPromise,
        employeeSnapsPromise,
        existingParticipantsPromise,
      ]);

      if (requestSnap) {
        if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
        const existingRequest = requestSnap.data() || {};
        if (existingRequest.entityId !== input.entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
        if (existingRequest.status !== "draft") throw new Error("Seules les demandes en brouillon peuvent être modifiées.");
      }

      const validatedEmployees = employeeSnaps.map((snap, index) => {
        const employeeId = employeeIds[index];
        if (!snap.exists) throw new Error("Collaborateur introuvable.");
        const employee = snap.data() || {};
        if (employee.entityId !== input.entityId || employee.employeeId !== employeeId || !isActiveEmployee(employee)) {
          throw new Error(SAFE_FORBIDDEN_MESSAGE);
        }
        return { employeeId, employee };
      });

      const existingParticipants = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      existingParticipantsSnap?.docs.forEach((docSnap) => existingParticipants.set(docSnap.id, docSnap));

      const now = FieldValue.serverTimestamp();
      transaction.set(requestRef, {
        id: requestId,
        entityId: input.entityId,
        visitType,
        providerType,
        providerName,
        providerEmail,
        medicalCenter,
        desiredStartDate,
        desiredEndDate,
        urgency,
        constraints,
        status: "draft",
        participantCount: employeeIds.length,
        ...(input.requestId ? {} : { createdAt: now, createdBy: actorUid }),
        updatedAt: now,
        updatedBy: actorUid,
      }, { merge: true });

      for (const { employeeId, employee } of validatedEmployees) {
        const participantRef = requestRef.collection("participants").doc(employeeId);
        if (existingParticipants.has(employeeId)) {
          transaction.update(participantRef, {
            selectionStatus: "selected",
            updatedAt: now,
            updatedBy: actorUid,
          });
          continue;
        }

        transaction.set(participantRef, {
          employeeId,
          employeeCodeSnapshot: employee.employeeCode || employeeId,
          employeeDisplayNameSnapshot: employee.displayName || `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employeeId,
          personId: employee.personId || null,
          contractId: employee.activeContractId || employee.contractId || null,
          selectionStatus: "selected",
          assignedSlotId: null,
          resultingMedicalVisitId: null,
          notificationStatus: "not_sent",
          emailStatus: "not_sent",
          createdAt: now,
          createdBy: actorUid,
          updatedAt: now,
          updatedBy: actorUid,
        });
      }

      for (const [employeeId, participantSnap] of existingParticipants) {
        if (!employeeIds.includes(employeeId)) {
          transaction.delete(participantSnap.ref);
        }
      }
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: input.entityId,
      action: isEditing ? "medicalVisitRequest.updated" : "medicalVisitRequest.created",
      resourceType: "medicalVisitRequest",
      resourceId: requestId,
      details: { requestId, participantCount: employeeIds.length },
    }).catch(() => undefined);

    return { success: true, requestId };
  } catch (error: any) {
    return { success: false, error: error?.message || "Demande de visites médicales impossible à enregistrer." };
  }
}

export async function getMedicalVisitRequestsAction(params: {
  idToken: string;
  entityId: string;
}): Promise<MedicalVisitRequestListResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId"]);
    await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_READ_PERMISSION);

    const snap = await adminDb.collection("entities").doc(params.entityId)
      .collection("medicalVisitRequests")
      .orderBy("createdAt", "desc")
      .get();

    const requests = snap.docs
      .map((docSnap) => serializeMedicalVisitRequest(docSnap.id, docSnap.data()))
      .filter((request) => request.entityId === params.entityId);
    const requestsWithSummaries = await enrichMedicalVisitRequestSlotSummaries(params.entityId, requests);

    return {
      success: true,
      requests: await enrichMedicalVisitRequestSenderNames(params.entityId, requestsWithSummaries),
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Demandes de visites médicales indisponibles." };
  }
}

export async function getMedicalVisitRequestDetailsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MedicalVisitRequestDetailsResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_READ_PERMISSION);

    const requestRef = adminDb.collection("entities").doc(params.entityId).collection("medicalVisitRequests").doc(params.requestId);
    const [requestSnap, participantsSnap, slotsSnap] = await Promise.all([
      requestRef.get(),
      requestRef.collection("participants").get(),
      requestRef.collection("slots").get(),
    ]);
    if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
    const request = serializeMedicalVisitRequest(requestSnap.id, requestSnap.data() || {});
    if (request.entityId !== params.entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);

    const [enrichedRequest] = await enrichMedicalVisitRequestSenderNames(params.entityId, [request]);

    const participants = participantsSnap.docs.map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data()));

    return {
      success: true,
      request: enrichedRequest,
      participants: await enrichMedicalVisitRequestParticipantVisitStatuses(params.entityId, params.requestId, participants),
      slots: slotsSnap.docs.map((docSnap) => serializeMedicalVisitProviderSlot(docSnap.id, docSnap.data())),
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Détail de demande indisponible." };
  }
}

export async function getMedicalProviderEmailPreviewAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MedicalProviderEmailPreviewResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const { request, participants, entity } = await loadVerifiedMedicalVisitRequestWithParticipants(params.entityId, params.requestId);
    assertRequestCanEmailProvider(request);

    const rendered = buildMedicalProviderEmailPreview(request, participants, entity);
    return { success: true, preview: rendered };
  } catch (error: any) {
    return { success: false, error: error?.message || "Prévisualisation de l'e-mail indisponible." };
  }
}

export async function sendMedicalProviderAvailabilityRequestAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
  subject: string;
  message: string;
}): Promise<MedicalProviderEmailSendResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId", "subject", "message"]);
    const { actorUid, user: actorUser } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const { requestRef, request, participants, entity } = await loadVerifiedMedicalVisitRequestWithParticipants(params.entityId, params.requestId);
    assertRequestCanEmailProvider(request);

    const trustedRecipient = normalizeEmail(request.providerEmail);
    const actorDisplayName = resolveTrustedUserDisplayName(actorUser);
    const subject = requireString(params.subject, "Objet", 180);
    const message = requireString(params.message, "Message", 8000);
    const currentSendCount = Number(request.providerRequestSendCount || 0);
    const nextSendCount = currentSendCount + 1;
    const deliveryKey = buildDeterministicId([
      "medical_provider_availability_request",
      params.entityId,
      params.requestId,
      String(nextSendCount),
      subject,
      message,
    ].join(":"));
    const emailLogRef = adminDb.collection("entities").doc(params.entityId).collection("emailLogs").doc(deliveryKey);
    const summary = buildMedicalProviderEmailPreview(request, participants, entity).summary;
    const logPayload = {
      id: deliveryKey,
      entityId: params.entityId,
      module: "medicalVisits",
      type: "provider_availability_request",
      requestId: params.requestId,
      recipient: trustedRecipient,
      subject,
      status: "sending",
      sentBy: actorUid,
      sentByName: actorDisplayName,
      providerName: request.providerName || null,
      providerType: request.providerType || null,
      participantCount: participants.length,
      summary,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    let alreadySent = false;
    await adminDb.runTransaction(async (transaction) => {
      const logSnap = await transaction.get(emailLogRef);
      if (logSnap.exists) {
        const status = logSnap.data()?.status;
        if (status === "sent") {
          alreadySent = true;
          return;
        }
        if (status === "sending") {
          throw new Error("Un envoi identique est déjà en cours.");
        }
      }
      transaction.set(emailLogRef, logPayload, { merge: true });
    });
    if (alreadySent) {
      return { success: true, requestId: params.requestId, sendCount: currentSendCount || nextSendCount, alreadySent: true };
    }

    try {
      const sendResult = await sendMedicalProviderAvailabilityRequestEmail({
        entityId: params.entityId,
        to: trustedRecipient,
        subject,
        body: message,
      });

      const now = FieldValue.serverTimestamp();
      await adminDb.runTransaction(async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
        const latestRequest = requestSnap.data() || {};
        if (latestRequest.entityId !== params.entityId || latestRequest.status === "cancelled") {
          throw new Error(SAFE_FORBIDDEN_MESSAGE);
        }
        transaction.update(requestRef, {
          status: "awaiting_provider_response",
          providerRequestSentAt: now,
          providerRequestSentBy: actorUid,
          providerRequestSentByName: actorDisplayName,
          providerRequestSentRecipient: trustedRecipient,
          providerRequestSentSubject: subject,
          providerRequestSentBodyText: message,
          providerRequestSendCount: FieldValue.increment(1),
          updatedAt: now,
          updatedBy: actorUid,
        });
        transaction.update(emailLogRef, {
          status: "sent",
          sentAt: now,
          messageId: sendResult.messageId || null,
          from: sendResult.from || null,
          bodyText: sendResult.body,
          bodyHtml: sendResult.html,
          updatedAt: now,
        });
      });

      await createTrustedAuditLog({
        actorUid,
        entityId: params.entityId,
        action: "medicalVisitRequest.providerAvailabilityEmailSent",
        resourceType: "medicalVisitRequest",
        resourceId: params.requestId,
        details: { requestId: params.requestId, recipient: trustedRecipient, participantCount: participants.length },
      }).catch(() => undefined);

      return { success: true, requestId: params.requestId, sendCount: nextSendCount };
    } catch (sendError: any) {
      await emailLogRef.set({
        status: "failed",
        error: sendError?.message || "Envoi impossible.",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      throw sendError;
    }
  } catch (error: any) {
    return { success: false, error: error?.message || "Envoi de l'e-mail impossible." };
  }
}

export async function saveMedicalProviderSlotsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
  slots: MedicalProviderSlotInput[];
}): Promise<MedicalProviderSlotMutationResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId", "slots"]);
    const { actorUid, user: actorUser } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const actorDisplayName = resolveTrustedUserDisplayName(actorUser);
    if (!Array.isArray(params.slots) || params.slots.length === 0) {
      throw new Error("Ajoutez au moins un créneau communiqué par le médecin.");
    }
    if (params.slots.length > 100) {
      throw new Error("Trop de créneaux pour une seule sauvegarde.");
    }
    const normalizedSlots = params.slots.map(normalizeProviderSlotInput);
    assertNoDuplicateProviderSlots(normalizedSlots);

    const entityRef = adminDb.collection("entities").doc(params.entityId);
    const requestRef = entityRef.collection("medicalVisitRequests").doc(params.requestId);
    await adminDb.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
      const request = requestSnap.data() || {};
      assertRequestCanManageSlots(request, params.entityId);
      if (!["awaiting_provider_response", "slots_received", "assignments_ready"].includes(String(request.status || ""))) {
        throw new Error("Les créneaux peuvent être enregistrés après l'envoi de la demande au médecin.");
      }

      const [existingSlotsSnap, participantsSnap] = await Promise.all([
        transaction.get(requestRef.collection("slots")),
        transaction.get(requestRef.collection("participants")),
      ]);
      const existingSlotIds = new Set(existingSlotsSnap.docs.map((docSnap) => docSnap.id));
      const incomingExistingIds = new Set(normalizedSlots.map((slot) => slot.slotId).filter(Boolean) as string[]);
      for (const slotId of incomingExistingIds) {
        if (!existingSlotIds.has(slotId)) throw new Error("Créneau introuvable pour cette demande.");
      }
      const finalSlotsForDuplicateCheck = [
        ...existingSlotsSnap.docs
          .filter((docSnap) => !incomingExistingIds.has(docSnap.id))
          .map((docSnap) => normalizeProviderSlotInput({
            slotId: docSnap.id,
            date: docSnap.data()?.date,
            startTime: docSnap.data()?.startTime,
            endTime: docSnap.data()?.endTime || null,
            location: docSnap.data()?.location,
            capacity: docSnap.data()?.capacity || null,
            instructions: docSnap.data()?.instructions || null,
          })),
        ...normalizedSlots,
      ];
      assertNoDuplicateProviderSlots(finalSlotsForDuplicateCheck);
      const finalSlotById = new Map<string, MedicalVisitProviderSlotDto>();
      existingSlotsSnap.docs
        .filter((docSnap) => !incomingExistingIds.has(docSnap.id))
        .forEach((docSnap) => finalSlotById.set(docSnap.id, serializeMedicalVisitProviderSlot(docSnap.id, docSnap.data())));
      normalizedSlots.forEach((slot) => {
        const slotId = slot.slotId || "";
        if (slotId) {
          finalSlotById.set(slotId, {
            id: slotId,
            slotId,
            entityId: params.entityId,
            requestId: params.requestId,
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            location: slot.location,
            capacity: slot.capacity,
            instructions: slot.instructions,
            createdAt: null,
            createdBy: "",
            updatedAt: null,
            updatedBy: "",
          });
        }
      });
      const existingAssignments = new Map<string, {
        slotId: string | null;
        appointmentStartTime: string | null;
        appointmentEndTime: string | null;
      }>();
      participantsSnap.docs.forEach((docSnap) => {
        const participant = docSnap.data() || {};
        if (participant.selectionStatus !== "removed") {
          const hasIndividualAppointment = !!participant.assignedSlotId && !!participant.assignedStartTime && !!participant.assignedEndTime;
          existingAssignments.set(docSnap.id, {
            slotId: hasIndividualAppointment ? participant.assignedSlotId : null,
            appointmentStartTime: hasIndividualAppointment ? participant.assignedStartTime : null,
            appointmentEndTime: hasIndividualAppointment ? participant.assignedEndTime : null,
          });
        }
      });
      validateAppointmentAssignments(existingAssignments, finalSlotById);
      const allAssigned = existingAssignments.size > 0 && Array.from(existingAssignments.values()).every((assignment) => (
        !!assignment.slotId && !!assignment.appointmentStartTime && !!assignment.appointmentEndTime
      ));

      const now = FieldValue.serverTimestamp();
      for (const slot of normalizedSlots) {
        const slotRef = slot.slotId
          ? requestRef.collection("slots").doc(slot.slotId)
          : requestRef.collection("slots").doc();
        const slotId = slotRef.id;
        transaction.set(slotRef, {
          id: slotId,
          slotId,
          entityId: params.entityId,
          requestId: params.requestId,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          location: slot.location,
          capacity: slot.capacity,
          instructions: slot.instructions,
          ...(slot.slotId ? {} : { createdAt: now, createdBy: actorUid }),
          updatedAt: now,
          updatedBy: actorUid,
        }, { merge: true });
      }

      transaction.update(requestRef, {
        status: allAssigned ? "assignments_ready" : "slots_received",
        providerResponseRecordedAt: now,
        providerResponseRecordedBy: actorUid,
        providerResponseRecordedByName: actorDisplayName,
        updatedAt: now,
        updatedBy: actorUid,
      });
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisitRequest.providerSlotsSaved",
      resourceType: "medicalVisitRequest",
      resourceId: params.requestId,
      details: { requestId: params.requestId, slotCount: normalizedSlots.length },
    }).catch(() => undefined);

    return { success: true, requestId: params.requestId };
  } catch (error: any) {
    return { success: false, error: error?.message || "Créneaux impossibles à enregistrer." };
  }
}

export async function deleteMedicalProviderSlotAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
  slotId: string;
}): Promise<MedicalProviderSlotDeleteResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId", "slotId"]);
    const { actorUid } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const slotId = requireString(params.slotId, "Créneau", 120);
    const requestRef = adminDb.collection("entities").doc(params.entityId).collection("medicalVisitRequests").doc(params.requestId);

    await adminDb.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
      const request = requestSnap.data() || {};
      assertRequestCanManageSlots(request, params.entityId);
      if (!["awaiting_provider_response", "slots_received", "assignments_ready"].includes(String(request.status || ""))) {
        throw new Error("Les créneaux peuvent être supprimés après l'envoi de la demande au médecin.");
      }

      const slotRef = requestRef.collection("slots").doc(slotId);
      const [slotSnap, participantsSnap, slotsSnap] = await Promise.all([
        transaction.get(slotRef),
        transaction.get(requestRef.collection("participants")),
        transaction.get(requestRef.collection("slots")),
      ]);
      if (!slotSnap.exists) throw new Error("Créneau introuvable.");
      const slot = slotSnap.data() || {};
      if (slot.entityId !== params.entityId || slot.requestId !== params.requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
      const assignedCount = participantsSnap.docs.filter((docSnap) => docSnap.data()?.assignedSlotId === slotId).length;
      if (assignedCount > 0) {
        throw new Error("Ce créneau contient des collaborateurs affectés. Réaffectez-les avant suppression.");
      }

      const remainingSlotCount = slotsSnap.docs.filter((docSnap) => docSnap.id !== slotId).length;
      const activeParticipants = participantsSnap.docs
        .map((docSnap) => docSnap.data() || {})
        .filter((participant) => participant.selectionStatus !== "removed");
      const allAssigned = remainingSlotCount > 0 && activeParticipants.length > 0 && activeParticipants.every((participant) => (
        !!participant.assignedSlotId && !!participant.assignedStartTime && !!participant.assignedEndTime
      ));
      const now = FieldValue.serverTimestamp();
      transaction.delete(slotRef);
      transaction.update(requestRef, {
        status: remainingSlotCount > 0 ? (allAssigned ? "assignments_ready" : "slots_received") : "awaiting_provider_response",
        updatedAt: now,
        updatedBy: actorUid,
      });
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisitRequest.providerSlotDeleted",
      resourceType: "medicalVisitRequest",
      resourceId: params.requestId,
      details: { requestId: params.requestId, slotId },
    }).catch(() => undefined);

    return { success: true, requestId: params.requestId };
  } catch (error: any) {
    return { success: false, error: error?.message || "Créneau impossible à supprimer." };
  }
}

export async function assignMedicalVisitParticipantsToSlotsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
  assignments: MedicalParticipantSlotAssignmentInput[];
}): Promise<MedicalParticipantSlotAssignmentResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId", "assignments"]);
    const { actorUid } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    if (!Array.isArray(params.assignments)) throw new Error("Affectations invalides.");

    const assignmentByEmployee = new Map<string, {
      slotId: string | null;
      appointmentStartTime: string | null;
      appointmentEndTime: string | null;
    }>();
    for (const assignment of params.assignments) {
      assertExactKeys(assignment as Record<string, unknown>, ["employeeId", "slotId", "appointmentStartTime", "appointmentEndTime"]);
      const employeeId = requireString(assignment.employeeId, "Collaborateur", 160);
      if (assignmentByEmployee.has(employeeId)) throw new Error("Un collaborateur ne peut être affecté qu'à un seul créneau.");
      const slotId = assignment.slotId ? requireString(assignment.slotId, "Créneau", 160) : null;
      const appointmentStartTime = slotId ? requireTime(assignment.appointmentStartTime, "Heure de début du rendez-vous") : null;
      const appointmentEndTime = slotId ? requireTime(assignment.appointmentEndTime, "Heure de fin du rendez-vous") : null;
      if (slotId && appointmentStartTime && appointmentEndTime && appointmentEndTime <= appointmentStartTime) {
        throw new Error("L'heure de fin du rendez-vous doit être postérieure à l'heure de début.");
      }
      assignmentByEmployee.set(employeeId, { slotId, appointmentStartTime, appointmentEndTime });
    }

    const requestRef = adminDb.collection("entities").doc(params.entityId).collection("medicalVisitRequests").doc(params.requestId);
    let nextStatus: MedicalVisitRequestStatus = "slots_received";
    await adminDb.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
      const request = requestSnap.data() || {};
      assertRequestCanManageSlots(request, params.entityId);
      if (!["slots_received", "assignments_ready"].includes(String(request.status || ""))) {
        throw new Error("Aucun créneau n'est disponible pour l'affectation.");
      }

      const [participantsSnap, slotsSnap] = await Promise.all([
        transaction.get(requestRef.collection("participants")),
        transaction.get(requestRef.collection("slots")),
      ]);
      const participants = participantsSnap.docs.map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data()));
      const activeParticipants = participants.filter((participant) => participant.selectionStatus !== "removed");
      const participantIds = new Set(activeParticipants.map((participant) => participant.employeeId));
      const slots = slotsSnap.docs.map((docSnap) => serializeMedicalVisitProviderSlot(docSnap.id, docSnap.data()));
      const slotById = new Map(slots.map((slot) => [slot.slotId, slot]));
      if (slots.length === 0) throw new Error("Ajoutez au moins un créneau avant d'affecter les collaborateurs.");

      for (const employeeId of assignmentByEmployee.keys()) {
        if (!participantIds.has(employeeId)) throw new Error("Collaborateur inconnu pour cette demande.");
      }
      for (const assignment of assignmentByEmployee.values()) {
        if (assignment.slotId && !slotById.has(assignment.slotId)) throw new Error("Créneau inconnu pour cette demande.");
      }

      const finalAssignments = new Map<string, {
        slotId: string | null;
        appointmentStartTime: string | null;
        appointmentEndTime: string | null;
      }>();
      for (const participant of activeParticipants) {
        const submitted = assignmentByEmployee.get(participant.employeeId);
        finalAssignments.set(
          participant.employeeId,
          submitted || {
            slotId: participant.assignedSlotId || null,
            appointmentStartTime: participant.assignedStartTime || null,
            appointmentEndTime: participant.assignedEndTime || null,
          }
        );
      }
      validateAppointmentAssignments(finalAssignments, slotById);
      const allAssigned = activeParticipants.length > 0 && activeParticipants.every((participant) => {
        const assignment = finalAssignments.get(participant.employeeId);
        return !!assignment?.slotId && !!assignment.appointmentStartTime && !!assignment.appointmentEndTime;
      });
      nextStatus = allAssigned ? "assignments_ready" : "slots_received";
      const now = FieldValue.serverTimestamp();
      const sequenceByEmployee = buildAppointmentSequenceByEmployee(finalAssignments);
      for (const [employeeId, assignment] of assignmentByEmployee) {
        const duration = assignment.appointmentStartTime && assignment.appointmentEndTime
          ? timeToMinutes(assignment.appointmentEndTime) - timeToMinutes(assignment.appointmentStartTime)
          : null;
        transaction.update(requestRef.collection("participants").doc(employeeId), {
          assignedSlotId: assignment.slotId,
          assignedStartTime: assignment.appointmentStartTime,
          assignedEndTime: assignment.appointmentEndTime,
          appointmentDurationMinutes: duration,
          appointmentSequence: assignment.slotId ? sequenceByEmployee.get(employeeId) || null : null,
          updatedAt: now,
          updatedBy: actorUid,
        });
      }
      transaction.update(requestRef, {
        status: nextStatus,
        updatedAt: now,
        updatedBy: actorUid,
      });
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisitRequest.participantsAssignedToSlots",
      resourceType: "medicalVisitRequest",
      resourceId: params.requestId,
      details: { requestId: params.requestId, assignmentCount: params.assignments.length, status: nextStatus },
    }).catch(() => undefined);

    return { success: true, requestId: params.requestId, status: nextStatus };
  } catch (error: any) {
    return { success: false, error: error?.message || "Affectations impossibles à enregistrer." };
  }
}

export async function materializeMedicalVisitsFromRequestAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MedicalVisitMaterializationResult> {
  const materializedAt = new Date().toISOString();
  let createdCount = 0;
  let existingCount = 0;
  let visitIds: string[] = [];
  let auditShouldBeCreated = false;

  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    const { actorUid, user: actorUser } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_CREATE_PERMISSION);
    const actorDisplayName = resolveTrustedUserDisplayName(actorUser);
    const entityRef = adminDb.collection("entities").doc(params.entityId);
    const requestRef = entityRef.collection("medicalVisitRequests").doc(params.requestId);

    await adminDb.runTransaction(async (transaction) => {
      createdCount = 0;
      existingCount = 0;
      visitIds = [];
      auditShouldBeCreated = false;

      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
      const request = requestSnap.data() || {};
      if (request.entityId !== params.entityId || request.id !== params.requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
      if (request.status === "cancelled" || request.status === "completed") {
        throw new Error("Cette demande ne peut plus être planifiée.");
      }
      if (!["assignments_ready", "employees_planned"].includes(String(request.status || ""))) {
        throw new Error("Toutes les affectations doivent être validées avant de créer les visites individuelles.");
      }

      const visitType = assertAllowed(request.visitType, MEDICAL_VISIT_TYPES, "Type de visite");
      const providerName = requireString(request.providerName, "Médecin ou centre", 180);
      assertAllowed(request.providerType, MEDICAL_VISIT_PROVIDER_TYPES, "Type de prestataire");

      const [participantsSnap, slotsSnap] = await Promise.all([
        transaction.get(requestRef.collection("participants")),
        transaction.get(requestRef.collection("slots")),
      ]);
      const participants = participantsSnap.docs
        .map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data()))
        .filter((participant) => participant.selectionStatus !== "removed");
      if (participants.length === 0) throw new Error("Aucun collaborateur actif n'est sélectionné.");
      if (participants.length > MATERIALIZATION_PARTICIPANT_LIMIT) {
        throw new Error(`Trop de collaborateurs pour une création atomique. Limite sûre : ${MATERIALIZATION_PARTICIPANT_LIMIT}.`);
      }

      const slots = slotsSnap.docs.map((docSnap) => serializeMedicalVisitProviderSlot(docSnap.id, docSnap.data()));
      if (slots.length === 0) throw new Error("Aucun créneau médecin n'est enregistré.");
      const slotById = new Map<string, MedicalVisitProviderSlotDto>();
      for (const slot of slots) {
        if (slot.entityId !== params.entityId || slot.requestId !== params.requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
        requireDateOnly(slot.date, "Date du créneau");
        requireTime(slot.startTime, "Heure de début du créneau");
        if (slot.endTime) requireTime(slot.endTime, "Heure de fin du créneau");
        requireString(slot.location, "Lieu du créneau", 240);
        slotById.set(slot.slotId, slot);
      }

      const finalAssignments = new Map<string, {
        slotId: string | null;
        appointmentStartTime: string | null;
        appointmentEndTime: string | null;
      }>();
      for (const participant of participants) {
        finalAssignments.set(participant.employeeId, {
          slotId: participant.assignedSlotId || null,
          appointmentStartTime: participant.assignedStartTime || null,
          appointmentEndTime: participant.assignedEndTime || null,
        });
      }
      validateAppointmentAssignments(finalAssignments, slotById);
      const allFullyAssigned = participants.every((participant) => {
        const assignment = finalAssignments.get(participant.employeeId);
        return !!assignment?.slotId && !!assignment.appointmentStartTime && !!assignment.appointmentEndTime;
      });
      if (!allFullyAssigned) {
        throw new Error("Chaque collaborateur doit avoir un créneau et un horaire individuel validés.");
      }

      const employeeRefs = participants.map((participant) => entityRef.collection("employees").doc(participant.employeeId));
      const visitRefs = participants.map((participant) => {
        const visitId = buildDeterministicId(`medical_visit_from_request:${params.entityId}:${params.requestId}:${participant.employeeId}`);
        return entityRef.collection("medicalVisits").doc(visitId);
      });
      const [employeeSnaps, visitSnaps] = await Promise.all([
        Promise.all(employeeRefs.map((ref) => transaction.get(ref))),
        Promise.all(visitRefs.map((ref) => transaction.get(ref))),
      ]);

      const now = FieldValue.serverTimestamp();
      for (let index = 0; index < participants.length; index += 1) {
        const participant = participants[index];
        const assignment = finalAssignments.get(participant.employeeId);
        if (!assignment?.slotId || !assignment.appointmentStartTime || !assignment.appointmentEndTime) {
          throw new Error("Affectation individuelle incomplète.");
        }
        const slot = slotById.get(assignment.slotId);
        if (!slot) throw new Error("Créneau inconnu pour cette demande.");

        const employeeSnap = employeeSnaps[index];
        if (!employeeSnap.exists) throw new Error("Collaborateur introuvable.");
        const employee = employeeSnap.data() || {};
        if (employee.entityId !== params.entityId || employee.employeeId !== participant.employeeId || !isActiveEmployee(employee)) {
          throw new Error(SAFE_FORBIDDEN_MESSAGE);
        }

        const visitRef = visitRefs[index];
        const visitId = visitRef.id;
        const visitSnap = visitSnaps[index];
        visitIds.push(visitId);

        if (visitSnap.exists) {
          const existingVisit = visitSnap.data() || {};
          if (
            existingVisit.entityId !== params.entityId
            || existingVisit.employeeId !== participant.employeeId
            || existingVisit.medicalVisitRequestId !== params.requestId
            || existingVisit.providerSlotId !== assignment.slotId
          ) {
            throw new Error("Collision d'identifiant de visite médicale détectée.");
          }
          existingCount += 1;
        } else {
          transaction.set(visitRef, {
            id: visitId,
            entityId: params.entityId,
            employeeId: participant.employeeId,
            personId: employee.personId || participant.personId || null,
            contractId: employee.activeContractId || employee.pendingContractId || employee.contractId || participant.contractId || null,
            visitType,
            visitDate: slot.date,
            visitStartTime: assignment.appointmentStartTime,
            visitEndTime: assignment.appointmentEndTime,
            doctorName: providerName,
            medicalCenter: slot.location,
            fitnessStatus: "pending_result",
            status: "scheduled",
            medicalVisitRequestId: params.requestId,
            medicalVisitRequestParticipantId: participant.employeeId,
            providerSlotId: assignment.slotId,
            plannedFromRequest: true,
            documentId: null,
            nextVisitDate: null,
            createdAt: now,
            createdBy: actorUid,
            updatedAt: now,
            updatedBy: actorUid,
          });
          createdCount += 1;
          auditShouldBeCreated = true;
        }

        if (participant.resultingMedicalVisitId !== visitId) {
          transaction.update(requestRef.collection("participants").doc(participant.employeeId), {
            resultingMedicalVisitId: visitId,
            updatedAt: now,
            updatedBy: actorUid,
          });
        }
      }

      const requestNeedsMaterializationUpdate = request.status !== "employees_planned"
        || !request.individualVisitsCreatedAt
        || Number(request.individualVisitsCount || 0) !== participants.length;
      if (requestNeedsMaterializationUpdate) {
        transaction.update(requestRef, {
          status: "employees_planned",
          individualVisitsCreatedAt: now,
          individualVisitsCreatedBy: actorUid,
          individualVisitsCreatedByName: actorDisplayName,
          individualVisitsCount: participants.length,
          updatedAt: now,
          updatedBy: actorUid,
        });
      }
    });

    if (auditShouldBeCreated) {
      await createTrustedAuditLog({
        actorUid,
        entityId: params.entityId,
        action: "medicalVisitRequest.individualVisitsMaterialized",
        resourceType: "medicalVisitRequest",
        resourceId: params.requestId,
        details: {
          requestId: params.requestId,
          createdCount,
          existingCount,
          visitCount: visitIds.length,
        },
      }).catch(() => undefined);
    }

    return {
      success: true,
      requestId: params.requestId,
      visitIds,
      createdCount,
      existingCount,
      materializedAt,
      materializedByName: actorDisplayName,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || "Impossible de créer les visites individuelles." };
  }
}

export async function getMedicalEmployeeInvitationsPreviewAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MedicalEmployeeInvitationPreviewResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const plan = await loadVerifiedMedicalEmployeeInvitationPlan(params.entityId, params.requestId);
    const rows = plan.rows.map(toMedicalEmployeeInvitationPreviewRow);
    return { success: true, requestId: params.requestId, rows, summary: summarizeInvitationPreview(rows) };
  } catch (error: any) {
    return { success: false, error: error?.message || "Prévisualisation des convocations indisponible." };
  }
}

export async function sendMedicalEmployeeInvitationsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
  resendMode?: "retry_failed_or_unsent" | "full_resend";
}): Promise<MedicalEmployeeInvitationSendResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId", "resendMode"]);
    const resendMode = params.resendMode === "full_resend" ? "full_resend" : "retry_failed_or_unsent";
    const { actorUid, user: actorUser } = await authorizeMedicalAction(params.entityId, params.idToken, MEDICAL_UPDATE_PERMISSION);
    const actorDisplayName = resolveTrustedUserDisplayName(actorUser);
    const plan = await loadVerifiedMedicalEmployeeInvitationPlan(params.entityId, params.requestId);
    const requestRef = adminDb.collection("entities").doc(params.entityId).collection("medicalVisitRequests").doc(params.requestId);
    const rows: MedicalEmployeeInvitationSendResultRow[] = [];
    if (!plan.rows.some((item) => item.eligible)) {
      throw new Error("Aucune visite planifiée ne peut être notifiée.");
    }

    for (const item of plan.rows) {
      const preview = toMedicalEmployeeInvitationPreviewRow(item);
      if (!item.eligible) {
        rows.push({
          ...preview,
          notificationDeliveryStatus: "skipped",
          emailDeliveryStatus: "skipped",
          deliveryResultStatus: item.eligibilityStatus,
          notificationId: null,
          emailLogId: null,
          error: null,
        });
        continue;
      }
      const attemptNumber = Number(item.participant.invitationSendCount || 0) + 1;
      const notificationId = buildDeterministicId([
        "medical_employee_invitation_notification",
        params.entityId,
        params.requestId,
        item.employeeId,
        item.medicalVisitId,
      ].join(":"));
      const ordinaryEmailLogId = buildDeterministicId([
        "medical_employee_invitation_email",
        params.entityId,
        params.requestId,
        item.employeeId,
        item.medicalVisitId,
      ].join(":"));
      const emailLogId = resendMode === "full_resend"
        ? buildDeterministicId([
            "medical_employee_invitation_email_full_resend",
            params.entityId,
            params.requestId,
            item.employeeId,
            item.medicalVisitId,
            String(attemptNumber),
          ].join(":"))
        : ordinaryEmailLogId;
      let notificationDeliveryStatus: MedicalEmployeeInvitationChannelStatus = "not_applicable";
      let emailDeliveryStatus: MedicalEmployeeInvitationChannelStatus = "not_applicable";
      let error: string | null = null;

      const participantRef = requestRef.collection("participants").doc(item.employeeId);
      const participantUpdate: Record<string, any> = {
        invitationLastAttemptAt: FieldValue.serverTimestamp(),
        invitationLastAttemptBy: actorUid,
        invitationLastAttemptByName: actorDisplayName,
        invitationSendCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      };

      if (item.recipientUid) {
        try {
          const notificationRef = adminDb.collection("entities").doc(params.entityId).collection("notifications").doc(notificationId);
          if (resendMode !== "full_resend" && item.participant.notificationStatus === "sent") {
            notificationDeliveryStatus = "already_sent";
          } else {
            const notificationSnap = await notificationRef.get();
            if (notificationSnap.exists) {
              notificationDeliveryStatus = "already_sent";
            } else {
              await notificationRef.set({
                id: notificationId,
                entityId: params.entityId,
                targetUid: item.recipientUid,
                audience: "employee",
                category: "medical",
                severity: "info",
                title: "Visite médicale planifiée",
                message: `Votre visite médicale est planifiée le ${item.visitDateLabel} de ${item.visitStartTime} à ${item.visitEndTime}, à ${item.location}.`,
                sourceModule: "medicalVisits",
                sourceId: item.medicalVisitId,
                actionUrl: `/entity/${params.entityId}/my-space/medical-visits`,
                dedupKey: `medical_employee_invitation:${params.requestId}:${item.employeeId}:${item.medicalVisitId}`,
                status: "unread",
                createdAt: FieldValue.serverTimestamp(),
                createdBy: actorUid,
              });
              notificationDeliveryStatus = "sent";
            }
          }
          participantUpdate.notificationStatus = "sent";
          participantUpdate.notificationSentAt = FieldValue.serverTimestamp();
          participantUpdate.notificationRecipientUid = item.recipientUid;
          participantUpdate.notificationId = notificationId;
        } catch (notificationError: any) {
          notificationDeliveryStatus = "failed";
          participantUpdate.notificationStatus = "failed";
          error = notificationError?.message || "Notification impossible.";
        }
      } else {
        participantUpdate.notificationStatus = "not_applicable";
      }

      if (item.emailRecipient) {
        try {
          const emailLogRef = adminDb.collection("entities").doc(params.entityId).collection("emailLogs").doc(emailLogId);
          let shouldSendEmail = true;
          if (resendMode !== "full_resend" && item.participant.emailStatus === "sent") {
            shouldSendEmail = false;
          } else {
            await adminDb.runTransaction(async (transaction) => {
              const logSnap = await transaction.get(emailLogRef);
              if (logSnap.exists) {
                const status = logSnap.data()?.status;
                if (status === "sent") {
                  shouldSendEmail = false;
                  return;
                }
                if (status === "sending") {
                  throw new Error("Une convocation identique est déjà en cours d'envoi.");
                }
              }
              transaction.set(emailLogRef, {
                id: emailLogId,
                entityId: params.entityId,
                module: "medicalVisits",
                type: "employee_medical_visit_invitation",
                requestId: params.requestId,
                medicalVisitId: item.medicalVisitId,
                employeeId: item.employeeId,
                recipient: item.emailRecipient,
                status: "sending",
                sentBy: actorUid,
                sentByName: actorDisplayName,
                providerName: item.providerName,
                visitDate: item.visitDate,
                visitStartTime: item.visitStartTime,
                visitEndTime: item.visitEndTime,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
            });
          }

          if (shouldSendEmail) {
            const sendResult = await sendMedicalEmployeeVisitInvitationEmail({
              entityId: params.entityId,
              to: item.emailRecipient,
              employeeName: item.employeeDisplayNameSnapshot,
              entityName: plan.entityName,
              visitTypeLabel: item.visitTypeLabel,
              visitDateLabel: item.visitDateLabel,
              visitStartTime: item.visitStartTime,
              visitEndTime: item.visitEndTime,
              providerName: item.providerName,
              location: item.location,
              instructions: item.instructions,
              actionUrl: `/entity/${params.entityId}/my-space/medical-visits`,
            });
            await emailLogRef.set({
              subject: sendResult.subject,
              bodyText: sendResult.body,
              bodyHtml: sendResult.html,
              messageId: sendResult.messageId || null,
              from: sendResult.from || null,
              status: "sent",
              sentAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            emailDeliveryStatus = "sent";
          } else {
            emailDeliveryStatus = "already_sent";
          }
          participantUpdate.emailStatus = "sent";
          participantUpdate.emailSentAt = FieldValue.serverTimestamp();
          participantUpdate.emailRecipient = item.emailRecipient;
          participantUpdate.emailLogId = emailLogId;
        } catch (emailError: any) {
          emailDeliveryStatus = "failed";
          participantUpdate.emailStatus = "failed";
          participantUpdate.emailRecipient = item.emailRecipient;
          participantUpdate.emailLogId = emailLogId;
          await adminDb.collection("entities").doc(params.entityId).collection("emailLogs").doc(emailLogId).set({
            id: emailLogId,
            entityId: params.entityId,
            module: "medicalVisits",
            type: "employee_medical_visit_invitation",
            requestId: params.requestId,
            medicalVisitId: item.medicalVisitId,
            employeeId: item.employeeId,
            recipient: item.emailRecipient,
            status: "failed",
            error: emailError?.message || "Envoi impossible.",
            sentBy: actorUid,
            sentByName: actorDisplayName,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          error = [error, emailError?.message || "E-mail impossible."].filter(Boolean).join(" / ");
        }
      } else {
        participantUpdate.emailStatus = "not_applicable";
      }

      participantUpdate.invitationErrorCode = error ? "delivery_failed" : null;
      await participantRef.set(participantUpdate, { merge: true });

      rows.push({
        ...preview,
        notificationDeliveryStatus,
        emailDeliveryStatus,
        deliveryResultStatus: resolveInvitationDeliveryResultStatus(preview, notificationDeliveryStatus, emailDeliveryStatus),
        notificationId: item.recipientUid ? notificationId : null,
        emailLogId: item.emailRecipient ? emailLogId : null,
        error,
      });
    }

    const summary = summarizeInvitationSend(rows);
    await requestRef.set({
      status: "employees_planned",
      employeeInvitationsLastSentAt: FieldValue.serverTimestamp(),
      employeeInvitationsLastSentBy: actorUid,
      employeeInvitationsLastSentByName: actorDisplayName,
      employeeInvitationAttemptCount: FieldValue.increment(1),
      employeeNotificationSentCount: summary.notificationSentCount,
      employeeEmailSentCount: summary.emailSentCount,
      employeeManualContactCount: summary.manualContactCount,
      employeeInvitationEligibleCount: summary.eligibleCount,
      employeeInvitationSkippedCount: summary.skippedCount,
      employeeInvitationFailureCount: summary.failureCount,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    }, { merge: true });

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisitRequest.employeeInvitationsSent",
      resourceType: "medicalVisitRequest",
      resourceId: params.requestId,
      details: {
        requestId: params.requestId,
        resendMode,
        processedCount: summary.processedCount,
        notificationSentCount: summary.notificationSentCount,
        emailSentCount: summary.emailSentCount,
        manualContactCount: summary.manualContactCount,
        eligibleCount: summary.eligibleCount,
        skippedCount: summary.skippedCount,
        failureCount: summary.failureCount,
      },
    }).catch(() => undefined);

    return { success: true, requestId: params.requestId, rows, summary };
  } catch (error: any) {
    return { success: false, error: error?.message || "Envoi des convocations impossible." };
  }
}

export async function attachMedicalCertificateAction(params: {
  idToken: string;
  entityId: string;
  visitId: string;
}, formData: FormData): Promise<MedicalCertificateMutationResult> {
  let uploadedStoragePath: string | null = null;
  let createdDocumentPath: string | null = null;

  try {
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "visitId"]);

    const { actorUid } = await authorizeMedicalAction(params.entityId, params.idToken, [
      MEDICAL_UPDATE_PERMISSION,
      DOCUMENT_UPLOAD_PERMISSION,
    ]);
    const { visitRef, visit } = await loadVerifiedVisit(params.entityId, params.visitId);
    if (visit.status === "archived") throw new Error("Impossible de joindre un certificat à une visite archivée.");
    if (visit.documentId) throw new Error("Un certificat est déjà joint. Utilisez l'action de remplacement.");

    const { file, buffer, safeFileName } = await extractMedicalCertificateFile(formData);
    const documentRef = adminDb.collection("entities").doc(params.entityId).collection("documents").doc();
    const documentId = documentRef.id;
    const storagePath = `entities/${params.entityId}/documents/${documentId}/${safeFileName}`;
    uploadedStoragePath = storagePath;
    createdDocumentPath = documentRef.path;

    await adminBucket.file(storagePath).save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { entityId: params.entityId, documentId, module: "medicalVisits", visitId: params.visitId },
      },
      resumable: false,
    });

    const now = FieldValue.serverTimestamp();
    const batch = adminDb.batch();
    batch.set(documentRef, {
      id: documentId,
      entityId: params.entityId,
      title: `Certificat médical - ${visit.visitDate || params.visitId}`,
      documentType: "medical_certificate",
      status: "valid",
      storagePath,
      fileName: safeFileName,
      originalFileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      fileSize: file.size,
      employeeId: visit.employeeId || null,
      personId: visit.personId || null,
      relatedModule: "medicalVisits",
      relatedId: params.visitId,
      relatedLabel: `Visite médicale - ${visit.visitDate || params.visitId}`,
      version: 1,
      rootDocumentId: documentId,
      isSensitive: true,
      isRequired: true,
      uploadedAt: now,
      uploadedBy: actorUid,
      uploadedByDisplayName: actorUid,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
      source: "medical_visit_certificate",
    });
    batch.update(visitRef, {
      documentId,
      updatedAt: now,
      updatedBy: actorUid,
    });

    await batch.commit();
    uploadedStoragePath = null;
    createdDocumentPath = null;

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisit.certificateAttached",
      resourceType: "medicalVisit",
      resourceId: params.visitId,
      details: { visitId: params.visitId, documentId },
    }).catch(() => undefined);

    return { success: true, documentId };
  } catch (error: any) {
    if (uploadedStoragePath && adminBucket) {
      await adminBucket.file(uploadedStoragePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    if (createdDocumentPath && adminDb) {
      await adminDb.doc(createdDocumentPath).delete().catch(() => undefined);
    }
    return { success: false, error: error?.message || "Certificat médical impossible à joindre." };
  }
}

export async function replaceMedicalCertificateAction(params: {
  idToken: string;
  entityId: string;
  visitId: string;
}, formData: FormData): Promise<MedicalCertificateMutationResult> {
  let uploadedStoragePath: string | null = null;
  let createdDocumentPath: string | null = null;

  try {
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "visitId"]);

    const { actorUid } = await authorizeMedicalAction(params.entityId, params.idToken, [
      MEDICAL_UPDATE_PERMISSION,
      DOCUMENT_UPLOAD_PERMISSION,
    ]);
    const { visitRef, visit } = await loadVerifiedVisit(params.entityId, params.visitId);
    if (visit.status === "archived") throw new Error("Impossible de remplacer le certificat d'une visite archivée.");

    const { documentId: oldDocumentId, documentRef: oldDocumentRef, documentData: oldDocument } =
      await loadVerifiedMedicalCertificateDocument(params.entityId, visit);
    if (oldDocument.status === "replaced" || oldDocument.status === "archived") {
      throw new Error("Ce certificat a déjà été remplacé ou archivé.");
    }

    const { file, buffer, safeFileName } = await extractMedicalCertificateFile(formData);
    const newDocumentRef = adminDb.collection("entities").doc(params.entityId).collection("documents").doc();
    const newDocumentId = newDocumentRef.id;
    const storagePath = `entities/${params.entityId}/documents/${newDocumentId}/${safeFileName}`;
    uploadedStoragePath = storagePath;
    createdDocumentPath = newDocumentRef.path;

    await adminBucket.file(storagePath).save(buffer, {
      metadata: {
        contentType: file.type,
        metadata: { entityId: params.entityId, documentId: newDocumentId, module: "medicalVisits", visitId: params.visitId },
      },
      resumable: false,
    });

    const now = FieldValue.serverTimestamp();
    const rootDocumentId = oldDocument.rootDocumentId || oldDocument.id || oldDocumentId;
    const version = Number(oldDocument.version || 1) + 1;
    const batch = adminDb.batch();
    batch.set(newDocumentRef, {
      ...oldDocument,
      id: newDocumentId,
      entityId: params.entityId,
      title: `Certificat médical - ${visit.visitDate || params.visitId}`,
      documentType: "medical_certificate",
      status: "valid",
      storagePath,
      fileName: safeFileName,
      originalFileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      fileSize: file.size,
      employeeId: visit.employeeId || null,
      personId: visit.personId || null,
      relatedModule: "medicalVisits",
      relatedId: params.visitId,
      relatedLabel: `Visite médicale - ${visit.visitDate || params.visitId}`,
      version,
      replacesId: oldDocumentId,
      previousDocumentId: oldDocumentId,
      replacedById: null,
      rootDocumentId,
      replacementReason: "Remplacement du certificat médical.",
      uploadedAt: now,
      uploadedBy: actorUid,
      uploadedByDisplayName: actorUid,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
      source: "medical_visit_certificate",
      sourceKey: null,
      isSensitive: true,
    });
    batch.update(oldDocumentRef, {
      status: "replaced",
      replacedById: newDocumentId,
      replacedAt: now,
      replacedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });
    batch.update(visitRef, {
      documentId: newDocumentId,
      updatedAt: now,
      updatedBy: actorUid,
    });

    await batch.commit();
    uploadedStoragePath = null;
    createdDocumentPath = null;

    await createTrustedAuditLog({
      actorUid,
      entityId: params.entityId,
      action: "medicalVisit.certificateReplaced",
      resourceType: "medicalVisit",
      resourceId: params.visitId,
      details: { visitId: params.visitId, oldDocumentId, newDocumentId },
    }).catch(() => undefined);

    return { success: true, documentId: newDocumentId };
  } catch (error: any) {
    if (uploadedStoragePath && adminBucket) {
      await adminBucket.file(uploadedStoragePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    if (createdDocumentPath && adminDb) {
      await adminDb.doc(createdDocumentPath).delete().catch(() => undefined);
    }
    return { success: false, error: error?.message || "Remplacement du certificat médical impossible." };
  }
}

export async function getMedicalCertificateUrlAction(params: {
  idToken: string;
  entityId: string;
  visitId: string;
  disposition: "view" | "download";
}): Promise<MedicalCertificateUrlResult> {
  try {
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    assertExactKeys(params as Record<string, unknown>, ["idToken", "entityId", "visitId", "disposition"]);
    const disposition = assertAllowed(params.disposition, ["view", "download"], "Mode d'ouverture");

    await authorizeMedicalAction(params.entityId, params.idToken, [
      MEDICAL_READ_PERMISSION,
      DOCUMENT_READ_PERMISSION,
    ]);
    const { visit } = await loadVerifiedVisit(params.entityId, params.visitId);
    const { documentId, documentData } = await loadVerifiedMedicalCertificateDocument(params.entityId, visit);

    const responseDisposition = disposition === "download" ? "attachment" : "inline";
    const fileName = sanitizeFileName(documentData.fileName || documentData.originalFileName || `certificat-medical-${documentId}.pdf`);
    const [url] = await adminBucket.file(documentData.storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
      responseDisposition: `${responseDisposition}; filename="${fileName}"`,
    });

    return { success: true, url };
  } catch (error: any) {
    return { success: false, error: error?.message || "Certificat médical indisponible." };
  }
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Valeur texte invalide.");
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error("Valeur texte trop longue.");
  return trimmed || null;
}

function normalizeProviderSlotInput(slot: MedicalProviderSlotInput) {
  assertExactKeys(slot as Record<string, unknown>, ["slotId", "date", "startTime", "endTime", "location", "capacity", "instructions"]);
  const slotId = normalizeOptionalString(slot.slotId, 160);
  const date = requireDateOnly(slot.date, "Date du créneau");
  if (!isValidTime(slot.startTime)) throw new Error("Heure de début invalide.");
  const startTime = slot.startTime;
  const endTime = normalizeOptionalString(slot.endTime, 5);
  if (endTime && !isValidTime(endTime)) throw new Error("Heure de fin invalide.");
  if (endTime && endTime <= startTime) throw new Error("L'heure de fin doit être postérieure à l'heure de début.");
  const location = requireString(slot.location, "Lieu", 300);
  let capacity: number | null = null;
  if (slot.capacity !== undefined && slot.capacity !== null) {
    const numericCapacity = typeof slot.capacity === "number" ? slot.capacity : Number(slot.capacity);
    if (!Number.isInteger(numericCapacity) || numericCapacity <= 0) throw new Error("La capacité doit être un entier positif.");
    capacity = numericCapacity;
  }
  const instructions = normalizeOptionalString(slot.instructions, 2000);
  return { slotId, date, startTime, endTime, location, capacity, instructions };
}

function assertNoDuplicateProviderSlots(slots: Array<ReturnType<typeof normalizeProviderSlotInput>>) {
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.date}|${slot.startTime}|${slot.location.trim().toLowerCase()}`;
    if (seen.has(key)) throw new Error("Deux créneaux ont la même date, heure de début et lieu.");
    seen.add(key);
  }
}

function assertRequestCanManageSlots(request: Record<string, any>, entityId: string) {
  if (request.entityId !== entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (request.status === "cancelled" || request.status === "completed") {
    throw new Error("Cette demande ne peut plus être modifiée.");
  }
  if (request.status === "employees_planned") {
    throw new Error("Les visites individuelles ont déjà été planifiées.");
  }
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateAppointmentAssignments(
  assignments: Map<string, { slotId: string | null; appointmentStartTime: string | null; appointmentEndTime: string | null }>,
  slotById: Map<string, MedicalVisitProviderSlotDto>
) {
  const appointmentsBySlot = new Map<string, Array<{ employeeId: string; start: number; end: number }>>();
  for (const [employeeId, assignment] of assignments) {
    if (!assignment.slotId) {
      if (assignment.appointmentStartTime || assignment.appointmentEndTime) {
        throw new Error("Un rendez-vous horaire doit être lié à un créneau médecin.");
      }
      continue;
    }
    const slot = slotById.get(assignment.slotId);
    if (!slot) throw new Error("Créneau inconnu pour cette demande.");
    if (!assignment.appointmentStartTime || !assignment.appointmentEndTime) {
      throw new Error("Chaque collaborateur affecté doit avoir une heure de début et de fin.");
    }
    const start = timeToMinutes(assignment.appointmentStartTime);
    const end = timeToMinutes(assignment.appointmentEndTime);
    if (end <= start) throw new Error("L'heure de fin du rendez-vous doit être postérieure à l'heure de début.");
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = slot.endTime ? timeToMinutes(slot.endTime) : null;
    if (start < slotStart) throw new Error("Un rendez-vous ne peut pas commencer avant la disponibilité du médecin.");
    if (slotEnd === null) throw new Error("L'heure de fin du créneau médecin est requise pour définir des rendez-vous individuels.");
    if (end > slotEnd) throw new Error("Un rendez-vous ne peut pas se terminer après la disponibilité du médecin.");
    const slotAppointments = appointmentsBySlot.get(assignment.slotId) || [];
    slotAppointments.push({ employeeId, start, end });
    appointmentsBySlot.set(assignment.slotId, slotAppointments);
  }

  for (const [slotId, appointments] of appointmentsBySlot) {
    const slot = slotById.get(slotId);
    if (!slot) throw new Error("Créneau inconnu pour cette demande.");
    if (slot.capacity && appointments.length > slot.capacity) {
      throw new Error(`La capacité du créneau du ${formatMedicalDate(slot.date)} à ${slot.startTime} est dépassée.`);
    }
    const sortedAppointments = [...appointments].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < sortedAppointments.length; index += 1) {
      if (sortedAppointments[index].start < sortedAppointments[index - 1].end) {
        throw new Error(`Deux rendez-vous se chevauchent sur le créneau du ${formatMedicalDate(slot.date)} à ${slot.startTime}.`);
      }
    }
  }
}

function buildAppointmentSequenceByEmployee(
  assignments: Map<string, { slotId: string | null; appointmentStartTime: string | null; appointmentEndTime: string | null }>
) {
  const grouped = new Map<string, Array<{ employeeId: string; start: number }>>();
  for (const [employeeId, assignment] of assignments) {
    if (!assignment.slotId || !assignment.appointmentStartTime) continue;
    const rows = grouped.get(assignment.slotId) || [];
    rows.push({ employeeId, start: timeToMinutes(assignment.appointmentStartTime) });
    grouped.set(assignment.slotId, rows);
  }
  const sequenceByEmployee = new Map<string, number>();
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.start - b.start || a.employeeId.localeCompare(b.employeeId));
    rows.forEach((row, index) => sequenceByEmployee.set(row.employeeId, index + 1));
  }
  return sequenceByEmployee;
}

type MedicalEmployeeInvitationPlanRow = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  medicalVisitId: string;
  visitTypeLabel: string;
  visitDate: string;
  visitDateLabel: string;
  visitStartTime: string;
  visitEndTime: string;
  providerName: string;
  location: string;
  instructions: string | null;
  recipientUid: string | null;
  emailRecipient: string | null;
  classification: MedicalEmployeeInvitationClassification;
  eligibilityStatus: MedicalEmployeeInvitationEligibilityStatus;
  eligibilityLabel: string;
  eligible: boolean;
  participant: MedicalVisitRequestParticipantDto;
};

async function loadVerifiedMedicalEmployeeInvitationPlan(entityId: string, requestId: string) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  const entityRef = adminDb.collection("entities").doc(entityId);
  const requestRef = entityRef.collection("medicalVisitRequests").doc(requestId);
  const [entitySnap, requestSnap, participantsSnap, slotsSnap] = await Promise.all([
    entityRef.get(),
    requestRef.get(),
    requestRef.collection("participants").get(),
    requestRef.collection("slots").get(),
  ]);
  if (!entitySnap.exists || entitySnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
  const request = requestSnap.data() || {};
  if (request.entityId !== entityId || request.id !== requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (request.status !== "employees_planned") {
    throw new Error("Les visites individuelles doivent être créées avant d'envoyer les convocations.");
  }
  const providerName = requireString(request.providerName, "Médecin ou centre", 180);
  const activeParticipants = participantsSnap.docs
    .map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data()))
    .filter((participant) => participant.selectionStatus !== "removed");
  if (activeParticipants.length === 0) throw new Error("Aucun collaborateur actif n'est sélectionné.");

  const slots = slotsSnap.docs.map((docSnap) => serializeMedicalVisitProviderSlot(docSnap.id, docSnap.data()));
  const slotById = new Map(slots.map((slot) => [slot.slotId, slot]));
  const visitRefs = activeParticipants.map((participant) => {
    if (!participant.resultingMedicalVisitId) throw new Error("Toutes les visites individuelles doivent être créées.");
    return entityRef.collection("medicalVisits").doc(participant.resultingMedicalVisitId);
  });
  const employeeRefs = activeParticipants.map((participant) => entityRef.collection("employees").doc(participant.employeeId));
  const [visitSnaps, employeeSnaps] = await Promise.all([
    Promise.all(visitRefs.map((ref) => ref.get())),
    Promise.all(employeeRefs.map((ref) => ref.get())),
  ]);

  const rows: MedicalEmployeeInvitationPlanRow[] = [];
  for (let index = 0; index < activeParticipants.length; index += 1) {
    const participant = activeParticipants[index];
    const visitSnap = visitSnaps[index];
    const employeeSnap = employeeSnaps[index];
    if (!visitSnap.exists) throw new Error("Une visite individuelle liée est introuvable.");
    if (!employeeSnap.exists) throw new Error("Collaborateur introuvable.");
    const visit = visitSnap.data() || {};
    const employee = employeeSnap.data() || {};
    if (employee.entityId !== entityId || employee.employeeId !== participant.employeeId || !isActiveEmployee(employee)) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }
    if (
      visit.entityId !== entityId
      || visit.employeeId !== participant.employeeId
      || visit.medicalVisitRequestId !== requestId
      || visit.id !== participant.resultingMedicalVisitId
    ) {
      throw new Error("Lien de visite individuelle incohérent.");
    }
    const eligibilityStatus = resolveVisitInvitationEligibilityStatus(visit.status);
    const eligible = eligibilityStatus === "eligible";
    const visitDate = String(visit.visitDate || "");
    const visitStartTime = String(visit.visitStartTime || "");
    const visitEndTime = String(visit.visitEndTime || "");
    const location = String(visit.medicalCenter || "");
    if (eligible) {
      requireDateOnly(visitDate, "Date de visite");
      requireTime(visitStartTime, "Heure de début");
      requireTime(visitEndTime, "Heure de fin");
      if (visitEndTime <= visitStartTime) throw new Error("Horaire de visite incohérent.");
      requireString(location, "Lieu", 240);
    }
    const slot = visit.providerSlotId ? slotById.get(String(visit.providerSlotId)) : null;
    if (!slot || slot.entityId !== entityId || slot.requestId !== requestId) {
      throw new Error("Créneau médecin lié introuvable.");
    }
    const recipientUid = await resolveActiveEmployeeAccountUid(entityId, employee);
    const emailRecipient = normalizeOptionalEmail(employee.email);
    const classification = resolveInvitationClassification(!!recipientUid, !!emailRecipient);
    const medicalVisitId = participant.resultingMedicalVisitId;
    if (!medicalVisitId) throw new Error("Toutes les visites individuelles doivent être créées.");
    rows.push({
      employeeId: participant.employeeId,
      employeeCodeSnapshot: participant.employeeCodeSnapshot,
      employeeDisplayNameSnapshot: participant.employeeDisplayNameSnapshot,
      medicalVisitId,
      visitTypeLabel: MEDICAL_VISIT_TYPE_LABELS[visit.visitType as MedicalVisitType] || String(visit.visitType || request.visitType || "Visite médicale"),
      visitDate,
      visitDateLabel: formatMedicalDate(visitDate),
      visitStartTime,
      visitEndTime,
      providerName,
      location,
      instructions: slot.instructions || null,
      recipientUid,
      emailRecipient,
      classification,
      eligibilityStatus,
      eligibilityLabel: getVisitInvitationEligibilityLabel(eligibilityStatus),
      eligible,
      participant,
    });
  }

  if (!rows.some((row) => row.eligible)) {
    throw new Error("Aucune visite planifiée ne peut être notifiée.");
  }

  return {
    entityName: resolveMedicalEntityName(entitySnap.data() || {}),
    request,
    rows,
  };
}

async function resolveActiveEmployeeAccountUid(entityId: string, employee: Record<string, any>) {
  if (!adminDb) return null;
  const uid = String(employee.userId || "").trim();
  if (!uid) return null;
  const [userSnap, membershipSnap] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("memberships").doc(`${uid}_${entityId}`).get(),
  ]);
  if (!userSnap.exists || userSnap.data()?.status !== "active") return null;
  if (!membershipSnap.exists || membershipSnap.data()?.status !== "active") return null;
  return uid;
}

function normalizeOptionalEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function resolveInvitationClassification(hasActiveAccount: boolean, hasValidEmail: boolean): MedicalEmployeeInvitationClassification {
  if (hasActiveAccount && hasValidEmail) return "notification_and_email";
  if (hasActiveAccount) return "notification_only";
  if (hasValidEmail) return "email_only";
  return "manual_contact_required";
}

function resolveVisitInvitationEligibilityStatus(status: unknown): MedicalEmployeeInvitationEligibilityStatus {
  switch (String(status || "")) {
    case "scheduled":
      return "eligible";
    case "completed":
      return "skipped_visit_completed";
    case "cancelled":
      return "skipped_visit_cancelled";
    case "archived":
      return "skipped_visit_archived";
    case "pending_result":
      return "skipped_visit_pending_result";
    default:
      return "skipped_visit_ineligible_status";
  }
}

function getVisitInvitationEligibilityLabel(status: MedicalEmployeeInvitationEligibilityStatus) {
  switch (status) {
    case "eligible":
      return "Éligible — visite planifiée";
    case "skipped_visit_completed":
      return "Non éligible — visite déjà terminée";
    case "skipped_visit_cancelled":
      return "Non éligible — visite annulée";
    case "skipped_visit_archived":
      return "Non éligible — visite archivée";
    case "skipped_visit_pending_result":
      return "Non éligible — résultat en attente";
    default:
      return "Non éligible — statut de visite incompatible";
  }
}

function getInvitationClassificationLabel(classification: MedicalEmployeeInvitationClassification) {
  switch (classification) {
    case "notification_and_email":
      return "Notification + e-mail";
    case "notification_only":
      return "Notification uniquement";
    case "email_only":
      return "E-mail uniquement";
    default:
      return "Contact manuel requis";
  }
}

function toMedicalEmployeeInvitationPreviewRow(item: MedicalEmployeeInvitationPlanRow): MedicalEmployeeInvitationPreviewRow {
  return {
    employeeId: item.employeeId,
    employeeCodeSnapshot: item.employeeCodeSnapshot,
    employeeDisplayNameSnapshot: item.employeeDisplayNameSnapshot,
    medicalVisitId: item.medicalVisitId,
    visitDate: item.visitDate,
    visitDateLabel: item.visitDateLabel,
    visitStartTime: item.visitStartTime,
    visitEndTime: item.visitEndTime,
    providerName: item.providerName,
    location: item.location,
    instructions: item.instructions,
    hasActiveAccount: !!item.recipientUid,
    hasValidEmail: !!item.emailRecipient,
    emailRecipient: item.emailRecipient,
    classification: item.classification,
    classificationLabel: getInvitationClassificationLabel(item.classification),
    eligibilityStatus: item.eligibilityStatus,
    eligibilityLabel: item.eligibilityLabel,
    eligible: item.eligible,
    notificationStatus: item.participant.notificationStatus,
    emailStatus: item.participant.emailStatus,
    sampleMessage: `Bonjour ${item.employeeDisplayNameSnapshot}, votre visite médicale est planifiée le ${item.visitDateLabel} de ${item.visitStartTime} à ${item.visitEndTime}, à ${item.location}.`,
  };
}

function summarizeInvitationPreview(rows: MedicalEmployeeInvitationPreviewRow[]) {
  const eligibleRows = rows.filter((row) => row.eligible);
  return {
    notificationAndEmail: eligibleRows.filter((row) => row.classification === "notification_and_email").length,
    notificationOnly: eligibleRows.filter((row) => row.classification === "notification_only").length,
    emailOnly: eligibleRows.filter((row) => row.classification === "email_only").length,
    manualContactRequired: eligibleRows.filter((row) => row.classification === "manual_contact_required").length,
    eligibleCount: eligibleRows.length,
    skippedCount: rows.length - eligibleRows.length,
  };
}

function summarizeInvitationSend(rows: MedicalEmployeeInvitationSendResultRow[]) {
  const channelSucceeded = (status: MedicalEmployeeInvitationChannelStatus) => status === "sent" || status === "already_sent";
  const eligibleRows = rows.filter((row) => row.eligible);
  return {
    processedCount: rows.length,
    notificationSentCount: eligibleRows.filter((row) => channelSucceeded(row.notificationDeliveryStatus)).length,
    emailSentCount: eligibleRows.filter((row) => channelSucceeded(row.emailDeliveryStatus)).length,
    manualContactCount: eligibleRows.filter((row) => row.classification === "manual_contact_required").length,
    eligibleCount: eligibleRows.length,
    skippedCount: rows.length - eligibleRows.length,
    failureCount: eligibleRows.filter((row) => row.notificationDeliveryStatus === "failed" || row.emailDeliveryStatus === "failed").length,
  };
}

function resolveInvitationDeliveryResultStatus(
  row: MedicalEmployeeInvitationPreviewRow,
  notificationStatus: MedicalEmployeeInvitationChannelStatus,
  emailStatus: MedicalEmployeeInvitationChannelStatus
) {
  if (!row.eligible) return row.eligibilityStatus;
  if (notificationStatus === "failed" || emailStatus === "failed") {
    const oneChannelSucceeded = notificationStatus === "sent"
      || notificationStatus === "already_sent"
      || emailStatus === "sent"
      || emailStatus === "already_sent";
    return oneChannelSucceeded ? "partially_sent" : "failed";
  }
  if (row.classification === "manual_contact_required") return "manual_contact_required";
  return "sent";
}

function normalizeEmail(value: unknown) {
  const email = requireString(value, "Adresse e-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Adresse e-mail invalide.");
  }
  return email;
}

function requireDateOnly(value: unknown, label: string) {
  if (!isValidDateOnly(value)) throw new Error(`${label} invalide.`);
  return value as string;
}

function requireTime(value: unknown, label: string) {
  if (!isValidTime(value)) throw new Error(`${label} invalide.`);
  return value as string;
}

function normalizeUniqueEmployeeIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Collaborateurs requis.");
  const employeeIds = value.map((item) => {
    if (typeof item !== "string") throw new Error("Collaborateur invalide.");
    return item.trim();
  }).filter(Boolean);
  if (employeeIds.length === 0) throw new Error("Au moins un collaborateur doit être sélectionné.");
  const unique = new Set(employeeIds);
  if (unique.size !== employeeIds.length) throw new Error("Un collaborateur ne peut pas être sélectionné plusieurs fois.");
  return employeeIds;
}

function isActiveEmployee(employee: Record<string, any>) {
  const status = String(employee.status || "").toLowerCase();
  return status === "active" || status === "actif" || status === "active_contract";
}

function requireString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${label} invalide.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} requis.`);
  if (trimmed.length > maxLength) throw new Error(`${label} trop long.`);
  return trimmed;
}

function assertAllowed<T extends string>(value: unknown, allowed: T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} invalide.`);
  }
  return value as T;
}

function assertExactKeys(input: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error("Champs non autorisés dans la requête.");
  }
}

function buildDeterministicId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function serializeTimestamp(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function serializeMedicalVisitRequest(id: string, data: Record<string, any>): MedicalVisitRequestSummary {
  return {
    id,
    entityId: String(data.entityId || ""),
    visitType: data.visitType,
    providerType: data.providerType,
    providerName: String(data.providerName || ""),
    providerEmail: String(data.providerEmail || ""),
    medicalCenter: data.medicalCenter || null,
    desiredStartDate: String(data.desiredStartDate || ""),
    desiredEndDate: String(data.desiredEndDate || ""),
    urgency: data.urgency || "normal",
    constraints: data.constraints || null,
    status: data.status || "draft",
    participantCount: Number(data.participantCount || 0),
    createdAt: serializeTimestamp(data.createdAt),
    createdBy: String(data.createdBy || ""),
    updatedAt: serializeTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy || ""),
    providerRequestSentAt: serializeTimestamp(data.providerRequestSentAt),
    providerRequestSentBy: data.providerRequestSentBy || null,
    providerRequestSentByName: data.providerRequestSentByName || null,
    providerRequestSentByDisplayName: data.providerRequestSentByName || null,
    providerRequestSentRecipient: data.providerRequestSentRecipient || null,
    providerRequestSentSubject: data.providerRequestSentSubject || null,
    providerRequestSendCount: Number(data.providerRequestSendCount || 0),
    providerResponseRecordedAt: serializeTimestamp(data.providerResponseRecordedAt),
    providerResponseRecordedBy: data.providerResponseRecordedBy || null,
    providerResponseRecordedByName: data.providerResponseRecordedByName || null,
    slotCount: Number(data.slotCount || 0),
    assignedParticipantCount: Number(data.assignedParticipantCount || 0),
    unassignedParticipantCount: Number(data.unassignedParticipantCount || 0),
    individualVisitsCreatedAt: serializeTimestamp(data.individualVisitsCreatedAt),
    individualVisitsCreatedBy: data.individualVisitsCreatedBy || null,
    individualVisitsCreatedByName: data.individualVisitsCreatedByName || null,
    individualVisitsCount: Number(data.individualVisitsCount || 0),
    employeeInvitationsLastSentAt: serializeTimestamp(data.employeeInvitationsLastSentAt),
    employeeInvitationsLastSentBy: data.employeeInvitationsLastSentBy || null,
    employeeInvitationsLastSentByName: data.employeeInvitationsLastSentByName || null,
    employeeInvitationAttemptCount: Number(data.employeeInvitationAttemptCount || 0),
    employeeNotificationSentCount: Number(data.employeeNotificationSentCount || 0),
    employeeEmailSentCount: Number(data.employeeEmailSentCount || 0),
    employeeManualContactCount: Number(data.employeeManualContactCount || 0),
    employeeInvitationEligibleCount: Number(data.employeeInvitationEligibleCount || 0),
    employeeInvitationSkippedCount: Number(data.employeeInvitationSkippedCount || 0),
    employeeInvitationFailureCount: Number(data.employeeInvitationFailureCount || 0),
  };
}

async function enrichMedicalVisitRequestSlotSummaries(entityId: string, requests: MedicalVisitRequestSummary[]) {
  if (!adminDb || requests.length === 0) return requests;
  return Promise.all(requests.map(async (request) => {
    const requestRef = adminDb.collection("entities").doc(entityId).collection("medicalVisitRequests").doc(request.id);
    const [slotsSnap, participantsSnap] = await Promise.all([
      requestRef.collection("slots").get(),
      requestRef.collection("participants").get(),
    ]);
    const activeParticipants = participantsSnap.docs
      .map((docSnap) => docSnap.data() || {})
      .filter((participant) => participant.selectionStatus !== "removed");
    const assignedParticipantCount = activeParticipants.filter((participant) => (
      !!participant.assignedSlotId && !!participant.assignedStartTime && !!participant.assignedEndTime
    )).length;
    return {
      ...request,
      slotCount: slotsSnap.size,
      assignedParticipantCount,
      unassignedParticipantCount: Math.max(activeParticipants.length - assignedParticipantCount, 0),
    };
  }));
}

async function enrichMedicalVisitRequestSenderNames(entityId: string, requests: MedicalVisitRequestSummary[]) {
  if (!adminDb || requests.length === 0) return requests;
  const missingSenderUids = Array.from(new Set(
    requests
      .filter((request) => request.providerRequestSentBy && !request.providerRequestSentByName)
      .map((request) => request.providerRequestSentBy as string)
  ));
  const userNameByUid = new Map<string, string>();
  await Promise.all(missingSenderUids.map(async (uid) => {
    const [userSnap, membershipSnap] = await Promise.all([
      adminDb.collection("users").doc(uid).get(),
      adminDb.collection("memberships").doc(`${uid}_${entityId}`).get(),
    ]);
    if (userSnap.exists && userSnap.data()?.status === "active" && membershipSnap.exists && membershipSnap.data()?.status === "active") {
      userNameByUid.set(uid, resolveTrustedUserDisplayName(userSnap.data() || {}, uid));
    }
  }));

  return requests.map((request) => {
    const storedName = request.providerRequestSentByName?.trim() || "";
    const derivedName = request.providerRequestSentBy
      ? userNameByUid.get(request.providerRequestSentBy) || request.providerRequestSentBy
      : null;
    return {
      ...request,
      providerRequestSentByDisplayName: storedName || derivedName,
    };
  });
}

async function enrichMedicalVisitRequestParticipantVisitStatuses(
  entityId: string,
  requestId: string,
  participants: MedicalVisitRequestParticipantDto[]
): Promise<MedicalVisitRequestParticipantDto[]> {
  if (!adminDb || participants.length === 0) return participants;
  const linkedParticipants = participants.filter((participant) => participant.resultingMedicalVisitId);
  if (linkedParticipants.length === 0) return participants;

  const visitSnaps = await Promise.all(linkedParticipants.map((participant) => (
    adminDb.collection("entities").doc(entityId)
      .collection("medicalVisits")
      .doc(participant.resultingMedicalVisitId as string)
      .get()
  )));
  const statusByEmployee = new Map<string, "created" | "incoherent">();
  linkedParticipants.forEach((participant, index) => {
    const visitSnap = visitSnaps[index];
    if (!visitSnap.exists) {
      statusByEmployee.set(participant.employeeId, "incoherent");
      return;
    }
    const visit = visitSnap.data() || {};
    const matches = visit.entityId === entityId
      && visit.employeeId === participant.employeeId
      && visit.medicalVisitRequestId === requestId
      && visit.id === participant.resultingMedicalVisitId;
    statusByEmployee.set(participant.employeeId, matches ? "created" : "incoherent");
  });

  return participants.map((participant): MedicalVisitRequestParticipantDto => ({
    ...participant,
    resultingMedicalVisitStatus: participant.resultingMedicalVisitId
      ? statusByEmployee.get(participant.employeeId) || "incoherent"
      : "not_created",
  }));
}

function serializeMedicalVisitRequestParticipant(id: string, data: Record<string, any>): MedicalVisitRequestParticipantDto {
  return {
    employeeId: String(data.employeeId || id),
    employeeCodeSnapshot: String(data.employeeCodeSnapshot || id),
    employeeDisplayNameSnapshot: String(data.employeeDisplayNameSnapshot || id),
    personId: data.personId || null,
    contractId: data.contractId || null,
    selectionStatus: data.selectionStatus || "selected",
    assignedSlotId: data.assignedSlotId || null,
    assignedStartTime: data.assignedStartTime || null,
    assignedEndTime: data.assignedEndTime || null,
    appointmentDurationMinutes: Number.isInteger(data.appointmentDurationMinutes) ? Number(data.appointmentDurationMinutes) : null,
    appointmentSequence: Number.isInteger(data.appointmentSequence) ? Number(data.appointmentSequence) : null,
    resultingMedicalVisitId: data.resultingMedicalVisitId || null,
    resultingMedicalVisitStatus: "not_created",
    notificationStatus: data.notificationStatus || "not_sent",
    notificationSentAt: serializeTimestamp(data.notificationSentAt),
    notificationRecipientUid: data.notificationRecipientUid || null,
    notificationId: data.notificationId || null,
    emailStatus: data.emailStatus || "not_sent",
    emailSentAt: serializeTimestamp(data.emailSentAt),
    emailRecipient: data.emailRecipient || null,
    emailLogId: data.emailLogId || null,
    invitationLastAttemptAt: serializeTimestamp(data.invitationLastAttemptAt),
    invitationLastAttemptBy: data.invitationLastAttemptBy || null,
    invitationLastAttemptByName: data.invitationLastAttemptByName || null,
    invitationErrorCode: data.invitationErrorCode || null,
    invitationSendCount: Number(data.invitationSendCount || 0),
    createdAt: serializeTimestamp(data.createdAt),
    createdBy: String(data.createdBy || ""),
    updatedAt: serializeTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy || ""),
  };
}

function serializeMedicalVisitProviderSlot(id: string, data: Record<string, any>): MedicalVisitProviderSlotDto {
  return {
    id,
    slotId: String(data.slotId || id),
    entityId: String(data.entityId || ""),
    requestId: String(data.requestId || ""),
    date: String(data.date || ""),
    startTime: String(data.startTime || ""),
    endTime: data.endTime || null,
    location: String(data.location || ""),
    capacity: Number.isInteger(data.capacity) && data.capacity > 0 ? Number(data.capacity) : null,
    instructions: data.instructions || null,
    createdAt: serializeTimestamp(data.createdAt),
    createdBy: String(data.createdBy || ""),
    updatedAt: serializeTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy || ""),
  };
}

async function loadVerifiedMedicalVisitRequestWithParticipants(entityId: string, requestId: string) {
  if (!adminDb || !requestId) throw new Error("Demande de visites médicales requise.");
  const entityRef = adminDb.collection("entities").doc(entityId);
  const requestRef = entityRef.collection("medicalVisitRequests").doc(requestId);
  const [entitySnap, requestSnap, participantsSnap] = await Promise.all([
    entityRef.get(),
    requestRef.get(),
    requestRef.collection("participants").get(),
  ]);
  if (!entitySnap.exists || entitySnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
  const request = requestSnap.data() || {};
  if (request.entityId !== entityId || request.id !== requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  const participants = participantsSnap.docs.map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data()));
  return { requestRef, request, participants, entity: entitySnap.data() || {} };
}

function assertRequestCanEmailProvider(request: Record<string, any>) {
  if (request.status === "cancelled") throw new Error("Impossible d'envoyer un e-mail pour une demande annulée.");
  if (!["draft", "awaiting_provider_response", "provider_request_sent"].includes(String(request.status || ""))) {
    throw new Error("Cette demande n'est pas dans un état permettant l'envoi au médecin.");
  }
  normalizeEmail(request.providerEmail);
}

function resolveMedicalEntityName(entity?: Record<string, any> | null) {
  return entity?.nomEntreprise || entity?.raisonSociale || entity?.name || entity?.displayName || "l'entreprise";
}

function resolveTrustedUserDisplayName(user?: Record<string, any> | null, fallback = "Utilisateur") {
  const displayName = String(user?.displayName || "").trim();
  if (displayName) return displayName;
  const fullName = String(user?.fullName || "").trim();
  if (fullName) return fullName;
  const firstLastName = [user?.firstName, user?.lastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (firstLastName) return firstLastName;
  const name = String(user?.name || "").trim();
  if (name) return name;
  const email = String(user?.email || "").trim();
  if (email) return email;
  return fallback;
}

function formatMedicalDate(value?: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (year && month && day) return `${day}/${month}/${year}`;
  return value;
}

function buildMedicalProviderEmailPreview(
  request: Record<string, any>,
  participants: MedicalVisitRequestParticipantDto[],
  entity: Record<string, any>
) {
  const entityName = resolveMedicalEntityName(entity);
  const recipient = normalizeEmail(request.providerEmail);
  const visitType = String(request.visitType || "");
  const providerName = String(request.providerName || "Docteur / Centre médical");
  const desiredPeriod = request.desiredStartDate === request.desiredEndDate
    ? formatMedicalDate(request.desiredStartDate)
    : `${formatMedicalDate(request.desiredStartDate)} - ${formatMedicalDate(request.desiredEndDate)}`;
  const urgency = String(request.urgency || "normal");
  const participantLines = participants.map((participant) => {
    const code = participant.employeeCodeSnapshot ? ` (${participant.employeeCodeSnapshot})` : "";
    return `- ${participant.employeeDisplayNameSnapshot}${code}`;
  });
  const constraints = String(request.constraints || "").trim();
  const defaultSubject = `Demande de disponibilités pour visites médicales — ${entityName}`;
  const summary = [
    `Destinataire : ${recipient}`,
    `Prestataire : ${providerName}`,
    `Type de visite : ${visitType}`,
    `Période souhaitée : ${desiredPeriod}`,
    `Urgence : ${urgency}`,
    `${participants.length} collaborateur${participants.length > 1 ? "s" : ""} concerné${participants.length > 1 ? "s" : ""}`,
  ];
  const defaultMessage = [
    `Bonjour ${providerName},`,
    "",
    `Nous souhaitons organiser des visites médicales pour ${participants.length} collaborateur${participants.length > 1 ? "s" : ""} de ${entityName}.`,
    "",
    `Type de visite : ${visitType}`,
    `Période souhaitée : ${desiredPeriod}`,
    `Urgence : ${urgency}`,
    constraints ? `Contraintes organisationnelles : ${constraints}` : "",
    "",
    "Collaborateurs concernés :",
    ...participantLines,
    "",
    "Pouvez-vous nous transmettre vos disponibilités en précisant, pour chaque créneau proposé :",
    "- la date ;",
    "- l'heure ;",
    "- le lieu ;",
    "- la capacité éventuelle si plusieurs salariés peuvent être reçus.",
    "",
    "Ces informations nous permettront de valider ensuite la planification interne.",
    "",
    "Cordialement,",
    `Service RH — ${entityName}`,
  ].filter((line) => line !== "").join("\n");

  return {
    recipient,
    subject: String(request.providerRequestSentSubject || "").trim() || defaultSubject,
    message: String(request.providerRequestSentBodyText || "").trim() || defaultMessage,
    summary,
  };
}

async function authorizeMedicalAction(entityId: string, idToken: string, requiredPermission: string | string[]) {
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
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  const requiredPermissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  if (
    !membershipSnap.exists
    || membership?.status !== "active"
    || requiredPermissions.some((permission) => !permissions.includes(permission))
  ) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, user: userSnap.data() || {} };
}

function sanitizeFileName(name: string) {
  return (name || "certificat-medical").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
}

async function extractMedicalCertificateFile(formData: FormData) {
  const entries = Array.from(formData.entries());
  const fileEntries = entries.filter(([, value]) => value instanceof File);
  if (fileEntries.length !== 1 || fileEntries[0][0] !== "file") {
    throw new Error("Un seul fichier de certificat médical est requis.");
  }

  const file = fileEntries[0][1];
  if (!(file instanceof File)) {
    throw new Error("Fichier de certificat médical requis.");
  }

  if (!ALLOWED_CERTIFICATE_MIME_TYPES.includes(file.type)) {
    throw new Error("Format de fichier non supporté. Veuillez utiliser PDF, PNG ou JPEG.");
  }

  if (file.size <= 0) {
    throw new Error("Le fichier est vide.");
  }

  if (file.size > MAX_CERTIFICATE_FILE_SIZE) {
    throw new Error("La taille max est de 10 Mo.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length <= 0) {
    throw new Error("Le fichier est vide.");
  }
  if (buffer.length > MAX_CERTIFICATE_FILE_SIZE) {
    throw new Error("La taille max est de 10 Mo.");
  }

  return {
    file,
    buffer,
    safeFileName: sanitizeFileName(file.name),
  };
}

function isMedicalCertificateStoragePath(storagePath: unknown, entityId: string, documentId: string) {
  return typeof storagePath === "string" && storagePath.startsWith(`entities/${entityId}/documents/${documentId}/`);
}

async function loadVerifiedMedicalCertificateDocument(entityId: string, visit: Record<string, any>) {
  if (!adminDb) throw new Error("Service administrateur indisponible.");
  const documentId = typeof visit.documentId === "string" ? visit.documentId.trim() : "";
  if (!documentId) throw new Error("Certificat médical introuvable.");

  const documentRef = adminDb.collection("entities").doc(entityId).collection("documents").doc(documentId);
  const documentSnap = await documentRef.get();
  if (!documentSnap.exists) throw new Error("Certificat médical introuvable.");

  const documentData = documentSnap.data() || {};
  const hasDocumentType = typeof documentData.documentType !== "undefined" && documentData.documentType !== null;
  const hasRelatedModule = typeof documentData.relatedModule !== "undefined" && documentData.relatedModule !== null;
  const hasRelatedId = typeof documentData.relatedId !== "undefined" && documentData.relatedId !== null;
  const hasSensitiveFlag = typeof documentData.isSensitive !== "undefined" && documentData.isSensitive !== null;
  const hasDocumentEmployee = typeof documentData.employeeId === "string" && documentData.employeeId.trim();
  const hasDocumentPerson = typeof documentData.personId === "string" && documentData.personId.trim();
  const visitEmployeeId = typeof visit.employeeId === "string" ? visit.employeeId.trim() : "";
  const visitPersonId = typeof visit.personId === "string" ? visit.personId.trim() : "";

  if (
    documentData.entityId !== entityId
    || (hasDocumentType && documentData.documentType !== "medical_certificate")
    || (hasRelatedModule && documentData.relatedModule !== "medicalVisits")
    || (hasRelatedId && documentData.relatedId !== visit.id)
    || (hasSensitiveFlag && documentData.isSensitive !== true)
    || (hasDocumentEmployee && visitEmployeeId && documentData.employeeId !== visitEmployeeId)
    || (hasDocumentPerson && visitPersonId && documentData.personId !== visitPersonId)
    || !isMedicalCertificateStoragePath(documentData.storagePath, entityId, documentId)
  ) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { documentId, documentRef, documentData };
}

async function loadVerifiedEmployee(entityId: string, employeeId: string) {
  if (!employeeId || !adminDb) throw new Error("Collaborateur requis.");

  const employeeSnap = await adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId).get();
  if (!employeeSnap.exists) throw new Error("Collaborateur introuvable.");

  const employee = employeeSnap.data() || {};
  if (employee.entityId !== entityId || employee.employeeId !== employeeId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return employee;
}

async function loadVerifiedVisit(entityId: string, visitId: string) {
  if (!visitId || !adminDb) throw new Error("Visite médicale requise.");

  const visitRef = adminDb.collection("entities").doc(entityId).collection("medicalVisits").doc(visitId);
  const visitSnap = await visitRef.get();
  if (!visitSnap.exists) throw new Error("Visite médicale introuvable.");

  const visit = visitSnap.data() || {};
  if (visit.entityId !== entityId || visit.id !== visitId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { visitRef, visit };
}

async function createMedicalVisitNotification(entityId: string, visitId: string, employee: Record<string, any>) {
  if (!adminDb) return;

  const employeeUserId = typeof employee.userId === "string" ? employee.userId.trim() : "";
  if (!employeeUserId) return;

  const [userSnap, membershipSnap] = await Promise.all([
    adminDb.collection("users").doc(employeeUserId).get(),
    adminDb.collection("memberships").doc(`${employeeUserId}_${entityId}`).get(),
  ]);

  const employeeMembership = membershipSnap.data();
  if (!userSnap.exists || userSnap.data()?.status !== "active" || !membershipSnap.exists || employeeMembership?.status !== "active") {
    return;
  }

  const notificationId = buildDeterministicId(`medical_visit_planned:${entityId}:${visitId}:${employeeUserId}`);
  const notificationRef = adminDb.collection("entities").doc(entityId).collection("notifications").doc(notificationId);
  const existing = await notificationRef.get();
  if (existing.exists) return;

  await notificationRef.set({
    id: notificationId,
    entityId,
    targetUid: employeeUserId,
    audience: "employee",
    category: "medical",
    severity: "info",
    title: "Visite médicale planifiée",
    message: "Votre visite médicale a été planifiée.",
    sourceModule: "medicalVisits",
    sourceId: visitId,
    actionUrl: `/entity/${entityId}/my-space`,
    dedupKey: `medical_visit_planned:${visitId}`,
    status: "unread",
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function createMedicalVisitAction(input: MedicalVisitCreateInput): Promise<MedicalVisitActionResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(input as Record<string, unknown>, [
      "idToken",
      "entityId",
      "employeeId",
      "visitType",
      "visitDate",
      "doctorName",
      "medicalCenter",
      "status",
    ]);
    const { actorUid } = await authorizeMedicalAction(input.entityId, input.idToken, MEDICAL_CREATE_PERMISSION);
    const employee = await loadVerifiedEmployee(input.entityId, input.employeeId);

    const visitType = assertAllowed(input.visitType, MEDICAL_VISIT_TYPES, "Type de visite");
    if (!isValidDateOnly(input.visitDate)) throw new Error("Date de visite invalide.");
    const doctorName = requireString(input.doctorName, "Médecin", 160);
    const medicalCenter = normalizeOptionalString(input.medicalCenter, 200);
    const status = input.status
      ? assertAllowed(input.status, ["scheduled", "pending_result"], "Statut")
      : "scheduled";

    const visitRef = adminDb.collection("entities").doc(input.entityId).collection("medicalVisits").doc();
    const visitId = visitRef.id;
    const now = FieldValue.serverTimestamp();

    await visitRef.set({
      id: visitId,
      entityId: input.entityId,
      employeeId: input.employeeId,
      personId: employee.personId || null,
      contractId: employee.activeContractId || employee.pendingContractId || null,
      visitType,
      visitDate: input.visitDate,
      doctorName,
      medicalCenter,
      fitnessStatus: "pending_result",
      status,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: input.entityId,
      action: "medicalVisit.created",
      resourceType: "medicalVisit",
      resourceId: visitId,
      details: { visitType, employeeId: input.employeeId },
    });

    try {
      await createMedicalVisitNotification(input.entityId, visitId, employee);
    } catch {
      // Preserve existing non-blocking notification behavior.
    }

    return { success: true, visitId };
  } catch (error: any) {
    return { success: false, error: error?.message || "Impossible de créer la visite médicale." };
  }
}

export async function updateMedicalVisitScheduleAction(input: MedicalVisitScheduleInput): Promise<MedicalVisitMutationResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(input as Record<string, unknown>, [
      "idToken",
      "entityId",
      "visitId",
      "visitType",
      "visitDate",
      "doctorName",
      "medicalCenter",
      "status",
    ]);
    const { actorUid } = await authorizeMedicalAction(input.entityId, input.idToken, MEDICAL_UPDATE_PERMISSION);
    const { visitRef } = await loadVerifiedVisit(input.entityId, input.visitId);

    const visitType = assertAllowed(input.visitType, MEDICAL_VISIT_TYPES, "Type de visite");
    if (!isValidDateOnly(input.visitDate)) throw new Error("Date de visite invalide.");
    const doctorName = requireString(input.doctorName, "Médecin", 160);
    const medicalCenter = normalizeOptionalString(input.medicalCenter, 200);
    const status = assertAllowed(input.status, SCHEDULE_UPDATE_STATUSES, "Statut");

    await visitRef.update({
      visitType,
      visitDate: input.visitDate,
      doctorName,
      medicalCenter,
      status,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: input.entityId,
      action: "medicalVisit.updated",
      resourceType: "medicalVisit",
      resourceId: input.visitId,
      details: { changes: ["visitType", "visitDate", "doctorName", "medicalCenter", "status"] },
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Impossible de mettre à jour la visite médicale." };
  }
}

export async function updateMedicalVisitResultAction(input: MedicalVisitResultInput): Promise<MedicalVisitMutationResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(input as Record<string, unknown>, [
      "idToken",
      "entityId",
      "visitId",
      "fitnessStatus",
      "nextVisitDate",
      "status",
      "prescriptions",
      "restrictions",
      "notes",
    ]);
    const { actorUid } = await authorizeMedicalAction(input.entityId, input.idToken, MEDICAL_UPDATE_PERMISSION);
    const { visitRef } = await loadVerifiedVisit(input.entityId, input.visitId);

    const fitnessStatus = assertAllowed(input.fitnessStatus, MEDICAL_FITNESS_STATUSES, "Jugement d'aptitude");
    const status = assertAllowed(input.status, RESULT_UPDATE_STATUSES, "Statut");
    const nextVisitDate = input.nextVisitDate ? input.nextVisitDate : null;
    if (nextVisitDate && !isValidDateOnly(nextVisitDate)) throw new Error("Date de prochaine visite invalide.");

    await visitRef.update({
      fitnessStatus,
      status,
      nextVisitDate,
      prescriptions: normalizeOptionalString(input.prescriptions, 2000),
      restrictions: normalizeOptionalString(input.restrictions, 2000),
      notes: normalizeOptionalString(input.notes, 2000),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: input.entityId,
      action: "medicalVisit.updated",
      resourceType: "medicalVisit",
      resourceId: input.visitId,
      details: { changes: ["fitnessStatus", "status", "nextVisitDate", "prescriptions", "restrictions", "notes"] },
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Impossible d'enregistrer le résultat médical." };
  }
}

export async function archiveMedicalVisitAction(input: {
  idToken: string;
  entityId: string;
  visitId: string;
}): Promise<MedicalVisitMutationResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    assertExactKeys(input as Record<string, unknown>, ["idToken", "entityId", "visitId"]);
    const { actorUid } = await authorizeMedicalAction(input.entityId, input.idToken, MEDICAL_UPDATE_PERMISSION);
    const { visitRef, visit } = await loadVerifiedVisit(input.entityId, input.visitId);

    if (visit.status === "archived") return { success: true };

    await visitRef.update({
      status: "archived",
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: input.entityId,
      action: "medicalVisit.archived",
      resourceType: "medicalVisit",
      resourceId: input.visitId,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Impossible d'archiver la visite médicale." };
  }
}
