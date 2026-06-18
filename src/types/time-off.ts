import { FieldValue } from "firebase/firestore";

export type TimeOffRequestKind = "leave" | "absence";

export type TimeOffRequestType = 
  | "paid_leave" 
  | "unpaid_leave" 
  | "permission" 
  | "sickness" 
  | "unjustified_absence" 
  | "work_accident" 
  | "other";

export type TimeOffStatus = "submitted" | "approved" | "rejected" | "cancelled";

export type JustificationStatus = "not_required" | "missing" | "provided";

export type DayPart = "full_day" | "morning" | "afternoon";

export interface TimeOffRequest {
  requestId: string;
  entityId: string;
  employeeId: string;
  personId?: string;
  employeeName: string;
  requestKind: TimeOffRequestKind;
  requestType: TimeOffRequestType;
  source: "hr_created" | "employee_created";
  status: TimeOffStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dayPart: DayPart;
  durationDays: number;
  reason?: string;
  
  // Justification Metadata
  requiresJustification: boolean;
  justificationStatus: JustificationStatus;
  justificationNote?: string | null;
  justificationDocumentIds: string[];

  createdByUid: string;
  createdByRole: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;

  // Decision Audit Fields
  approvedAt?: Date | FieldValue;
  approvedByUid?: string;
  approvedByRole?: string;
  
  rejectedAt?: Date | FieldValue;
  rejectedByUid?: string;
  rejectedByRole?: string;
  rejectionReason?: string;

  cancelledAt?: Date | FieldValue;
  cancelledByUid?: string;
  cancelledByRole?: string;
  cancelReason?: string;
}

export type BalanceCounterType = "paid_leave" | "rol" | "ex_holidays";
export type BalanceUnit = "days" | "hours";

export interface LeaveBalanceCounter {
  entitlement: number;
  carriedOver: number;
  accrued: number;
  used: number;
  pending: number;
  remaining: number;
  unit: BalanceUnit;
}

export interface LeaveBalance {
  entityId: string;
  employeeId: string;
  year: number;
  
  // Multi-counter structure (Phase 2F2)
  counters?: Record<string, LeaveBalanceCounter>;

  // Legacy flat fields for backward compatibility (mirrored to paid_leave counter)
  entitlementDays?: number;
  carriedOverDays?: number;
  usedDays?: number;
  pendingDays?: number;
  remainingDays?: number;
  
  // CCNL Source Snapshot (Phase 2F1)
  ccnlSnapshot?: {
    ccnlId?: string | null;
    ccnlName?: string | null;
    levelId?: string | null;
    levelCode?: string | null;
    ruleVersion?: number | null;
    contractId?: string | null;
    source: "contract" | "manual" | "unknown";
    capturedAt: Date | FieldValue | null;
  };

  updatedAt: Date | FieldValue;
  updatedByUid: string;
  updatedByRole: string;
}

export const TIME_OFF_TYPE_LABELS: Record<TimeOffRequestType, string> = {
  paid_leave: "Congé payé",
  unpaid_leave: "Congé sans solde",
  permission: "Permission / RTT",
  sickness: "Maladie",
  unjustified_absence: "Absence injustifiée",
  work_accident: "Accident du travail",
  other: "Autre motif"
};
