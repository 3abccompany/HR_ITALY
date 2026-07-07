/**
 * @fileOverview Type definitions for the work schedule resolution system.
 */

export type WorkScheduleSource = 
  | "level_schedule" 
  | "ccnl_schedule" 
  | "missing_contract" 
  | "missing_ccnl" 
  | "missing_schedule" 
  | "invalid_date";

export type WeekdayName = 
  | "monday" 
  | "tuesday" 
  | "wednesday" 
  | "thursday" 
  | "friday" 
  | "saturday" 
  | "sunday";

export interface ResolvedWorkSchedule {
  /** The number of work hours expected for the given day. */
  expectedDailyHours: number | null;
  /** Where the data was retrieved from. */
  source: WorkScheduleSource;
  /** True if the value is derived from an explicit schedule and is valid. */
  isReliable: boolean;
  /** Optional warning message for debugging or UI feedback. */
  warning?: string;
  /** The ID of the contract used for resolution. */
  contractId?: string;
  /** The ID of the CCNL used for resolution. */
  ccnlId?: string;
  /** The ID of the CCNL Level used for resolution. */
  ccnlLevelId?: string;
  /** The resolved weekday name. */
  weekday?: WeekdayName;
}
