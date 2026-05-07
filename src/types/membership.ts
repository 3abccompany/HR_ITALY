
import { FieldValue } from "firebase/firestore";

export type MembershipStatus = "active" | "inactive" | "archived";

export interface Membership {
  id?: string; // standard firestore document id alias
  membershipId: string; // format: {uid}_{entityId}
  uid: string;
  userId: string; // alias for uid
  userDisplayName: string;
  userEmail: string;
  entityId: string;
  entityName: string;
  roleId: string;
  roleLabel: string;
  permissions: string[];
  status: MembershipStatus;
  notes?: string;
  
  // Metadata
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}
