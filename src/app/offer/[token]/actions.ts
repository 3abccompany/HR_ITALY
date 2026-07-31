'use server';

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import { PublicOfferDTO, EmploymentOffer } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { sendEmploymentOfferEmail } from "@/services/email.service";
import { buildExternalPublicUrl, getExternalPublicBaseUrl } from "@/lib/url/external-public-url";

const OFFER_SEND_PERMISSIONS = ["contracts.create", "contracts.update"];
const SAFE_FORBIDDEN_MESSAGE = "AccÃ¨s refusÃ©.";

async function authorizeOfferSend(params: { entityId: string; idToken: string }) {
  const { entityId, idToken } = params;
  if (!entityId || !idToken) {
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
  if (!OFFER_SEND_PERMISSIONS.some((permission) => permissions.includes(permission))) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid, entityData: entitySnap.data() || {} };
}

function resolveTrustedCandidateEmail(candidate: Candidate, person: Person | null) {
  const candidateEmail = typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : "";
  if (candidateEmail) return candidateEmail;

  const personEmail = typeof person?.email === "string" ? person.email.trim().toLowerCase() : "";
  if (personEmail) return personEmail;

  throw new Error("DonnÃ©es candidat incomplÃ¨tes.");
}

/**
 * 7K-D Server Action: Sends the offer to the candidate.
 * Generates token, creates global lookup, and updates offer status.
 */
export async function sendOfferToCandidateAction(params: {
  entityId: string;
  offerId: string;
  idToken: string;
}): Promise<{ success: true; actorUid: string } | { success: false; error: string }> {
  const { entityId, offerId, idToken } = params;

  try {
    const { actorUid, entityData } = await authorizeOfferSend({ entityId, idToken });

    const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
    const snap = await offerRef.get();
    
    if (!snap.exists) throw new Error("Proposition introuvable.");
    const offer = snap.data() as EmploymentOffer;
    if (offer.entityId && offer.entityId !== entityId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    if (!offer.candidateId) {
      throw new Error("DonnÃ©es candidat incomplÃ¨tes.");
    }

    const candidateSnap = await adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId).get();
    if (!candidateSnap.exists) {
      throw new Error("DonnÃ©es candidat incomplÃ¨tes.");
    }

    const candidate = candidateSnap.data() as Candidate;
    if (candidate.entityId && candidate.entityId !== entityId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }
    if (candidate.candidateId && candidate.candidateId !== offer.candidateId) {
      throw new Error("DonnÃ©es candidat incohÃ©rentes.");
    }
    if (offer.personId && candidate.personId !== offer.personId) {
      throw new Error("DonnÃ©es candidat incohÃ©rentes.");
    }

    let person: Person | null = null;
    if (offer.personId) {
      const personSnap = await adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId).get();
      if (!personSnap.exists) {
        throw new Error("DonnÃ©es candidat incomplÃ¨tes.");
      }
      person = personSnap.data() as Person;
      if (person.entityId && person.entityId !== entityId) {
        throw new Error(SAFE_FORBIDDEN_MESSAGE);
      }
      if (candidate.personId && person.personId !== candidate.personId) {
        throw new Error("DonnÃ©es candidat incohÃ©rentes.");
      }
    }

    const allowed = ["ready_to_send", "sent", "viewed"];
    if (!allowed.includes(offer.status)) {
      throw new Error("Le statut actuel de la proposition ne permet pas l'envoi.");
    }

    const resolvedEntityName = entityData?.nomEntreprise || entityData?.raisonSociale || "l'entreprise";
    const trustedRecipientEmail = resolveTrustedCandidateEmail(candidate, person);
    const externalPublicBaseUrl = getExternalPublicBaseUrl();

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const validityDays = offer.linkValidityDays || 7;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + validityDays);

    const offerLink = buildExternalPublicUrl(`/offer/${rawToken}`, externalPublicBaseUrl);

    await sendEmploymentOfferEmail({
      entityId,
      to: trustedRecipientEmail,
      subject: `Proposta di assunzione — ${resolvedEntityName}`,
      candidateName: candidate.displayName || offer.candidateDisplayName,
      companyName: resolvedEntityName,
      jobTitle: offer.jobTitleName,
      offerLink,
      expiresAt: expiry.toLocaleString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    });

    const batch = adminDb.batch();

    if (offer.publicAccessTokenHash) {
      const oldTokenRef = adminDb.collection("publicOfferTokens").doc(offer.publicAccessTokenHash);
      batch.update(oldTokenRef, { status: "revoked", updatedAt: FieldValue.serverTimestamp() });
    }

    const lookupRef = adminDb.collection("publicOfferTokens").doc(tokenHash);
    batch.set(lookupRef, {
      tokenHash,
      entityId,
      offerId,
      expiresAt: Timestamp.fromDate(expiry),
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid
    });

    const isResent = offer.status === "sent" || offer.status === "viewed";
    batch.update(offerRef, {
      status: "sent",
      publicAccessTokenHash: tokenHash,
      publicAccessTokenExpiresAt: Timestamp.fromDate(expiry),
      sentAt: FieldValue.serverTimestamp(),
      sentBy: actorUid,
      resendCount: (offer.resendCount || 0) + (isResent ? 1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid
    });

    await batch.commit();
    return { success: true, actorUid };
  } catch (err: any) {
    console.error("[Send Offer Action] Error:", err);
    return { success: false, error: err.message || "Envoi impossible." };
  }
}

export async function getPublicOfferAction(rawToken: string) {
  if (!rawToken) return { success: false, error: "Token manquant." };
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  try {
    const tokenSnap = await adminDb.collection("publicOfferTokens").doc(tokenHash).get();
    if (!tokenSnap.exists) return { success: false, error: "Lien invalide ou expiré." };

    const tokenData = tokenSnap.data()!;
    if (tokenData.status !== "active") return { success: false, error: "Cette proposition n'est plus accessible." };
    if (tokenData.expiresAt.toDate() < new Date()) return { success: false, error: "Le lien a expiré." };

    const offerSnap = await adminDb.collection("entities").doc(tokenData.entityId).collection("employmentOffers").doc(tokenData.offerId).get();
    if (!offerSnap.exists) return { success: false, error: "Dossier introuvable." };
    const offer = offerSnap.data() as EmploymentOffer;

    const entitySnap = await adminDb.collection("entities").doc(tokenData.entityId).get();
    const entityData = entitySnap.data();
    const resolvedEntityName = entityData?.nomEntreprise || "Notre entreprise";

    // Update tracking metrics
    const updatePayload: any = {
      viewCount: FieldValue.increment(1),
      lastViewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    if (offer.status === "sent") {
      updatePayload.status = "viewed";
    }

    if (!offer.viewedAt) {
      updatePayload.viewedAt = FieldValue.serverTimestamp();
    }

    await offerSnap.ref.update(updatePayload);

    const dto: PublicOfferDTO = {
      entityName: resolvedEntityName,
      candidateDisplayName: offer.candidateDisplayName,
      jobTitleName: offer.jobTitleName,
      departmentName: offer.departmentName,
      worksiteName: offer.worksiteName,
      contractType: offer.contractType,
      proposedStartDate: offer.proposedStartDate,
      proposedEndDate: offer.proposedEndDate,
      weeklyHours: offer.weeklyHours,
      trialPeriodDays: offer.trialPeriodDays,
      ccnlName: offer.ccnlName,
      levelCode: offer.levelCode,
      levelLabel: offer.levelLabel,
      qualificationLabel: offer.qualificationLabel,
      proposedGrossMonthly: offer.proposedGrossMonthly,
      proposedGrossAnnual: offer.proposedGrossAnnual,
      salaryNotes: offer.salaryNotes,
      status: offer.status,
      expiresAt: tokenData.expiresAt.toDate().toISOString()
    };

    return { success: true, offer: dto };
  } catch (err: any) {
    return { success: false, error: "Une erreur technique est survenue." };
  }
}

/**
 * 7K-F-A Extension: Automatically ensures a Pre-Hire Dossier when offer is accepted.
 * Phase 5A: Mirrors acceptance into standalone Employment Request foundation.
 */
export async function respondToOfferAction(rawToken: string, response: "accepted" | "declined", reason?: string) {
  if (!rawToken) throw new Error("Token manquant.");
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return await adminDb.runTransaction(async (transaction) => {
    const tokenRef = adminDb.collection("publicOfferTokens").doc(tokenHash);
    const tokenSnap = await transaction.get(tokenRef);
    if (!tokenSnap.exists || tokenSnap.data()?.status !== "active") throw new Error("Lien invalide.");

    const tokenData = tokenSnap.data()!;
    const offerRef = adminDb.collection("entities").doc(tokenData.entityId).collection("employmentOffers").doc(tokenData.offerId);
    const offerSnap = await transaction.get(offerRef);
    if (!offerSnap.exists) throw new Error("Proposition introuvable.");

    const offer = offerSnap.data() as EmploymentOffer;
    if (["accepted", "declined", "cancelled"].includes(offer.status)) throw new Error("Réponse déjà enregistrée.");

    transaction.update(offerRef, {
      status: response,
      candidateResponse: response,
      declinedReason: reason || null,
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "candidate_portal"
    });

    transaction.update(tokenRef, { status: "used", updatedAt: FieldValue.serverTimestamp() });

    // --- 7K-F-A: Auto-initialize Pre-Hire Dossier ---
    if (response === "accepted") {
      const offerData = offer as EmploymentOffer & Record<string, any>;
    
      const dossierId = adminDb
        .collection("entities")
        .doc(tokenData.entityId)
        .collection("preHireDossiers")
        .doc().id;
    
      const dossierRef = adminDb
        .collection("entities")
        .doc(tokenData.entityId)
        .collection("preHireDossiers")
        .doc(dossierId);
    
      const communicationId = adminDb
        .collection("entities")
        .doc(tokenData.entityId)
        .collection("mandatoryCommunications")
        .doc().id;
    
      const communicationRef = adminDb
        .collection("entities")
        .doc(tokenData.entityId)
        .collection("mandatoryCommunications")
        .doc(communicationId);
    
      transaction.set(dossierRef, {
        dossierId,
        entityId: tokenData.entityId,
    
        personId: offerData.personId || null,
        candidateId: offerData.candidateId || null,
        employmentOfferId: offerData.offerId || tokenData.offerId,
        recruitmentNeedId: offerData.recruitmentNeedId || null,
    
        status: "documents_required",
        readyForConversion: false,
    
        mandatoryCommunicationId: communicationId,
        coStatus: "to_prepare",
    
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "candidate_portal",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "candidate_portal",
      });
    
      const defaultDocs = [
        {
          label: "Carte d’identità",
          type: "identity_document",
          isRequired: true,
        },
        {
          label: "Tessera sanitaria",
          type: "health_card",
          isRequired: true,
        },
        {
          label: "Richiesta assunzione",
          type: "hiring_request",
          isRequired: true,
        }
      ];
    
      defaultDocs.forEach((d) => {
        const itemRef = dossierRef.collection("checklist").doc();
    
        transaction.set(itemRef, {
          itemId: itemRef.id,
          dossierId,
          entityId: tokenData.entityId,
          employmentOfferId: offerData.offerId || tokenData.offerId,
    
          type: d.type,
          label: d.label,
          status: "missing",
          isRequired: d.isRequired,
    
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    
      transaction.set(communicationRef, {
        communicationId,
        entityId: tokenData.entityId,
    
        employmentOfferId: offerData.offerId || tokenData.offerId,
        preHireDossierId: dossierId || null,
        candidateId: offerData.candidateId || null,
        personId: offerData.personId || null,
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
    
        emailSubject: "",
        emailBody: "",
    
        protocolNumber: "",
        receiptPdfUrl: "",
        submittedAt: null,
    
        missingFields: [],
        notes:
          "Communication obligatoire préparée en mode brouillon. Aucun email réel envoyé au consultant.",
    
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "candidate_portal",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "candidate_portal",
      });

      // --- PHASE 5A: Mirror to standalone EmploymentRequest foundation ---
      try {
         const requestId = `unilav_${offer.offerId}`;
         const requestRef = adminDb.collection("entities").doc(tokenData.entityId).collection("employmentRequests").doc(requestId);
         
         // Use transaction.set to ensure atomicity within existing response transaction
         transaction.set(requestRef, {
           id: requestId,
           entityId: tokenData.entityId,
           offerId: offer.offerId,
           personId: offer.personId,
           candidateId: offer.candidateId,
           candidateDisplayName: offer.candidateDisplayName || null,
           candidateEmail: offer.candidateEmail || null,
           candidatePhone: offer.candidatePhone || null,
           mandatoryCommunicationId: communicationId,
           source: "offer",
           type: "unilav",
           status: "draft",
           plannedHireDate: offer.proposedStartDate || "",
           jobRoleId: offer.jobTitleName || "",
           worksiteId: offer.worksiteId || "",
           contractType: offer.contractType || null,
           createdAt: FieldValue.serverTimestamp(),
           createdBy: "candidate_portal",
           updatedAt: FieldValue.serverTimestamp(),
           updatedBy: "candidate_portal",
         });
      } catch (err) {
         console.warn("[Phase 5A Mirror] Mirror creation skipped or failed:", err);
      }
    }

    const timelineRef = adminDb.collection("entities").doc(tokenData.entityId).collection("personTimeline").doc();
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId: tokenData.entityId,
      personId: offer.personId,
      type: response === "accepted" ? "employment_offer.accepted" : "employment_offer.declined",
      label: "Proposition acceptée",
      description: response === "accepted" ? "Dossier d'embauche initié." : reason,
      sourceCollection: "employmentOffers",
      sourceId: tokenData.offerId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "candidate_portal",
    });

    return { success: true };
  });
}
