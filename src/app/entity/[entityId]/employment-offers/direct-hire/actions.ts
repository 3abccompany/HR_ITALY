"use server";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createTrustedAuditLog } from "@/services/audit.server";
import { buildEmploymentOfferDraftPayload } from "@/services/employment-offer-draft.shared";
import { ensurePostAcceptanceHiringWorkflowAfterOfferAccepted } from "@/services/post-acceptance-hiring.service";
import type { Candidate } from "@/types/candidate";
import type { EmploymentOffer, PayCalculationMode } from "@/types/employment-offer";
import type { RecruitmentNeed } from "@/types/recruitment-need";

type DirectHireInput = {
  entityId: string;
  idToken: string;
  firstName: string;
  lastName: string;
  codiceFiscale?: string;
  email: string;
  phone?: string;
  birthDate?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  departmentId?: string;
  departmentName?: string;
  worksiteId?: string;
  worksiteName?: string;
  worksiteAddress?: string;
  recruitmentNeedId?: string;
  jobProfileId: string;
  jobTitleName: string;
  contractType: string;
  startDate: string;
  endDate?: string;
  ccnlId: string;
  ccnlName: string;
  cnelCode?: string;
  levelId: string;
  levelCode: string;
  levelLabel?: string;
  qualificationLabel?: string;
  weeklyHours: number;
  workingTime?: string;
  trialPeriodDays?: number;
  monthlyPayments: number;
  hourlyDivisor?: number;
  grossMonthly: number;
  grossHourly?: number;
  grossAnnual: number;
  payCalculationMode: PayCalculationMode;
  notes?: string;
};

type DirectHireResult =
  | { success: true; offerId: string; candidateId: string; personId: string; reusedPerson: boolean; reusedCandidate: boolean; reusedOffer: boolean }
  | { success: false; error: string };

const ACTIVE_OFFER_STATUSES = ["draft", "internal_review", "ready_to_send", "sent", "viewed", "accepted"];
const SELECTABLE_RECRUITMENT_NEED_STATUSES = ["open", "partially_fulfilled"];

function sanitizePayload<T extends Record<string, any>>(payload: T): T {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as T;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeTaxCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function requirePositiveNumber(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`VALIDATION_ERROR: ${label} invalide.`);
  }
  return numeric;
}

async function requireAuthorizedDirectHireUser(entityId: string, idToken: string) {
  if (!adminDb || !adminAuth) {
    throw new Error("SERVICE_UNAVAILABLE: Service administrateur indisponible.");
  }

  if (!entityId || !idToken) {
    throw new Error("PARAM_MISSING: Paramètres d'authentification incomplets.");
  }

  const decodedToken = await adminAuth.verifyIdToken(idToken);
  const actorUid = decodedToken.uid;

  const [userSnap, entitySnap, membershipSnap] = await Promise.all([
    adminDb.collection("users").doc(actorUid).get(),
    adminDb.collection("entities").doc(entityId).get(),
    adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") {
    throw new Error("ACCESS_DENIED: Utilisateur inactif ou introuvable.");
  }

  if (!entitySnap.exists || entitySnap.data()?.status !== "active") {
    throw new Error("ACCESS_DENIED: Entité inactive ou introuvable.");
  }

  const membership = membershipSnap.data();
  if (!membershipSnap.exists || membership?.status !== "active") {
    throw new Error("ACCESS_DENIED: Appartenance inactive ou introuvable.");
  }

  const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
  if (!permissions.includes("contracts.create")) {
    throw new Error("PERMISSION_DENIED: Permission contracts.create requise.");
  }

  return { actorUid, entity: entitySnap.data() || {} };
}

function validateDirectHireInput(input: DirectHireInput) {
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const email = normalizeEmail(input.email);
  const codiceFiscale = normalizeTaxCode(input.codiceFiscale);
  const startDate = normalizeText(input.startDate);
  const contractType = normalizeText(input.contractType);
  const ccnlId = normalizeText(input.ccnlId);
  const levelId = normalizeText(input.levelId);
  const jobProfileId = normalizeText(input.jobProfileId);
  const jobTitleName = normalizeText(input.jobTitleName);
  const recruitmentNeedId = normalizeText(input.recruitmentNeedId);
  const payCalculationMode: PayCalculationMode = input.payCalculationMode === "actual_worked_hours" ? "actual_worked_hours" : "monthly";

  if (!firstName || !lastName) throw new Error("VALIDATION_ERROR: Nom et prénom obligatoires.");
  if (!email) throw new Error("VALIDATION_ERROR: Email obligatoire.");
  if (!jobProfileId || !jobTitleName) throw new Error("VALIDATION_ERROR: Fiche de poste obligatoire.");
  if (!contractType) throw new Error("VALIDATION_ERROR: Type de contrat obligatoire.");
  if (!startDate) throw new Error("VALIDATION_ERROR: Date de début obligatoire.");
  if (!ccnlId || !levelId) throw new Error("VALIDATION_ERROR: CCNL et niveau obligatoires.");

  const weeklyHours = requirePositiveNumber(input.weeklyHours, "Heures hebdomadaires");
  const monthlyPayments = requirePositiveNumber(input.monthlyPayments, "Mensualités");
  const grossMonthly = requirePositiveNumber(input.grossMonthly, "Brut mensuel");
  const grossAnnual = Number.isFinite(Number(input.grossAnnual))
    ? Math.round(Number(input.grossAnnual) * 100) / 100
    : Math.round(grossMonthly * monthlyPayments * 100) / 100;

  return {
    ...input,
    firstName,
    lastName,
    email,
    codiceFiscale,
    startDate,
    contractType,
    ccnlId,
    levelId,
    jobProfileId,
    jobTitleName,
    recruitmentNeedId,
    weeklyHours,
    monthlyPayments,
    grossMonthly,
    grossAnnual,
    payCalculationMode,
  };
}

async function ensureEmploymentRequestMirror(params: {
  entityId: string;
  offer: EmploymentOffer;
  mandatoryCommunicationId: string;
  actorUid: string;
}) {
  const { entityId, offer, mandatoryCommunicationId, actorUid } = params;
  const requestId = `unilav_${offer.offerId}`;
  const requestRef = adminDb.collection("entities").doc(entityId).collection("employmentRequests").doc(requestId);
  const existing = await requestRef.get();
  if (existing.exists) return { requestId, alreadyExists: true };

  await requestRef.set(sanitizePayload({
    id: requestId,
    entityId,
    offerId: offer.offerId,
    personId: offer.personId,
    candidateId: offer.candidateId,
    candidateDisplayName: offer.candidateDisplayName || null,
    candidateEmail: offer.candidateEmail || null,
    candidatePhone: offer.candidatePhone || null,
    employeeId: offer.employeeId || null,
    contractId: offer.contractId || null,
    mandatoryCommunicationId,
    source: "offer",
    type: "unilav",
    status: "draft",
    plannedHireDate: offer.proposedStartDate || "",
    jobRoleId: offer.jobTitleName || "",
    worksiteId: offer.worksiteId || "",
    contractType: offer.contractType || null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  }));

  return { requestId, alreadyExists: false };
}

export async function createDirectHireOfferAction(input: DirectHireInput): Promise<DirectHireResult> {
  try {
    const data = validateDirectHireInput(input);
    const { actorUid, entity } = await requireAuthorizedDirectHireUser(data.entityId, data.idToken);
    const now = FieldValue.serverTimestamp();

    const result = await adminDb.runTransaction(async (transaction) => {
      const entityRef = adminDb.collection("entities").doc(data.entityId);
      const personsRef = entityRef.collection("persons");
      const candidatesRef = entityRef.collection("candidates");
      const offersRef = entityRef.collection("employmentOffers");
      let linkedNeed: RecruitmentNeed | null = null;

      if (data.recruitmentNeedId) {
        const needSnap = await transaction.get(entityRef.collection("recruitmentNeeds").doc(data.recruitmentNeedId));
        if (!needSnap.exists) {
          throw new Error("VALIDATION_ERROR: Besoin RH introuvable.");
        }

        const needData = { ...needSnap.data(), needId: needSnap.id } as RecruitmentNeed;
        if (!SELECTABLE_RECRUITMENT_NEED_STATUSES.includes(needData.status)) {
          throw new Error("VALIDATION_ERROR: Ce besoin RH n'est pas ouvert Ã  une nouvelle embauche.");
        }

        linkedNeed = needData;
      }

      let personDoc = null;
      if (data.codiceFiscale) {
        const byTax = await transaction.get(personsRef.where("codiceFiscale", "==", data.codiceFiscale).limit(1));
        personDoc = byTax.empty ? null : byTax.docs[0];
      }

      if (!personDoc && data.email) {
        const byEmail = await transaction.get(personsRef.where("email", "==", data.email).limit(1));
        personDoc = byEmail.empty ? null : byEmail.docs[0];
      }

      let personId = personDoc?.id || null;
      const personData = personDoc?.data() || null;
      const reusedPerson = !!personDoc;

      if (personData?.currentEmployeeId) {
        throw new Error("VALIDATION_ERROR: Cette personne est déjà employée active.");
      }

      const newPersonRef = personId ? null : personsRef.doc();
      if (!personId && newPersonRef) {
        personId = newPersonRef.id;
      }

      let candidateId = personData?.currentCandidateId || null;
      let candidateDoc = null;
      if (candidateId) {
        const currentCandidateSnap = await transaction.get(candidatesRef.doc(candidateId));
        if (currentCandidateSnap.exists) {
          const currentCandidateData = currentCandidateSnap.data();
          if (
            currentCandidateData?.source === "direct_hire" &&
            currentCandidateData?.personId === personId &&
            currentCandidateData?.entityId === data.entityId
          ) {
            candidateDoc = currentCandidateSnap;
          }
        }
        if (!candidateDoc) candidateId = null;
      }

      if (!candidateDoc) {
        const directCandidateSnap = await transaction.get(
          candidatesRef.where("personId", "==", personId).where("source", "==", "direct_hire").limit(1)
        );
        candidateDoc = directCandidateSnap.empty ? null : directCandidateSnap.docs[0];
        candidateId = candidateDoc?.id || null;
      }

      const reusedCandidate = !!candidateDoc;
      const newCandidateRef = candidateId ? null : candidatesRef.doc();
      if (!candidateId && newCandidateRef) {
        candidateId = newCandidateRef.id;
      }

      const activeOfferSnap = await transaction.get(
        offersRef.where("candidateId", "==", candidateId).where("status", "in", ACTIVE_OFFER_STATUSES)
      );
      const existingDirectHireOfferDoc = activeOfferSnap.docs.find((offerDoc) => {
        const existingOffer = offerDoc.data() as EmploymentOffer;
        return (
          existingOffer.acceptanceMode === "hr_direct" &&
          existingOffer.candidateId === candidateId &&
          existingOffer.personId === personId
        );
      });

      if (existingDirectHireOfferDoc) {
        const existingOffer = existingDirectHireOfferDoc.data() as EmploymentOffer;
        return {
          offerId: existingOffer.offerId || existingDirectHireOfferDoc.id,
          candidateId: candidateId!,
          personId: personId!,
          reusedPerson,
          reusedCandidate,
          reusedOffer: true,
          offer: existingOffer,
        };
      }

      if (newPersonRef) {
        transaction.set(newPersonRef, sanitizePayload({
          personId,
          entityId: data.entityId,
          firstName: data.firstName,
          lastName: data.lastName,
          displayName: `${data.firstName} ${data.lastName}`.trim(),
          codiceFiscale: data.codiceFiscale || "",
          dateOfBirth: data.birthDate || "",
          email: data.email,
          phone: data.phone || "",
          address: data.address || "",
          city: data.city || "",
          province: data.province || "",
          postalCode: data.postalCode || "",
          country: data.country || "Italie",
          currentLifecycleStatus: "candidate",
          currentCandidateId: candidateId,
          currentEmployeeId: null,
          status: "active",
          createdAt: now,
          createdBy: actorUid,
          updatedAt: now,
          updatedBy: actorUid,
        }));
      }

      if (newCandidateRef) {
        transaction.set(newCandidateRef, sanitizePayload({
          candidateId,
          entityId: data.entityId,
          personId,
          displayName: `${data.firstName} ${data.lastName}`.trim(),
          email: data.email,
          phone: data.phone || "",
          source: "direct_hire",
          positionApplied: data.jobTitleName,
          department: data.departmentName || "",
          departmentId: data.departmentId || "",
          recruitmentNeedId: linkedNeed?.needId || "",
          applicationDate: data.startDate,
          availabilityDate: data.startDate,
          expectedSalary: String(data.grossMonthly),
          status: "accepted",
          acceptedAt: now,
          acceptedBy: actorUid,
          notes: "Candidat technique créé pour embauche directe RH. Aucune candidature publique ni entretien fictif.",
          createdAt: now,
          createdBy: actorUid,
          updatedAt: now,
          updatedBy: actorUid,
        }));
      }

      transaction.set(personsRef.doc(personId!), {
        currentLifecycleStatus: "candidate",
        currentCandidateId: candidateId,
        updatedAt: now,
        updatedBy: actorUid,
      }, { merge: true });

      const offerRef = offersRef.doc();
      const offerId = offerRef.id;
      const candidate = {
        candidateId,
        entityId: data.entityId,
        personId,
        displayName: `${data.firstName} ${data.lastName}`.trim(),
        email: data.email,
        phone: data.phone || "",
        source: "direct_hire",
        positionApplied: data.jobTitleName,
        department: data.departmentName || "",
        departmentId: data.departmentId || "",
        recruitmentNeedId: linkedNeed?.needId || "",
        applicationDate: data.startDate,
        availabilityDate: data.startDate,
        expectedSalary: String(data.grossMonthly),
        status: "accepted",
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      } as Candidate;

      const offer = buildEmploymentOfferDraftPayload({
        offerId,
        entityId: data.entityId,
        candidate,
        need: linkedNeed,
        actorUid,
        now,
        revisionNumber: 1,
        previousOfferId: null,
        revisionReason: "Embauche directe RH",
        overrides: {
          entityName: entity.nomEntreprise || entity.raisonSociale || entity.name || "",
          status: "accepted",
          acceptanceMode: "hr_direct",
          acceptedBy: actorUid,
          respondedAt: now,
          directHireReason: "Confirmation RH directe sans proposition candidat publique.",
          jobProfileId: data.jobProfileId,
          jobTitleName: data.jobTitleName,
          departmentId: data.departmentId || "",
          departmentName: data.departmentName || "",
          worksiteId: data.worksiteId || "",
          worksiteName: data.worksiteName || "",
          contractType: data.contractType,
          proposedStartDate: data.startDate,
          proposedEndDate: data.endDate || undefined,
          weeklyHours: data.weeklyHours,
          workingTime: data.workingTime || "Tempo pieno (Full-time)",
          trialPeriodDays: data.trialPeriodDays || undefined,
          ccnlId: data.ccnlId,
          ccnlName: data.ccnlName,
          cnelCode: data.cnelCode || undefined,
          levelId: data.levelId,
          levelCode: data.levelCode,
          levelLabel: data.levelLabel || "",
          qualificationLabel: data.qualificationLabel || "",
          monthlyPayments: data.monthlyPayments,
          hourlyDivisor: data.hourlyDivisor || undefined,
          minGrossMonthly: data.grossMonthly,
          minGrossHourly: data.grossHourly || undefined,
          proposedGrossMonthly: data.grossMonthly,
          proposedGrossHourly: data.grossHourly || undefined,
          proposedGrossAnnual: data.grossAnnual,
          payCalculationMode: data.payCalculationMode,
          notes: data.notes || undefined,
        },
      });

      transaction.set(offerRef, sanitizePayload(offer));

      const timelineRef = entityRef.collection("personTimeline").doc();
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId: data.entityId,
        personId,
        type: "employment_offer.hr_direct_accepted",
        label: "Embauche directe confirmée",
        description: "Proposition acceptée comme état de workflow par RH, sans portail candidat.",
        sourceCollection: "employmentOffers",
        sourceId: offerId,
        createdAt: now,
        createdBy: actorUid,
      }));

      return {
        offerId,
        candidateId: candidateId!,
        personId: personId!,
        reusedPerson,
        reusedCandidate,
        reusedOffer: false,
        offer,
      };
    });

    const workflow = await ensurePostAcceptanceHiringWorkflowAfterOfferAccepted({
      entityId: data.entityId,
      employmentOfferId: result.offerId,
      actorUid,
      offerSnapshot: {
        candidateId: result.candidateId,
        personId: result.personId,
        candidateDisplayName: result.offer.candidateDisplayName,
        candidateEmail: result.offer.candidateEmail,
        candidatePhone: result.offer.candidatePhone,
        jobTitleName: result.offer.jobTitleName,
        departmentName: result.offer.departmentName,
        worksiteName: result.offer.worksiteName,
        worksiteAddress: data.worksiteAddress || null,
        contractType: result.offer.contractType,
        workingTime: result.offer.workingTime,
        proposedStartDate: result.offer.proposedStartDate,
        proposedEndDate: result.offer.proposedEndDate,
        ccnlName: result.offer.ccnlName,
        levelCode: result.offer.levelCode,
        levelLabel: result.offer.levelLabel,
        proposedGrossMonthly: result.offer.proposedGrossMonthly,
        proposedGrossAnnual: result.offer.proposedGrossAnnual,
        acceptanceMode: "hr_direct",
      },
    });

    await ensureEmploymentRequestMirror({
      entityId: data.entityId,
      offer: result.offer,
      mandatoryCommunicationId: workflow.mandatoryCommunicationId,
      actorUid,
    });

    await createTrustedAuditLog({
      actorUid,
      entityId: data.entityId,
      action: "employmentOffer.direct_hire_confirmed",
      resourceType: "employmentOffer",
      resourceId: result.offerId,
      details: {
        candidateId: result.candidateId,
        personId: result.personId,
        acceptanceMode: "hr_direct",
        reusedPerson: result.reusedPerson,
        reusedCandidate: result.reusedCandidate,
        reusedOffer: result.reusedOffer,
      },
    });

    return {
      success: true,
      offerId: result.offerId,
      candidateId: result.candidateId,
      personId: result.personId,
      reusedPerson: result.reusedPerson,
      reusedCandidate: result.reusedCandidate,
      reusedOffer: result.reusedOffer,
    };
  } catch (err: any) {
    console.error("[Direct Hire Action]", err);
    return { success: false, error: err.message || "Erreur lors de l'embauche directe." };
  }
}
