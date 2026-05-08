import { FieldValue } from "firebase/firestore";

export type PersonLifecycleStatus =
  | "person"
  | "candidate"
  | "employee"
  | "former_employee"
  | "archived";

export type PersonStatus = "active" | "inactive" | "archived";

export interface Person {
  id?: string; // Firestore document ID alias
  personId: string;
  entityId: string;
  
  // Identity
  firstName: string;
  lastName: string;
  displayName: string;
  codiceFiscale: string; // Italian tax code
  dateOfBirth?: string;
  placeOfBirth?: string;
  gender?: "M" | "F" | "other";
  nationality?: string;

  // Contact
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;

  // Lifecycle
  currentLifecycleStatus: PersonLifecycleStatus;
  currentCandidateId?: string;
  currentEmployeeId?: string;

  // Status & Metadata
  status: PersonStatus;
  notes?: string;
  
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}
