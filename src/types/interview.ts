import { FieldValue } from "firebase/firestore";

export type InterviewDecision =
  | "pending"
  | "accepted"
  | "rejected"
  | "second_interview_required"
  | "cancelled";

export type InterviewType =
  | "phone_screening"
  | "first_interview"
  | "technical_interview"
  | "final_interview"
  | "other";

export interface Interview {
  interviewId: string;
  personId: string;
  candidateId: string;
  entityId: string;
  interviewDate: string;
  interviewerUserId: string;
  interviewType: InterviewType;
  score?: number;
  decision: InterviewDecision;
  hiredEmployeeId?: string;
  notes?: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}