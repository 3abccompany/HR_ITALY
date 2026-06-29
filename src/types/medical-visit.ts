import { FieldValue } from "firebase/firestore";

export type MedicalVisitType = 
  | "preventive" 
  | "pre_employment_preventive" 
  | "periodic" 
  | "job_change" 
  | "worker_request" 
  | "return_after_long_absence" 
  | "extraordinary" 
  | "other";

export type MedicalFitnessStatus = 
  | "fit" 
  | "fit_with_prescriptions" 
  | "temporarily_unfit" 
  | "unfit" 
  | "pending_result";

export type MedicalVisitStatus = 
  | "scheduled" 
  | "completed" 
  | "pending_result" 
  | "cancelled" 
  | "archived";

export interface MedicalVisit {
  id: string;
  entityId: string;
  employeeId: string;
  personId?: string | null;
  contractId?: string | null;
  
  // Core Visit Data
  visitType: MedicalVisitType;
  visitDate: string; // YYYY-MM-DD
  doctorName: string;
  medicalCenter?: string | null;
  
  // Results & Compliance
  fitnessStatus: MedicalFitnessStatus;
  nextVisitDate?: string | null; // YYYY-MM-DD
  status: MedicalVisitStatus;
  
  // Sensitive Notes (Workplace focused, NOT clinical diagnosis)
  prescriptions?: string | null; // Prescrizioni
  restrictions?: string | null; // Limitazioni
  notes?: string | null; // Note gestionali
  
  documentId?: string | null; // Link to Giudizio di Idoneità in GED
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  archivedAt?: Date | FieldValue | null;
  archivedBy?: string | null;
}

export const MEDICAL_VISIT_TYPE_LABELS: Record<MedicalVisitType, string> = {
  preventive: "Visita preventiva",
  pre_employment_preventive: "Visita preventiva preassuntiva",
  periodic: "Visita periodica",
  job_change: "Visita per cambio mansione",
  worker_request: "Visita su richiesta del lavoratore",
  return_after_long_absence: "Visita per ripresa al lavoro",
  extraordinary: "Visita straordinaria",
  other: "Altro"
};

export const FITNESS_STATUS_LABELS: Record<MedicalFitnessStatus, string> = {
  fit: "Idoneo",
  fit_with_prescriptions: "Idoneo con prescrizioni/limitazioni",
  temporarily_unfit: "Temporaneamente non idoneo",
  unfit: "Non idoneo",
  pending_result: "In attesa di giudizio"
};
