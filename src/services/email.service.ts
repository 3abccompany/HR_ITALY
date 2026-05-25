'use server';
/**
 * @fileOverview Server-only email service for HR communications.
 * Handles template variable replacement and interacts with email providers.
 */

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import nodemailer from 'nodemailer';

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
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user;

    if (host && user && pass) {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to,
        subject: renderedSubject,
        html: renderedBody.replace(/\n/g, '<br>'),
        text: renderedBody,
      });
    } else {
      console.log(`[Email Service] SMTP not configured. Log only: to=${to}, subject=${renderedSubject}`);
    }

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
 * 7K-D: Returns error if no provider is configured.
 */
export async function sendEmploymentOfferEmail(params: SendOfferEmailParams) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    throw new Error("Configuration du service email requise.");
  }

  // Defensive values to avoid "undefined" in the body
  const candidateName = params.candidateName || "candidat";
  const jobTitle = params.jobTitle || "poste proposé";
  const companyName = params.companyName || "notre entreprise";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.6;">
      <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Proposition d'embauche</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; border-radius: 0 0 12px 12px; background-color: white;">
        <p>Bonjour <strong>${candidateName}</strong>,</p>
        <p>Nous avons le plaisir de vous transmettre une proposition d'embauche pour le poste de <strong>${jobTitle}</strong> au sein de l'entreprise <strong>${companyName}</strong>.</p>
        <p>Vous pouvez consulter les détails de cette proposition et nous transmettre votre réponse via notre portail sécurisé :</p>
        
        <div style="margin: 40px 0; text-align: center;">
          <a href="${params.offerLink}" style="background-color: #4DB3E6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(77, 179, 230, 0.3);">
            Consulter ma proposition
          </a>
        </div>
        
        <p style="font-size: 12px; color: #71717A; text-align: center; margin-top: 20px;">
          Ce lien sécurisé est personnel et valable jusqu'au <strong>${params.expiresAt}</strong>.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #EEEFF7; margin: 30px 0;">
        
        <p style="font-size: 11px; color: #A1A1AA; font-style: italic;">
          Ceci est un message automatique généré par HR Nexus Studio. Merci de ne pas répondre directement à cet email.
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html,
      text: `Bonjour ${candidateName},\n\nNous avons le plaisir de vous transmettre une proposition d'embauche pour le poste de ${jobTitle} au sein de ${companyName}.\n\nVous pouvez consulter les détails de cette proposition via le lien suivant : ${params.offerLink}\n\nCe lien est valable jusqu'au ${params.expiresAt}.`,
    });
    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] SMTP Send Error:", error);
    throw new Error(`Erreur lors de l'envoi de l'email : ${error.message}`);
  }
}
