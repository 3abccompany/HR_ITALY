import { FieldValue } from "firebase/firestore";

export type EmploymentRequestStatus = 
  | "draft" 
  | "to_send" 
  | "sent_to_consultant" 
  | "waiting_for_communication" 
  | "communication_done" 
  | "completed" 
  | "cancelled";

export type EmploymentRequestType = 
  | "unilav" 
  | "unilav_proroga" 
  | "unilav_trasformazione" 
  | "unilav_cessazione" 
  | "cpi" 
  | "consultant_request" 
  | "other";

export interface EmploymentRequest {
  id: string;
  entityId: string;
  
  // Relational links
  personId?: string;
  candidateId?: string;
  candidateDisplayName?: string | null;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  offerId?: string;
  employeeId?: string | null;
  contractId?: string | null;
  previousContractId?: string | null;
  mandatoryCommunicationId?: string | null;

  // Metadata
  source: "offer" | "manual" | "contract_renewal";
  type: EmploymentRequestType;
  status: EmploymentRequestStatus;
  
  // Business fields
  plannedHireDate?: string; // YYYY-MM-DD
  worksiteId?: string;
  jobRoleId?: string;
  contractType?: string | null;

  // Consultant fields
  consultantId?: string | null;
  consultantName?: string | null;
  consultantEmail?: string | null;
  requestDate?: string | null;
  sendMode?: "email" | "portal" | "manual" | "draft_only" | null;
  sentAt?: Date | FieldValue | null;
  sentBy?: string | null;
  emailMessageId?: string | null;

  // Response fields
  cpiCommunicationDate?: string | null;
  protocolCode?: string | null;
  receiptDocumentId?: string | null;
  legacyReceiptPdfUrl?: string | null;

  // Completion Audit
  completedAt?: Date | FieldValue | null;
  completedBy?: string | null;

  // Notes & Audit
  notes?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string | null;
}
