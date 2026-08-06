import type { FieldValue } from "firebase/firestore";

export type EmployeeFinancialRequestType =
  | "salary_advance"
  | "internal_loan"
  | "employee_debt";

export type EmployeeFinancialRequestOrigin =
  | "employee_self_service"
  | "hr_on_behalf";

export type EmployeeFinancialRequestStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "document_generated"
  | "awaiting_signature"
  | "signed"
  | "payment_pending"
  | "active"
  | "suspended"
  | "settled"
  | "cancelled"
  | "written_off";

export type EmployeeFinancialSignatureStatus =
  | "not_generated"
  | "awaiting_signature"
  | "uploaded"
  | "validated"
  | "rejected";

export type EmployeeRepaymentScheduleStatus =
  | "draft"
  | "pending_activation"
  | "active"
  | "suspended"
  | "settled"
  | "cancelled";

export type EmployeeRepaymentInstallmentStatus =
  | "scheduled"
  | "partially_paid"
  | "deducted"
  | "externally_paid"
  | "waived"
  | "overdue"
  | "cancelled";

export interface EmployeeFinancialRequestSnapshot {
  displayName: string;
  matricule: string;
}

export interface EmployeeFinancialActiveContractSummary {
  id: string;
  displayLabel: string;
  href: string | null;
}

export interface EmployeeFinancialRequest {
  id: string;
  entityId: string;
  personId: string | null;
  employeeId: string;
  employeeSnapshot: EmployeeFinancialRequestSnapshot;
  requestOrigin: EmployeeFinancialRequestOrigin;
  requestType: EmployeeFinancialRequestType;
  requestDate: Date | FieldValue | string;
  currency: string;

  requestedAmountCents: number;
  reason: string;
  requestedRepaymentMonths: number | null;
  requestedMonthlyAmountCents: number | null;
  requestedFirstInstallmentPeriod: string | null;

  status: EmployeeFinancialRequestStatus;
  submittedAt: Date | FieldValue | string | null;
  submittedBy: string | null;
  submittedByName: string | null;

  decisionBy: string | null;
  decisionByName: string | null;
  decisionAt: Date | FieldValue | string | null;
  decisionReason: string | null;
  approvedAmountCents: number | null;
  approvedRepaymentMonths: number | null;
  approvedMonthlyAmountCents: number | null;
  approvedFirstInstallmentPeriod: string | null;

  agreementDocumentId: string | null;
  agreementVersion: number | null;
  agreementGeneratedAt: Date | FieldValue | string | null;
  agreementGeneratedBy: string | null;
  signedAgreementDocumentId: string | null;
  signedAgreementUploadedAt: Date | FieldValue | string | null;
  signedAgreementUploadedBy: string | null;
  signatureStatus: EmployeeFinancialSignatureStatus;
  signatureValidatedAt: Date | FieldValue | string | null;
  signatureValidatedBy: string | null;
  signatureValidatedByName: string | null;
  signatureRejectionReason: string | null;

  disbursementDocumentId: string | null;
  repaymentScheduleId: string | null;

  activeContractId: string | null;
  activeContractWarning: boolean;

  createdAt: Date | FieldValue | string;
  createdBy: string;
  createdByName: string;
  updatedAt: Date | FieldValue | string;
  updatedBy: string;
  updatedByName: string;
  archivedAt: Date | FieldValue | string | null;
  archivedBy: string | null;
  version: number;
}

export interface EmployeeFinancialRequestDto
  extends Omit<EmployeeFinancialRequest, "requestDate" | "createdAt" | "updatedAt" | "submittedAt" | "decisionAt" | "agreementGeneratedAt" | "signedAgreementUploadedAt" | "signatureValidatedAt" | "archivedAt"> {
  requestDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  submittedAt: string | null;
  decisionAt: string | null;
  agreementGeneratedAt: string | null;
  signedAgreementUploadedAt: string | null;
  signatureValidatedAt: string | null;
  archivedAt: string | null;
  activeContractSummary: EmployeeFinancialActiveContractSummary | null;
}

export interface EmployeeRepaymentSchedule {
  id: string;
  requestId: string;
  entityId: string;
  personId: string | null;
  employeeId: string;
  principalAmountCents: number;
  interestAmountCents: number;
  feesAmountCents: number;
  totalRepayableCents: number;
  currency: string;
  installmentCount: number;
  monthlyInstallmentAmountCents: number;
  firstPeriod: string;
  lastPeriod: string;
  roundingAdjustmentCents: number;
  remainingBalanceCents: number;
  status: EmployeeRepaymentScheduleStatus;
  createdAt: Date | FieldValue | string;
  createdBy: string;
  createdByName: string;
  updatedAt: Date | FieldValue | string;
  updatedBy: string;
  updatedByName: string;
  version: number;
}

export interface EmployeeRepaymentInstallment {
  id: string;
  scheduleId: string;
  requestId: string;
  entityId: string;
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  dueDate: string;
  scheduledAmountCents: number;
  deductedAmountCents: number;
  externallyPaidAmountCents: number;
  waivedAmountCents: number;
  remainingForInstallmentCents: number;
  status: EmployeeRepaymentInstallmentStatus;
  payrollCalculationId: string | null;
  payrollDeductionId: string | null;
  receiptDocumentIds: string[];
  createdAt: Date | FieldValue | string;
  createdBy: string;
  createdByName: string;
  updatedAt: Date | FieldValue | string;
  updatedBy: string;
  updatedByName: string;
  version: number;
}

export const EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS: Record<EmployeeFinancialRequestType, string> = {
  salary_advance: "Avance sur salaire",
  internal_loan: "Prêt interne",
  employee_debt: "Dette employé",
};

export const EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS: Record<EmployeeFinancialRequestOrigin, string> = {
  employee_self_service: "Demandée par l’employé",
  hr_on_behalf: "Créée par RH pour l’employé",
};

export const EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS: Record<EmployeeFinancialRequestStatus, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  under_review: "En analyse",
  approved: "Approuvée",
  rejected: "Rejetée",
  document_generated: "Document généré",
  awaiting_signature: "Signature attendue",
  signed: "Signée",
  payment_pending: "Paiement à effectuer",
  active: "Active",
  suspended: "Suspendue",
  settled: "Soldée",
  cancelled: "Annulée",
  written_off: "Passée en perte",
};

export const EMPLOYEE_FINANCIAL_SIGNATURE_STATUS_LABELS: Record<EmployeeFinancialSignatureStatus, string> = {
  not_generated: "Non générée",
  awaiting_signature: "Signature attendue",
  uploaded: "Document reçu",
  validated: "Signature validée",
  rejected: "Signature rejetée",
};
