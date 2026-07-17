export type SuperAdminCatalogComparisonState =
  | "synchronized"
  | "missing-runtime"
  | "runtime-only"
  | "drifted"
  | "inactive";

export interface SuperAdminCatalogUsageCount {
  active: number;
  inactive: number;
  total: number;
}

export interface SuperAdminRoleCatalogItem {
  roleId: string;
  name?: string;
  label: string;
  description?: string;
  scope?: "platform" | "entity";
  runtimeStatus?: string;
  comparisonState: SuperAdminCatalogComparisonState;
  permissionCount: number;
  activeMemberships: number;
  inactiveMemberships: number;
  totalMemberships: number;
  updatedAtLabel?: string;
  source: "static" | "runtime" | "static-runtime";
}

export interface SuperAdminPermissionCatalogItem {
  code: string;
  label: string;
  description?: string;
  module?: string;
  action?: string;
  scope?: "platform" | "entity";
  runtimeStatus?: string;
  comparisonState: SuperAdminCatalogComparisonState;
  isSensitive: boolean;
  roleUsageCount: number;
  activeMembershipUsageCount: number;
  inactiveMembershipUsageCount: number;
  totalMembershipUsageCount: number;
  source: "static" | "runtime" | "static-runtime";
}

export interface SuperAdminCatalogSummary {
  total: number;
  synchronized: number;
  missingRuntime: number;
  runtimeOnly: number;
  drifted: number;
  inactive: number;
}

export interface SuperAdminRoleCatalogSummary extends SuperAdminCatalogSummary {
  activeMembershipAssignments: number;
}

export interface SuperAdminPermissionCatalogSummary extends SuperAdminCatalogSummary {
  sensitive: number;
  unused: number;
}

export interface SuperAdminCatalogReport {
  roles: SuperAdminRoleCatalogItem[];
  permissions: SuperAdminPermissionCatalogItem[];
  roleSummary: SuperAdminRoleCatalogSummary;
  permissionSummary: SuperAdminPermissionCatalogSummary;
  modules: string[];
  isEmptyRuntimeCatalog: boolean;
}
