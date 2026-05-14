
import { FieldValue } from "firebase/firestore";

export type WorksiteStatus = "active" | "inactive" | "archived";

export type WorksiteType = 
  | "main_office" 
  | "operational_site" 
  | "client_site" 
  | "warehouse" 
  | "other";

export interface Worksite {
  worksiteId: string;
  entityId: string;
  name: string;
  code: string;
  type: WorksiteType;
  address: string;
  city: string;
  province: string;
  country: string;
  status: WorksiteStatus;
  notes?: string;
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
}
