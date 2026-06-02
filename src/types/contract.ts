import { FieldValue } from "firebase/firestore";

export type ContractStatus = "draft" | "pending_signature" | "active" | "suspended" | "terminated" | "archived";

export interface Contract {
  contractId: string;
  entityId: string;
  personId: string;
  employeeId: string;
  sourceOfferId?: string;

  // Identity Snapshots (Denormalized for registry performance)
  employeeDisplayName?: string;
  employeeCode?: string;

  // Parameters
  contractType: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  weeklyHours: number;
  
  // Salary Snapshot
  ccnlId?: string;
  ccnlName?: string;
  levelId?: string;
  levelCode?: string;
  levelLabel?: string;
  grossMonthly: number;
  grossAnnual: number;
  monthlyPayments?: number;

  status: ContractStatus;
  signedDocumentId?: string | null;
  notes?: string;

  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
