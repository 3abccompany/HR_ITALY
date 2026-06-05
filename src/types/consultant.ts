import { FieldValue } from "firebase/firestore";

export type ConsultantStatus = "active" | "inactive" | "archived";

export interface Consultant {
  id: string;
  entityId: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  pec?: string; // Posta Elettronica Certificata (Certified Email)
  address?: string;
  notes?: string;
  status: ConsultantStatus;
  
  // Audit
  createdAt?: Date | FieldValue;
  createdBy?: string;
  updatedAt?: Date | FieldValue;
  updatedBy?: string;
}
