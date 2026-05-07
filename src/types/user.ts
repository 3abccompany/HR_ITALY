import { FieldValue } from "firebase/firestore";

export type PlatformRole = "superAdmin" | "user";
export type UserStatus = "active" | "inactive" | "archived";

export interface AppUser {
  uid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  platformRole: PlatformRole;
  status: UserStatus;
  lastLoginAt?: Date | FieldValue;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  notes?: string;
}
