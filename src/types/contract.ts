import { FieldValue } from "firebase/firestore";

export type ContractStatus = "draft" | "pending_signature" | "active" | "suspended" | "terminated" | "archived";

export interface Contract {
  contractId: string;
  entityId: string;
  personId: string;
  employeeId: string;
  sourceOfferId?: string;

  // --- Identity Snapshots (Denormalized) ---
  employeeDisplayName?: string;
  employeeCode?: string;

  // --- Legal Employer Snapshot ---
  entityName?: string;
  entityLegalName?: string;
  entityVatNumber?: string;
  companyAddressSnapshot?: string;
  legalRepresentativeName?: string;
  legalRepresentativeTitle?: string;

  // --- Legal Employee Snapshot ---
  taxCode?: string;
  employeeAddressSnapshot?: string;
  dateOfBirth?: string;
  placeOfBirth?: string;

  // --- Job & Workplace ---
  jobTitleName?: string;
  departmentName?: string;
  worksiteName?: string;
  missionsSnapshot?: string[];

  // --- Contractual Parameters ---
  contractType: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  trialPeriodDays?: number;
  trialPeriodUnit?: string; // "days" | "months"
  weeklyHours: number;
  workingScheduleNotes?: string;
  isPartTime?: boolean;
  
  // --- Classification & Remuneration ---
  ccnlName?: string;
  levelCode?: string;
  levelLabel?: string;
  qualificationCategory?: string; // e.g. Impiegato, Operaio
  grossMonthly: number;
  grossAnnual: number;
  monthlyPayments?: number;
  overtimeNote?: string;

  // --- Compliance ---
  uniLavProtocolNumber?: string;
  uniLavSubmissionDate?: string;
  uniLavReceiptUrl?: string;

  // --- Generated Unsigned PDF Metadata ---
  generatedPdfUrl?: string;
  generatedPdfStoragePath?: string;
  generatedPdfFileName?: string;
  generatedPdfVersion?: number;
  generatedPdfAt?: Date | FieldValue;
  generatedPdfBy?: string;
  generatedPdfStatus?: "generated";

  // --- Signed Document Reference ---
  signedDocumentId?: string | null;
  signedDocumentTitle?: string;
  signedDocumentUrl?: string;
  signedDocumentFileName?: string | null;
  signedDocumentStoragePath?: string | null;
  signedDocumentMimeType?: string | null;
  signedDocumentUploadedAt?: Date | FieldValue;
  signedDocumentUploadedBy?: string;

  // --- Lifecycle & Audit ---
  status: ContractStatus;
  notes?: string;

  sentForSignatureAt?: Date | FieldValue;
  signedAt?: Date | FieldValue;
  activatedAt?: Date | FieldValue;
  terminatedAt?: Date | FieldValue;
  archivedAt?: Date | FieldValue;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
