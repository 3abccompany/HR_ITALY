
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
  | "on_hold";

export type InterviewType =
  | "phone"
  | "video"
  | "onsite"
  | "technical"
  | "hr"
  | "final";

export interface Interview {
  interviewId: string;
  entityId: string;
  personId: string;
  candidateId: string;
  candidateDisplayName: string;
  positionApplied: string;
  scheduledAt: string; // ISO format for easy sorting and DatePicker use
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
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}
