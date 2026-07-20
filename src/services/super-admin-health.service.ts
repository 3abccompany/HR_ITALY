import {
  collection,
  onSnapshot,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { MVP_PERMISSIONS, type PermissionDefinition } from "@/config/permissions";
import { MVP_ROLES, type RoleDefinition } from "@/config/roles";
import { db } from "@/lib/firebase/client";
import type { Entity } from "@/types/entity";
import type { Membership } from "@/types/membership";
import type { Permission } from "@/types/permission";
import type { Role } from "@/types/role";
import type {
  SuperAdminHealthCategory,
  SuperAdminHealthDiagnostic,
  SuperAdminHealthReport,
  SuperAdminHealthSeverity,
  SuperAdminHealthSummary,
} from "@/types/super-admin-health";
import type { AppUser } from "@/types/user";

type WithDocumentId<T> = T & { id?: string };

export interface SuperAdminHealthInput {
  entities: WithDocumentId<Entity>[];
  users: WithDocumentId<AppUser>[];
  memberships: WithDocumentId<Membership>[];
  roles: WithDocumentId<Role>[];
  permissions: WithDocumentId<Permission>[];
  staticRoles?: RoleDefinition[];
  staticPermissions?: PermissionDefinition[];
}

type RuntimeStatus = "active" | "inactive" | "archived";

interface RuntimeStatusSummary {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  invalidOrMissing: number;
}

interface PermissionShapeSummary {
  validArray: number;
  missing: number;
  invalidType: number;
}

interface SuperAdminStatusCompatibilitySummary {
  users: RuntimeStatusSummary;
  entities: RuntimeStatusSummary;
  memberships: RuntimeStatusSummary;
  membershipPermissions: PermissionShapeSummary;
  superAdmins: RuntimeStatusSummary;
}

const SENSITIVE_PERMISSION_PREFIXES = ["platform."];
const SENSITIVE_PERMISSION_CODES = new Set([
  "platform.users.create",
  "platform.users.update",
  "platform.users.disable",
  "platform.entities.create",
  "platform.entities.update",
  "platform.entities.disable",
  "platform.roles.create",
  "platform.roles.update",
  "platform.permissions.update",
  "platform.memberships.create",
  "platform.memberships.update",
  "platform.memberships.disable",
  "platform.audit.read",
  "platform.settings.manage",
  "payroll.approve",
  "payroll.export",
  "payroll.lock",
  "payroll.write",
  "payroll.calculate",
  "payroll.recalculate",
  "documents.download",
  "documents.archive",
  "reports.export",
  "contracts.create",
  "contracts.update",
  "contracts.renew",
  "contracts.terminate",
  "employees.archive",
  "memberships.create",
  "memberships.update",
  "permissions.update",
]);

function snapshotToData<T>(snapshot: QuerySnapshot<DocumentData>): WithDocumentId<T>[] {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as WithDocumentId<T>[];
}

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveUserId(value: Partial<Membership> | Partial<AppUser>, documentId?: string): string | null {
  return normalize((value as Partial<Membership>).uid) || normalize((value as Partial<Membership>).userId) || normalize(documentId);
}

function resolveEntityId(value: Partial<Membership> | Partial<Entity>, documentId?: string): string | null {
  return normalize((value as Partial<Membership>).entityId) || normalize((value as Partial<Entity>).entityId) || normalize(documentId);
}

function resolveRoleId(value: Partial<Role> | Partial<Membership> | Partial<RoleDefinition>, documentId?: string): string | null {
  return normalize((value as Partial<Role>).roleId) || normalize((value as Partial<RoleDefinition>).roleId) || normalize(documentId);
}

function resolvePermissionCode(value: Partial<Permission> | Partial<PermissionDefinition>, documentId?: string): string | null {
  return normalize((value as Partial<Permission>).code) || normalize(documentId);
}

function resolveMembershipId(membership: WithDocumentId<Membership>): string {
  return normalize(membership.membershipId) || normalize(membership.id) || "membership-inconnu";
}

function resolveUserName(user?: Partial<AppUser>, membership?: Partial<Membership>): string | undefined {
  return (
    normalize(membership?.userDisplayName) ||
    normalize(user?.displayName) ||
    [normalize(user?.firstName), normalize(user?.lastName)].filter(Boolean).join(" ") ||
    undefined
  );
}

function resolveEntityName(entity?: Partial<Entity>, membership?: Partial<Membership>): string | undefined {
  return (
    normalize(membership?.entityName) ||
    normalize(entity?.nomEntreprise) ||
    normalize(entity?.raisonSociale) ||
    normalize(entity?.name) ||
    normalize(entity?.legalName) ||
    undefined
  );
}

function resolveRoleLabel(role?: Partial<Role>, staticRole?: RoleDefinition, membership?: Partial<Membership>): string | undefined {
  return normalize(membership?.roleLabel) || normalize(role?.label) || normalize(staticRole?.label) || undefined;
}

function getRolePermissions(role?: Partial<Role>, staticRole?: RoleDefinition): string[] {
  if (Array.isArray(role?.permissions)) return role.permissions.filter((permission): permission is string => typeof permission === "string");
  if (staticRole) return staticRole.getPermissions();
  return [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function arraysDiffer(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueSorted(left);
  const normalizedRight = uniqueSorted(right);
  return normalizedLeft.length !== normalizedRight.length || normalizedLeft.some((value, index) => value !== normalizedRight[index]);
}

function createStatusSummary(): RuntimeStatusSummary {
  return {
    total: 0,
    active: 0,
    inactive: 0,
    archived: 0,
    invalidOrMissing: 0,
  };
}

function createPermissionShapeSummary(): PermissionShapeSummary {
  return {
    validArray: 0,
    missing: 0,
    invalidType: 0,
  };
}

function isValidRuntimeStatus(value: unknown): value is RuntimeStatus {
  return value === "active" || value === "inactive" || value === "archived";
}

function addStatus(summary: RuntimeStatusSummary, value: unknown) {
  summary.total += 1;
  if (isValidRuntimeStatus(value)) {
    summary[value] += 1;
  } else {
    summary.invalidOrMissing += 1;
  }
}

function hasOwnField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isActiveStatus(value?: string): boolean {
  return value === "active";
}

export function isSensitivePermission(permissionCode: string): boolean {
  return SENSITIVE_PERMISSION_CODES.has(permissionCode) || SENSITIVE_PERMISSION_PREFIXES.some((prefix) => permissionCode.startsWith(prefix));
}

function createDiagnostic(params: Omit<SuperAdminHealthDiagnostic, "id"> & { diagnosticKey?: string }): SuperAdminHealthDiagnostic {
  const { diagnosticKey, ...diagnostic } = params;
  const base = [
    diagnostic.code,
    diagnosticKey,
    diagnostic.membershipId,
    diagnostic.userId,
    diagnostic.entityId,
    diagnostic.roleId,
    diagnostic.permissionCode,
  ]
    .filter(Boolean)
    .join("__")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_");

  return {
    id: base || diagnostic.code,
    ...diagnostic,
  };
}

function buildSummary(diagnostics: SuperAdminHealthDiagnostic[]): SuperAdminHealthSummary {
  const category: Record<SuperAdminHealthCategory, number> = {
    membership: 0,
    permission: 0,
    role: 0,
    catalog: 0,
  };
  const severity: Record<SuperAdminHealthSeverity, number> = {
    critical: 0,
    warning: 0,
    information: 0,
  };

  diagnostics.forEach((diagnostic) => {
    severity[diagnostic.severity] += 1;
    category[diagnostic.category] += 1;
  });

  return {
    total: diagnostics.length,
    severity,
    category,
    unknownPermissions: diagnostics.filter((diagnostic) => diagnostic.code.includes("unknown_permission")).length,
    staleRoleSnapshots: diagnostics.filter((diagnostic) => diagnostic.code === "membership_role_snapshot_drift").length,
    sensitiveAssignments: diagnostics.filter((diagnostic) => diagnostic.code === "sensitive_permission_assignment").length,
    isHealthy: diagnostics.length === 0,
  };
}

export function buildSuperAdminHealthReport(input: SuperAdminHealthInput): SuperAdminHealthReport {
  const staticRoles = input.staticRoles || MVP_ROLES;
  const staticPermissions = input.staticPermissions || MVP_PERMISSIONS;

  const usersById = new Map<string, WithDocumentId<AppUser>>();
  const entitiesById = new Map<string, WithDocumentId<Entity>>();
  const rolesById = new Map<string, WithDocumentId<Role>>();
  const staticRolesById = new Map<string, RoleDefinition>();
  const permissionsByCode = new Map<string, WithDocumentId<Permission>>();
  const staticPermissionsByCode = new Map<string, PermissionDefinition>();

  input.users.forEach((user) => {
    const uid = resolveUserId(user, user.id);
    if (uid) usersById.set(uid, user);
  });

  input.entities.forEach((entity) => {
    const entityId = resolveEntityId(entity, entity.id);
    if (entityId) entitiesById.set(entityId, entity);
  });

  input.roles.forEach((role) => {
    const roleId = resolveRoleId(role, role.id);
    if (roleId) rolesById.set(roleId, role);
  });

  staticRoles.forEach((role) => {
    const roleId = resolveRoleId(role);
    if (roleId) staticRolesById.set(roleId, role);
  });

  input.permissions.forEach((permission) => {
    const code = resolvePermissionCode(permission, permission.id);
    if (code) permissionsByCode.set(code, permission);
  });

  staticPermissions.forEach((permission) => {
    const code = resolvePermissionCode(permission);
    if (code) staticPermissionsByCode.set(code, permission);
  });

  const diagnostics: SuperAdminHealthDiagnostic[] = [];
  const membershipsByUserEntity = new Map<string, WithDocumentId<Membership>[]>();
  const membershipUserIds = new Set<string>();
  const permissionsUsedByRoles = new Set<string>();
  const permissionsUsedByMemberships = new Set<string>();
  const statusCompatibility: SuperAdminStatusCompatibilitySummary = {
    users: createStatusSummary(),
    entities: createStatusSummary(),
    memberships: createStatusSummary(),
    membershipPermissions: createPermissionShapeSummary(),
    superAdmins: createStatusSummary(),
  };

  input.users.forEach((user, index) => {
    addStatus(statusCompatibility.users, user.status);

    if (!isValidRuntimeStatus(user.status)) {
      diagnostics.push(createDiagnostic({
        diagnosticKey: `user_${index}`,
        code: "user_invalid_status",
        category: "membership",
        severity: "critical",
        title: "Utilisateur avec statut invalide",
        explanation: "Un utilisateur possède un statut manquant, nul, non texte ou hors valeurs autorisées.",
        status: typeof user.status === "string" ? user.status : undefined,
      }));
    }

    if (user.platformRole === "superAdmin") {
      addStatus(statusCompatibility.superAdmins, user.status);

      if (user.status === "inactive" || user.status === "archived") {
        diagnostics.push(createDiagnostic({
          diagnosticKey: `super_admin_${index}`,
          code: "super_admin_non_active",
          category: "membership",
          severity: "warning",
          title: "Super Admin non actif",
          explanation: "Un utilisateur Super Admin possède un statut inactif ou archivé. Diagnostic informatif, sans changement d'accès automatique.",
          status: user.status,
        }));
      } else if (!isValidRuntimeStatus(user.status)) {
        diagnostics.push(createDiagnostic({
          diagnosticKey: `super_admin_${index}`,
          code: "super_admin_invalid_status",
          category: "membership",
          severity: "critical",
          title: "Super Admin avec statut invalide",
          explanation: "Un utilisateur Super Admin possède un statut manquant, nul, non texte ou inconnu.",
          status: typeof user.status === "string" ? user.status : undefined,
        }));
      }
    }
  });

  input.entities.forEach((entity, index) => {
    addStatus(statusCompatibility.entities, entity.status);

    if (!isValidRuntimeStatus(entity.status)) {
      diagnostics.push(createDiagnostic({
        diagnosticKey: `entity_${index}`,
        code: "entity_invalid_status",
        category: "membership",
        severity: "critical",
        title: "Entité avec statut invalide",
        explanation: "Une entité possède un statut manquant, nul, non texte ou hors valeurs autorisées.",
        status: typeof entity.status === "string" ? entity.status : undefined,
      }));
    }
  });

  input.memberships.forEach((membership, index) => {
    addStatus(statusCompatibility.memberships, membership.status);

    if (!isValidRuntimeStatus(membership.status)) {
      diagnostics.push(createDiagnostic({
        diagnosticKey: `membership_${index}`,
        code: "membership_invalid_status",
        category: "membership",
        severity: "critical",
        title: "Membership avec statut invalide",
        explanation: "Une affectation possède un statut manquant, nul, non texte ou hors valeurs autorisées.",
        status: typeof membership.status === "string" ? membership.status : undefined,
      }));
    }

    if (!hasOwnField(membership, "permissions")) {
      statusCompatibility.membershipPermissions.missing += 1;
      diagnostics.push(createDiagnostic({
        diagnosticKey: `membership_permissions_${index}`,
        code: "membership_permissions_missing",
        category: "membership",
        severity: "critical",
        title: "Snapshot de permissions manquant",
        explanation: "Une affectation ne contient pas de champ permissions exploitable.",
        status: membership.status,
      }));
    } else if (!Array.isArray(membership.permissions)) {
      statusCompatibility.membershipPermissions.invalidType += 1;
      diagnostics.push(createDiagnostic({
        diagnosticKey: `membership_permissions_${index}`,
        code: "membership_permissions_invalid_type",
        category: "membership",
        severity: "critical",
        title: "Snapshot de permissions de type invalide",
        explanation: "Une affectation contient un champ permissions, mais sa valeur n'est pas un tableau.",
        status: membership.status,
      }));
    } else {
      statusCompatibility.membershipPermissions.validArray += 1;
    }

    const membershipId = resolveMembershipId(membership);
    const userId = resolveUserId(membership);
    const entityId = resolveEntityId(membership);
    const roleId = resolveRoleId(membership);
    const isActiveMembership = isActiveStatus(membership.status);
    const user = userId ? usersById.get(userId) : undefined;
    const entity = entityId ? entitiesById.get(entityId) : undefined;
    const role = roleId ? rolesById.get(roleId) : undefined;
    const staticRole = roleId ? staticRolesById.get(roleId) : undefined;
    const userName = resolveUserName(user, membership);
    const entityName = resolveEntityName(entity, membership);
    const roleLabel = resolveRoleLabel(role, staticRole, membership);

    if (userId) membershipUserIds.add(userId);
    if (userId && entityId) {
      const key = `${userId}__${entityId}`;
      membershipsByUserEntity.set(key, [...(membershipsByUserEntity.get(key) || []), membership]);
    }

    const baseContext = {
      userId: userId || undefined,
      userDisplayName: userName,
      userEmail: normalize(membership.userEmail) || user?.email,
      entityId: entityId || undefined,
      entityName,
      membershipId,
      roleId: roleId || undefined,
      roleLabel,
      status: membership.status,
    };

    if (!userId) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_missing_user_id",
        category: "membership",
        severity: isActiveMembership ? "critical" : "warning",
        title: "Membership sans utilisateur",
        explanation: "Cette affectation ne contient ni uid ni userId exploitable.",
      }));
    } else if (!user) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_missing_user_reference",
        category: "membership",
        severity: isActiveMembership ? "critical" : "warning",
        title: "Utilisateur introuvable",
        explanation: "Cette affectation référence un utilisateur absent du catalogue plateforme.",
      }));
    } else if (isActiveMembership && user.status !== "active") {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "active_membership_inactive_user",
        category: "membership",
        severity: "critical",
        title: "Utilisateur inactif avec accès actif",
        explanation: "Un utilisateur inactif ou archivé conserve une affectation active.",
      }));
    }

    if (!entityId) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_missing_entity_id",
        category: "membership",
        severity: isActiveMembership ? "critical" : "warning",
        title: "Membership sans entité",
        explanation: "Cette affectation ne contient pas d'entityId exploitable.",
      }));
    } else if (!entity) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_missing_entity_reference",
        category: "membership",
        severity: isActiveMembership ? "critical" : "warning",
        title: "Entité introuvable",
        explanation: "Cette affectation référence une entité absente du catalogue plateforme.",
      }));
    } else if (isActiveMembership && entity.status !== "active") {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "active_membership_inactive_entity",
        category: "membership",
        severity: "critical",
        title: "Entité inactive avec accès actif",
        explanation: "Une entité inactive ou archivée contient encore une affectation active.",
      }));
    }

    if (!roleId) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_missing_role_id",
        category: "membership",
        severity: "warning",
        title: "Rôle non renseigné",
        explanation: "Cette affectation n'indique pas le modèle de rôle attendu.",
      }));
    } else if (!role && !staticRole) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_unknown_role",
        category: "role",
        severity: "warning",
        title: "Rôle absent du catalogue",
        explanation: "Le rôle indiqué par cette affectation n'existe ni dans le catalogue runtime ni dans les rôles système.",
      }));
    }

    if (membershipId && userId && entityId && membershipId !== `${userId}_${entityId}`) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_identity_mismatch",
        category: "membership",
        severity: "warning",
        title: "Identifiant de membership atypique",
        explanation: "L'identifiant ne suit pas la convention déterministe {uid}_{entityId}. À vérifier si ce n'est pas un ancien format légitime.",
      }));
    }

    const membershipPermissions = Array.isArray(membership.permissions)
      ? membership.permissions.filter((permission): permission is string => typeof permission === "string")
      : [];

    membershipPermissions.forEach((permissionCode) => {
      permissionsUsedByMemberships.add(permissionCode);
      const runtimePermission = permissionsByCode.get(permissionCode);
      const staticPermission = staticPermissionsByCode.get(permissionCode);
      const permissionScope = runtimePermission?.scope || staticPermission?.scope;

      if (!runtimePermission) {
        diagnostics.push(createDiagnostic({
          ...baseContext,
          code: "membership_unknown_permission",
          category: "permission",
          severity: isActiveMembership ? "critical" : "warning",
          title: "Permission absente du catalogue runtime",
          explanation: "Cette affectation contient une permission qui n'existe pas dans le catalogue Firestore.",
          permissionCode,
        }));
      }

      if (permissionScope === "platform" || permissionCode.startsWith("platform.")) {
        diagnostics.push(createDiagnostic({
          ...baseContext,
          code: "platform_permission_in_entity_membership",
          category: "permission",
          severity: "critical",
          title: "Permission plateforme dans un membership entité",
          explanation: "Une permission de portée plateforme est présente dans une affectation d'entité.",
          permissionCode,
        }));
      } else if (isSensitivePermission(permissionCode)) {
        diagnostics.push(createDiagnostic({
          ...baseContext,
          code: "sensitive_permission_assignment",
          category: "permission",
          severity: "information",
          title: "Permission sensible attribuée",
          explanation: "Cette affectation contient une permission sensible. Ce n'est pas forcément une erreur, mais elle mérite une revue périodique.",
          permissionCode,
        }));
      }

      if (runtimePermission && runtimePermission.status && runtimePermission.status !== "active") {
        diagnostics.push(createDiagnostic({
          ...baseContext,
          code: "inactive_permission_assigned",
          category: "permission",
          severity: isActiveMembership ? "warning" : "information",
          title: "Permission inactive encore attribuée",
          explanation: "Une permission inactive dans le catalogue est encore présente dans une affectation.",
          permissionCode,
        }));
      }
    });

    if ((role || staticRole) && arraysDiffer(membershipPermissions, getRolePermissions(role, staticRole))) {
      diagnostics.push(createDiagnostic({
        ...baseContext,
        code: "membership_role_snapshot_drift",
        category: "membership",
        severity: "warning",
        title: "Snapshot de rôle désynchronisé",
        explanation: "Les permissions stockées sur le membership diffèrent du modèle de rôle référencé.",
      }));
    }
  });

  usersById.forEach((user, userId) => {
    if (!membershipUserIds.has(userId)) {
      diagnostics.push(createDiagnostic({
        code: "user_without_membership",
        category: "membership",
        severity: "information",
        title: "Utilisateur sans affectation",
        explanation: "Cet utilisateur n'a aucun membership associé.",
        userId,
        userDisplayName: resolveUserName(user),
        userEmail: user.email,
        status: user.status,
      }));
    }
  });

  const userEntityMemberships = new Map<string, Set<string>>();
  membershipsByUserEntity.forEach((memberships, key) => {
    const [userId, entityId] = key.split("__");
    if (!userEntityMemberships.has(userId)) userEntityMemberships.set(userId, new Set());
    userEntityMemberships.get(userId)?.add(entityId);

    if (memberships.length > 1) {
      const activeMemberships = memberships.filter((membership) => membership.status === "active");
      const activePermissionSets = new Set(
        activeMemberships.map((membership) => uniqueSorted(membership.permissions || []).join("|"))
      );
      diagnostics.push(createDiagnostic({
        code: "duplicate_user_entity_membership",
        category: "membership",
        severity: activeMemberships.length > 1 && activePermissionSets.size > 1 ? "critical" : "warning",
        title: "Affectations dupliquées",
        explanation: "Plusieurs documents membership correspondent au même couple utilisateur/entité.",
        userId,
        userDisplayName: resolveUserName(usersById.get(userId), memberships[0]),
        userEmail: usersById.get(userId)?.email || memberships[0].userEmail,
        entityId,
        entityName: resolveEntityName(entitiesById.get(entityId), memberships[0]),
        membershipId: memberships.map(resolveMembershipId).join(", "),
      }));
    }
  });

  userEntityMemberships.forEach((entityIds, userId) => {
    if (entityIds.size > 1) {
      const entityNames = Array.from(entityIds)
        .map((entityId) => resolveEntityName(entitiesById.get(entityId)) || entityId)
        .join(", ");
      diagnostics.push(createDiagnostic({
        code: "user_multi_entity_memberships",
        category: "membership",
        severity: "information",
        title: "Utilisateur multi-entités",
        explanation: `Cet utilisateur possède des affectations dans plusieurs entités: ${entityNames}.`,
        userId,
        userDisplayName: resolveUserName(usersById.get(userId)),
        userEmail: usersById.get(userId)?.email,
      }));
    }
  });

  rolesById.forEach((role, roleId) => {
    const staticRole = staticRolesById.get(roleId);
    const rolePermissions = getRolePermissions(role, staticRole);
    rolePermissions.forEach((permissionCode) => {
      permissionsUsedByRoles.add(permissionCode);
      const runtimePermission = permissionsByCode.get(permissionCode);
      const staticPermission = staticPermissionsByCode.get(permissionCode);

      if (!runtimePermission) {
        diagnostics.push(createDiagnostic({
          code: "role_unknown_permission",
          category: "role",
          severity: "critical",
          title: "Rôle avec permission absente",
          explanation: "Ce rôle référence une permission absente du catalogue runtime.",
          roleId,
          roleLabel: role.label,
          permissionCode,
          status: role.status,
        }));
      }

      const permissionScope = runtimePermission?.scope || staticPermission?.scope;
      if (permissionScope && role.scope && permissionScope !== role.scope) {
        diagnostics.push(createDiagnostic({
          code: "role_permission_scope_mismatch",
          category: "role",
          severity: "critical",
          title: "Portée de permission incohérente",
          explanation: "La portée de la permission ne correspond pas à la portée du rôle.",
          roleId,
          roleLabel: role.label,
          permissionCode,
          status: role.status,
        }));
      }
    });

    if (staticRole && arraysDiffer(rolePermissions, staticRole.getPermissions())) {
      diagnostics.push(createDiagnostic({
        code: "runtime_role_template_drift",
        category: "role",
        severity: "warning",
        title: "Rôle runtime différent du modèle système",
        explanation: "Le rôle stocké dans Firestore diffère du modèle MVP statique.",
        roleId,
        roleLabel: role.label || staticRole.label,
        status: role.status,
      }));
    }
  });

  staticPermissionsByCode.forEach((permission, code) => {
    if (!permissionsByCode.has(code)) {
      diagnostics.push(createDiagnostic({
        code: "static_permission_missing_runtime",
        category: "catalog",
        severity: "warning",
        title: "Permission système absente du catalogue runtime",
        explanation: "Une permission définie dans le catalogue statique n'est pas présente dans Firestore.",
        permissionCode: code,
        status: permission.scope,
      }));
    }
  });

  permissionsByCode.forEach((permission, code) => {
    if (!staticPermissionsByCode.has(code)) {
      diagnostics.push(createDiagnostic({
        code: "runtime_permission_not_in_static_catalog",
        category: "catalog",
        severity: "warning",
        title: "Permission runtime hors catalogue statique",
        explanation: "Une permission présente dans Firestore n'existe pas dans MVP_PERMISSIONS.",
        permissionCode: code,
        status: permission.status,
      }));
    }

    if (!permissionsUsedByRoles.has(code)) {
      diagnostics.push(createDiagnostic({
        code: "permission_assigned_to_no_role",
        category: "permission",
        severity: "information",
        title: "Permission non utilisée par un rôle",
        explanation: "Cette permission existe dans le catalogue mais n'est référencée par aucun rôle runtime.",
        permissionCode: code,
        status: permission.status,
      }));
    }
  });

  const reportDiagnostics = diagnostics.sort((left, right) => {
    const severityOrder: Record<SuperAdminHealthSeverity, number> = { critical: 0, warning: 1, information: 2 };
    return severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title);
  });

  return {
    diagnostics: reportDiagnostics,
    summary: buildSummary(reportDiagnostics),
    statusCompatibility,
    isEmptyPlatform:
      input.entities.length === 0 &&
      input.users.length === 0 &&
      input.memberships.length === 0 &&
      input.roles.length === 0 &&
      input.permissions.length === 0,
  } as SuperAdminHealthReport & { statusCompatibility: SuperAdminStatusCompatibilitySummary };
}

export function subscribeSuperAdminHealthReport(
  onUpdate: (report: SuperAdminHealthReport) => void,
  onError: (error: Error) => void
): Unsubscribe {
  if (!db) {
    onError(new Error("Firestore n'est pas initialisé."));
    return () => {};
  }

  const latest: Partial<Pick<SuperAdminHealthInput, "entities" | "users" | "memberships" | "roles" | "permissions">> = {};
  const loadedCollections = new Set<string>();
  const unsubscribers: Unsubscribe[] = [];

  const cleanup = () => {
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      unsubscribe?.();
    }
  };

  const emitIfReady = () => {
    if (loadedCollections.size !== 5) return;
    onUpdate(
      buildSuperAdminHealthReport({
        entities: latest.entities || [],
        users: latest.users || [],
        memberships: latest.memberships || [],
        roles: latest.roles || [],
        permissions: latest.permissions || [],
      })
    );
  };

  const handleError = (error: unknown) => {
    console.error("[SuperAdminHealth] Realtime diagnostics failed", error);
    cleanup();
    onError(new Error("Impossible de synchroniser les diagnostics d'accès."));
  };

  unsubscribers.push(
    onSnapshot(collection(db, "entities"), (snapshot) => {
      latest.entities = snapshotToData<Entity>(snapshot);
      loadedCollections.add("entities");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "users"), (snapshot) => {
      latest.users = snapshotToData<AppUser>(snapshot);
      loadedCollections.add("users");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "memberships"), (snapshot) => {
      latest.memberships = snapshotToData<Membership>(snapshot);
      loadedCollections.add("memberships");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "roles"), (snapshot) => {
      latest.roles = snapshotToData<Role>(snapshot);
      loadedCollections.add("roles");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "permissions"), (snapshot) => {
      latest.permissions = snapshotToData<Permission>(snapshot);
      loadedCollections.add("permissions");
      emitIfReady();
    }, handleError)
  );

  return cleanup;
}
