import { FieldValue } from "firebase/firestore";

export type KilometerReimbursementPolicyScope = "entity" | "employee" | "contract" | "vehicle";
export type KilometerReimbursementRateSource = "manual" | "aci" | "company_policy";
export type KilometerReimbursementPolicyStatus = "active" | "inactive";
export type KilometerReimbursementStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "confirmed"
  | "exported";
export type KilometerReimbursementMonthlySummaryStatus = "preview" | "confirmed" | "exported";

export interface KilometerReimbursementPolicy {
  id?: string;
  entityId: string;
  scope: KilometerReimbursementPolicyScope;
  employeeId?: string | null;
  contractId?: string | null;
  vehicleId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  ratePerKm: number;
  rateSource: KilometerReimbursementRateSource;
  aciReferenceLabel?: string | null;
  notes?: string | null;
  status: KilometerReimbursementPolicyStatus;
  createdAt?: Date | FieldValue;
  createdBy?: string;
  updatedAt?: Date | FieldValue;
  updatedBy?: string;
}

export interface KilometerReimbursement {
  id?: string;
  entityId: string;
  employeeId: string;
  employeeName?: string;
  year: number;
  month: number;
  tripDate: string;
  origin: string;
  destination: string;
  reason: string;
  kilometers: number;
  ratePerKm: number;
  totalAmount: number;
  policyId?: string | null;
  vehicleInfo?: string | null;
  status: KilometerReimbursementStatus;
  notes?: string | null;
  attachmentIds?: string[];
  approvedAt?: Date | FieldValue;
  approvedBy?: string;
  rejectedAt?: Date | FieldValue;
  rejectedBy?: string;
  rejectionReason?: string | null;
  exportedAt?: Date | FieldValue;
  exportedBy?: string;
  createdAt?: Date | FieldValue;
  createdBy?: string;
  updatedAt?: Date | FieldValue;
  updatedBy?: string;
}

export interface KilometerReimbursementMonthlySummary {
  id?: string;
  entityId: string;
  employeeId: string;
  employeeName?: string;
  year: number;
  month: number;
  totalKilometers: number;
  totalAmount: number;
  itemCount: number;
  approvedItemIds: string[];
  status: KilometerReimbursementMonthlySummaryStatus;
  generatedAt: Date | FieldValue;
  generatedBy?: string;
}
