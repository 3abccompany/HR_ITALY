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

export type MedicalVisitRequestStatus =
  | "draft"
  | "provider_request_sent"
  | "awaiting_provider_response"
  | "slots_received"
  | "assignments_ready"
  | "employees_planned"
  | "completed"
  | "cancelled";

export type MedicalVisitProviderType = "doctor" | "medical_center";

export type MedicalVisitRequestUrgency = "normal" | "urgent" | "critical";

export type MedicalVisitRequestSelectionStatus = "selected" | "removed";

export type MedicalVisitRequestNotificationStatus = "not_sent" | "sent" | "failed" | "not_applicable";

export type MedicalVisitRequestEmailStatus = "not_sent" | "sent" | "failed" | "not_applicable";

export interface MedicalVisit {
  id: string;
  entityId: string;
  employeeId: string;
  personId?: string | null;
  contractId?: string | null;
  
  // Core Visit Data
  visitType: MedicalVisitType;
  visitDate: string; // YYYY-MM-DD
  visitStartTime?: string | null;
  visitEndTime?: string | null;
  doctorName: string;
  medicalCenter?: string | null;
  medicalVisitRequestId?: string | null;
  medicalVisitRequestParticipantId?: string | null;
  providerSlotId?: string | null;
  plannedFromRequest?: boolean;
  
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

export interface MedicalVisitRequest {
  id: string;
  entityId: string;
  visitType: MedicalVisitType;
  providerType: MedicalVisitProviderType;
  providerName: string;
  providerEmail: string;
  medicalCenter?: string | null;
  desiredStartDate: string;
  desiredEndDate: string;
  urgency: MedicalVisitRequestUrgency;
  constraints?: string | null;
  status: MedicalVisitRequestStatus;
  participantCount: number;
  providerRequestSentAt?: Date | FieldValue | null;
  providerRequestSentBy?: string | null;
  providerRequestSentByName?: string | null;
  providerRequestSentByDisplayName?: string | null;
  providerRequestSentRecipient?: string | null;
  providerRequestSentSubject?: string | null;
  providerRequestSentBodyText?: string | null;
  providerRequestSendCount?: number;
  providerResponseRecordedAt?: Date | FieldValue | null;
  providerResponseRecordedBy?: string | null;
  providerResponseRecordedByName?: string | null;
  slotCount?: number;
  assignedParticipantCount?: number;
  unassignedParticipantCount?: number;
  providerEmailSentAt?: Date | FieldValue | null;
  providerEmailSentBy?: string | null;
  providerEmailLastRecipient?: string | null;
  providerEmailSendCount?: number;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export interface MedicalVisitProviderSlot {
  id: string;
  slotId: string;
  entityId: string;
  requestId: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  location: string;
  capacity?: number | null;
  instructions?: string | null;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

export interface MedicalVisitRequestParticipant {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  personId?: string | null;
  contractId?: string | null;
  selectionStatus: MedicalVisitRequestSelectionStatus;
  assignedSlotId?: string | null;
  assignedStartTime?: string | null;
  assignedEndTime?: string | null;
  appointmentDurationMinutes?: number | null;
  appointmentSequence?: number | null;
  resultingMedicalVisitId?: string | null;
  notificationStatus?: MedicalVisitRequestNotificationStatus;
  emailStatus?: MedicalVisitRequestEmailStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
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

export const MEDICAL_VISIT_REQUEST_STATUS_LABELS: Record<MedicalVisitRequestStatus, string> = {
  draft: "Brouillon",
  provider_request_sent: "Demande envoyée au médecin",
  awaiting_provider_response: "En attente de réponse",
  slots_received: "Créneaux reçus",
  assignments_ready: "Affectation prête",
  employees_planned: "Employés planifiés",
  completed: "Terminée",
  cancelled: "Annulée",
};

export const MEDICAL_VISIT_PROVIDER_TYPE_LABELS: Record<MedicalVisitProviderType, string> = {
  doctor: "Médecin",
  medical_center: "Centre médical",
};

export const MEDICAL_VISIT_REQUEST_URGENCY_LABELS: Record<MedicalVisitRequestUrgency, string> = {
  normal: "Normale",
  urgent: "Urgente",
  critical: "Critique",
};

export const FITNESS_STATUS_LABELS: Record<MedicalFitnessStatus, string> = {
  fit: "Apte (Idoneo)",
  fit_with_prescriptions: "Apte avec prescriptions / limitations",
  temporarily_unfit: "Temporairement inapte",
  unfit: "Inapte",
  pending_result: "En attente de jugement d’aptitude"
};
