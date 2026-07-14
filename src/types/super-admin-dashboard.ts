import type { SuperAdminHealthSummary } from "./super-admin-health";

export interface SuperAdminStatusSummary {
  total: number;
  active: number;
  inactive: number;
}

export interface SuperAdminAccessHealthSummary {
  usersWithoutMembership: number;
  brokenMemberships: number;
}

export interface SuperAdminCatalogSummary {
  roles: number;
  permissions: number;
}

export interface SuperAdminDashboardSummary {
  entities: SuperAdminStatusSummary;
  users: SuperAdminStatusSummary;
  memberships: SuperAdminStatusSummary;
  accessHealth: SuperAdminAccessHealthSummary;
  health: SuperAdminHealthSummary;
  catalog: SuperAdminCatalogSummary;
  isEmptyPlatform: boolean;
}
