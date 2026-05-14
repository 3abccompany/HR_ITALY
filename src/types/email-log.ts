
import { FieldValue } from "firebase/firestore";

export type EmailLogStatus = "queued" | "sent" | "failed";

export interface EmailLog {
  logId: string;
  entityId: string;
  candidateId: string;
  personId: string;
  interviewId: string;
  to: string;
  subject: string;
  body: string;
  status: EmailLogStatus;
  providerMessageId?: string;
  errorMessage?: string;
  sentAt?: Date | FieldValue;
  createdAt: Date | FieldValue;
  createdBy: string;
}
