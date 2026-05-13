import { FieldValue } from "firebase/firestore";

export type CandidateStatus =
  | "new"
  | "screening"
  | "interview"
  | "offered"
  | "hired"
  | "rejected"
  | "withdrawn"
  | "inactive"
  | "archived";

export interface Candidate {
  candidateId: string;
  entityId: string;
  personId: string;
  applicationSubmissionId?: string; // Link to the original form submission if source is public_application_form
  displayName: string;
  email: string;
  phone: string;
  source: string;
  positionApplied: string;
  department: string;
  applicationDate: string;
  availabilityDate: string;
  expectedSalary: string;
  status: CandidateStatus;
  previousStatus?: CandidateStatus;
  employeeId?: string;
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