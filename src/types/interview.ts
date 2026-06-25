import { FieldValue } from "firebase/firestore";

export type InterviewStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show"
  | "inactive"
  | "archived";

export type InterviewDecision =
  | "pending"
  | "accepted"
  | "rejected"
  | "on_hold"
  | "stand_by";

export type InterviewType =
  | "phone"
  | "video"
  | "onsite"
  | "technical"
  | "hr"
  | "final";

export type ConfirmationStatus = "pending" | "confirmed" | "expired" | "declined";

export type EmailNotificationStatus = "not_requested" | "queued" | "sent" | "failed";

export interface Interview {
  interviewId: string;
  entityId: string;
  personId: string;
  candidateId: string;
  candidateDisplayName: string;
  positionApplied: string;
  scheduledAt: string; // ISO format
  interviewType: InterviewType;
  interviewerName: string;
  interviewerUid: string;
  location: string;
  status: InterviewStatus;
  decision: InterviewDecision;
  score?: number;
  feedback?: string;
  notes?: string;
  hiredEmployeeId: string | null;
  previousStatus?: InterviewStatus;

  // Confirmation Tracking (Candidate intent)
  confirmationStatus?: ConfirmationStatus;
  confirmationTokenHash?: string;
  confirmationExpiresAt?: Date | FieldValue | any;
  confirmedAt?: Date | FieldValue | any;
  declinedAt?: Date | FieldValue | any;
  confirmationViewedAt?: Date | FieldValue | any;

  // Email Notification Tracking
  emailNotificationEnabled: boolean;
  emailTo: string;
  emailSubjectSnapshot?: string;
  emailMessageSnapshot?: string;
  emailStatus: EmailNotificationStatus;
  emailSentAt?: Date | FieldValue;
  emailError?: string;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}
