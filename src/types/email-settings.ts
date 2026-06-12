import { FieldValue, Timestamp } from "firebase/firestore";

export type EmailProvider = "smtp" | "none";

export type EmailSettingsStatus = 
  | "not_configured" 
  | "configured" 
  | "verified" 
  | "failed" 
  | "disabled";

/**
 * Full entity email configuration as stored in Firestore.
 */
export interface EntityEmailSettings {
  provider: EmailProvider;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  
  // SMTP specific
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  
  // Secrets (Server-only, never sent to client)
  encryptedSmtpPassword?: string | null;
  passwordIv?: string | null;
  passwordAuthTag?: string | null;
  
  // UI indicator to show that a password is set without revealing it
  hasPassword: boolean;
  
  status: EmailSettingsStatus;
  
  // Tracking & Diagnostics
  lastTestedAt?: any;
  lastTestResult?: "success" | "failure" | null;
  lastError?: string | null;
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

/**
 * Sanitized version of settings for public/admin UI consumption.
 */
export type EntityEmailSettingsUI = Omit<
  EntityEmailSettings, 
  "encryptedSmtpPassword" | "passwordIv" | "passwordAuthTag"
>;
