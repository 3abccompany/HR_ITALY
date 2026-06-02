export type DocumentChecklistStatus =
  | "requested"
  | "uploaded"
  | "approved"
  | "rejected"
  | "not_applicable"
  | "expired";

export type PreHireDossierStatus =
  | "not_started"
  | "docs_requested"
  | "partially_received"
  | "under_review"
  | "rejected_documents"
  | "ready_for_employee_creation"
  | "employee_created"
  | "contract_generated"
  | "contract_signed"
  | "completed"
  | "cancelled";

export type MandatoryCommunicationType = "UNILAV_ASSUNZIONE";

export type MandatoryCommunicationStatus =
  | "draft"
  | "sent_to_consultant"
  | "missing_data"
  | "submitted"
  | "receipt_received"
  | "cancelled";

export type ConsultantEmailMode = "draft_only" | "test" | "production";

export type PreHireDocumentKey =
  | "identity_document"
  | "tax_code_health_card"
  | "residence_permit"
  | "iban"
  | "residence_address"
  | "contact_confirmed"
  | "driving_license"
  | "safety_training"
  | "medical_fitness"
  | "professional_qualification";

export type PreHireDocumentChecklistItem = {
  key: PreHireDocumentKey;
  label: string;
  description?: string;
  required: boolean;
  conditional?: boolean;
  conditionNote?: string;
  status: DocumentChecklistStatus;
  rejectionReason?: string;
  documentId?: string | null;
  uploadedAt?: any;
  approvedAt?: any;
  approvedBy?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
};

export type PreHireDossier = {
  id?: string;
  entityId: string;

  employmentOfferId: string;
  candidateId?: string | null;
  personId?: string | null;
  employeeId?: string | null;
  contractId?: string | null;

  status: PreHireDossierStatus;

  candidateDisplayName?: string | null;
  candidateEmail?: string | null;
  jobTitleName?: string | null;
  departmentName?: string | null;
  worksiteName?: string | null;
  proposedStartDate?: string | null;

  checklist: PreHireDocumentChecklistItem[];

  requiredDocumentsCount: number;
  approvedRequiredDocumentsCount: number;
  readyForConversion: boolean;

  createdAt?: any;
  createdBy?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
};

export type MandatoryCommunication = {
  id?: string;
  entityId: string;

  employmentOfferId: string;
  preHireDossierId?: string | null;
  candidateId?: string | null;
  personId?: string | null;
  employeeId?: string | null;
  contractId?: string | null;

  type: MandatoryCommunicationType;
  status: MandatoryCommunicationStatus;

  consultantEmail: string;
  consultantName: string;
  emailMode: ConsultantEmailMode;

  emailPrepared: boolean;
  emailSent: boolean;
  sentToConsultantAt?: any | null;

  protocolNumber: string;
  receiptPdfUrl: string;
  submittedAt?: any | null;

  missingFields: string[];
  notes: string;

  createdAt?: any;
  createdBy?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
};

export type HrNotificationSettings = {
  notifyOnOfferAccepted: boolean;
  offerAcceptedRecipients: string[];
  ccRecipients: string[];
  bccRecipients?: string[];
};

export type ItalyComplianceSettings = {
  mandatoryCommunicationEnabled: boolean;
  consultantEmail: string;
  consultantName: string;
  sendConsultantEmailAutomatically: boolean;
  mode: ConsultantEmailMode;
};