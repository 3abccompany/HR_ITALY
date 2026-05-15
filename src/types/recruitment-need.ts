
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

  // Requester
  requesterUid: string;
  requesterName: string;
  requesterSourceJobProfileId: string;

  // Headcount
  requestedHeadcount: number;
  fulfilledHeadcount: number;
  remainingHeadcount: number;
  fulfilledAt?: Date | FieldValue;
  fulfilledBy?: string;

  // Company / site
  companyName: string;
  worksiteId: string | null;
  worksiteNameSnapshot: string;
  
  // Legacy / Fallback support
  worksiteName?: string;
  siteName?: string;
  location?: string;

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
  jobOfferText: string;
  jobOfferLocation: string;
  jobOfferPlanning: string;
  jobOfferBenefits: string;
  jobOfferApplicationInstructions: string;

  // Snapshot fields from Job Profile
  jobOfferMissions: string[];
  jobOfferSkills: string[];
  jobOfferExperience: string[];
  jobOfferTraining: string[];

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
