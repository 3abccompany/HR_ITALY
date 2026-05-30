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

  // Internal Contractual Recommendations (Milestone 7K-B)
  defaultCcnlId?: string;
  defaultCcnlName?: string;
  defaultLevelId?: string;
  defaultLevelCode?: string;
  defaultLevelLabel?: string;
  defaultContractType?: string;
  defaultWeeklyHours?: number;
  defaultMonthlyPayments?: number;
  defaultMinimumGrossMonthly?: number;
  defaultMinimumGrossHourly?: number;
  
  // Versioning
  version: number;
  versionLabel: string;
  lastModifiedAt?: Date | FieldValue;
  lastModifiedBy?: string;

  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  disabledAt?: Date | FieldValue;
  disabledBy?: string;
  reactivatedAt?: Date | FieldValue;
  reactivatedBy?: string;
}

export interface JobProfileVersion {
  versionId: string;
  entityId: string;
  jobProfileId: string;
  version: number;
  versionLabel: string;
  snapshot: Partial<JobProfile>;
  changeSummary?: string;
  createdAt: Date | FieldValue;
  createdBy: string;
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
