
import { FieldValue } from "firebase/firestore";

export type ApplicationFormStatus = "draft" | "published" | "closed" | "archived";

export type ApplicationFormFieldType = 
  | "text" 
  | "textarea" 
  | "email" 
  | "phone" 
  | "number" 
  | "date" 
  | "select" 
  | "checkbox" 
  | "file";

export interface ApplicationFormField {
  fieldId: string;
  key: string;
  label: string;
  type: ApplicationFormFieldType;
  required: boolean;
  options?: string[];
  order: number;
  systemField: boolean;
  enabled: boolean;
}

export interface ApplicationForm {
  formId: string;
  entityId: string;
  
  // Source links
  recruitmentNeedId: string;
  recruitmentNeedTitle: string;
  jobProfileId: string;
  jobProfileTitle: string;
  departmentId: string;
  departmentName: string;
  jobTitleId: string;
  jobTitleName: string;
  worksiteId: string | null;
  worksiteName: string;

  // Form identity
  title: string;
  description: string;
  publicSlug: string;
  status: ApplicationFormStatus;

  // Configuration
  fields: ApplicationFormField[];

  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  publishedAt?: Date | FieldValue;
  publishedBy?: string;
  closedAt?: Date | FieldValue;
  closedBy?: string;
  archivedAt?: Date | FieldValue;
  archivedBy?: string;
}
