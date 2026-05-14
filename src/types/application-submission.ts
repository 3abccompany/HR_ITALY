
import { FieldValue } from "firebase/firestore";

export type SubmissionStatus = "submitted" | "converted_to_candidate" | "duplicate_blocked" | "rejected";

export interface ApplicationSubmission {
  submissionId: string;
  entityId: string;
  formId: string;
  publicSlug: string;
  recruitmentNeedId: string;
  jobProfileId: string;
  departmentId: string;
  departmentName: string;
  jobTitleId: string;
  jobTitleName: string;
  worksiteId: string | null;
  worksiteName: string;

  // Identity
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  nationalId?: string; // Optional (legacy/manual)
  normalizedNationalId?: string; // Optional (legacy/manual)

  // Data
  answers: Record<string, any>;
  customAnswers: Record<string, any>;
  consentAccepted: boolean;
  consentAcceptedAt: Date | FieldValue;

  // Processing
  dedupeKey: string;
  possibleDuplicate: boolean;
  duplicateReason?: string;
  personId: string;
  candidateId: string;
  status: SubmissionStatus;
  source: "public_application_form";

  // Audit
  submittedAt: Date | FieldValue;
  convertedAt: Date | FieldValue;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}

export interface ApplicationSubmissionDedupe {
  dedupeKey: string;
  entityId: string;
  recruitmentNeedId: string;
  normalizedEmail: string;
  applicationSubmissionId: string;
  personId: string;
  candidateId: string;
  createdAt: Date | FieldValue;
  source: "public_application_form";
}
