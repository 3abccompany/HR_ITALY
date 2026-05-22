'use server';
/**
 * @fileOverview Server-only email service for HR communications.
 * Handles template variable replacement and interacts with email providers.
 */

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

export interface SendInterviewEmailParams {
  entityId: string;
  interviewId: string;
  to: string;
  subject: string;
  message: string;
  templateData: {
    candidateName: string;
    jobTitle: string;
    companyName: string;
    interviewDate: string;
    interviewTime: string;
    locationOrLink: string;
    recruiterName: string;
  };
}

export interface SendOfferEmailParams {
  to: string;
  subject: string;
  candidateName: string;
  companyName: string;
  jobTitle: string;
  offerLink: string;
  expiresAt: string;
}

/**
 * Replaces {{variable}} placeholders in a string.
 */
function renderTemplate(template: string, data: Record<string, string>): string {
  let rendered = template;
  Object.entries(data).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value || '');
  });
  return rendered;
}

/**
 * Server Action to send an interview notification.
 */
export async function sendInterviewEmailAction(params: SendInterviewEmailParams) {
  const { entityId, interviewId, to, subject, message, templateData } = params;

  if (!adminDb) throw new Error("Firestore Admin not initialized");

  const renderedSubject = renderTemplate(subject, templateData);
  const renderedBody = renderTemplate(message, templateData);

  try {
    // --- PROVIDER INTEGRATION POINT ---
    // In a real environment, use Resend, SendGrid, etc.
    console.log(`[Email Service] Mock sending email to: ${to}`);
    
    await new Promise(resolve => setTimeout(resolve, 500));

    const interviewRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(interviewId);
    await interviewRef.update({
      emailStatus: "sent",
      emailSentAt: FieldValue.serverTimestamp(),
    });

    const logsRef = adminDb.collection("entities").doc(entityId).collection("emailLogs");
    const logSnap = await logsRef.where("interviewId", "==", interviewId).limit(1).get();
    
    if (!logSnap.empty) {
      await logSnap.docs[0].ref.update({
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        subject: renderedSubject,
        body: renderedBody,
      });
    }

    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] Failed to send email:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Sends the formal employment offer link to the candidate.
 * 7K-D requirement: Return error if no provider is configured.
 */
export async function sendEmploymentOfferEmail(params: SendOfferEmailParams) {
  // CONFIGURATION CHECK: Throw if no real SMTP/API key is present to avoid silent fakes.
  // Replace 'MOCK' with your real env variable check if available.
  const hasProvider = false; // Set to true when Resend/SendGrid is integrated.

  if (!hasProvider) {
    throw new Error("Configuration du service email requise.");
  }

  console.log(`[Email Service] Sending Offer to ${params.to} for ${params.jobTitle}`);
  
  // Real implementation would go here...
  return { success: true };
}
