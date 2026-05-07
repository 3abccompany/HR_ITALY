
import { FieldValue } from "firebase/firestore";

export type RoleScope = "platform" | "entity";
export type RoleStatus = "active" | "inactive";

export interface Role {
  roleId: string;
  name: string;
  label: string;
  description: string;
  scope: RoleScope;
  permissions: string[];
  status: RoleStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
