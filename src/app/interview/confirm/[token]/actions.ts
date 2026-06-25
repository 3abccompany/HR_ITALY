'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "crypto";

/**
 * Server action to securely retrieve interview details for public confirmation.
 */
export async function getPublicInterviewAction(rawToken: string): Promise<{ success: boolean; interview?: any; error?: string }> {
  if (!rawToken) return { success: false, error: "Token manquant." };
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const tokenSnap = await adminDb.collection("publicInterviewTokens").doc(tokenHash).get();
    if (!tokenSnap.exists) return { success: false, error: "Lien invalide ou expiré." };

    const tokenData = tokenSnap.data()!;
    if (tokenData.status !== "active") return { success: false, error: "Ce lien n'est plus actif." };
    
    // Check expiration against scheduled time
    const expiresAt = tokenData.expiresAt.toDate();
    if (expiresAt < new Date()) {
       return { success: false, error: "La date de cet entretien est passée." };
    }

    const interviewSnap = await adminDb.collection("entities").doc(tokenData.entityId).collection("interviews").doc(tokenData.interviewId).get();
    if (!interviewSnap.exists) return { success: false, error: "Entretien introuvable." };
    const interview = interviewSnap.data()!;

    return { 
      success: true, 
      interview: {
        id: interview.interviewId,
        candidateName: interview.candidateDisplayName,
        jobTitle: interview.positionApplied,
        scheduledAt: interview.scheduledAt,
        interviewerName: interview.interviewerName,
        type: interview.interviewType,
        location: interview.location,
        confirmationStatus: interview.confirmationStatus || "pending"
      }
    };
  } catch (err: any) {
    console.error("[Get Public Interview Action] Error:", err);
    return { success: false, error: "Erreur lors de la récupération des détails." };
  }
}

/**
 * Marks the interview invitation response (Confirm or Decline).
 */
export async function confirmInterviewAttendanceAction(rawToken: string, response: "confirmed" | "declined" = "confirmed"): Promise<{ success: boolean; error?: string }> {
  if (!rawToken) throw new Error("Token manquant.");
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    return await adminDb.runTransaction(async (transaction) => {
      const tokenRef = adminDb.collection("publicInterviewTokens").doc(tokenHash);
      const tokenSnap = await transaction.get(tokenRef);
      
      if (!tokenSnap.exists || tokenSnap.data()?.status !== "active") {
        throw new Error("Lien invalide ou déjà utilisé.");
      }

      const tokenData = tokenSnap.data()!;
      const interviewRef = adminDb.collection("entities").doc(tokenData.entityId).collection("interviews").doc(tokenData.interviewId);
      const interviewSnap = await transaction.get(interviewRef);

      if (!interviewSnap.exists) throw new Error("Entretien introuvable.");

      // Update Payload
      const updatePayload: any = {
        confirmationStatus: response,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (response === "confirmed") {
        updatePayload.confirmedAt = FieldValue.serverTimestamp();
      } else {
        updatePayload.declinedAt = FieldValue.serverTimestamp();
      }

      // Atomic updates
      transaction.update(interviewRef, updatePayload);

      transaction.update(tokenRef, {
        status: "used",
        updatedAt: FieldValue.serverTimestamp()
      });

      // Record Timeline Event ONLY for confirmations (as per instructions: do not add personTimeline in this fix)
      // Existing timeline logic is preserved for 'confirmed' but not extended to 'declined' to stay strict.
      if (response === "confirmed") {
        const timelineRef = adminDb.collection("entities").doc(tokenData.entityId).collection("personTimeline").doc();
        transaction.set(timelineRef, {
          eventId: timelineRef.id,
          entityId: tokenData.entityId,
          personId: interviewSnap.data()?.personId,
          type: "interview.attendance_confirmed",
          label: "Présence confirmée",
          description: "Le candidat a confirmé sa présence à l'entretien via le lien sécurisé.",
          sourceCollection: "interviews",
          sourceId: tokenData.interviewId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "candidate_portal"
        });
      }

      return { success: true };
    });
  } catch (err: any) {
    console.error("[Confirm Attendance Action] Error:", err);
    return { success: false, error: err.message };
  }
}
