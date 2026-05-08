import { FieldValue } from "firebase/firestore";

export type JobProfileStatus = "active" | "inactive" | "archived";

export type CatalogItemType = 
  | "missionResponsibility" 
  | "objective" 
  | "trainingRequirement" 
  | "professionalExperience" 
  | "softSkill";

export interface JobProfile {
  jobProfileId: string;
  entityId: string;
  entityName: string;
  issueDate: string;
  departmentId: string;
  departmentName: string;
  jobTitleId: string;
  jobTitleName: string;
  directSupervisorJobTitleId: string;
  directSupervisorJobTitleName: string;
  collaboratorJobTitleIds: string[];
  collaboratorJobTitleNames: string[];
  missionsAndResponsibilities: string[];
  objectives: string[];
  initialAndProfessionalTraining: string[];
  professionalExperience: string[];
  softSkills: string[];
  status: JobProfileStatus;
  notes?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}

export interface JobProfileCatalogItem {
  itemId: string;
  entityId: string;
  type: CatalogItemType;
  label: string;
  description?: string;
  status: "active" | "inactive" | "archived";
  usageCount: number;
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
