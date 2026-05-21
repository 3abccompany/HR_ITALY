
import { FieldValue } from "firebase/firestore";

export type CCNLStatus = "active" | "inactive" | "archived";

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
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
