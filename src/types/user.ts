import { FieldValue } from "firebase/firestore";

export type PlatformRole = "superAdmin" | "user";
export type UserStatus = "active" | "inactive" | "archived";

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  platformRole: PlatformRole;
  status: UserStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}