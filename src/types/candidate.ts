import { FieldValue } from "firebase/firestore";

export type CandidateStatus =
  | "new"
  | "under_review"
  | "shortlisted"
  | "interview_to_schedule"
  | "interview_scheduled"
  | "interview_completed"
  | "accepted"
  | "rejected"
  | "hired"
  | "archived"
  | "inactive";

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new: "Nouveau",
  under_review: "En revue",
  shortlisted: "Présélectionné",
  interview_to_schedule: "Entretien à planifier",
  interview_scheduled: "Entretien planifié",
  interview_completed: "Entretien réalisé",
  accepted: "Accepté",
  rejected: "Rejeté",
  hired: "Embauché",
  archived: "Archivé",
  inactive: "Inactif",
};

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
  
  // Decision Workflow Fields
  reviewNotes?: string;
  rejectionReason?: string;
  statusUpdatedAt?: Date | FieldValue;
  statusUpdatedBy?: string;
  reviewedAt?: Date | FieldValue;
  reviewedBy?: string;
  shortlistedAt?: Date | FieldValue;
  shortlistedBy?: string;
  rejectedAt?: Date | FieldValue;
  rejectedBy?: string;
  acceptedAt?: Date | FieldValue;
  acceptedBy?: string;

  // Interview Tracking
  latestInterviewId?: string;
  interviewIds?: string[];

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
