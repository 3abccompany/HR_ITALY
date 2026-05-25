'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import { PublicOfferDTO, EmploymentOffer } from "@/types/employment-offer";
import { sendEmploymentOfferEmail } from "@/services/email.service";

/**
 * 7K-D Server Action: Sends the offer to the candidate.
 * Generates token, creates global lookup, and updates offer status.
 * Reordered to ensure status only updates on successful email send.
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

    // Allowed statuses for sending/resending
    const allowed = ["ready_to_send", "sent", "viewed"];
    if (!allowed.includes(offer.status)) {
      throw new Error("Le statut actuel de la proposition ne permet pas l'envoi.");
    }

    // Resolve Entity Name for the email
    const entitySnap = await adminDb.collection("entities").doc(entityId).get();
    const entityData = entitySnap.data();
    const resolvedEntityName = entityData?.nomEntreprise || entityData?.raisonSociale || entityData?.name || entityData?.legalName || "l'entreprise";

    // 1. Generate Token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7); // Default 7 days

    // 2. Prepare Link
    const baseUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    const offerLink = `${baseUrl}/offer/${rawToken}`;

    // 3. Attempt to Send Email (CRITICAL STEP)
    // This will throw if the provider is not configured or fails.
    await sendEmploymentOfferEmail({
      to: offer.candidateEmail,
      subject: `Proposition d'embauche — ${resolvedEntityName}`,
      candidateName: offer.candidateDisplayName,
      companyName: resolvedEntityName,
      jobTitle: offer.jobTitleName,
      offerLink,
      expiresAt: expiry.toLocaleDateString('fr-FR', { dateStyle: 'long' })
    });

    // 4. Update Database (Only if email was accepted by provider)
    const batch = adminDb.batch();

    // Revoke old token if exists
    if (offer.publicAccessTokenHash) {
      const oldTokenRef = adminDb.collection("publicOfferTokens").doc(offer.publicAccessTokenHash);
      batch.update(oldTokenRef, {
        status: "revoked",
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    // Create Global Lookup
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

    // Update Offer
    const isResend = offer.status === "sent" || offer.status === "viewed";
    batch.update(offerRef, {
      status: "sent",
      publicAccessTokenHash: tokenHash,
      publicAccessTokenExpiresAt: Timestamp.fromDate(expiry),
      sentAt: FieldValue.serverTimestamp(),
      sentBy: actorUid,
      resendCount: (offer.resendCount || 0) + (isResend ? 1 : 0),
      lastResentAt: isResent ? FieldValue.serverTimestamp() : null,
      lastResentBy: isResent ? actorUid : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid
    });

    await batch.commit();

    return { success: true };
  } catch (err: any) {
    console.error("[Send Offer Action] Error:", err);
    // If we catch an error here, no DB updates (batch) will have been committed.
    return { success: false, error: err.message };
  }
}

/**
 * 7K-D Server Action: Fetches sanitized data for the public portal.
 * Implements the Privacy Firewall.
 */
export async function getPublicOfferAction(rawToken: string) {
  if (!rawToken) return { success: false, error: "Token manquant." };

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  try {
    // 1. Find Token Lookup
    const tokenSnap = await adminDb.collection("publicOfferTokens").doc(tokenHash).get();
    if (!tokenSnap.exists) return { success: false, error: "Lien invalide ou expiré." };

    const tokenData = tokenSnap.data()!;
    if (tokenData.status !== "active") return { success: false, error: "Cette proposition n'est plus accessible." };
    
    if (tokenData.expiresAt.toDate() < new Date()) {
      return { success: false, error: "Le lien de cette proposition a expiré." };
    }

    // 2. Fetch Entity-Scoped Offer
    const offerSnap = await adminDb
      .collection("entities").doc(tokenData.entityId)
      .collection("employmentOffers").doc(tokenData.offerId)
      .get();

    if (!offerSnap.exists) return { success: false, error: "Dossier introuvable." };
    const offer = offerSnap.data() as EmploymentOffer;

    if (offer.status === "cancelled") return { success: false, error: "Cette proposition a été annulée par l'entreprise." };

    // Resolve Entity Name for the DTO
    const entitySnap = await adminDb.collection("entities").doc(tokenData.entityId).get();
    const entityData = entitySnap.data();
    const resolvedEntityName = entityData?.nomEntreprise || entityData?.raisonSociale || entityData?.name || entityData?.legalName || "Notre entreprise";

    // 3. Mark as Viewed (Transactional)
    if (offer.status === "sent") {
      await offerSnap.ref.update({
        status: "viewed",
        viewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    // 4. Sanitize DTO (Privacy Firewall)
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
    console.error("[Get Public Offer Action] Error:", err);
    return { success: false, error: "Une erreur technique est survenue." };
  }
}

/**
 * 7K-D Server Action: Handles candidate response (Accept/Decline).
 */
export async function respondToOfferAction(rawToken: string, response: "accepted" | "declined", reason?: string) {
  if (!rawToken) throw new Error("Token manquant.");

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return await adminDb.runTransaction(async (transaction) => {
    // 1. Validate Token
    const tokenRef = adminDb.collection("publicOfferTokens").doc(tokenHash);
    const tokenSnap = await transaction.get(tokenRef);
    if (!tokenSnap.exists || tokenSnap.data()?.status !== "active") {
      throw new Error("Lien invalide ou déjà utilisé.");
    }

    const tokenData = tokenSnap.data()!;
    if (tokenData.expiresAt.toDate() < new Date()) throw new Error("Lien expiré.");

    // 2. Validate Offer
    const offerRef = adminDb.collection("entities").doc(tokenData.entityId).collection("employmentOffers").doc(tokenData.offerId);
    const offerSnap = await transaction.get(offerRef);
    if (!offerSnap.exists) throw new Error("Proposition introuvable.");

    const offer = offerSnap.data() as EmploymentOffer;
    if (["accepted", "declined", "cancelled"].includes(offer.status)) {
      throw new Error("Une réponse a déjà été enregistrée pour ce dossier.");
    }

    // 3. Update Everything
    transaction.update(offerRef, {
      status: response,
      candidateResponse: response,
      declinedReason: reason || null,
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "candidate_public_portal"
    });

    transaction.update(tokenRef, {
      status: "used",
      lastUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // 4. Timeline Event
    const timelineRef = adminDb.collection("entities").doc(tokenData.entityId).collection("personTimeline").doc();
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId: tokenData.entityId,
      personId: offer.personId,
      type: response === "accepted" ? "employment_offer.accepted" : "employment_offer.declined",
      label: response === "accepted" ? "Proposition acceptée" : "Proposition refusée",
      description: response === "accepted" 
        ? `Le candidat a accepté la proposition pour le poste de ${offer.jobTitleName}.` 
        : `Le candidat a décliné la proposition. Motif : ${reason || "Non renseigné"}`,
      sourceCollection: "employmentOffers",
      sourceId: tokenData.offerId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "candidate_public_portal",
    });

    return { success: true };
  });
}
