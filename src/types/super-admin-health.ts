export type SuperAdminHealthSeverity = "critical" | "warning" | "information";

export type SuperAdminHealthCategory = "membership" | "permission" | "role" | "catalog";

export interface SuperAdminHealthDiagnostic {
  id: string;
  code: string;
  category: SuperAdminHealthCategory;
  severity: SuperAdminHealthSeverity;
  title: string;
  explanation: string;
  userId?: string;
  userDisplayName?: string;
  userEmail?: string;
  entityId?: string;
  entityName?: string;
  membershipId?: string;
  roleId?: string;
  roleLabel?: string;
  permissionCode?: string;
  status?: string;
}

export interface SuperAdminHealthSeverityCounts {
  critical: number;
  warning: number;
  information: number;
}

export interface SuperAdminHealthCategoryCounts {
  membership: number;
  permission: number;
  role: number;
  catalog: number;
}

export interface SuperAdminHealthSummary {
  total: number;
  severity: SuperAdminHealthSeverityCounts;
  category: SuperAdminHealthCategoryCounts;
  unknownPermissions: number;
  staleRoleSnapshots: number;
  sensitiveAssignments: number;
  isHealthy: boolean;
}

export interface SuperAdminHealthReport {
  diagnostics: SuperAdminHealthDiagnostic[];
  summary: SuperAdminHealthSummary;
  isEmptyPlatform: boolean;
}
