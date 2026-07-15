import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

type AuditDetails = Record<string, unknown>;

interface TrustedAuditLogInput {
  actorUid: string;
  entityId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: AuditDetails;
}

interface TrustedSystemAuditLogInput {
  systemActor: `system:${string}`;
  entityId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: AuditDetails;
}

const SENSITIVE_DETAIL_KEY = /token|secret|password|cookie|authorization|private.?key|iban|codice.?fiscale|tax.?code|medical|health|diagnos|permission|email.?body|full.?document|snapshot/i;
const MAX_DETAIL_DEPTH = 3;
const MAX_DETAIL_KEYS = 30;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;

function sanitizePermissionCount(value: unknown, path: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`AUDIT_PERMISSION_COUNT_INVALID: ${path.join(".") || "permissionCount"}`);
  }
  return value;
}

function sanitizeAuditValue(value: unknown, path: string[], depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) {
    throw new Error(`AUDIT_DETAILS_TOO_DEEP: ${path.join(".") || "details"}`);
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new Error(`AUDIT_DETAIL_STRING_TOO_LONG: ${path.join(".") || "details"}`);
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`AUDIT_DETAIL_ARRAY_TOO_LARGE: ${path.join(".") || "details"}`);
    }
    return value.map((item, index) => sanitizeAuditValue(item, [...path, String(index)], depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_DETAIL_KEYS) {
      throw new Error(`AUDIT_DETAILS_TOO_MANY_KEYS: ${path.join(".") || "details"}`);
    }

    return Object.fromEntries(
      entries.map(([key, nestedValue]) => {
        if (key === "permissionCount") {
          return [key, sanitizePermissionCount(nestedValue, [...path, key])];
        }
        if (SENSITIVE_DETAIL_KEY.test(key)) {
          throw new Error(`AUDIT_SENSITIVE_DETAIL_REJECTED: ${[...path, key].join(".")}`);
        }
        return [key, sanitizeAuditValue(nestedValue, [...path, key], depth + 1)];
      })
    );
  }

  throw new Error(`AUDIT_DETAIL_TYPE_UNSUPPORTED: ${path.join(".") || "details"}`);
}

function sanitizeAuditDetails(details?: AuditDetails): AuditDetails | undefined {
  if (!details) return undefined;
  const sanitized = sanitizeAuditValue(details, [], 0);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as AuditDetails)
    : undefined;
}

async function writeTrustedAuditLog(input: TrustedAuditLogInput | TrustedSystemAuditLogInput) {
  if (!adminDb) {
    throw new Error("AUDIT_ADMIN_UNAVAILABLE");
  }

  const userId = "actorUid" in input ? input.actorUid : input.systemActor;
  const auditRef = adminDb.collection("auditLogs").doc();
  const sanitizedDetails = sanitizeAuditDetails(input.details);

  await auditRef.set({
    userId,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ...(sanitizedDetails ? { details: sanitizedDetails } : {}),
    timestamp: FieldValue.serverTimestamp(),
    source: "trusted-server",
  });
}

export async function createTrustedAuditLog(input: TrustedAuditLogInput) {
  if (!input.actorUid || input.actorUid.startsWith("system:")) {
    throw new Error("AUDIT_ACTOR_INVALID");
  }
  await writeTrustedAuditLog(input);
}

export async function createTrustedSystemAuditLog(input: TrustedSystemAuditLogInput) {
  if (!input.systemActor.startsWith("system:")) {
    throw new Error("AUDIT_SYSTEM_ACTOR_INVALID");
  }
  await writeTrustedAuditLog(input);
}
