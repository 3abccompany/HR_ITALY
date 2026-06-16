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

export interface LeaveBalance {
  entityId: string;
  employeeId: string;
  year: number;
  entitlementDays: number;
  carriedOverDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
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
