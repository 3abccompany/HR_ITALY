import { FieldValue } from "firebase/firestore";

export type MealTicketPolicyScope = "entity" | "employee" | "contract";
export type MealTicketPolicyStatus = "active" | "inactive";
export type MealTicketMonthlySummaryStatus = "preview" | "confirmed" | "exported";

export interface MealTicketPolicy {
  id?: string;
  entityId: string;
  scope: MealTicketPolicyScope;
  employeeId?: string | null;
  contractId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  valuePerTicket: number;
  minimumWorkedHoursForEligibility: number;
  includeHolidayWorkedDays: boolean;
  excludeLeaveDays: boolean;
  excludeAbsenceDays: boolean;
  status: MealTicketPolicyStatus;
  createdAt?: Date | FieldValue;
  createdBy?: string;
  updatedAt?: Date | FieldValue;
  updatedBy?: string;
}

export interface MealTicketExcludedBreakdown {
  absences: number;
  leave: number;
  holidaysNotWorked: number;
  nonWorkedDays: number;
  invalidOrDraftAttendance: number;
}

export interface MealTicketExcludedDayDetail {
  date: string;
  reason:
    | "absence"
    | "leave"
    | "holiday_not_worked"
    | "holiday_worked_not_included"
    | "non_worked_day"
    | "invalid_or_draft_attendance";
  attendanceId?: string;
  validatedHours?: number;
}

export interface MealTicketMonthlySummary {
  id?: string;
  entityId: string;
  employeeId: string;
  employeeName?: string;
  year: number;
  month: number;
  policyId?: string;
  valuePerTicket: number;
  eligibleDays: number;
  excludedDays: number;
  excludedBreakdown: MealTicketExcludedBreakdown;
  totalValue: number;
  sourceAttendanceIds: string[];
  eligibleDates?: string[];
  excludedDates?: MealTicketExcludedDayDetail[];
  warnings?: string[];
  generatedAt: Date | FieldValue;
  generatedBy?: string;
  status: MealTicketMonthlySummaryStatus;
}
