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
      entityId,
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
    
      const candidateName =
        offerData.candidateDisplayName || "Candidato non specificato";
    
      const startDate =
        offerData.proposedStartDate || "Data da confermare";
      
      const endDate =
        offerData.proposedEndDate || "Nessuna data di fine (Indeterminato)";
    
      const consultantEmailSubject =
        `Richiesta Comunicazione Obbligatoria / UniLav — ${candidateName} — ${startDate}`;
    
      const consultantEmailBody = [
        "Buongiorno,",
        "",
        `il candidato ${candidateName} ha accettato l'offerta di assunzione.`,
        "",
        "Si richiede la predisposizione della Comunicazione Obbligatoria / UniLav, salvo verifica documentale finale.",
        "",
        "Dati principali:",
        `- Candidato: ${candidateName}`,
        `- Email candidato: ${offerData.candidateEmail || "-"}`,
        `- Telefono candidato: ${offerData.candidatePhone || "-"}`,
        `- Mansione / posizione: ${offerData.jobTitleName || "-"}`,
        `- Reparto: ${offerData.departmentName || "-"}`,
        `- Sede di lavoro: ${offerData.worksiteName || "-"}`,
        `- Tipo contratto: ${offerData.contractType || "-"}`,
        `- Orario: ${offerData.workingTime || "-"}`,
        `- Data inizio proposta: ${startDate}`,
        `- Data fine proposta: ${endDate}`,
        `- CCNL: ${offerData.ccnlName || "-"}`,
        `- Livello: ${offerData.levelCode || offerData.levelLabel || "-"}`,
        `- Retribuzione lorda mensile: ${offerData.proposedGrossMonthly || "-"} €`,
        `- RAL: ${offerData.proposedGrossAnnual || "-"} €`,
        "",
        "Documenti da verificare:",
        "- Carte d’identità: da verificare",
        "- Tessera sanitaria: da verificare",
        "- Richiesta assunzione: da verificare",
        "",
        "Si prega di confermare eventuali dati mancanti.",
        "",
        "Nota: questa email è una richiesta operativa di preparazione. Non costituisce conferma di invio ufficiale UniLav.",
        "",
        "Cordiali saluti.",
      ].join("\n");
    
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
    
        emailSubject: consultantEmailSubject,
        emailBody: consultantEmailBody,
    
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
