import "server-only";

import { MVP_PERMISSIONS, type PermissionDefinition } from "@/config/permissions";
import { MVP_ROLES } from "@/config/roles";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/types/role";

export type CustomRoleValidationErrorCode =
  | "unauthenticated"
  | "inactive-user"
  | "forbidden-not-super-admin"
  | "entity-not-found"
  | "entity-inactive"
  | "invalid-role-name"
  | "invalid-role-label"
  | "invalid-permission"
  | "unknown-permission"
  | "platform-permission-forbidden"
  | "system-role-protected"
  | "cross-entity-role"
  | "custom-role-invalid";

export class CustomRoleValidationError extends Error {
  constructor(
    public readonly code: CustomRoleValidationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CustomRoleValidationError";
  }
}

export interface AuthorizedSuperAdminContext {
  actorUid: string;
}

export interface ValidatedEntityContext {
  entityId: string;
  name: string;
  legalName: string;
}

export interface CustomRoleInput {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  permissions?: unknown;
  sourceRoleId?: unknown;
}

export interface NormalizedCustomRoleInput {
  name: string;
  label: string;
  description: string;
  permissions: string[];
  sourceRoleId?: string;
}

export interface ValidatedCustomRoleDocument {
  roleId: string;
  entityId: string;
  name: string;
  label: string;
  description: string;
  permissions: string[];
  version?: number;
}

const PROTECTED_SYSTEM_ROLE_IDS = new Set([
  "superAdmin",
  "companyAdmin",
  "companyHR",
  "safetyManager",
  "employee",
  "readOnly",
]);

const PERMISSION_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function reject(code: CustomRoleValidationErrorCode, message: string): never {
  throw new CustomRoleValidationError(code, message);
}

function staticPermissionByCode(code: string): PermissionDefinition | undefined {
  return MVP_PERMISSIONS.find((permission) => permission.code === code);
}

export function isProtectedSystemRoleId(roleId: string): boolean {
  return PROTECTED_SYSTEM_ROLE_IDS.has(roleId) || MVP_ROLES.some((role) => role.roleId === roleId);
}

export function assertNotProtectedSystemRole(roleId: string): void {
  if (isProtectedSystemRoleId(roleId)) {
    reject("system-role-protected", "Ce rôle système est protégé.");
  }
}

export async function authorizeActiveSuperAdmin(idToken: string): Promise<AuthorizedSuperAdminContext> {
  if (!idToken) {
    reject("unauthenticated", "Authentification requise.");
  }

  if (!adminAuth || !adminDb) {
    reject("unauthenticated", "Service administrateur indisponible.");
  }

  let actorUid = "";

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    actorUid = decodedToken.uid;
  } catch {
    reject("unauthenticated", "Authentification invalide.");
  }

  if (!actorUid) {
    reject("unauthenticated", "Authentification invalide.");
  }

  const userSnapshot = await adminDb.collection("users").doc(actorUid).get();
  if (!userSnapshot.exists || userSnapshot.data()?.status !== "active") {
    reject("inactive-user", "Utilisateur inactif ou introuvable.");
  }

  if (userSnapshot.data()?.platformRole !== "superAdmin") {
    reject("forbidden-not-super-admin", "Privilèges Super Admin requis.");
  }

  return { actorUid };
}

export async function validateActiveEntity(entityId: string): Promise<ValidatedEntityContext> {
  const normalizedEntityId = toTrimmedString(entityId);
  if (!normalizedEntityId) {
    reject("entity-not-found", "Entité introuvable.");
  }

  if (!adminDb) {
    reject("entity-not-found", "Service administrateur indisponible.");
  }

  const entitySnapshot = await adminDb.collection("entities").doc(normalizedEntityId).get();
  if (!entitySnapshot.exists) {
    reject("entity-not-found", "Entité introuvable.");
  }

  const entity = entitySnapshot.data() || {};
  if (entity.status !== "active") {
    reject("entity-inactive", "Entité inactive.");
  }

  return {
    entityId: normalizedEntityId,
    name: toTrimmedString(entity.name) || toTrimmedString(entity.nomEntreprise),
    legalName: toTrimmedString(entity.legalName) || toTrimmedString(entity.raisonSociale),
  };
}

export function normalizeCustomRoleInput(input: CustomRoleInput): NormalizedCustomRoleInput {
  const name = toTrimmedString(input.name);
  const label = toTrimmedString(input.label);
  const description = toTrimmedString(input.description);
  const sourceRoleId = toTrimmedString(input.sourceRoleId);

  if (!name) {
    reject("invalid-role-name", "Le nom du rôle est obligatoire.");
  }

  if (!label) {
    reject("invalid-role-label", "Le libellé du rôle est obligatoire.");
  }

  if (!Array.isArray(input.permissions)) {
    reject("invalid-permission", "La liste des permissions est invalide.");
  }

  const normalizedPermissions = Array.from(new Set(
    input.permissions.map((permission) => {
      const code = toTrimmedString(permission);
      if (!code || !PERMISSION_CODE_PATTERN.test(code)) {
        reject("invalid-permission", "Une permission est vide ou malformée.");
      }
      return code;
    })
  )).sort((left, right) => left.localeCompare(right));

  return {
    name,
    label,
    description,
    permissions: normalizedPermissions,
    ...(sourceRoleId ? { sourceRoleId } : {}),
  };
}

export async function validateEntityScopedPermissions(permissionCodes: string[]): Promise<string[]> {
  if (!adminDb) {
    reject("unknown-permission", "Catalogue des permissions indisponible.");
  }

  const normalizedCodes = Array.from(new Set(permissionCodes.map((code) => toTrimmedString(code)))).sort((left, right) => left.localeCompare(right));

  for (const code of normalizedCodes) {
    if (!code || !PERMISSION_CODE_PATTERN.test(code)) {
      reject("invalid-permission", "Une permission est vide ou malformée.");
    }

    if (code.startsWith("platform.")) {
      reject("platform-permission-forbidden", "Les permissions plateforme sont interdites dans un rôle personnalisé.");
    }

    const runtimeSnapshot = await adminDb.collection("permissions").doc(code).get();
    const runtimePermission = runtimeSnapshot.exists ? runtimeSnapshot.data() : undefined;
    const staticPermission = staticPermissionByCode(code);
    const sourcePermission = runtimePermission || staticPermission;

    if (!sourcePermission) {
      reject("unknown-permission", "Permission inconnue.");
    }

    if (runtimePermission?.status && runtimePermission.status !== "active") {
      reject("invalid-permission", "Permission inactive.");
    }

    if (sourcePermission.scope !== "entity") {
      reject("platform-permission-forbidden", "Seules les permissions entité sont autorisées.");
    }
  }

  return normalizedCodes;
}

export async function normalizeAndValidateCustomRoleInput(input: CustomRoleInput): Promise<NormalizedCustomRoleInput> {
  const normalized = normalizeCustomRoleInput(input);
  const permissions = await validateEntityScopedPermissions(normalized.permissions);

  return {
    ...normalized,
    permissions,
  };
}

export function validateCustomRoleDocument(params: {
  entityId: string;
  roleId: string;
  roleData: unknown;
}): ValidatedCustomRoleDocument {
  const requestedEntityId = toTrimmedString(params.entityId);
  const roleId = toTrimmedString(params.roleId);

  if (!requestedEntityId || !roleId || !isRecord(params.roleData)) {
    reject("custom-role-invalid", "Rôle personnalisé invalide.");
  }

  if (isProtectedSystemRoleId(roleId)) {
    reject("system-role-protected", "Ce rôle système est protégé.");
  }

  const entityId = toTrimmedString(params.roleData.entityId);
  if (entityId !== requestedEntityId) {
    reject("cross-entity-role", "Rôle personnalisé hors entité.");
  }

  if (params.roleData.kind !== "custom" || params.roleData.isSystem === true || params.roleData.isLocked === true) {
    reject("custom-role-invalid", "Rôle personnalisé invalide.");
  }

  if (!Array.isArray(params.roleData.permissions)) {
    reject("custom-role-invalid", "Snapshot de permissions invalide.");
  }

  return {
    roleId,
    entityId,
    name: toTrimmedString(params.roleData.name),
    label: toTrimmedString(params.roleData.label),
    description: toTrimmedString(params.roleData.description),
    permissions: params.roleData.permissions.filter((permission): permission is string => typeof permission === "string"),
    version: typeof params.roleData.version === "number" ? params.roleData.version : undefined,
  };
}

export async function loadAndValidateCustomRole(entityId: string, customRoleId: string): Promise<ValidatedCustomRoleDocument> {
  const normalizedEntityId = toTrimmedString(entityId);
  const normalizedRoleId = toTrimmedString(customRoleId);

  if (!normalizedEntityId || !normalizedRoleId) {
    reject("custom-role-invalid", "Rôle personnalisé invalide.");
  }

  if (isProtectedSystemRoleId(normalizedRoleId)) {
    reject("system-role-protected", "Ce rôle système est protégé.");
  }

  if (!adminDb) {
    reject("custom-role-invalid", "Service administrateur indisponible.");
  }

  const roleSnapshot = await adminDb
    .collection("entities")
    .doc(normalizedEntityId)
    .collection("roles")
    .doc(normalizedRoleId)
    .get();

  if (!roleSnapshot.exists) {
    reject("custom-role-invalid", "Rôle personnalisé introuvable.");
  }

  return validateCustomRoleDocument({
    entityId: normalizedEntityId,
    roleId: normalizedRoleId,
    roleData: roleSnapshot.data(),
  });
}
