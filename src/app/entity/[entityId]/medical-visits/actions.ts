"use server";

import crypto from "crypto";
import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createTrustedAuditLog } from "@/services/audit.server";
import { sendMedicalProviderAvailabilityRequestEmail } from "@/services/email.service";
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
};

type MedicalVisitRequestParticipantDto = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  personId: string | null;
  contractId: string | null;
  selectionStatus: string;
  assignedSlotId: string | null;
  resultingMedicalVisitId: string | null;
  notificationStatus: string;
  emailStatus: string;
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
  | { success: true; request: MedicalVisitRequestSummary; participants: MedicalVisitRequestParticipantDto[] }
  | { success: false; error: string };

type MedicalProviderEmailPreviewResult =
  | { success: true; preview: { recipient: string; subject: string; message: string; summary: string[] } }
  | { success: false; error: string };

type MedicalProviderEmailSendResult =
  | { success: true; requestId: string; sendCount: number; alreadySent?: boolean }
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

    return {
      success: true,
      requests: await enrichMedicalVisitRequestSenderNames(params.entityId, requests),
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
    const [requestSnap, participantsSnap] = await Promise.all([
      requestRef.get(),
      requestRef.collection("participants").get(),
    ]);
    if (!requestSnap.exists) throw new Error("Demande de visites médicales introuvable.");
    const request = serializeMedicalVisitRequest(requestSnap.id, requestSnap.data() || {});
    if (request.entityId !== params.entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);

    const [enrichedRequest] = await enrichMedicalVisitRequestSenderNames(params.entityId, [request]);

    return {
      success: true,
      request: enrichedRequest,
      participants: participantsSnap.docs.map((docSnap) => serializeMedicalVisitRequestParticipant(docSnap.id, docSnap.data())),
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
  };
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

function serializeMedicalVisitRequestParticipant(id: string, data: Record<string, any>): MedicalVisitRequestParticipantDto {
  return {
    employeeId: String(data.employeeId || id),
    employeeCodeSnapshot: String(data.employeeCodeSnapshot || id),
    employeeDisplayNameSnapshot: String(data.employeeDisplayNameSnapshot || id),
    personId: data.personId || null,
    contractId: data.contractId || null,
    selectionStatus: data.selectionStatus || "selected",
    assignedSlotId: data.assignedSlotId || null,
    resultingMedicalVisitId: data.resultingMedicalVisitId || null,
    notificationStatus: data.notificationStatus || "not_sent",
    emailStatus: data.emailStatus || "not_sent",
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
