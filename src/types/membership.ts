import { FieldValue } from "firebase/firestore";

export type MembershipStatus = "active" | "inactive" | "archived";

export interface Membership {
  id: string; // format: {uid}_{entityId}
  uid: string;
  entityId: string;
  roleId: string;
  status: MembershipStatus;
  permissions: string[];
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}