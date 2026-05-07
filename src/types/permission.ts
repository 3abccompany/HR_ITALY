
import { FieldValue } from "firebase/firestore";

export type PermissionScope = "platform" | "entity";
export type PermissionStatus = "active" | "inactive";

export interface Permission {
  code: string;
  module: string;
  action: string;
  label: string;
  description: string;
  scope: PermissionScope;
  status: PermissionStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
