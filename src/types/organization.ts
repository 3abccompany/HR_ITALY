import { FieldValue } from "firebase/firestore";

export type OrganizationStatus = "active" | "inactive" | "archived";

export interface Department {
  id?: string;
  departmentId: string;
  entityId: string;
  name: string;
  code: string;
  description: string;
  responsibleName: string;
  status: OrganizationStatus;
  notes: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}

export interface JobTitle {
  id?: string;
  jobTitleId: string;
  entityId: string;
  departmentId: string;
  departmentName: string; // denormalized for optimization
  title: string;
  description: string;
  status: OrganizationStatus;
  notes: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}
