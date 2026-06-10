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

export interface SendDocumentRequestParams {
  to: string;
  candidateName: string;
  companyName: string;
  jobTitle: string;
  requiredDocuments: string[];
  contactEmail: string;
}

export interface SendConsultantCPIParams {
  entityId: string;
  requestId: string;
  to: string;
  subject: string;
  templateData: {
    consultantName: string;
    candidateName: string;
    candidateEmail?: string;
    candidatePhone?: string;
    jobTitle: string;
    companyName: string;
    plannedHireDate: string;
    contractType: string;
    requestId: string;
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
 * Internal helper to render the CPI email content based on common template data.
 */
function renderConsultantCPIEmailContent(data: SendConsultantCPIParams['templateData']) {
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.5;">
      <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">Richiesta Comunicazione Obbligatoria (UniLav)</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; background-color: white; border-radius: 0 0 12px 12px;">
        <p>Gentile <strong>${data.consultantName || 'Consulente'}</strong>,</p>
        <p>con la presente si richiede la predisposizione della comunicazione obbligatoria (UniLav) per l'assunzione del seguente candidato:</p>
        
        <div style="background: #F8FAFC; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E2E8F0;">
          <p style="margin: 0 0 10px 0;"><strong>Dettagli Candidato:</strong></p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
            <li>Nome: ${data.candidateName}</li>
            <li>Email: ${data.candidateEmail || '-'}</li>
            <li>Telefono: ${data.candidatePhone || '-'}</li>
          </ul>
          <p style="margin: 15px 0 10px 0;"><strong>Dettagli Contrattuali:</strong></p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
            <li>Posizione: ${data.jobTitle}</li>
            <li>Azienda: ${data.companyName}</li>
            <li>Tipo contratto: ${data.contractType}</li>
            <li>Data inizio prevista: <strong>${data.plannedHireDate}</strong></li>
          </ul>
        </div>

        <p>Vi preghiamo gentilmente di procedere con l'invio e di trasmetterci non appena disponibili:</p>
        <ul style="font-size: 14px; color: #475569;">
          <li>Il <strong>codice di protocollo</strong> UniLav.</li>
          <li>La <strong>data effettiva</strong> di comunicazione.</li>
          <li>Il <strong>file PDF del récépissé</strong> ufficiale.</li>
        </ul>

        <p style="margin-top: 30px; font-size: 13px; color: #94A3B8;">
          Riferimento interno pratica: ${data.requestId}
        </p>
        
        <p style="border-top: 1px solid #EEEFF7; padding-top: 20px; font-size: 14px; font-weight: bold;">
          Cordiali saluti,<br>
          Ufficio Risorse Umane — ${data.companyName}
        </p>
      </div>
    </div>
  `;

  const text = `Richiesta UniLav per ${data.candidateName}. Data inizio: ${data.plannedHireDate}.`;

  return { html, text };
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
        <p>Buongiorno <strong>${candidateName}</strong>,</p>
        <p>Abbiamo il piacere di trasmetterti una proposta di assunzione per la posizione di <strong>${jobTitle}</strong> presso l'azienda <strong>${companyName}</strong>.</p>
        <p>Puoi consultare i dettagli di questa proposta e trasmetterci la tua risposta tramite il nostro portale sicuro:</p>
        
        <div style="margin: 40px 0; text-align: center;">
          <a href="${params.offerLink}" style="background-color: #4DB3E6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(77, 179, 230, 0.3);">
            Visualizza la mia proposta
          </a>
        </div>
        
        <p style="font-size: 12px; color: #71717A; text-align: center; margin-top: 20px;">
          Questo link sicuro è personale e valido fino al <strong>${params.expiresAt}</strong>.
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
    });
    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] SMTP Send Error:", error);
    throw new Error(`Erreur lors de l'envoi de l'email : ${error.message}`);
  }
}

/**
 * Sends a request for hiring documents to the candidate in Italian.
 */
export async function sendDocumentRequestEmailAction(params: SendDocumentRequestParams) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    console.warn("[Email Service] SMTP not configured. Simulating success for document request.");
    return { success: true };
  }

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });

  const docList = params.requiredDocuments.map(d => `<li>${d}</li>`).join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66;">
      <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px;">Documenti necessari per l'assunzione</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; background-color: white;">
        <p>Buongiorno <strong>${params.candidateName}</strong>,</p>
        <p>Siamo lieti di procedere con la tua assunzione per la posizione di <strong>${params.jobTitle}</strong> presso <strong>${params.companyName}</strong>.</p>
        <p>Per poter predisporre il contratto e le comunicazioni obbligatorie, ti chiediamo gentilmente di inviarci i seguenti documenti:</p>
        <ul style="background: #F8FAFC; padding: 20px 40px; border-radius: 12px; list-style-type: square; color: #334155;">
          ${docList}
        </ul>
        <p>Ti preghiamo di trasmettere i documenti rispondendo a cette email o contattando il nostro ufficio RU all'indirizzo: <strong>${params.contactEmail}</strong>.</p>
        <p style="font-size: 13px; color: #64748B; margin-top: 30px;">
          <em>Nota sulla privacy: I dati forniti saranno trattati esclusivamente per le finalità legate alla gestione del rapporto di lavoro, nel rispetto del GDPR.</em>
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: `Documenti necessari per la tua assunzione — ${params.companyName}`,
      html,
    });
    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] SMTP Send Error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Server Action to get a preview of the consultant CPI email.
 */
export async function getConsultantCPIEmailPreviewAction(params: {
  entityId: string;
  requestId: string;
  templateData: SendConsultantCPIParams['templateData'];
}) {
  const { templateData } = params;
  const subject = `Richiesta Comunicazione UniLav/CPI — ${templateData.candidateName} — ${templateData.plannedHireDate}`;
  const { html, text } = renderConsultantCPIEmailContent(templateData);
  
  return { 
    success: true, 
    preview: {
      subject,
      html,
      text
    } 
  };
}

/**
 * Sends the official request for UniLav / CPI communication to the Labor Consultant.
 */
export async function sendConsultantCPIRequestAction(params: SendConsultantCPIParams) {
  const { entityId, requestId, to, subject, templateData } = params;

  try {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user;

    if (!host || !user || !pass) {
      throw new Error("SMTP_NOT_CONFIGURED: Il servizio email non è configurato.");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const { html, text } = renderConsultantCPIEmailContent(templateData);

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });

    // Logging for traceability
    try {
       const logRef = adminDb.collection("entities").doc(entityId).collection("emailLogs").doc();
       await logRef.set({
         logId: logRef.id,
         entityId,
         requestId,
         module: "employmentRequests",
         type: "cpi_consultant_request",
         to,
         from,
         subject,
         status: "sent",
         messageId: info.messageId,
         createdAt: FieldValue.serverTimestamp(),
       });
    } catch (logErr) {
       console.warn("[Email Service] Non-blocking log failure:", logErr);
    }

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("[Email Service] Failed to send consultant email:", error);
    
    // Attempt to log failure
    try {
       const logRef = adminDb.collection("entities").doc(entityId).collection("emailLogs").doc();
       await logRef.set({
         logId: logRef.id,
         entityId,
         requestId,
         module: "employmentRequests",
         type: "cpi_consultant_request",
         to,
         subject,
         status: "failed",
         error: error.message,
         createdAt: FieldValue.serverTimestamp(),
       });
    } catch (e) {}

    return { success: false, error: error.message };
  }
}
