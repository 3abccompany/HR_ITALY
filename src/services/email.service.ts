
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
 * Implementation note: This currently simulates a send and updates Firestore logs.
 * In a real production environment, this would call Resend, SendGrid, or Postmark.
 */
export async function sendInterviewEmailAction(params: SendInterviewEmailParams) {
  const { entityId, interviewId, to, subject, message, templateData } = params;

  if (!adminDb) throw new Error("Firestore Admin not initialized");

  const renderedSubject = renderTemplate(subject, templateData);
  const renderedBody = renderTemplate(message, templateData);

  try {
    // --- PROVIDER INTEGRATION POINT ---
    // Example: const response = await resend.emails.send({ ... });
    console.log(`[Email Service] Mock sending email to: ${to}`);
    console.log(`[Email Service] Subject: ${renderedSubject}`);
    
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update Logs & Interview Document
    const interviewRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(interviewId);
    await interviewRef.update({
      emailStatus: "sent",
      emailSentAt: FieldValue.serverTimestamp(),
    });

    // Update EmailLog in the subcollection (using a query since we might not have the logId easily)
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
    
    // Update Interview with failure
    const interviewRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(interviewId);
    await interviewRef.update({
      emailStatus: "failed",
      emailError: error.message || "Unknown error",
    }).catch(() => {});

    return { success: false, error: error.message };
  }
}
