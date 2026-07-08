import { FieldValue } from "firebase/firestore";

export type PayrollCalculationStatus = 
  | "draft" 
  | "calculated" 
  | "approved" 
  | "exported" 
  | "locked" 
  | "cancelled";

export interface PayrollRateSnapshot {
  source: "ccnl_level" | "ccnl_root" | "contract" | "payroll_parameter" | "manual" | "missing";
  payCalculationMode?: "monthly" | "hourly";
  ordinaryHourlyRate: number;
  grossMonthly?: number | null;
  levelCode?: string | null;
  expectedWeeklyHours?: number | null;
  nightPremiumPercent?: number | null;
  overtimePremiumPercent?: number | null;
  overtimeNightPremiumPercent?: number | null;
  holidayPremiumPercent?: number | null;
  sundayPremiumPercent?: number | null;
  ccnlId?: string;
  ccnlLevelId?: string;
  contractId?: string;
  payrollParameterId?: string;
}

/**
 * Breakdown of hours and overtime for a specific week.
 * Phase 4E-3F-1
 */
export interface PayrollWeeklyBreakdown {
  weekKey: string; // e.g. "2024-W12"
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
  expectedWeeklyHours: number | null;
  workedHoursInWeek: number;
  paidJustifiedHoursInWeek?: number;
  rawImportedOvertimeHours?: number;
  weeklyOvertimeHours: number;
  payableOvertimeHoursInPayrollMonth?: number;
  
  // Exclusive Classification buckets
  overtimeDayHours: number;
  overtimeNightHours: number;
  overtimeSundayHours: number;
  overtimeHolidayHours: number;
  
  classificationStatus: "not_classified" | "classified" | "limited";
  classificationReason?: string | null;
}

export interface PayrollAttendanceAggregation {
  employeeId: string;
  year: number;
  month: number;
  totalValidatedHours: number;
  ordinaryDayHours: number;
  ordinaryNightHours: number;
  overtimeHours: number;
  holidayWorkedHours: number;
  workedDays: number;
  sourceAttendanceIds: string[];
  hasLegacyFallback?: boolean;
  legacyFallbackReason?: string;
  
  // Weekly Reconciliation Fields (Phase 4E-3F-1)
  weeklyBreakdown?: PayrollWeeklyBreakdown[];
  overtimeDayHours?: number;
  overtimeNightHours?: number;
  overtimeSundayHours?: number;
  overtimeHolidayHours?: number;
  rawImportedOvertimeHours?: number;
  weeklyReconciledOvertimeHours?: number;
  overtimeClassificationSource?: "not_available" | "imported_daily" | "weekly_reconciled" | "manual_approved";
}

export interface PayrollReconciliationWarning {
  code: 
    | "missing_schedule" 
    | "missing_hours" 
    | "over_expected_hours" 
    | "non_working_day_work" 
    | "holiday_work" 
    | "legacy_attendance_split_missing" 
    | "missing_payroll_rate" 
    | "missing_monthly_gross"
    | "missing_premium_rule"
    | "raw_overtime_not_weekly_reconciled"
    | "missing_time_segments_for_overtime_classification"
    | "missing_weekly_schedule"
    | "missing_night_window"
    | "missing_overtime_night_premium"
    | "overtime_classification_limited";
  severity: "info" | "warning" | "blocking";
  employeeId: string;
  date?: string;
  message: string;
  expectedDailyHours?: number | null;
  validatedHours?: number;
  coveredHours?: number;
  differenceHours?: number;
}

export interface PayrollCalculation {
  id: string; // employeeId_year_month
  entityId: string;
  employeeId: string;
  year: number;
  month: number;
  status: PayrollCalculationStatus;
  
  attendanceAggregation: PayrollAttendanceAggregation;
  rateSnapshot: PayrollRateSnapshot;
  reconciliationWarnings: PayrollReconciliationWarning[];
  
  // Financial Values
  baseGrossValue: number;
  ordinaryValue: number;
  nightValue: number;
  overtimeValue: number;
  overtimeNightValue: number;
  holidayWorkedValue: number;
  deductionValue: number;
  mealTicketsValue: number;
  mileageValue: number;
  bonusValue: number;
  
  // Advanced Overtime Values (Phase 4E-3F-1)
  overtimeDayHours?: number;
  overtimeNightHours?: number;
  overtimeSundayHours?: number;
  overtimeHolidayHours?: number;
  overtimeDayValue?: number;
  overtimeSundayValue?: number;
  overtimeHolidayValue?: number;
  rawImportedOvertimeHours?: number;
  weeklyReconciledOvertimeHours?: number;
  weeklyBreakdown?: PayrollWeeklyBreakdown[];

  /** Total gross sum before taxes and contributions */
  grossEconomicTotal: number;
  
  sourceAttendanceIds: string[];
  sourceTimeOffRequestIds?: string[];
  
  // Audit
  calculatedAt?: Date | FieldValue | any;
  calculatedBy?: string;
  approvedAt?: Date | FieldValue | any;
  approvedBy?: string;
  exportedAt?: Date | FieldValue | any;
  exportedBy?: string;
  lockedAt?: Date | FieldValue | any;
  lockedBy?: string;
  
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export interface PayrollParameter {
  id: string;
  entityId: string;
  employeeId: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null;
  
  payCalculationMode?: "monthly" | "hourly";
  ordinaryHourlyRate?: number | null;
  grossMonthly?: number | null;
  
  // Overrides
  nightPremiumPercent?: number | null;
  overtimePremiumPercent?: number | null;
  overtimeNightPremiumPercent?: number | null;
  holidayPremiumPercent?: number | null;
  sundayPremiumPercent?: number | null;
  
  // Misc
  mealTicketActive?: boolean;
  mealTicketAmount?: number;
  mileageRate?: number;
  
  status: "active" | "inactive" | "archived";
  
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
