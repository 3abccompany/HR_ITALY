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
import type { Membership } from "@/types/membership";
import type { Permission } from "@/types/permission";
import type { Role } from "@/types/role";
import type {
  SuperAdminCatalogComparisonState,
  SuperAdminCatalogReport,
  SuperAdminCatalogSummary,
  SuperAdminCatalogUsageCount,
  SuperAdminPermissionCatalogItem,
  SuperAdminPermissionCatalogSummary,
  SuperAdminRoleCatalogItem,
  SuperAdminRoleCatalogSummary,
} from "@/types/super-admin-catalog";
import { isSensitivePermission } from "./super-admin-health.service";

type WithDocumentId<T> = T & { id?: string };

interface CatalogInput {
  roles: WithDocumentId<Role>[];
  permissions: WithDocumentId<Permission>[];
  memberships: WithDocumentId<Membership>[];
  staticRoles?: RoleDefinition[];
  staticPermissions?: PermissionDefinition[];
}

function snapshotToData<T>(snapshot: QuerySnapshot<DocumentData>): WithDocumentId<T>[] {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as WithDocumentId<T>[];
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function arraysDiffer(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueSorted(left);
  const normalizedRight = uniqueSorted(right);
  return normalizedLeft.length !== normalizedRight.length || normalizedLeft.some((value, index) => value !== normalizedRight[index]);
}

function resolveRoleId(role: Partial<Role> | RoleDefinition | Partial<Membership>, documentId?: string): string | undefined {
  return normalize((role as Partial<Role>).roleId) || normalize(documentId);
}

function resolvePermissionCode(permission: Partial<Permission> | PermissionDefinition, documentId?: string): string | undefined {
  return normalize((permission as Partial<Permission>).code) || normalize(documentId);
}

function rolePermissions(role?: Partial<Role>, staticRole?: RoleDefinition): string[] {
  if (Array.isArray(role?.permissions)) return role.permissions.filter((permission): permission is string => typeof permission === "string");
  return staticRole?.getPermissions() || [];
}

function permissionValuesDiffer(staticPermission: PermissionDefinition, runtimePermission: Partial<Permission>): boolean {
  return (
    staticPermission.label !== runtimePermission.label ||
    staticPermission.description !== runtimePermission.description ||
    staticPermission.module !== runtimePermission.module ||
    staticPermission.action !== runtimePermission.action ||
    staticPermission.scope !== runtimePermission.scope
  );
}

function comparisonState(params: {
  hasStatic: boolean;
  hasRuntime: boolean;
  isInactive?: boolean;
  isDrifted?: boolean;
}): SuperAdminCatalogComparisonState {
  if (params.hasRuntime && params.isInactive) return "inactive";
  if (params.hasStatic && !params.hasRuntime) return "missing-runtime";
  if (!params.hasStatic && params.hasRuntime) return "runtime-only";
  if (params.hasStatic && params.hasRuntime && params.isDrifted) return "drifted";
  return "synchronized";
}

function createEmptyUsage(): SuperAdminCatalogUsageCount {
  return { active: 0, inactive: 0, total: 0 };
}

function incrementUsage(map: Map<string, SuperAdminCatalogUsageCount>, key: string, status?: string) {
  const current = map.get(key) || createEmptyUsage();
  current.total += 1;
  if (status === "active") current.active += 1;
  else current.inactive += 1;
  map.set(key, current);
}

function formatTimestampLabel(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toLocaleDateString("fr-FR");
  if (typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toLocaleDateString("fr-FR");
  }
  return undefined;
}

function buildSummary<T extends { comparisonState: SuperAdminCatalogComparisonState }>(items: T[]): SuperAdminCatalogSummary {
  return {
    total: items.length,
    synchronized: items.filter((item) => item.comparisonState === "synchronized").length,
    missingRuntime: items.filter((item) => item.comparisonState === "missing-runtime").length,
    runtimeOnly: items.filter((item) => item.comparisonState === "runtime-only").length,
    drifted: items.filter((item) => item.comparisonState === "drifted").length,
    inactive: items.filter((item) => item.comparisonState === "inactive").length,
  };
}

export function buildSuperAdminCatalogReport(input: CatalogInput): SuperAdminCatalogReport {
  const staticRoles = input.staticRoles || MVP_ROLES;
  const staticPermissions = input.staticPermissions || MVP_PERMISSIONS;

  const runtimeRolesById = new Map<string, WithDocumentId<Role>>();
  const staticRolesById = new Map<string, RoleDefinition>();
  const runtimePermissionsByCode = new Map<string, WithDocumentId<Permission>>();
  const staticPermissionsByCode = new Map<string, PermissionDefinition>();
  const roleMembershipUsage = new Map<string, SuperAdminCatalogUsageCount>();
  const permissionMembershipUsage = new Map<string, SuperAdminCatalogUsageCount>();
  const rolePermissionUsage = new Map<string, Set<string>>();

  input.roles.forEach((role) => {
    const roleId = resolveRoleId(role, role.id);
    if (roleId) runtimeRolesById.set(roleId, role);
  });

  staticRoles.forEach((role) => {
    staticRolesById.set(role.roleId, role);
  });

  input.permissions.forEach((permission) => {
    const code = resolvePermissionCode(permission, permission.id);
    if (code) runtimePermissionsByCode.set(code, permission);
  });

  staticPermissions.forEach((permission) => {
    staticPermissionsByCode.set(permission.code, permission);
  });

  input.memberships.forEach((membership) => {
    const roleId = resolveRoleId(membership);
    if (roleId) incrementUsage(roleMembershipUsage, roleId, membership.status);

    uniqueSorted(Array.isArray(membership.permissions) ? membership.permissions : []).forEach((permissionCode) => {
      incrementUsage(permissionMembershipUsage, permissionCode, membership.status);
    });
  });

  const allRoleIds = uniqueSorted([...staticRolesById.keys(), ...runtimeRolesById.keys()]);
  const roleItems: SuperAdminRoleCatalogItem[] = allRoleIds.map((roleId) => {
    const runtimeRole = runtimeRolesById.get(roleId);
    const staticRole = staticRolesById.get(roleId);
    const permissions = rolePermissions(runtimeRole, staticRole);
    const runtimePermissions = rolePermissions(runtimeRole);
    const staticPermissionsForRole = staticRole?.getPermissions() || [];
    const isDrifted = !!runtimeRole && !!staticRole && (
      runtimeRole.label !== staticRole.label ||
      runtimeRole.description !== staticRole.description ||
      runtimeRole.scope !== staticRole.scope ||
      arraysDiffer(runtimePermissions, staticPermissionsForRole)
    );
    const usage = roleMembershipUsage.get(roleId) || createEmptyUsage();

    permissions.forEach((permissionCode) => {
      const roles = rolePermissionUsage.get(permissionCode) || new Set<string>();
      roles.add(roleId);
      rolePermissionUsage.set(permissionCode, roles);
    });

    return {
      roleId,
      name: runtimeRole?.name || staticRole?.name,
      label: runtimeRole?.label || staticRole?.label || roleId,
      description: runtimeRole?.description || staticRole?.description,
      scope: runtimeRole?.scope || staticRole?.scope,
      runtimeStatus: runtimeRole?.status,
      comparisonState: comparisonState({
        hasStatic: !!staticRole,
        hasRuntime: !!runtimeRole,
        isInactive: runtimeRole?.status === "inactive",
        isDrifted,
      }),
      permissionCount: uniqueSorted(permissions).length,
      activeMemberships: usage.active,
      inactiveMemberships: usage.inactive,
      totalMemberships: usage.total,
      updatedAtLabel: formatTimestampLabel(runtimeRole?.updatedAt),
      source: runtimeRole && staticRole ? "static-runtime" : runtimeRole ? "runtime" : "static",
    };
  });

  const allPermissionCodes = uniqueSorted([...staticPermissionsByCode.keys(), ...runtimePermissionsByCode.keys()]);
  const permissionItems: SuperAdminPermissionCatalogItem[] = allPermissionCodes.map((code) => {
    const runtimePermission = runtimePermissionsByCode.get(code);
    const staticPermission = staticPermissionsByCode.get(code);
    const isDrifted = !!runtimePermission && !!staticPermission && permissionValuesDiffer(staticPermission, runtimePermission);
    const membershipUsage = permissionMembershipUsage.get(code) || createEmptyUsage();
    const rolesUsingPermission = rolePermissionUsage.get(code)?.size || 0;

    return {
      code,
      label: runtimePermission?.label || staticPermission?.label || code,
      description: runtimePermission?.description || staticPermission?.description,
      module: runtimePermission?.module || staticPermission?.module,
      action: runtimePermission?.action || staticPermission?.action,
      scope: runtimePermission?.scope || staticPermission?.scope,
      runtimeStatus: runtimePermission?.status,
      comparisonState: comparisonState({
        hasStatic: !!staticPermission,
        hasRuntime: !!runtimePermission,
        isInactive: runtimePermission?.status === "inactive",
        isDrifted,
      }),
      isSensitive: isSensitivePermission(code),
      roleUsageCount: rolesUsingPermission,
      activeMembershipUsageCount: membershipUsage.active,
      inactiveMembershipUsageCount: membershipUsage.inactive,
      totalMembershipUsageCount: membershipUsage.total,
      source: runtimePermission && staticPermission ? "static-runtime" : runtimePermission ? "runtime" : "static",
    };
  });

  const roleSummaryBase = buildSummary(roleItems);
  const permissionSummaryBase = buildSummary(permissionItems);
  const roleSummary: SuperAdminRoleCatalogSummary = {
    ...roleSummaryBase,
    activeMembershipAssignments: roleItems.reduce((total, item) => total + item.activeMemberships, 0),
  };
  const permissionSummary: SuperAdminPermissionCatalogSummary = {
    ...permissionSummaryBase,
    sensitive: permissionItems.filter((item) => item.isSensitive).length,
    unused: permissionItems.filter((item) => item.roleUsageCount === 0 && item.totalMembershipUsageCount === 0).length,
  };

  return {
    roles: roleItems.sort((left, right) => left.label.localeCompare(right.label)),
    permissions: permissionItems.sort((left, right) => left.code.localeCompare(right.code)),
    roleSummary,
    permissionSummary,
    modules: uniqueSorted(permissionItems.map((item) => item.module || "")),
    isEmptyRuntimeCatalog: input.roles.length === 0 && input.permissions.length === 0,
  };
}

export function subscribeSuperAdminCatalogReport(
  onUpdate: (report: SuperAdminCatalogReport) => void,
  onError: (error: Error) => void
): Unsubscribe {
  if (!db) {
    onError(new Error("Firestore n'est pas initialisé."));
    return () => {};
  }

  const latest: Partial<Pick<CatalogInput, "roles" | "permissions" | "memberships">> = {};
  const loadedCollections = new Set<string>();
  const unsubscribers: Unsubscribe[] = [];

  const cleanup = () => {
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      unsubscribe?.();
    }
  };

  const emitIfReady = () => {
    if (loadedCollections.size !== 3) return;
    onUpdate(
      buildSuperAdminCatalogReport({
        roles: latest.roles || [],
        permissions: latest.permissions || [],
        memberships: latest.memberships || [],
      })
    );
  };

  const handleError = (error: unknown) => {
    console.error("[SuperAdminCatalog] Realtime catalog failed", error);
    cleanup();
    onError(new Error("Impossible de synchroniser les catalogues rôles et permissions."));
  };

  unsubscribers.push(
    onSnapshot(collection(db, "roles"), (snapshot) => {
      latest.roles = snapshotToData<Role>(snapshot);
      loadedCollections.add("roles");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "permissions"), (snapshot) => {
      latest.permissions = snapshotToData<Permission>(snapshot);
      loadedCollections.add("permissions");
      emitIfReady();
    }, handleError),
    onSnapshot(collection(db, "memberships"), (snapshot) => {
      latest.memberships = snapshotToData<Membership>(snapshot);
      loadedCollections.add("memberships");
      emitIfReady();
    }, handleError)
  );

  return cleanup;
}

