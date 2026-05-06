import { FieldValue } from "firebase/firestore";

export type CandidateStatus =
  | "new"
  | "screening"
  | "interview_scheduled"
  | "interview_done"
  | "accepted"
  | "rejected"
  | "hired"
  | "archived";

export interface Candidate {
  candidateId: string;
  personId: string;
  entityId: string;
  positionApplied: string;
  source: string;
  applicationDate: string;
  status: CandidateStatus;
  latestInterviewId?: string;
  interviewIds: string[];
  employeeId?: string;
  notes?: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}