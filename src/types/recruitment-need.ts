
import { FieldValue } from "firebase/firestore";

export type RecruitmentNeedStatus = 
  | "draft" 
  | "open" 
  | "partially_fulfilled" 
  | "fulfilled" 
  | "cancelled" 
  | "archived";

export interface RecruitmentNeed {
  needId: string;
  entityId: string;
  entityName: string;
  requesterUid: string;
  requesterName: string;

  // Headcount
  requestedHeadcount: number;
  fulfilledHeadcount: number;
  remainingHeadcount: number;
  fulfilledAt?: Date | FieldValue;
  fulfilledBy?: string;

  // Company / site
  companyName: string;
  worksiteId: string | null;
  worksiteName: string;

  // Contract / employment
  contractType: string;
  employmentType: string;
  workingTime: string;

  // Job profile link
  jobProfileId: string;
  jobProfileTitle: string;
  jobProfileVersion?: string;
  departmentId: string;
  departmentName: string;
  jobTitleId: string;
  jobTitleName: string;

  // Dates
  issueDate: string;
  desiredAvailabilityDate: string;
  applicationDeadline?: string;

  // Status
  status: RecruitmentNeedStatus;

  // Other
  priority: "low" | "medium" | "high" | "urgent";
  reason?: string;
  notes?: string;

  // Job offer fields
  jobOfferTitle: string;
  jobOfferSummary: string;
  jobOfferDescription: string;
  jobOfferMissions: string;
  jobOfferSkills: string;
  jobOfferExperience: string;
  jobOfferTraining: string;
  jobOfferLocation: string;
  jobOfferSalaryRange: string;
  jobOfferBenefits: string;
  jobOfferWorkingHours: string;
  jobOfferApplicationInstructions: string;

  // Audit fields
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
  cancelledAt?: Date | FieldValue;
  cancelledBy?: string;
  archivedAt?: Date | FieldValue;
  archivedBy?: string;
}
