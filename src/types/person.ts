import { FieldValue } from "firebase/firestore";

export type PersonLifecycleStatus =
  | "prospect"
  | "candidate"
  | "interviewing"
  | "accepted"
  | "employee"
  | "former_employee"
  | "archived";

export interface Person {
  personId: string;
  entityId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone?: string;
  taxCode?: string;
  birthDate?: string;
  currentLifecycleStatus: PersonLifecycleStatus;
  currentCandidateId?: string;
  currentEmployeeId?: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}