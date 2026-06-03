import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_PRE_HIRE_CHECKLIST,
  calculatePreHireReadiness,
} from "@/lib/post-acceptance-hiring/defaults";
import type {
  MandatoryCommunication,
  PreHireDossier,
  PreHireDocumentChecklistItem,
} from "@/types/post-acceptance-hiring";

export type OfferAcceptanceSnapshot = {
  candidateId?: string | null;
  personId?: string | null;

  candidateDisplayName?: string | null;
  candidateEmail?: string | null;
  candidatePhone?: string | null;

  jobTitleName?: string | null;
  departmentName?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: string | null;

  contractType?: string | null;
  workingTime?: string | null;
  proposedStartDate?: string | null;
  proposedEndDate?: string | null;

  ccnlName?: string | null;
  levelCode?: string | null;
  levelLabel?: string | null;

  proposedGrossMonthly?: number | null;
  proposedGrossAnnual?: number | null;
};

export type EnsurePostAcceptanceHiringInput = {
  entityId: string;
  employmentOfferId: string;
  actorUid: string;
  offerSnapshot: OfferAcceptanceSnapshot;
};

export type EnsurePostAcceptanceHiringResult = {
  dossierId: string;
  mandatoryCommunicationId: string;
  createdDossier: boolean;
  createdMandatoryCommunication: boolean;
  emailMode: "draft_only";
  consultantEmailSent: false;
};

type PreHireDossierPayload = PreHireDossier & {
  dossierId: string;
  mandatoryCommunicationId?: string | null;
};

type MandatoryCommunicationPayload = MandatoryCommunication & {
  communicationId: string;
  emailSubject: string;
  emailBody: string;
};

function cloneDefaultChecklist(): PreHireDocumentChecklistItem[] {
  return DEFAULT_PRE_HIRE_CHECKLIST.map((item) => ({
    ...item,
  }));
}

function formatEuro(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";

  return `${value.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function buildConsultantEmailDraft(snapshot: OfferAcceptanceSnapshot) {
  const candidateName =
    snapshot.candidateDisplayName || "Candidato non specificato";

  const startDate = snapshot.proposedStartDate || "Data da confermare";
  const endDate = snapshot.proposedEndDate || "Nessuna data di fine (Indeterminato)";

  const subject = `Richiesta Comunicazione Obbligatoria / UniLav — ${candidateName} — ${startDate}`;

  const body = [
    "Buongiorno,",
    "",
    `il candidato ${candidateName} ha accettato l'offerta di assunzione.`,
    "",
    "Si richiede la predisposizione della Comunicazione Obbligatoria / UniLav, salvo verifica documentale finale.",
    "",
    "Dati principali:",
    `- Candidato: ${candidateName}`,
    `- Email candidato: ${snapshot.candidateEmail || "-"}`,
    `- Telefono candidato: ${snapshot.candidatePhone || "-"}`,
    `- Mansione / posizione: ${snapshot.jobTitleName || "-"}`,
    `- Reparto: ${snapshot.departmentName || "-"}`,
    `- Sede di lavoro: ${snapshot.worksiteName || "-"}`,
    `- Indirizzo sede: ${snapshot.worksiteAddress || "-"}`,
    `- Tipo contratto: ${snapshot.contractType || "-"}`,
    `- Orario: ${snapshot.workingTime || "-"}`,
    `- Data inizio proposta: ${startDate}`,
    `- Data fine proposta: ${endDate}`,
    `- CCNL: ${snapshot.ccnlName || "-"}`,
    `- Livello: ${snapshot.levelCode || snapshot.levelLabel || "-"}`,
    `- Retribuzione lorda mensile: ${formatEuro(snapshot.proposedGrossMonthly)}`,
    `- RAL: ${formatEuro(snapshot.proposedGrossAnnual)}`,
    "",
    "Documenti:",
    "- Documento di identità: da verificare",
    "- Codice fiscale / tessera sanitaria: da verificare",
    "- Permesso di soggiorno: se applicabile",
    "- IBAN: da verificare",
    "- Residenza / domicilio: da verificare",
    "",
    "Si prega di confermare eventuali dati mancanti.",
    "",
    "Nota: questa email è una richiesta operativa di preparazione. Non costituisce conferma di invio ufficiale UniLav.",
    "",
    "Cordiali saluti.",
  ].join("\n");

  return { subject, body };
}

async function findExistingPreHireDossier(
  entityId: string,
  employmentOfferId: string
) {
  const snap = await adminDb
    .collection("entities")
    .doc(entityId)
    .collection("preHireDossiers")
    .where("employmentOfferId", "==", employmentOfferId)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  const data = docSnap.data();

  return {
    id: docSnap.id,
    dossierId: data.dossierId || docSnap.id,
    data,
  };
}

async function findExistingMandatoryCommunication(
  entityId: string,
  employmentOfferId: string
) {
  const snap = await adminDb
    .collection("entities")
    .doc(entityId)
    .collection("mandatoryCommunications")
    .where("employmentOfferId", "==", employmentOfferId)
    .limit(10)
    .get();

  const match = snap.docs.find((docSnap) => {
    const data = docSnap.data();
    return data.type === "UNILAV_ASSUNZIONE";
  });

  if (!match) return null;

  const data = match.data();

  return {
    id: match.id,
    communicationId: data.communicationId || match.id,
    data,
  };
}

export async function ensurePostAcceptanceHiringWorkflowAfterOfferAccepted(
  input: EnsurePostAcceptanceHiringInput
): Promise<EnsurePostAcceptanceHiringResult> {
  const { entityId, employmentOfferId, actorUid, offerSnapshot } = input;

  if (!entityId) {
    throw new Error("ENTITY_ID_REQUIRED");
  }

  if (!employmentOfferId) {
    throw new Error("EMPLOYMENT_OFFER_ID_REQUIRED");
  }

  if (!actorUid) {
    throw new Error("ACTOR_UID_REQUIRED");
  }

  const existingDossier = await findExistingPreHireDossier(
    entityId,
    employmentOfferId
  );

  const existingCommunication = await findExistingMandatoryCommunication(
    entityId,
    employmentOfferId
  );

  if (existingDossier && existingCommunication) {
    return {
      dossierId: existingDossier.dossierId,
      mandatoryCommunicationId: existingCommunication.communicationId,
      createdDossier: false,
      createdMandatoryCommunication: false,
      emailMode: "draft_only",
      consultantEmailSent: false,
    };
  }

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  let dossierId = existingDossier?.dossierId;

  let dossierRef = existingDossier?.id
    ? adminDb
        .collection("entities")
        .doc(entityId)
        .collection("preHireDossiers")
        .doc(existingDossier.id)
    : null;

  let createdDossier = false;

  if (!existingDossier) {
    dossierRef = adminDb
      .collection("entities")
      .doc(entityId)
      .collection("preHireDossiers")
      .doc();

    dossierId = dossierRef.id;

    const checklist = cloneDefaultChecklist();
    const readiness = calculatePreHireReadiness(checklist);

    const dossierPayload: PreHireDossierPayload = {
      id: dossierId,
      dossierId,
      entityId,

      employmentOfferId,
      candidateId: offerSnapshot.candidateId || null,
      personId: offerSnapshot.personId || null,
      employeeId: null,
      contractId: null,

      status: readiness.readyForConversion
        ? "ready_for_employee_creation"
        : "docs_requested",

      candidateDisplayName: offerSnapshot.candidateDisplayName || null,
      candidateEmail: offerSnapshot.candidateEmail || null,
      jobTitleName: offerSnapshot.jobTitleName || null,
      departmentName: offerSnapshot.departmentName || null,
      worksiteName: offerSnapshot.worksiteName || null,
      proposedStartDate: offerSnapshot.proposedStartDate || null,

      checklist,
      requiredDocumentsCount: readiness.requiredDocumentsCount,
      approvedRequiredDocumentsCount:
        readiness.approvedRequiredDocumentsCount,
      readyForConversion: readiness.readyForConversion,

      mandatoryCommunicationId: null,

      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };

    batch.set(dossierRef, dossierPayload);

    for (const item of checklist) {
      const checklistItemRef = dossierRef.collection("checklist").doc(item.key);

      batch.set(checklistItemRef, {
        id: item.key,
        itemId: item.key,
        dossierId,
        entityId,
        employmentOfferId,

        key: item.key,
        label: item.label,
        description: item.description || "",
        required: item.required,
        conditional: item.conditional || false,
        conditionNote: item.conditionNote || "",

        status: item.status,
        rejectionReason: "",
        documentId: null,

        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }

    createdDossier = true;
  }

  let mandatoryCommunicationId = existingCommunication?.communicationId;
  let createdMandatoryCommunication = false;

  if (!existingCommunication) {
    const communicationRef = adminDb
      .collection("entities")
      .doc(entityId)
      .collection("mandatoryCommunications")
      .doc();

    mandatoryCommunicationId = communicationRef.id;

    const emailDraft = buildConsultantEmailDraft(offerSnapshot);

    const communicationPayload: MandatoryCommunicationPayload = {
      id: mandatoryCommunicationId,
      communicationId: mandatoryCommunicationId,
      entityId,

      employmentOfferId,
      preHireDossierId: dossierId || null,
      candidateId: offerSnapshot.candidateId || null,
      personId: offerSnapshot.personId || null,
      employeeId: null,
      contractId: null,

      type: "UNILAV_ASSUNZIONE",
      status: "draft",

      consultantEmail: "",
      consultantName: "",
      emailMode: "draft_only",

      emailPrepared: true,
      emailSent: false,
      sentToConsultantAt: null,

      emailSubject: emailDraft.subject,
      emailBody: emailDraft.body,

      protocolNumber: "",
      receiptPdfUrl: "",
      submittedAt: null,

      missingFields: [],
      notes:
        "Communication obligatoire préparée en mode brouillon. Aucun email réel envoyé au consultant.",

      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };

    batch.set(communicationRef, communicationPayload);

    if (dossierRef && dossierId) {
      batch.set(
        dossierRef,
        {
          mandatoryCommunicationId,
          updatedAt: now,
          updatedBy: actorUid,
        },
        { merge: true }
      );
    }

    createdMandatoryCommunication = true;
  }

  await batch.commit();

  return {
    dossierId: dossierId!,
    mandatoryCommunicationId: mandatoryCommunicationId!,
    createdDossier,
    createdMandatoryCommunication,
    emailMode: "draft_only",
    consultantEmailSent: false,
  };
}
