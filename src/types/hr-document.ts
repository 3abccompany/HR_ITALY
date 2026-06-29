import { FieldValue } from "firebase/firestore";

export type HRDocumentStatus = "valid" | "expiring_soon" | "expired" | "replaced" | "archived" | "rejected" | "missing";

export type HRDocumentType = 
  | "identity_document"
  | "fiscal_code"
  | "health_card"
  | "hiring_request"
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
  | "dpi_delivery_report"
  | "disciplinary_document"
  | "absence_justification"
  | "work_accident_justification"
  | "other";

export type RelatedModule = 
  | "candidates"
  | "applications"
  | "preHireDossiers"
  | "employees"
  | "contracts"
  | "mandatoryCommunications"
  | "employmentRequests"
  | "payroll"
  | "termination"
  | "timeOffRequests"
  | "medicalVisits"
  | "trainings"
  | "safety"
  | "general";

export interface HRDocument {
  id: string;
  entityId: string;
  title: string;
  description?: string | null;
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
  preHireDossierId?: string | null;
  relatedModule?: RelatedModule | null;
  relatedId?: string | null;
  relatedLabel?: string | null;

  // Lifecycle
  issuedAt?: string | null; // YYYY-MM-DD
  expiresAt?: string | null; // YYYY-MM-DD
  isSensitive: boolean;
  isRequired: boolean;
  tags?: string[];
  
  // Versioning
  version: number;
  replacesId?: string | null;
  replacedById?: string | null;
  rootDocumentId?: string | null;
  replacementReason?: string | null;
  replacedAt?: Date | FieldValue | null;
  replacedBy?: string | null;

  // Phase 2 Integration Fields
  sourceKey?: string | null; // For idempotency (e.g. contract:{id}:signed)
  source?: string | null; // Origin identifier
  externalUrl?: string | null; // Link for external docs
  externalReference?: string | null; // External ID or code
  generatedAt?: Date | FieldValue | null;
  generatedBy?: string | null;

  // Contract Mirror Fields
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  contractType?: string | null;

  // Audit
  uploadedAt: Date | FieldValue;
  uploadedBy: string;
  uploadedByDisplayName?: string | null;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export const DOCUMENT_TYPE_LABELS: Record<HRDocumentType, string> = {
  identity_document: "Carte d’identité",
  fiscal_code: "Code fiscal",
  health_card: "Tessera sanitaria",
  hiring_request: "Richiesta assunzione",
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
  dpi_delivery_report: "PV de remise EPI/DPI",
  disciplinary_document: "Document disciplinaire",
  absence_justification: "Justificatif d'absence",
  work_accident_justification: "Justificatif accident du travail",
  other: "Autre"
};

export const STATUS_LABELS: Record<HRDocumentStatus, string> = {
  valid: "Valide",
  expiring_soon: "Échéance proche",
  expired: "Expiré",
  replaced: "Remplacé",
  archived: "Archivé",
  rejected: "Rejeté",
  missing: "Manquant"
};
