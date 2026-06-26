'use server';
/**
 * @fileOverview Server-only email service for HR communications.
 * Handles template variable replacement and interacts with email providers.
 */

import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import nodemailer from 'nodemailer';
import { resolveEmailTransportForEntity } from "./email-settings.service";
import crypto from 'crypto';

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
    confirmationLink: string;
  };
}

export interface SendOfferEmailParams {
  entityId: string;
  to: string;
  subject: string;
  candidateName: string;
  companyName: string;
  jobTitle: string;
  offerLink: string;
  expiresAt: string;
}

export interface SendDocumentRequestParams {
  entityId: string;
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

export interface SendEmployeeInvitationEmailParams {
  entityId: string;
  to: string;
  employeeName: string;
  activationLink: string;
}

export interface SendContractToEmployeeParams {
  entityId: string;
  contractId: string;
  to: string;
  employeeName: string;
  companyName: string;
  jobTitle: string;
  storagePath: string;
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

  const text = `Gentile ${data.consultantName || 'Consulente'},

con la presente si richiede la predisposizione della comunicazione obbligatoria (UniLav) per l'assunzione del seguente candidato:

Dettagli Candidato:
- Nome: ${data.candidateName}
- Email: ${data.candidateEmail || '-'}
- Telefono: ${data.candidatePhone || '-'}

Dettagli Contrattuali:
- Posizione: ${data.jobTitle}
- Azienda: ${data.companyName}
- Tipo contratto: ${data.contractType}
- Data inizio prevista: ${data.plannedHireDate}

Vi preghiamo gentilmente di procedere con l'invio e di trasmetterci non appena disponibili il codice di protocollo UniLav, la data effettiva e il file PDF del récépissé ufficiale.

Riferimento interno pratica: ${data.requestId}

Cordiali saluti,
Ufficio Risorse Umane — ${data.companyName}`;

  return { html, text };
}

/**
 * Server Action to send an interview notification.
 * Integrates Entity SMTP with global fallback.
 * Generates secure confirmation token for candidates.
 */
export async function sendInterviewEmailAction(params: SendInterviewEmailParams) {
  const { entityId, interviewId, to, subject, message, templateData } = params;

  if (!adminDb) throw new Error("Firestore Admin not initialized");

  try {
    // 1. Generate Secure Attendance Confirmation Token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const interviewRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(interviewId);
    const interviewSnap = await interviewRef.get();
    if (!interviewSnap.exists) throw new Error("Interview not found");
    const interviewData = interviewSnap.data()!;

    const scheduledAt = interviewData.scheduledAt;
    const expiresAt = scheduledAt ? (typeof scheduledAt === 'string' ? Timestamp.fromDate(new Date(scheduledAt)) : scheduledAt) : Timestamp.fromDate(new Date());

    // 2. Store Token in Global Registry
    const tokenRef = adminDb.collection("publicInterviewTokens").doc(tokenHash);
    await tokenRef.set({
      tokenHash,
      entityId,
      interviewId,
      expiresAt,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });

    // 3. Update Interview Record
    await interviewRef.update({
      confirmationStatus: "pending",
      confirmationTokenHash: tokenHash,
      confirmationExpiresAt: expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 4. Prepare Link and Render Template
    const baseUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    const confirmationLink = `${baseUrl}/interview/confirm/${rawToken}`;
    
    const finalTemplateData = {
      ...templateData,
      confirmationLink
    };

    const renderedSubject = renderTemplate(subject, finalTemplateData);
    const renderedBody = renderTemplate(message, finalTemplateData);

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.6;">
        <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">Invitation à un entretien</h1>
        </div>
        <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; background-color: white; border-radius: 0 0 12px 12px;">
          <div style="white-space: pre-wrap; margin-bottom: 30px; color: #334155;">${renderedBody}</div>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="${confirmationLink}" style="background-color: #1F1F66; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(31, 31, 102, 0.2);">
              Répondre à l'invitation
            </a>
          </div>

          <p style="font-size: 10px; color: #94A3B8; text-align: center; margin-top: 40px; opacity: 0.5;">
            Si vous ne parvenez pas à cliquer sur le bouton, copiez ce lien :<br>
            <span style="word-break: break-all;">${confirmationLink}</span>
          </p>
        </div>
      </div>
    `;

    // 5. SMTP Dispatch
    const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);
    
    const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
    const canSend = source === 'entity' || isGlobalConfigured;

    if (canSend) {
      await transporter.sendMail({
        from,
        to,
        replyTo: replyTo || undefined,
        subject: renderedSubject,
        html: htmlContent,
        text: `${renderedBody}\n\nLien de confirmation : ${confirmationLink}`,
      });
    } else {
      console.log(`[Email Service] SMTP not configured for ${source}. Log only: to=${to}, subject=${renderedSubject}`);
    }

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
 * Integrates Entity SMTP with global fallback.
 */
export async function sendEmploymentOfferEmail(params: SendOfferEmailParams) {
  const { entityId, to, subject, candidateName, companyName, jobTitle, offerLink, expiresAt } = params;
  
  const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);

  const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
  const canSend = source === 'entity' || isGlobalConfigured;

  if (!canSend) {
    throw new Error("Configuration du service email requise.");
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.6;">
      <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Proposition d'embauche</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; border-radius: 0 0 12px 12px; background-color: white;">
        <p>Buongiorno <strong>${candidateName || "candidato"}</strong>,</p>
        <p>Abbiamo il piacere di trasmetterti una proposta di assunzione per la posizione di <strong>${jobTitle || "poste proposé"}</strong> presso l'azienda <strong>${companyName || "notre entreprise"}</strong>.</p>
        <p>Puoi consultare i dettagli di questa proposta e trasmetterci la tua risposta tramite il nostro portale sicuro:</p>
        
        <div style="margin: 40px 0; text-align: center;">
          <a href="${offerLink}" style="background-color: #4DB3E6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(77, 179, 230, 0.3);">
            Visualizza la mia proposta
          </a>
        </div>
        
        <p style="font-size: 12px; color: #71717A; text-align: center; margin-top: 20px;">
          Questo link sicuro è personale e valido fino al <strong>${expiresAt}</strong>.
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject,
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
 * Integrates Entity SMTP with global fallback.
 */
export async function sendDocumentRequestEmailAction(params: SendDocumentRequestParams) {
  const { entityId, to, candidateName, companyName, jobTitle, requiredDocuments, contactEmail } = params;
  
  const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);

  const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
  const canSend = source === 'entity' || isGlobalConfigured;

  if (!canSend) {
    console.warn(`[Email Service] SMTP not configured for ${source}. Simulating success for document request.`);
    return { success: true };
  }

  const docList = requiredDocuments.map(d => `<li>${d}</li>`).join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66;">
      <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px;">Documenti necessari per l'assunzione</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; background-color: white;">
        <p>Buongiorno <strong>${candidateName}</strong>,</p>
        <p>Siamo lieti di procedere con la tua assunzione per la posizione di <strong>${jobTitle}</strong> presso <strong>${companyName}</strong>.</p>
        <p>Per poter predisporre il contrat e le comunicazioni obbligatorie, ti chiediamo gentilmente di inviarci i seguenti documenti:</p>
        <ul style="background: #F8FAFC; padding: 20px 40px; border-radius: 12px; list-style-type: square; color: #334155;">
          ${docList}
        </ul>
        <p>Ti preghiamo di trasmettere i documenti rispondendo a cette email o contattando il nostro ufficio RU all'indirizzo: <strong>${contactEmail}</strong>.</p>
        <p style="font-size: 13px; color: #64748B; margin-top: 30px;">
          <em>Nota sulla privacy: I dati forniti saranno trattati esclusivamente per le finalità legate alla gestione del rapporto di lavoro, nel rispetto del GDPR.</em>
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject: `Documenti necessari per la tua assunzione — ${companyName}`,
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
}): Promise<{ success: true; preview: { subject: string; html: string; text: string; } } | { success: false; error: string }> {
  try {
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
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to render preview" };
  }
}

/**
 * Sends the official request for UniLav / CPI communication to the Labor Consultant.
 * Supports subject and body overrides from the preview/edit step.
 * Integrates Entity SMTP with global fallback.
 */
export async function sendConsultantCPIRequestAction(params: SendConsultantCPIParams & {
  subjectOverride?: string;
  bodyOverride?: string;
}) {
  const { entityId, requestId, to, subject, templateData, subjectOverride, bodyOverride } = params;

  try {
    const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);
    
    const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
    const canSend = source === 'entity' || isGlobalConfigured;

    const finalSubject = subjectOverride?.trim() || subject;
    let finalHtml: string;
    let finalText: string;

    if (bodyOverride?.trim()) {
      finalText = bodyOverride.trim();
      // Basic text to HTML conversion with entity escaping for safety
      const escapedText = finalText
        .replace(/&/g, "&amp;")
        .replace(/@/g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      
      finalHtml = `<div style="font-family: sans-serif; white-space: pre-wrap; line-height: 1.5; color: #1F1F66;">${escapedText.replace(/\n/g, '<br>')}</div>`;
    } else {
      const { html, text } = renderConsultantCPIEmailContent(templateData);
      finalHtml = html;
      finalText = text;
    }

    if (canSend) {
      const info = await transporter.sendMail({
        from,
        to,
        replyTo: replyTo || undefined,
        subject: finalSubject,
        html: finalHtml,
        text: finalText,
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
           subject: finalSubject,
           body: finalText,
           status: "sent",
           messageId: info.messageId,
           createdAt: FieldValue.serverTimestamp(),
         });
      } catch (logErr) {
         console.warn("[Email Service] Non-blocking log failure:", logErr);
      }
    } else {
      console.log(`[Email Service] SMTP not configured for ${source}. Log only: to=${to}, subject=${finalSubject}`);
    }

    return { success: true };
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
         subject: subjectOverride || subject,
         status: "failed",
         error: error.message,
         createdAt: FieldValue.serverTimestamp(),
       });
    } catch (e) {}

    return { success: false, error: error.message };
  }
}

/**
 * Sends a secure invitation to the employee to activate their personal space.
 * Phase 1A: Employee Access Foundation.
 */
export async function sendEmployeeInvitationEmailAction(params: SendEmployeeInvitationEmailParams) {
  const { entityId, to, employeeName, activationLink } = params;

  try {
    const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);
    
    const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
    const canSend = source === 'entity' || isGlobalConfigured;

    if (!canSend) {
       console.warn(`[Email Service] SMTP not configured for ${source}. Skipping real email dispatch.`);
       return { success: true, simulated: true };
    }

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.6;">
        <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Activation de votre Espace Employé</h1>
        </div>
        <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; border-radius: 0 0 12px 12px; background-color: white;">
          <p>Bonjour <strong>${employeeName}</strong>,</p>
          <p>Votre compte employé a été créé pour accéder à l’Espace Employé.</p>
          <p>Email de connexion : <strong>${to}</strong></p>
          <p>Pour activer votre compte et définir votre mot de passe, veuillez cliquer sur le lien sécurisé ci-dessous :</p>
          
          <div style="margin: 40px 0; text-align: center;">
            <a href="${activationLink}" style="background-color: #4DB3E6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block;">
              Activer mon compte
            </a>
          </div>
          
          <p style="font-size: 12px; color: #71717A; text-align: center; margin-top: 20px;">
            Ce lien est personnel et expirera dans 48 heures.
          </p>
          <p style="font-size: 14px; font-weight: bold; border-top: 1px solid #EEEFF7; padding-top: 20px; margin-top: 20px;">
            Cordialement,<br>L’équipe RH
          </p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject: "Activation de votre Espace Employé",
      html,
    });

    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] Failed to send employee invitation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Sends a secure short-lived download link for a contract to the employee.
 * Strictly limited to fresh, generated PDFs.
 */
export async function sendContractToEmployeeAction(params: SendContractToEmployeeParams) {
  const { entityId, contractId, to, employeeName, companyName, jobTitle, storagePath } = params;

  try {
    if (!adminBucket) throw new Error("Storage Admin not initialized");

    // 1. Resolve Transport
    const { transporter, from, replyTo, source } = await resolveEmailTransportForEntity(entityId);
    
    const isGlobalConfigured = !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
    const canSend = source === 'entity' || isGlobalConfigured;

    if (!canSend) {
      throw new Error("SMTP service not configured for this entity or globally.");
    }

    // 2. Generate Secure Signed URL (48 hours expiry)
    const file = adminBucket.file(storagePath);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 48 * 60 * 60 * 1000,
    });

    // 3. Render HTML
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1F1F66; line-height: 1.6;">
        <div style="background-color: #1F1F66; padding: 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">Votre contrat de travail est prêt</h1>
        </div>
        <div style="padding: 30px; border: 1px solid #EEEFF7; border-top: none; background-color: white; border-radius: 0 0 12px 12px;">
          <p>Bonjour <strong>${employeeName}</strong>,</p>
          <p>Nous avons le plaisir de vous informer que votre contrat de travail pour le poste de <strong>${jobTitle}</strong> chez <strong>${companyName}</strong> est prêt pour votre signature.</p>
          
          <div style="margin: 40px 0; text-align: center;">
            <a href="${signedUrl}" style="background-color: #4DB3E6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(77, 179, 230, 0.3);">
              Consulter mon contrat
            </a>
          </div>

          <p style="font-size: 13px; color: #475569; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
            Ce lien est sécurisé et personnel. Il restera valide pendant 48 heures.
          </p>

          <p style="font-size: 14px; font-weight: bold; border-top: 1px solid #EEEFF7; padding-top: 20px; margin-top: 40px;">
            Cordialement,<br>
            L’équipe Ressources Humaines — ${companyName}
          </p>
        </div>
      </div>
    `;

    // 4. Dispatch
    await transporter.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject: `Votre contrat de travail — ${companyName}`,
      html,
      text: `Bonjour ${employeeName}, votre contrat de travail chez ${companyName} est prêt. Vous pouvez le consulter ici : ${signedUrl}`,
    });

    return { success: true };
  } catch (error: any) {
    console.error("[Email Service] Failed to send contract to employee:", error);
    return { success: false, error: error.message };
  }
}
