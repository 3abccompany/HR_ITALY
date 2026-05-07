
import { FieldValue } from "firebase/firestore";

export type EntityStatus = "active" | "inactive" | "archived";
export type EntityType = "internal_entity" | "supplier" | "customer" | "other";

export interface Entity {
  id?: string;
  // Identification
  entityId: string;
  type: EntityType;
  status: EntityStatus;
  
  // Required Company Fields (Approved Specification)
  raisonSociale: string;
  nomEntreprise: string;
  
  // Compatibility Aliases (Matching legacy backend.json)
  legalName?: string;
  name?: string;

  numeroTVA: string;
  codeFiscalEntreprise: string;
  
  // Address & Contact
  adresseSiegeSocial: string;
  codePostal: string;
  ville: string;
  province: string;
  telephone: string;
  email: string;
  pec: string;
  referentEntreprise: string;
  
  // Metadata & Audit
  notes?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy?: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
}
