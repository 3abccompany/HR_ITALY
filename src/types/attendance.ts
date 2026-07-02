import { FieldValue } from "firebase/firestore";

export type AttendanceStatus = 
  | "draft_imported" 
  | "draft" 
  | "validated" 
  | "corrected" 
  | "cancelled" 
  | "locked" 
  | "archived";

export type AttendanceSource = "manual" | "excel_import";

export type PunchType = "AM" | "PM" | "OT";

export interface AttendancePunch {
  type: PunchType;
  timeIn?: string;  // HH:mm
  timeOut?: string; // HH:mm
}

export interface AttendanceRecord {
  id: string;
  attendanceId: string; // Format: {employeeId}_{YYYY-MM-DD}
  entityId: string;
  employeeId: string;
  personId?: string | null;
  employeeCode: string;
  employeeDisplayName?: string;
  attendanceDate: string; // YYYY-MM-DD
  
  // Organization Context
  worksiteId?: string | null;
  worksiteName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  
  // Work Data
  shiftType: "day" | "night" | "mixed";
  punches: AttendancePunch[];
  pauseMinutes: number;
  
  // Totals
  calculatedHours: number;
  validatedHours: number;
  
  // Detailed Distribution
  dayHours: number;
  nightHours: number;
  overtimeHours: number;
  holidayWorkedHours?: number;
  
  // Context & Exceptions
  holidayFlag: boolean;
  holidayName?: string | null;
  absenceCode?: string | null;
  
  // Audit & Anomalies
  anomalyFlag: boolean;
  anomalyNotes?: string | null;
  anomalyMessages?: string[];
  notes?: string;
  correctionReason?: string;
  
  // Lifecycle
  status: AttendanceStatus;
  source: AttendanceSource;
  importBatchId?: string | null;
  
  // Validation Metadata
  validatedAt?: Date | FieldValue | null;
  validatedBy?: string | null;

  // Standard Metadata
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export type ImportBatchStatus = 
  | "previewed" 
  | "imported" 
  | "cancelled" 
  | "failed" 
  | "draft_imported" 
  | "partially_validated" 
  | "validated";

export interface AttendanceImportBatch {
  id: string;
  batchId: string;
  entityId: string;
  periodType: "weekly" | "monthly";
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  sourceFileName?: string;
  templateMode?: string;
  
  // Summary Stats
  totalPreviewRows?: number;
  importedRowsCount?: number;
  validatedRowsCount?: number;
  warningRowsCount?: number;
  ignoredRowsCount?: number;
  totalWorkedHours?: number;
  dayHours?: number;
  nightHours?: number;
  overtimeHours?: number;
  absenceRowsCount?: number;
  
  status: ImportBatchStatus;
  notes?: string;
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export interface AttendancePreviewRow {
  rowId: string;
  status: "valid" | "warning" | "error";
  messages: string[];
  
  employeeCode: string;
  employeeName: string;
  employeeId?: string;
  personId?: string | null;
  date: string;
  dayName: string;
  worksite?: string;
  department?: string;
  
  punches: AttendancePunch[];
  pauseMinutes: number;
  
  // Calculated Splits
  calculatedHours: number;
  dayHours: number;
  nightHours: number;
  overtimeHours: number;
  holidayWorkedHours: number;
  
  validatedHours: number;
  absenceCode?: string;
  isHoliday: boolean;
  notes?: string;
}
