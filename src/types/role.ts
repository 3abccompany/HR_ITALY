
import { FieldValue } from "firebase/firestore";

export type RoleScope = "platform" | "entity";
export type RoleStatus = "active" | "inactive";
export type RoleKind = "system" | "custom";

export interface Role {
  roleId: string;
  name: string;
  label: string;
  description: string;
  scope: RoleScope;
  kind?: RoleKind;
  isSystem?: boolean;
  isLocked?: boolean;
  entityId?: string | null;
  sourceRoleId?: string;
  version?: number;
  permissions: string[];
  status: RoleStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
