import { FieldValue } from "firebase/firestore";

export type EntityStatus = "active" | "inactive" | "archived";
export type EntityType = "internal_entity" | "supplier" | "customer" | "other";

export interface Entity {
  entityId: string;
  name: string;
  legalName: string;
  type: EntityType;
  taxNumber?: string;
  fiscalCode?: string;
  address?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
  status: EntityStatus;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}