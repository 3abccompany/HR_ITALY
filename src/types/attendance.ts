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
  id?: string;
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
  
  // Detailed Distribution (Simplified for MVP)
  dayHours: number;
  nightHours: number;
  overtimeHours: number;
  
  // Detailed Distribution (Snapshot or Calculated - Legacy/Future support)
  ordinaryDayHours?: number;
  ordinaryNightHours?: number;
  otDayHours?: number;
  otNightHours?: number;
  
  // Context & Exceptions
  holidayFlag: boolean;
  holidayName?: string | null;
  holidayWorkedHours?: number;
  absenceCode?: string | null; // e.g., 'F' for Ferie, 'M' for Malattia
  
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
  
  // Standard Metadata
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export type ImportBatchStatus = "previewed" | "imported" | "cancelled" | "failed" | "draft_imported";

export interface AttendanceImportBatch {
  id?: string;
  batchId: string;
  importBatchId?: string; // Legacy support
  entityId: string;
  periodType: "weekly" | "monthly";
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  fileName?: string;
  sourceFileName?: string;
  templateMode?: string;
  
  // Summary Stats
  totalRows: number;
  totalPreviewRows?: number;
  validRows: number;
  warningRows: number;
  warningRowsCount?: number;
  errorRows: number;
  importedRows: number;
  importedRowsCount?: number;
  ignoredRowsCount?: number;
  
  totalWorkedHours?: number;
  dayHours?: number;
  nightHours?: number;
  overtimeHours?: number;
  absenceRowsCount?: number;
  
  status: ImportBatchStatus | string;
  notes?: string;
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt?: Date | FieldValue;
  updatedBy?: string;
  importedAt?: Date | FieldValue | null;
  importedBy?: string | null;
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
