import { FieldValue } from "firebase/firestore";

export type EmploymentRequestStatus = 
  | "draft" 
  | "to_send" 
  | "sent_to_consultant" 
  | "waiting_for_communication" 
  | "communication_done" 
  | "completed" 
  | "cancelled";

export type EmploymentRequestType = "unilav" | "cpi" | "consultant_request" | "other";

export interface EmploymentRequest {
  id: string;
  entityId: string;
  
  // Relational links
  personId?: string;
  candidateId?: string;
  offerId?: string;
  employeeId?: string | null;
  contractId?: string | null;
  mandatoryCommunicationId?: string | null;

  // Metadata
  source: "offer" | "manual";
  type: EmploymentRequestType;
  status: EmploymentRequestStatus;
  
  // Business fields
  plannedHireDate?: string; // YYYY-MM-DD
  worksiteId?: string;
  jobRoleId?: string;

  // Consultant fields
  consultantId?: string;
  consultantName?: string;
  consultantEmail?: string;
  requestDate?: string;
  sendMode?: "email" | "portal" | "manual";
  sentAt?: Date | FieldValue;
  sentBy?: string;

  // Response fields
  cpiCommunicationDate?: string;
  protocolCode?: string;
  receiptDocumentId?: string;
  legacyReceiptPdfUrl?: string;

  // Notes & Audit
  notes?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
