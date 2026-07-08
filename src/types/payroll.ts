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
    | "missing_premium_rule";
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
