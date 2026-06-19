import { FieldValue } from "firebase/firestore";

export type TimeOffRequestKind = "leave" | "absence";

export type TimeOffRequestType = 
  | "paid_leave" 
  | "unpaid_leave" 
  | "permission" 
  | "sickness" 
  | "unjustified_absence" 
  | "work_accident" 
  | "rol_permission"
  | "ex_holiday_permission"
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
  startTime?: string | null;
  endTime?: string | null;
  dayPart: DayPart;
  durationDays: number;
  durationHours?: number;
  unit: "days" | "hours";
  balanceCounterType?: BalanceCounterType | null;
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

export type MonthlyAccrualStatus = "draft" | "confirmed" | "cancelled" | "posted";

export interface MonthlyAccrual {
  id: string; // {employeeId}_YYYY_MM
  entityId: string;
  employeeId: string;
  employeeName: string;
  year: number;
  month: number;
  periodKey: string; // "YYYY-MM"
  contractId?: string | null;
  
  ccnlSnapshot?: {
    ccnlId: string;
    ccnlName: string;
    levelId: string;
    levelCode: string;
  } | null;

  ruleSnapshot?: {
    usefulDaysThreshold: number;
    prorationMethod: string;
    blockingAbsenceTypes: string[];
  } | null;

  usefulDaysCount: number;
  usefulDaysSource: "manual" | "time_off_estimate";
  blockingReasonFound: boolean;
  blockingReasonTypes: string[];
  isAccrualQualified: boolean;

  accrued: {
    paid_leave: number;
    rol: number;
    ex_holidays: number;
  };

  status: MonthlyAccrualStatus;
  calculationNotes?: string | null;

  // Impact & Safety Flags (Phase 2J-A)
  needsReview?: boolean;
  hasDiscrepancy?: boolean;
  impactedByRequestIds?: string[];
  lastImpactDetectedAt?: Date | FieldValue | null;
  reviewReason?: string | null;

  // Posting metadata (Phase 2I)
  postedAt?: Date | FieldValue | null;
  postedByUid?: string | null;
  postedToBalanceId?: string | null;
  postedValues?: {
    paid_leave: number;
    rol: number;
    ex_holidays: number;
  } | null;
  
  createdAt: Date | FieldValue;
  createdByUid: string;
  updatedAt: Date | FieldValue;
  updatedByUid: string;
}

/**
 * Normalizes a leave balance document by mapping legacy flat fields 
 * into the new multi-counter structure if missing.
 */
export function normalizeBalance(balance: any): LeaveBalance {
  const b = balance as LeaveBalance;
  
  if (b.counters) return b;

  // Migration logic for old flat balances
  const paidLeaveCounter: LeaveBalanceCounter = {
    entitlement: b.entitlementDays || 0,
    carriedOver: b.carriedOverDays || 0,
    accrued: 0,
    used: b.usedDays || 0,
    pending: b.pendingDays || 0,
    remaining: b.remainingDays || 0,
    unit: "days"
  };

  const zeroCounter = (unit: "hours" | "days"): LeaveBalanceCounter => ({
    entitlement: 0,
    carriedOver: 0,
    accrued: 0,
    used: 0,
    pending: 0,
    remaining: 0,
    unit
  });

  return {
    ...b,
    counters: {
      paid_leave: paidLeaveCounter,
      rol: zeroCounter("hours"),
      ex_holidays: zeroCounter("hours")
    }
  };
}

/**
 * Maps a request type to the specific counter it should consume.
 */
export function getCounterTypeForRequestType(type: TimeOffRequestType): BalanceCounterType | null {
  switch (type) {
    case "paid_leave": return "paid_leave";
    case "rol_permission": return "rol";
    case "ex_holiday_permission": return "ex_holidays";
    default: return null;
  }
}

export const TIME_OFF_TYPE_LABELS: Record<TimeOffRequestType, string> = {
  paid_leave: "Congé payé",
  unpaid_leave: "Congé sans solde",
  permission: "Permission / RTT",
  sickness: "Maladie",
  unjustified_absence: "Absence injustifiée",
  work_accident: "Accident du travail",
  rol_permission: "Permission ROL",
  ex_holiday_permission: "Permission anciens jours fériés (Ex Fest.)",
  other: "Autre motif"
};
