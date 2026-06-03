import { FieldValue } from "firebase/firestore";

export type HRDocumentStatus = "valid" | "expired" | "replaced" | "archived" | "rejected";

export type HRDocumentType = 
  | "identity_document"
  | "fiscal_code"
  | "residence_permit"
  | "work_permit"
  | "cv"
  | "application_attachment"
  | "prehire_required_document"
  | "unilav_receipt"
  | "cpi_receipt"
  | "generated_contract_pdf"
  | "signed_contract"
  | "termination_document"
  | "payroll_document"
  | "medical_certificate"
  | "training_certificate"
  | "disciplinary_document"
  | "other";

export type RelatedModule = 
  | "candidates"
  | "applications"
  | "preHireDossiers"
  | "employees"
  | "contracts"
  | "mandatoryCommunications"
  | "payroll"
  | "termination"
  | "general";

export interface HRDocument {
  id: string;
  entityId: string;
  title: string;
  description?: string;
  documentType: HRDocumentType;
  status: HRDocumentStatus;
  
  // Storage
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  
  // Relational (Snapshots for display)
  employeeId?: string | null;
  employeeDisplayName?: string | null;
  personId?: string | null;
  candidateId?: string | null;
  candidateDisplayName?: string | null;
  contractId?: string | null;
  relatedModule?: RelatedModule | null;
  relatedId?: string | null;
  relatedLabel?: string | null;

  // Lifecycle
  issuedAt?: string | null; // YYYY-MM-DD
  expiresAt?: string | null; // YYYY-MM-DD
  isSensitive: boolean;
  isRequired: boolean;
  tags?: string[];
  version: number;

  // Phase 2 Integration Fields
  sourceKey?: string | null; // For idempotency (e.g. contract:{id}:signed)
  source?: string | null; // Origin identifier
  externalUrl?: string | null; // Link for external docs
  externalReference?: string | null; // External ID or code
  generatedAt?: Date | FieldValue | null;
  generatedBy?: string | null;

  // Audit
  uploadedAt: Date | FieldValue;
  uploadedBy: string;
  uploadedByDisplayName?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export const DOCUMENT_TYPE_LABELS: Record<HRDocumentType, string> = {
  identity_document: "Pièce d’identité",
  fiscal_code: "Code fiscal",
  residence_permit: "Permis de séjour",
  work_permit: "Permis de travail",
  cv: "CV",
  application_attachment: "Document de candidature",
  prehire_required_document: "Document pré-embauche",
  unilav_receipt: "Reçu UniLav",
  cpi_receipt: "Reçu CPI",
  generated_contract_pdf: "PDF contrat généré",
  signed_contract: "Contrat signé",
  termination_document: "Document de terminaison",
  payroll_document: "Document de paie",
  medical_certificate: "Certificat médical",
  training_certificate: "Formation / certificat",
  disciplinary_document: "Document disciplinaire",
  other: "Autre"
};

export const STATUS_LABELS: Record<HRDocumentStatus, string> = {
  valid: "Valide",
  expired: "Expiré",
  replaced: "Remplacé",
  archived: "Archivé",
  rejected: "Rejeté"
};
