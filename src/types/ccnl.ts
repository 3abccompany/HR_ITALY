import { FieldValue } from "firebase/firestore";

export type CCNLStatus = "active" | "inactive" | "archived";

export type BalanceCounterType = "paid_leave" | "rol" | "ex_holidays";
export type BalanceUnit = "days" | "hours";
export type CcnlProrationMethod = "none" | "pro_rata_temporis" | "hired_before_15_full_month";

export interface WeeklySchedule {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

export interface CCNLAccrualRules {
  /** Threshold of days worked in a month to accrue entitlements (Default 14) */
  usefulDaysThreshold?: number;
  prorationMethod?: CcnlProrationMethod;
  
  // Useful day inclusion toggles
  includeSickDaysInUsefulDays?: boolean;
  includePaidLeaveInUsefulDays?: boolean;
  includeRolInUsefulDays?: boolean;
  includeExHolidaysInUsefulDays?: boolean;
  includeWorkAccidentInUsefulDays?: boolean;

  /** List of absence request types that block the monthly accrual */
  blockingAbsenceTypes?: string[];

  // Acquisition enablement
  accrualPaidLeaveEnabled?: boolean;
  accrualRolEnabled?: boolean;
  accrualExHolidaysEnabled?: boolean;
}

export interface CCNL {
  ccnlId: string;
  entityId: string;
  name: string;
  sector: string;
  cnelCode?: string;
  standardWeeklyHours: number;
  monthlyPayments: number;
  hourlyDivisor: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  status: CCNLStatus;
  notes?: string;

  // Leave Rules Foundation
  ruleVersion?: string;
  annualPaidLeaveDays?: number;
  annualRolHours?: number;
  annualExHolidayHours?: number;
  accrualRules?: CCNLAccrualRules;

  // Working Schedule (Phase 4E-0A)
  weeklySchedule?: WeeklySchedule;

  // Payroll MVP Premium Fields (Legacy - Moving to Level)
  nightPremiumPercent?: number | null;
  overtimePremiumPercent?: number | null;
  overtimeNightPremiumPercent?: number | null;
  holidayPremiumPercent?: number | null;
  sundayPremiumPercent?: number | null;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export interface CCNLLevel {
  levelId: string;
  ccnlId: string;
  entityId: string;
  levelCode: string;
  label: string;
  qualificationLabel: string;
  qualificationCategory?: string;
  minimumGrossMonthly: number;
  minimumGrossHourly: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  status: CCNLStatus;
  notes?: string;

  // Level-specific overrides
  annualPaidLeaveDays?: number;
  annualRolHours?: number;
  annualExHolidayHours?: number;
  accrualRules?: CCNLAccrualRules;
  weeklySchedule?: WeeklySchedule;

  // Payroll MVP Premium Overrides
  nightPremiumPercent?: number | null;
  overtimePremiumPercent?: number | null;
  overtimeNightPremiumPercent?: number | null;
  holidayPremiumPercent?: number | null;
  sundayPremiumPercent?: number | null;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
