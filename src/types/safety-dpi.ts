import { FieldValue } from "firebase/firestore";

export type SafetyDpiStatus = 
  | "assigned" 
  | "replaced" 
  | "returned" 
  | "lost" 
  | "damaged" 
  | "archived";

export interface SafetyDpiAssignment {
  assignmentId: string;
  entityId: string;
  employeeId: string;
  personId?: string | null;
  employeeName?: string;
  
  riskType: string;
  dpiName: string;
  quantity: number;
  deliveryDate: string; // YYYY-MM-DD
  plannedReplacementDate: string; // YYYY-MM-DD
  
  status: SafetyDpiStatus;
  reportDocumentId?: string | null;
  
  notes?: string;
  
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  archivedAt?: Date | FieldValue | null;
  archivedBy?: string | null;
}

export const SAFETY_DPI_STATUS_LABELS: Record<SafetyDpiStatus, string> = {
  assigned: "Remis / Assigné",
  replaced: "Remplacé",
  returned: "Retourné",
  lost: "Perdu",
  damaged: "Endommagé",
  archived: "Archivé"
};
