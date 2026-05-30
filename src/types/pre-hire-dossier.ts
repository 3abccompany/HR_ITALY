import { FieldValue } from "firebase/firestore";

export type PreHireDossierStatus = 
  | "documents_required" 
  | "document_request_sent" 
  | "documents_under_review" 
  | "documents_rejected" 
  | "documents_validated" 
  | "ready_for_conversion" 
  | "converted_to_employee" 
  | "cancelled";

export type PreHireDocumentStatus = 
  | "missing" 
  | "uploaded" 
  | "approved" 
  | "rejected" 
  | "not_required";

export interface PreHireDocument {
  itemId: string;
  type: string;
  label: string;
  status: PreHireDocumentStatus;
  isRequired: boolean;
  fileId?: string;
  rejectionReason?: string;
  reviewedAt?: Date | FieldValue;
  reviewedBy?: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}

export interface PreHireDossier {
  dossierId: string;
  entityId: string;
  entityName?: string;
  personId: string;
  candidateId: string;
  employmentOfferId: string;
  recruitmentNeedId?: string;
  
  status: PreHireDossierStatus;
  readyForConversion: boolean;
  
  documentRequestSentAt?: Date | FieldValue;
  documentRequestSentBy?: string;
  documentsValidatedAt?: Date | FieldValue;
  documentsValidatedBy?: string;
  
  employeeId?: string;
  contractId?: string;
  convertedAt?: Date | FieldValue;
  convertedBy?: string;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
