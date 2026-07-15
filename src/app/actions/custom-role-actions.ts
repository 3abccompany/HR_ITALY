"use server";

import { MVP_PERMISSIONS } from "@/config/permissions";
import { MVP_ROLES } from "@/config/roles";
import { adminDb } from "@/lib/firebase/admin";
import { createTrustedAuditLog } from "@/services/audit.server";
import {
  authorizeActiveSuperAdmin,
  CustomRoleValidationError,
  isProtectedSystemRoleId,
  normalizeAndValidateCustomRoleInput,
  validateActiveEntity,
  validateCustomRoleDocument,
  validateEntityScopedPermissions,
  type CustomRoleInput,
} from "@/services/custom-role.server";
import { FieldValue } from "firebase-admin/firestore";

type CustomRoleActionCode =
  | "unauthenticated"
  | "inactive-user"
  | "forbidden-not-super-admin"
  | "entity-not-found"
  | "entity-inactive"
  | "role-not-found"
  | "role-inactive"
  | "system-role-protected"
  | "invalid-role-name"
  | "invalid-role-label"
  | "invalid-permission"
  | "unknown-permission"
  | "platform-permission-forbidden"
  | "cross-entity-role"
  | "custom-role-invalid"
  | "service-unavailable";

type CustomRoleActionResult = {
  success: boolean;
  roleId?: string;
  alreadyInactive?: boolean;
  auditWarning?: string;
  error?: string;
  code?: CustomRoleActionCode;
};

export type CustomRoleManagementEntity = {
  entityId: string;
  name: string;
  legalName: string;
  status: string;
};

export type CustomRoleManagementPermission = {
  code: string;
  label: string;
  description: string;
  module: string;
};

export type CustomRoleManagementSystemRole = {
  roleId: string;
  name: string;
  label: string;
  description: string;
  scope: string;
  permissionCount: number;
  cloneAllowed: boolean;
  status: "active";
};

export type CustomRoleManagementCustomRole = {
  roleId: string;
  entityId: string;
  name: string;
  label: string;
  description: string;
  status: string;
  permissions: string[];
  permissionCount: number;
  sourceRoleId?: string;
  version?: number;
};

export type CustomRoleManagementDataResult = {
  success: boolean;
  entities?: CustomRoleManagementEntity[];
  systemRoles?: CustomRoleManagementSystemRole[];
  permissions?: CustomRoleManagementPermission[];
  customRoles?: CustomRoleManagementCustomRole[];
  error?: string;
  code?: CustomRoleActionCode;
};

type CreateCustomRoleParams = {
  idToken: string;
  entityId: string;
  name: unknown;
  label: unknown;
  description?: unknown;
  permissions: unknown;
};

type CloneSystemRoleParams = {
  idToken: string;
  entityId: string;
  sourceRoleId: string;
  name?: unknown;
  label?: unknown;
  description?: unknown;
};

type UpdateCustomRoleParams = {
  idToken: string;
  entityId: string;
  customRoleId: string;
  name: unknown;
  label: unknown;
  description?: unknown;
  permissions: unknown;
};

type DeactivateCustomRoleParams = {
  idToken: string;
  entityId: string;
  customRoleId: string;
};

type ListCustomRoleManagementDataParams = {
  idToken: string;
  entityId?: string;
};

type MutatedRoleResult = {
  roleId: string;
  previousVersion?: number;
  nextVersion: number;
  changedFields?: string[];
  permissionCount: number;
  sourceRoleId?: string;
  alreadyInactive?: boolean;
};

const editableCustomRoleFields = ["name", "label", "description", "permissions"] as const;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function actionError(code: CustomRoleActionCode, message: string): CustomRoleActionResult {
  return { success: false, code, error: message };
}

function mapError(error: unknown): CustomRoleActionResult {
  if (error instanceof CustomRoleValidationError) {
    return actionError(error.code as CustomRoleActionCode, error.message);
  }

  if (error instanceof Error && error.message.includes(":")) {
    const [rawCode, ...messageParts] = error.message.split(":");
    const code = rawCode.trim() as CustomRoleActionCode;
    const message = messageParts.join(":").trim() || "Action refusée.";
    return actionError(code, message);
  }

  return actionError("custom-role-invalid", "Action refusée.");
}

function ensureAdminDb() {
  if (!adminDb) {
    throw new Error("service-unavailable: Service administrateur indisponible.");
  }
  return adminDb;
}

function normalizePermissionDocument(code: string, data: FirebaseFirestore.DocumentData | undefined): CustomRoleManagementPermission | null {
  const staticPermission = MVP_PERMISSIONS.find((permission) => permission.code === code);
  const source = data || staticPermission;

  if (!source) return null;
  if (data && safeString(data.status) && safeString(data.status) !== "active") return null;
  if (source.scope !== "entity") return null;
  if (code.startsWith("platform.")) return null;

  return {
    code,
    label: safeString(source.label) || code,
    description: safeString(source.description),
    module: safeString(source.module) || "Autres",
  };
}

function normalizeCustomRoleForManagement(roleId: string, data: FirebaseFirestore.DocumentData): CustomRoleManagementCustomRole {
  const permissions = Array.isArray(data.permissions)
    ? data.permissions.filter((permission): permission is string => typeof permission === "string")
    : [];

  return {
    roleId,
    entityId: safeString(data.entityId),
    name: safeString(data.name),
    label: safeString(data.label) || roleId,
    description: safeString(data.description),
    status: safeString(data.status) || "inactive",
    permissions,
    permissionCount: permissions.length,
    sourceRoleId: safeString(data.sourceRoleId) || undefined,
    version: typeof data.version === "number" ? data.version : undefined,
  };
}

export async function listCustomRoleManagementDataAction(params: ListCustomRoleManagementDataParams): Promise<CustomRoleManagementDataResult> {
  try {
    const db = ensureAdminDb();
    await authorizeActiveSuperAdmin(params.idToken);

    const [entitiesSnapshot, runtimePermissionsSnapshot] = await Promise.all([
      db.collection("entities").get(),
      db.collection("permissions").get(),
    ]);

    const entities = entitiesSnapshot.docs
      .map((document) => {
        const data = document.data();
        return {
          entityId: safeString(data.entityId) || document.id,
          name: safeString(data.name) || safeString(data.nomEntreprise) || document.id,
          legalName: safeString(data.legalName) || safeString(data.raisonSociale),
          status: safeString(data.status) || "inactive",
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    const runtimePermissionMap = new Map<string, FirebaseFirestore.DocumentData>();
    runtimePermissionsSnapshot.docs.forEach((document) => runtimePermissionMap.set(document.id, document.data()));

    const permissions = Array.from(new Set([
      ...MVP_PERMISSIONS.map((permission) => permission.code),
      ...runtimePermissionsSnapshot.docs.map((document) => document.id),
    ]))
      .map((code) => normalizePermissionDocument(code, runtimePermissionMap.get(code)))
      .filter((permission): permission is CustomRoleManagementPermission => !!permission)
      .sort((left, right) => left.module.localeCompare(right.module) || left.label.localeCompare(right.label));

    const systemRoles = MVP_ROLES.map((role) => ({
      roleId: role.roleId,
      name: role.name,
      label: role.label,
      description: role.description,
      scope: role.scope,
      permissionCount: role.getPermissions().length,
      cloneAllowed: role.scope === "entity" && role.roleId !== "superAdmin",
      status: "active" as const,
    }));

    let customRoles: CustomRoleManagementCustomRole[] = [];
    const selectedEntityId = safeString(params.entityId);
    if (selectedEntityId) {
      if (!entities.some((entity) => entity.entityId === selectedEntityId)) {
        throw new CustomRoleValidationError("entity-not-found", "Entité introuvable.");
      }
      const customRolesSnapshot = await db.collection("entities").doc(selectedEntityId).collection("roles").get();
      customRoles = customRolesSnapshot.docs
        .map((document) => normalizeCustomRoleForManagement(document.id, document.data()))
        .filter((role) => role.entityId === selectedEntityId)
        .sort((left, right) => left.label.localeCompare(right.label));
    }

    return {
      success: true,
      entities,
      systemRoles,
      permissions,
      customRoles,
    };
  } catch (error) {
    return mapError(error);
  }
}

async function auditMutation(params: {
  actorUid: string;
  entityId: string;
  action: "entityRole.created" | "entityRole.cloned" | "entityRole.updated" | "entityRole.deactivated";
  roleId: string;
  sourceRoleId?: string;
  changedFields?: string[];
  permissionCount: number;
  previousVersion?: number;
  nextVersion: number;
}): Promise<CustomRoleActionResult | null> {
  try {
    await createTrustedAuditLog({
      actorUid: params.actorUid,
      entityId: params.entityId,
      action: params.action,
      resourceType: "entityRole",
      resourceId: params.roleId,
      details: {
        roleId: params.roleId,
        ...(params.sourceRoleId ? { sourceRoleId: params.sourceRoleId } : {}),
        ...(params.changedFields ? { changedFields: params.changedFields } : {}),
        permissionCount: params.permissionCount,
        ...(typeof params.previousVersion === "number" ? { previousVersion: params.previousVersion } : {}),
        nextVersion: params.nextVersion,
      },
    });
    return null;
  } catch {
    return {
      success: true,
      roleId: params.roleId,
      auditWarning: "Le rôle personnalisé a été modifié, mais le journal d'audit serveur n'a pas pu être écrit.",
    };
  }
}

function changedFieldsFrom(before: Record<string, unknown>, after: Pick<CustomRoleInput, "name" | "label" | "description"> & { permissions: string[] }): string[] {
  const changedFields: string[] = [];

  if (safeString(before.name) !== safeString(after.name)) changedFields.push("name");
  if (safeString(before.label) !== safeString(after.label)) changedFields.push("label");
  if (safeString(before.description) !== safeString(after.description)) changedFields.push("description");

  const beforePermissions = Array.isArray(before.permissions)
    ? before.permissions.filter((permission): permission is string => typeof permission === "string").sort((left, right) => left.localeCompare(right))
    : [];
  if (beforePermissions.join("|") !== after.permissions.join("|")) changedFields.push("permissions");

  return changedFields.filter((field) => editableCustomRoleFields.includes(field as (typeof editableCustomRoleFields)[number]));
}

async function authorizeAndValidateEntity(idToken: string, entityId: string) {
  const authContext = await authorizeActiveSuperAdmin(idToken);
  const entityContext = await validateActiveEntity(entityId);
  return { ...authContext, ...entityContext };
}

export async function createCustomRoleAction(params: CreateCustomRoleParams): Promise<CustomRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const context = await authorizeAndValidateEntity(params.idToken, params.entityId);
    const normalized = await normalizeAndValidateCustomRoleInput({
      name: params.name,
      label: params.label,
      description: params.description,
      permissions: params.permissions,
    });

    const roleRef = db.collection("entities").doc(context.entityId).collection("roles").doc();
    const now = FieldValue.serverTimestamp();
    const roleData = {
      roleId: roleRef.id,
      entityId: context.entityId,
      name: normalized.name,
      label: normalized.label,
      description: normalized.description,
      scope: "entity",
      kind: "custom",
      isSystem: false,
      isLocked: false,
      status: "active",
      permissions: normalized.permissions,
      version: 1,
      createdAt: now,
      createdBy: context.actorUid,
      updatedAt: now,
      updatedBy: context.actorUid,
    };

    await roleRef.set(roleData);

    const auditResult = await auditMutation({
      actorUid: context.actorUid,
      entityId: context.entityId,
      action: "entityRole.created",
      roleId: roleRef.id,
      changedFields: ["name", "label", "description", "permissions"],
      permissionCount: normalized.permissions.length,
      nextVersion: 1,
    });

    return auditResult || { success: true, roleId: roleRef.id };
  } catch (error) {
    return mapError(error);
  }
}

export async function cloneSystemRoleAction(params: CloneSystemRoleParams): Promise<CustomRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const context = await authorizeAndValidateEntity(params.idToken, params.entityId);
    const sourceRoleId = safeString(params.sourceRoleId);

    if (!sourceRoleId || sourceRoleId === "superAdmin" || !isProtectedSystemRoleId(sourceRoleId)) {
      return actionError("system-role-protected", "Ce rôle système ne peut pas être cloné.");
    }

    const sourceRole = MVP_ROLES.find((role) => role.roleId === sourceRoleId);
    if (!sourceRole) {
      return actionError("role-not-found", "Rôle source introuvable.");
    }

    if (sourceRole.scope !== "entity") {
      return actionError("platform-permission-forbidden", "Les rôles plateforme ne peuvent pas être clonés en rôle entité.");
    }

    const permissions = await validateEntityScopedPermissions(sourceRole.getPermissions());
    const normalized = await normalizeAndValidateCustomRoleInput({
      name: params.name || `${sourceRole.name}Custom`,
      label: params.label || `${sourceRole.label} (copie)`,
      description: params.description || sourceRole.description,
      permissions,
      sourceRoleId,
    });

    const roleRef = db.collection("entities").doc(context.entityId).collection("roles").doc();
    const now = FieldValue.serverTimestamp();

    await roleRef.set({
      roleId: roleRef.id,
      entityId: context.entityId,
      name: normalized.name,
      label: normalized.label,
      description: normalized.description,
      scope: "entity",
      kind: "custom",
      isSystem: false,
      isLocked: false,
      sourceRoleId,
      status: "active",
      permissions: normalized.permissions,
      version: 1,
      createdAt: now,
      createdBy: context.actorUid,
      updatedAt: now,
      updatedBy: context.actorUid,
    });

    const auditResult = await auditMutation({
      actorUid: context.actorUid,
      entityId: context.entityId,
      action: "entityRole.cloned",
      roleId: roleRef.id,
      sourceRoleId,
      changedFields: ["name", "label", "description", "permissions"],
      permissionCount: normalized.permissions.length,
      nextVersion: 1,
    });

    return auditResult || { success: true, roleId: roleRef.id };
  } catch (error) {
    return mapError(error);
  }
}

export async function updateCustomRoleAction(params: UpdateCustomRoleParams): Promise<CustomRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const context = await authorizeAndValidateEntity(params.idToken, params.entityId);
    const customRoleId = safeString(params.customRoleId);
    if (!customRoleId) return actionError("role-not-found", "Rôle personnalisé introuvable.");

    const normalized = await normalizeAndValidateCustomRoleInput({
      name: params.name,
      label: params.label,
      description: params.description,
      permissions: params.permissions,
    });

    const roleRef = db.collection("entities").doc(context.entityId).collection("roles").doc(customRoleId);
    const mutation = await db.runTransaction(async (transaction): Promise<MutatedRoleResult> => {
      const roleSnapshot = await transaction.get(roleRef);
      if (!roleSnapshot.exists) {
        throw new Error("role-not-found: Rôle personnalisé introuvable.");
      }

      const currentRole = validateCustomRoleDocument({
        entityId: context.entityId,
        roleId: customRoleId,
        roleData: roleSnapshot.data(),
      });
      const currentData = roleSnapshot.data() || {};

      if (currentData.status !== "active") {
        throw new Error("role-inactive: Rôle personnalisé inactif.");
      }

      const previousVersion = currentRole.version || 1;
      const nextVersion = previousVersion + 1;
      const changedFields = changedFieldsFrom(currentData, normalized);

      transaction.update(roleRef, {
        name: normalized.name,
        label: normalized.label,
        description: normalized.description,
        permissions: normalized.permissions,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.actorUid,
        version: nextVersion,
      });

      return {
        roleId: customRoleId,
        previousVersion,
        nextVersion,
        changedFields,
        permissionCount: normalized.permissions.length,
      };
    });

    const auditResult = await auditMutation({
      actorUid: context.actorUid,
      entityId: context.entityId,
      action: "entityRole.updated",
      roleId: mutation.roleId,
      changedFields: mutation.changedFields,
      permissionCount: mutation.permissionCount,
      previousVersion: mutation.previousVersion,
      nextVersion: mutation.nextVersion,
    });

    return auditResult || { success: true, roleId: mutation.roleId };
  } catch (error) {
    return mapError(error);
  }
}

export async function deactivateCustomRoleAction(params: DeactivateCustomRoleParams): Promise<CustomRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const context = await authorizeAndValidateEntity(params.idToken, params.entityId);
    const customRoleId = safeString(params.customRoleId);
    if (!customRoleId) return actionError("role-not-found", "Rôle personnalisé introuvable.");

    const roleRef = db.collection("entities").doc(context.entityId).collection("roles").doc(customRoleId);
    const mutation = await db.runTransaction(async (transaction): Promise<MutatedRoleResult> => {
      const roleSnapshot = await transaction.get(roleRef);
      if (!roleSnapshot.exists) {
        throw new Error("role-not-found: Rôle personnalisé introuvable.");
      }

      const currentRole = validateCustomRoleDocument({
        entityId: context.entityId,
        roleId: customRoleId,
        roleData: roleSnapshot.data(),
      });
      const currentData = roleSnapshot.data() || {};

      if (currentData.status === "inactive") {
        return {
          roleId: customRoleId,
          previousVersion: currentRole.version || 1,
          nextVersion: currentRole.version || 1,
          permissionCount: currentRole.permissions.length,
          alreadyInactive: true,
        };
      }

      if (currentData.status !== "active") {
        throw new Error("role-inactive: Rôle personnalisé inactif.");
      }

      const previousVersion = currentRole.version || 1;
      const nextVersion = previousVersion + 1;

      transaction.update(roleRef, {
        status: "inactive",
        deactivatedAt: FieldValue.serverTimestamp(),
        deactivatedBy: context.actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.actorUid,
        version: nextVersion,
      });

      return {
        roleId: customRoleId,
        previousVersion,
        nextVersion,
        changedFields: ["status"],
        permissionCount: currentRole.permissions.length,
      };
    });

    if (mutation.alreadyInactive) {
      return { success: true, roleId: mutation.roleId, alreadyInactive: true };
    }

    const auditResult = await auditMutation({
      actorUid: context.actorUid,
      entityId: context.entityId,
      action: "entityRole.deactivated",
      roleId: mutation.roleId,
      changedFields: mutation.changedFields,
      permissionCount: mutation.permissionCount,
      previousVersion: mutation.previousVersion,
      nextVersion: mutation.nextVersion,
    });

    return auditResult || { success: true, roleId: mutation.roleId };
  } catch (error) {
    return mapError(error);
  }
}
