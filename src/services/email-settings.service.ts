'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import nodemailer from 'nodemailer';
import { EntityEmailSettings, EntityEmailSettingsUI, EmailProvider } from "@/types/email-settings";

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * @fileOverview Server-side administration and data repair services for Email Settings.
 * Handles AES-256-GCM encryption/decryption of SMTP credentials using Admin SDK.
 */

/**
 * Derives a 32-byte key from the environment secret for AES-256.
 * Only callable on the server.
 */
function getEncryptionKey() {
  const secret = process.env.EMAIL_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_ERROR: EMAIL_ENCRYPTION_SECRET is not configured on the server.");
  }
  return crypto.scryptSync(secret, 'hr-nexus-email-salt-v1', 32);
}

/**
 * Encrypts a string using AES-256-GCM.
 */
function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag
  };
}

/**
 * Decrypts a string using AES-256-GCM.
 */
function decrypt(encrypted: string, iv: string, authTag: string) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM, 
    key, 
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Converts Firestore Timestamps (including Admin SDK POJO formats) to ISO strings for client consumption.
 */
function serializeDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  
  // Standard toDate helper (Client SDK or Admin SDK)
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  
  // Serialized POJO from Admin SDK
  if (value._seconds !== undefined) {
    return new Date(value._seconds * 1000).toISOString();
  }
  
  if (typeof value === 'string') return value;
  
  return null;
}

/**
 * Removes undefined properties to prevent Firestore "unsupported field value" errors.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  // Preservation check for Firestore internal objects
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

/**
 * Strips sensitive encryption fields and serializes dates before sending settings to the UI.
 */
function sanitizeEmailSettingsForClient(settings: EntityEmailSettings): EntityEmailSettingsUI {
  const { encryptedSmtpPassword, passwordIv, passwordAuthTag, ...safeData } = settings;
  
  return {
    ...safeData,
    lastTestedAt: serializeDate(settings.lastTestedAt),
    createdAt: serializeDate(settings.createdAt),
    updatedAt: serializeDate(settings.updatedAt),
  } as EntityEmailSettingsUI;
}

/**
 * Security helper to verify if an actor has the required permissions for an entity.
 */
async function verifyPermission(entityId: string, actorUid: string) {
  if (!actorUid || !entityId) return false;
  
  try {
    const membershipId = `${actorUid}_${entityId}`;
    const mSnap = await adminDb.collection("memberships").doc(membershipId).get();
    
    if (mSnap.exists) {
      const mData = mSnap.data();
      if (mData?.status === "active") {
        const perms = mData?.permissions || [];
        if (perms.includes("settings.manage") || perms.includes("emailSettings.manage")) {
          return true;
        }
      }
    }

    const userSnap = await adminDb.collection("users").doc(actorUid).get();
    if (userSnap.exists) {
      const uData = userSnap.data();
      return uData?.platformRole === 'superAdmin' && uData?.status === 'active';
    }
  } catch (err) {
    console.error("[EmailSettings:PermissionCheck] Failed", err);
  }

  return false;
}

/**
 * Retrieves the email settings for an entity, sanitized for the UI.
 */
export async function getEntityEmailSettingsForAdmin(entityId: string): Promise<EntityEmailSettingsUI | null> {
  if (!entityId) return null;
  try {
    const snap = await adminDb.collection("entities").doc(entityId).collection("emailSettings").doc("main").get();
    if (!snap.exists) return null;
    
    const data = snap.data() as EntityEmailSettings;
    return sanitizeEmailSettingsForClient(data);
  } catch (e) {
    console.error(`[EmailSettingsService] Error loading for entity ${entityId}:`, e);
    return null;
  }
}

/**
 * Validates the email settings input before saving or testing.
 */
export async function validateEmailSettingsInput(input: any) {
  const errors: string[] = [];
  
  if (input.provider === 'smtp') {
    if (!input.smtpHost) errors.push("L'hôte SMTP est requis.");
    if (!input.smtpPort || isNaN(Number(input.smtpPort))) errors.push("Le port SMTP est requis et doit être numérique.");
    if (!input.smtpUser) errors.push("L'utilisateur SMTP est requis.");
    if (!input.fromEmail) errors.push("L'email d'expédition est requis.");
    if (!input.fromName) errors.push("Le nom d'affichage de l'expéditeur est requis.");
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (input.fromEmail && !emailRegex.test(input.fromEmail)) {
    errors.push("L'email d'expédition n'est pas valide.");
  }
  if (input.replyToEmail && !emailRegex.test(input.replyToEmail)) {
    errors.push("L'email de réponse n'est pas valide.");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Saves or updates email settings for an entity using Admin SDK.
 */
export async function saveEntityEmailSettings(
  entityId: string, 
  input: Partial<EntityEmailSettings> & { password?: string }, 
  actorUid: string
) {
  const hasPerm = await verifyPermission(entityId, actorUid);
  if (!hasPerm) throw new Error("PERMISSION_DENIED: Vous n'avez pas les droits pour modifier ces paramètres.");

  const docRef = adminDb.collection("entities").doc(entityId).collection("emailSettings").doc("main");
  const snap = await docRef.get();
  const existing = snap.exists ? (snap.data() as EntityEmailSettings) : null;

  const { password, ...otherData } = input;
  
  let encryptionData: Partial<EntityEmailSettings> = {};
  let hasPassword = existing?.hasPassword || false;

  if (password && password.trim()) {
    const { encrypted, iv, authTag } = encrypt(password.trim());
    encryptionData = {
      encryptedSmtpPassword: encrypted,
      passwordIv: iv,
      passwordAuthTag: authTag,
    };
    hasPassword = true;
  } else if (existing?.encryptedSmtpPassword) {
    encryptionData = {
      encryptedSmtpPassword: existing.encryptedSmtpPassword,
      passwordIv: existing.passwordIv,
      passwordAuthTag: existing.passwordAuthTag,
    };
  }

  const payload = sanitizePayload({
    ...otherData,
    ...encryptionData,
    hasPassword,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  });

  if (!existing) {
    payload.createdAt = FieldValue.serverTimestamp();
    payload.createdBy = actorUid;
    payload.status = payload.status || "configured";
    await docRef.set(payload);
  } else {
    await docRef.update(payload);
  }

  // Record Audit Log via Admin SDK
  await adminDb.collection("auditLogs").add({
    userId: actorUid,
    entityId,
    action: "emailSettings.saved",
    resourceType: "emailSettings",
    resourceId: "main",
    timestamp: FieldValue.serverTimestamp()
  });

  return { success: true };
}

/**
 * Internal server-only function to fetch full settings with decrypted password.
 */
export async function getEntityEmailTransportSettings(entityId: string): Promise<(EntityEmailSettings & { decryptedPassword?: string }) | null> {
  const snap = await adminDb.collection("entities").doc(entityId).collection("emailSettings").doc("main").get();
  if (!snap.exists) return null;
  
  const settings = snap.data() as EntityEmailSettings;
  const result = { ...settings } as any;

  if (settings.provider === 'smtp' && settings.encryptedSmtpPassword && settings.passwordIv && settings.passwordAuthTag) {
    try {
      result.decryptedPassword = decrypt(
        settings.encryptedSmtpPassword, 
        settings.passwordIv, 
        settings.passwordAuthTag
      );
    } catch (err) {
      console.error(`[Email Settings Service] Decryption failed for entity: ${entityId}`);
    }
  }

  return result;
}

/**
 * Executes a connectivity test using the entity's SMTP configuration via Admin SDK.
 */
export async function testEntityEmailSettingsAction(params: {
  entityId: string;
  testEmail: string;
  actorUid: string;
}) {
  const { entityId, testEmail, actorUid } = params;
  
  const hasPerm = await verifyPermission(entityId, actorUid);
  if (!hasPerm) throw new Error("PERMISSION_DENIED");

  const transportSettings = await getEntityEmailTransportSettings(entityId);
  if (!transportSettings || transportSettings.provider !== 'smtp') {
    throw new Error("Configuration SMTP manquante ou incomplète pour ce test.");
  }

  const { smtpHost, smtpPort, smtpSecure, smtpUser, decryptedPassword, fromName, fromEmail, replyToEmail } = transportSettings;

  if (!decryptedPassword) {
    throw new Error("Mot de passe SMTP introuvable ou illisible.");
  }

  const docRef = adminDb.collection("entities").doc(entityId).collection("emailSettings").doc("main");

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure || smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: decryptedPassword
      },
      connectionTimeout: 10000,
    });

    const fromString = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

    await transporter.sendMail({
      from: fromString,
      to: testEmail,
      replyTo: replyToEmail || undefined,
      subject: `Test configuration email — HR Nexus`,
      text: `Ceci est un email de test envoyé depuis la configuration SMTP de votre entité.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1F1F66;">
          <h2 style="color: #1F1F66;">Test de connectivité SMTP</h2>
          <p>Ceci est un email de test envoyé depuis la configuration de votre entité.</p>
          <p style="background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #EEEFF7;">
            <strong>Statut :</strong> Connecté et prêt à l'envoi.
          </p>
        </div>
      `
    });

    await docRef.update({
      status: "verified",
      lastTestedAt: FieldValue.serverTimestamp(),
      lastTestResult: "success",
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    await adminDb.collection("auditLogs").add({
      userId: actorUid,
      entityId,
      action: "emailSettings.tested",
      resourceType: "emailSettings",
      resourceId: "main",
      details: { result: "success", target: testEmail },
      timestamp: FieldValue.serverTimestamp()
    });

    return { success: true };
  } catch (err: any) {
    console.error("[SMTP Test Error]:", err);
    
    const safeError = err.message?.replace(decryptedPassword, '****') || "Échec de la connexion SMTP.";

    await docRef.update({
      status: "failed",
      lastTestedAt: FieldValue.serverTimestamp(),
      lastTestResult: "failure",
      lastError: safeError,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    await adminDb.collection("auditLogs").add({
      userId: actorUid,
      entityId,
      action: "emailSettings.tested",
      resourceType: "emailSettings",
      resourceId: "main",
      details: { result: "failure", error: safeError },
      timestamp: FieldValue.serverTimestamp()
    });

    return { success: false, error: safeError };
  }
}
