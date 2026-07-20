"use server";

import { MVP_ROLES, type RoleDefinition } from "@/config/roles";
import { createTrustedAuditLog } from "@/services/audit.server";
import {
  authorizeActiveSuperAdmin,
  CustomRoleValidationError,
  isProtectedSystemRoleId,
  validateEntityScopedPermissions,
} from "@/services/custom-role.server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

type MembershipRoleActionCode =
  | "unauthenticated"
  | "inactive-user"
  | "forbidden-not-super-admin"
  | "target-user-not-found"
  | "target-user-inactive"
  | "entity-not-found"
  | "entity-inactive"
  | "membership-not-found"
  | "membership-already-exists"
  | "role-not-found"
  | "role-inactive"
  | "role-not-assignable"
  | "system-role-protected"
  | "platform-permission-forbidden"
  | "invalid-permission"
  | "unknown-permission"
  | "custom-role-invalid"
  | "service-unavailable";

type MembershipRoleActionResult = {
  success: boolean;
  membershipId?: string;
  auditWarning?: string;
  error?: string;
  code?: MembershipRoleActionCode;
};

type CreateMembershipWithRoleParams = {
  idToken: string;
  targetUid: string;
  entityId: string;
  roleId: string;
  notes?: unknown;
};

type AssignMembershipRoleParams = {
  idToken: string;
  membershipId: string;
  roleId: string;
};

type RoleKindForAssignment = "system" | "custom";

type ResolvedAssignableRole = {
  roleId: string;
  roleLabel: string;
  roleKind: RoleKindForAssignment;
  permissions: string[];
};

type TargetUserContext = {
  uid: string;
  displayName: string;
  email: string;
};

type EntityContext = {
  entityId: string;
  entityName: string;
};

type SnapshotResult = {
  permissions: string[];
  selfServiceOverlayApplied: boolean;
};

const assignableSystemRoleIds = new Set(["companyAdmin", "companyHR", "safetyManager", "employee", "readOnly"]);

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeOptionalString(value: unknown): string | undefined {
  const normalized = safeString(value);
  return normalized || undefined;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function actionError(code: MembershipRoleActionCode, message: string): MembershipRoleActionResult {
  return { success: false, code, error: message };
}

function mapError(error: unknown): MembershipRoleActionResult {
  if (error instanceof MembershipRoleValidationError) {
    return actionError(error.code, error.message);
  }

  if (error instanceof CustomRoleValidationError) {
    return actionError(error.code as MembershipRoleActionCode, error.message);
  }

  if (error instanceof Error && error.message.includes(":")) {
    const [rawCode, ...messageParts] = error.message.split(":");
    const code = rawCode.trim() as MembershipRoleActionCode;
    const message = messageParts.join(":").trim() || "Action refusée.";
    return actionError(code, message);
  }

  return actionError("custom-role-invalid", "Action refusée.");
}

class MembershipRoleValidationError extends Error {
  constructor(
    public readonly code: MembershipRoleActionCode,
    message: string
  ) {
    super(message);
    this.name = "MembershipRoleValidationError";
  }
}

function reject(code: MembershipRoleActionCode, message: string): never {
  throw new MembershipRoleValidationError(code, message);
}

function ensureAdminDb() {
  if (!adminDb) {
    reject("service-unavailable", "Service administrateur indisponible.");
  }
  return adminDb;
}

function resolveSystemRole(roleId: string): RoleDefinition | null {
  if (!assignableSystemRoleIds.has(roleId)) return null;
  return MVP_ROLES.find((role) => role.roleId === roleId && role.scope === "entity") || null;
}

async function loadActiveTargetUser(targetUid: string): Promise<TargetUserContext> {
  const db = ensureAdminDb();
  const uid = safeString(targetUid);
  if (!uid) reject("target-user-not-found", "Utilisateur cible introuvable.");

  const userSnapshot = await db.collection("users").doc(uid).get();
  if (!userSnapshot.exists) {
    reject("target-user-not-found", "Utilisateur cible introuvable.");
  }

  const user = userSnapshot.data() || {};
  if (user.status !== "active") {
    reject("target-user-inactive", "Utilisateur cible inactif.");
  }

  return {
    uid,
    displayName: safeString(user.displayName) || [safeString(user.firstName), safeString(user.lastName)].filter(Boolean).join(" ") || safeString(user.email) || uid,
    email: safeString(user.email),
  };
}

async function loadActiveEntity(entityId: string): Promise<EntityContext> {
  const db = ensureAdminDb();
  const normalizedEntityId = safeString(entityId);
  if (!normalizedEntityId) reject("entity-not-found", "Entité introuvable.");

  const entitySnapshot = await db.collection("entities").doc(normalizedEntityId).get();
  if (!entitySnapshot.exists) {
    reject("entity-not-found", "Entité introuvable.");
  }

  const entity = entitySnapshot.data() || {};
  if (entity.status !== "active") {
    reject("entity-inactive", "Entité inactive.");
  }

  return {
    entityId: normalizedEntityId,
    entityName: safeString(entity.nomEntreprise) || safeString(entity.name) || safeString(entity.raisonSociale) || safeString(entity.legalName) || normalizedEntityId,
  };
}

async function resolveAssignableRole(roleId: string): Promise<ResolvedAssignableRole> {
  const db = ensureAdminDb();
  const normalizedRoleId = safeString(roleId);
  if (!normalizedRoleId) reject("role-not-found", "Rôle introuvable.");
  if (normalizedRoleId === "superAdmin") {
    reject("system-role-protected", "Le rôle Super Admin ne peut pas être affecté à un membership entité.");
  }

  const roleSnapshot = await db.collection("roles").doc(normalizedRoleId).get();
  const runtimeRole = roleSnapshot.exists ? roleSnapshot.data() || {} : null;
  const systemRole = resolveSystemRole(normalizedRoleId);

  if (systemRole) {
    const sourcePermissions = Array.isArray(runtimeRole?.permissions)
      ? runtimeRole.permissions.filter((permission): permission is string => typeof permission === "string")
      : systemRole.getPermissions();
    const permissions = await validateEntityScopedPermissions(sourcePermissions);

    return {
      roleId: normalizedRoleId,
      roleLabel: safeString(runtimeRole?.label) || systemRole.label,
      roleKind: "system",
      permissions,
    };
  }

  if (!runtimeRole) {
    reject("role-not-found", "Rôle introuvable.");
  }

  if (isProtectedSystemRoleId(normalizedRoleId)) {
    reject("role-not-assignable", "Ce rôle système ne peut pas être affecté à un membership entité.");
  }

  if (
    runtimeRole.kind !== "custom" ||
    runtimeRole.scope !== "entity" ||
    runtimeRole.isSystem === true ||
    runtimeRole.isLocked === true
  ) {
    reject("role-not-assignable", "Rôle non affectable.");
  }

  if (runtimeRole.status !== "active") {
    reject("role-inactive", "Rôle inactif.");
  }

  if (!Array.isArray(runtimeRole.permissions)) {
    reject("custom-role-invalid", "Snapshot de permissions du rôle invalide.");
  }

  const runtimePermissions = runtimeRole.permissions.filter((permission): permission is string => typeof permission === "string");
  if (runtimePermissions.length !== runtimeRole.permissions.length || runtimePermissions.some((permission) => permission.startsWith("platform."))) {
    reject("platform-permission-forbidden", "Permissions plateforme interdites.");
  }

  const permissions = await validateEntityScopedPermissions(runtimePermissions);

  return {
    roleId: normalizedRoleId,
    roleLabel: safeString(runtimeRole.label) || normalizedRoleId,
    roleKind: "custom",
    permissions,
  };
}

async function buildPermissionSnapshot(params: {
  entityId: string;
  targetUid: string;
  rolePermissions: string[];
}): Promise<SnapshotResult> {
  const db = ensureAdminDb();
  const permissions = new Set(params.rolePermissions);
  const employeeRole = MVP_ROLES.find((role) => role.roleId === "employee");
  const employeeSelfServicePermissions = employeeRole?.getPermissions() || [];

  const employeeSnapshot = await db
    .collection("entities")
    .doc(params.entityId)
    .collection("employees")
    .where("userId", "==", params.targetUid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  const selfServiceOverlayApplied = !employeeSnapshot.empty;
  if (selfServiceOverlayApplied) {
    const validatedOverlay = await validateEntityScopedPermissions(employeeSelfServicePermissions);
    validatedOverlay.forEach((permission) => permissions.add(permission));
  }

  return {
    permissions: uniqueSorted(Array.from(permissions)),
    selfServiceOverlayApplied,
  };
}

async function auditMembershipMutation(params: {
  actorUid: string;
  entityId: string;
  action: "membership.created" | "membership.roleAssigned";
  membershipId: string;
  targetUid: string;
  previousRoleId?: string;
  nextRoleId: string;
  nextRoleKind: RoleKindForAssignment;
  permissionCount: number;
  selfServiceOverlayApplied: boolean;
}): Promise<MembershipRoleActionResult | null> {
  try {
    await createTrustedAuditLog({
      actorUid: params.actorUid,
      entityId: params.entityId,
      action: params.action,
      resourceType: "membership",
      resourceId: params.membershipId,
      details: {
        targetMembershipId: params.membershipId,
        targetUid: params.targetUid,
        ...(params.previousRoleId ? { previousRoleId: params.previousRoleId } : {}),
        nextRoleId: params.nextRoleId,
        nextRoleKind: params.nextRoleKind,
        permissionCount: params.permissionCount,
        selfServiceOverlayApplied: params.selfServiceOverlayApplied,
      },
    });
    return null;
  } catch {
    return {
      success: true,
      membershipId: params.membershipId,
      auditWarning: "L’affectation a été modifiée, mais le journal d’audit serveur n’a pas pu être écrit.",
    };
  }
}

export async function createMembershipWithRoleAction(params: CreateMembershipWithRoleParams): Promise<MembershipRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const { actorUid } = await authorizeActiveSuperAdmin(params.idToken);
    const targetUser = await loadActiveTargetUser(params.targetUid);
    const entity = await loadActiveEntity(params.entityId);
    const role = await resolveAssignableRole(params.roleId);
    const membershipId = `${targetUser.uid}_${entity.entityId}`;
    const membershipRef = db.collection("memberships").doc(membershipId);
    const existingMembership = await membershipRef.get();

    if (existingMembership.exists) {
      reject("membership-already-exists", "Une affectation existe déjà pour cet utilisateur et cette entité.");
    }

    const snapshot = await buildPermissionSnapshot({
      entityId: entity.entityId,
      targetUid: targetUser.uid,
      rolePermissions: role.permissions,
    });

    await membershipRef.set({
      membershipId,
      uid: targetUser.uid,
      userId: targetUser.uid,
      userDisplayName: targetUser.displayName,
      userEmail: targetUser.email,
      entityId: entity.entityId,
      entityName: entity.entityName,
      roleId: role.roleId,
      roleLabel: role.roleLabel,
      permissions: snapshot.permissions,
      status: "active",
      ...(safeOptionalString(params.notes) ? { notes: safeOptionalString(params.notes) } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedBy: actorUid,
    });

    const auditResult = await auditMembershipMutation({
      actorUid,
      entityId: entity.entityId,
      action: "membership.created",
      membershipId,
      targetUid: targetUser.uid,
      nextRoleId: role.roleId,
      nextRoleKind: role.roleKind,
      permissionCount: snapshot.permissions.length,
      selfServiceOverlayApplied: snapshot.selfServiceOverlayApplied,
    });

    return auditResult || { success: true, membershipId };
  } catch (error) {
    return mapError(error);
  }
}

export async function assignMembershipRoleAction(params: AssignMembershipRoleParams): Promise<MembershipRoleActionResult> {
  try {
    const db = ensureAdminDb();
    const { actorUid } = await authorizeActiveSuperAdmin(params.idToken);
    const membershipId = safeString(params.membershipId);
    if (!membershipId) reject("membership-not-found", "Affectation introuvable.");

    const role = await resolveAssignableRole(params.roleId);
    const membershipRef = db.collection("memberships").doc(membershipId);
    const mutation = await db.runTransaction(async (transaction) => {
      const membershipSnapshot = await transaction.get(membershipRef);
      if (!membershipSnapshot.exists) {
        throw new MembershipRoleValidationError("membership-not-found", "Affectation introuvable.");
      }

      const membership = membershipSnapshot.data() || {};
      const targetUid = safeString(membership.uid) || safeString(membership.userId);
      const entityId = safeString(membership.entityId);
      if (!targetUid || !entityId) {
        throw new MembershipRoleValidationError("custom-role-invalid", "Affectation invalide.");
      }

      const targetUser = await loadActiveTargetUser(targetUid);
      const entity = await loadActiveEntity(entityId);
      const snapshot = await buildPermissionSnapshot({
        entityId: entity.entityId,
        targetUid: targetUser.uid,
        rolePermissions: role.permissions,
      });
      const previousRoleId = safeString(membership.roleId);

      transaction.update(membershipRef, {
        roleId: role.roleId,
        roleLabel: role.roleLabel,
        permissions: snapshot.permissions,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });

      return {
        entityId: entity.entityId,
        targetUid: targetUser.uid,
        previousRoleId,
        permissions: snapshot.permissions,
        selfServiceOverlayApplied: snapshot.selfServiceOverlayApplied,
      };
    });

    const auditResult = await auditMembershipMutation({
      actorUid,
      entityId: mutation.entityId,
      action: "membership.roleAssigned",
      membershipId,
      targetUid: mutation.targetUid,
      previousRoleId: mutation.previousRoleId,
      nextRoleId: role.roleId,
      nextRoleKind: role.roleKind,
      permissionCount: mutation.permissions.length,
      selfServiceOverlayApplied: mutation.selfServiceOverlayApplied,
    });

    return auditResult || { success: true, membershipId };
  } catch (error) {
    return mapError(error);
  }
}
