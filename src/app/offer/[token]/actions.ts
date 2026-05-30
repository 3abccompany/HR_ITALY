
'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import { PublicOfferDTO, EmploymentOffer } from "@/types/employment-offer";
import { sendEmploymentOfferEmail } from "@/services/email.service";

/**
 * 7K-D Server Action: Sends the offer to the candidate.
 * Generates token, creates global lookup, and updates offer status.
 */
export async function sendOfferToCandidateAction(params: {
  entityId: string;
  offerId: string;
  actorUid: string;
}) {
  const { entityId, offerId, actorUid } = params;

  try {
    const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
    const snap = await offerRef.get();
    
    if (!snap.exists) throw new Error("Proposition introuvable.");
    const offer = snap.data() as EmploymentOffer;

    const allowed = ["ready_to_send", "sent", "viewed"];
    if (!allowed.includes(offer.status)) {
      throw new Error("Le statut actuel de la proposition ne permet pas l'envoi.");
    }

    const entitySnap = await adminDb.collection("entities").doc(entityId).get();
    const entityData = entitySnap.data();
    const resolvedEntityName = entityData?.nomEntreprise || entityData?.raisonSociale || "l'entreprise";

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const validityDays = offer.linkValidityDays || 7;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + validityDays);

    const baseUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    const offerLink = `${baseUrl}/offer/${rawToken}`;

    await sendEmploymentOfferEmail({
      to: offer.candidateEmail,
      subject: `Proposta di assunzione — ${resolvedEntityName}`,
      candidateName: offer.candidateDisplayName,
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
    return { success: true };
  } catch (err: any) {
    console.error("[Send Offer Action] Error:", err);
    return { success: false, error: err.message };
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

    if (offer.status === "sent") {
      await offerSnap.ref.update({ status: "viewed", viewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }

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
      const dossierId = adminDb.collection("entities").doc(tokenData.entityId).collection("preHireDossiers").doc().id;
      const dossierRef = adminDb.collection("entities").doc(tokenData.entityId).collection("preHireDossiers").doc(dossierId);
      
      transaction.set(dossierRef, {
        dossierId,
        entityId: tokenData.entityId,
        personId: offer.personId,
        candidateId: offer.candidateId,
        employmentOfferId: offer.offerId,
        recruitmentNeedId: offer.recruitmentNeedId,
        status: "documents_required",
        readyForConversion: false,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "candidate_portal",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "candidate_portal",
      });

      // Default Italian Items
      const defaultDocs = [
        { label: "Documento d'identità", type: "id" },
        { label: "Codice Fiscale", type: "tax_code" },
        { label: "IBAN", type: "iban" },
        { label: "Residenza / Domicilio", type: "residence" }
      ];

      defaultDocs.forEach(d => {
        const itemRef = dossierRef.collection("checklist").doc();
        transaction.set(itemRef, {
          itemId: itemRef.id,
          type: d.type,
          label: d.label,
          status: "missing",
          isRequired: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }

    const timelineRef = adminDb.collection("entities").doc(tokenData.entityId).collection("personTimeline").doc();
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId: tokenData.entityId,
      personId: offer.personId,
      type: response === "accepted" ? "employment_offer.accepted" : "employment_offer.declined",
      label: response === "accepted" ? "Proposition acceptée" : "Proposition refusée",
      description: response === "accepted" ? "Dossier d'embauche initié." : reason,
      sourceCollection: "employmentOffers",
      sourceId: tokenData.offerId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "candidate_portal",
    });

    return { success: true };
  });
}
