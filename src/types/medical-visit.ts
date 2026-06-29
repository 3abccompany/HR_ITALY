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
  preventive: "Visite préventive",
  pre_employment_preventive: "Visite préventive pré-embauche",
  periodic: "Visite périodique",
  job_change: "Visite pour changement de poste",
  worker_request: "Visite à la demande du salarié",
  return_after_long_absence: "Visite avant reprise du travail",
  extraordinary: "Visite extraordinaire",
  other: "Autre"
};

export const FITNESS_STATUS_LABELS: Record<MedicalFitnessStatus, string> = {
  fit: "Apte (Idoneo)",
  fit_with_prescriptions: "Apte avec prescriptions / limitations",
  temporarily_unfit: "Temporairement inapte",
  unfit: "Inapte",
  pending_result: "En attente de jugement d’aptitude"
};
