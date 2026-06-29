import { FieldValue } from "firebase/firestore";

export type TrainingType = 
  | "worker_general"
  | "worker_specific"
  | "preposto"
  | "dirigente"
  | "rls"
  | "rspp_aspp"
  | "first_aid"
  | "fire_safety"
  | "ppe"
  | "equipment"
  | "forklift"
  | "internal"
  | "other";

export type TrainingStatus = 
  | "planned"
  | "completed"
  | "expired"
  | "cancelled"
  | "archived";

export interface Training {
  id: string;
  entityId: string;
  employeeId: string;
  personId?: string | null;
  contractId?: string | null;
  
  trainingType: TrainingType;
  title: string;
  provider: string;
  deliveryMode?: "classroom" | "online" | "blended" | "on_the_job" | null;
  
  courseDate: string; // YYYY-MM-DD
  completionDate?: string | null; // YYYY-MM-DD
  expiryDate?: string | null; // YYYY-MM-DD
  durationHours?: number | null;
  
  status: TrainingStatus;
  certificateDocumentId?: string | null;
  notes?: string | null;

  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  archivedAt?: Date | FieldValue | null;
  archivedBy?: string | null;
}

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  worker_general: "Formation générale travailleurs",
  worker_specific: "Formation spécifique travailleurs",
  preposto: "Formation chef d’équipe / préposé",
  dirigente: "Formation dirigeant",
  rls: "Formation RLS",
  rspp_aspp: "Formation RSPP / ASPP",
  first_aid: "Premiers secours",
  fire_safety: "Sécurité incendie",
  ppe: "EPI / DPI",
  equipment: "Équipements de travail",
  forklift: "Chariot élévateur",
  internal: "Formation interne",
  other: "Autre"
};

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  planned: "Planifiée",
  completed: "Terminée",
  expired: "Expirée",
  cancelled: "Annulée",
  archived: "Archivée"
};
