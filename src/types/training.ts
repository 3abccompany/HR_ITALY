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
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled"
  | "archived";

export type TrainingResultStatus = 
  | "passed"
  | "failed"
  | "attended"
  | "not_attended"
  | "not_required";

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
  
  /** @deprecated use startDate */
  courseDate: string; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  daysCount?: number | null;
  
  completionDate?: string | null; // YYYY-MM-DD
  expiryDate?: string | null; // YYYY-MM-DD
  durationHours?: number | null;
  
  status: TrainingStatus;
  resultStatus?: TrainingResultStatus | null;
  
  certificateDocumentId?: string | null;
  notes?: string | null;

  // Batch / Session tracking
  batchId?: string | null;
  sessionId?: string | null;
  batchLabel?: string | null;
  createdFromBatch?: boolean;

  // History & Renewal
  renewalOfTrainingId?: string | null;
  replacedByTrainingId?: string | null;

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
  in_progress: "En cours",
  completed: "Terminée",
  failed: "Non validée",
  expired: "Expirée",
  cancelled: "Annulée",
  archived: "Archivée"
};

export const TRAINING_RESULT_LABELS: Record<TrainingResultStatus, string> = {
  passed: "Réussite",
  failed: "Échec",
  attended: "Présence validée",
  not_attended: "Absent",
  not_required: "Sans évaluation"
};
