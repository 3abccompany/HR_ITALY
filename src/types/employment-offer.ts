import { FieldValue } from "firebase/firestore";

export type EmploymentOfferStatus = 
  | "draft" 
  | "internal_review" 
  | "ready_to_send" 
  | "sent" 
  | "viewed" 
  | "accepted" 
  | "declined" 
  | "expired" 
  | "cancelled";

export interface EmploymentOffer {
  offerId: string;
  entityId: string;
  personId: string;
  candidateId: string;
  recruitmentNeedId?: string;
  recruitmentNeedTitle?: string;
  jobProfileId?: string;
  interviewId?: string;

  // Candidate Snapshot
  candidateDisplayName: string;
  candidateEmail: string;
  candidatePhone?: string;

  // Job Details Snapshot
  jobTitleName: string;
  departmentId?: string;
  departmentName?: string;
  worksiteId?: string;
  worksiteName?: string;

  // Contractual Parameters
  proposedStartDate: string; // YYYY-MM-DD
  proposedEndDate?: string;  // YYYY-MM-DD
  contractType: string;
  weeklyHours: number;
  trialPeriodDays?: number;
  workingScheduleNotes?: string;
  workplaceNotes?: string;

  // CCNL Snapshot (frozen at draft creation/save)
  ccnlId?: string;
  ccnlName?: string;
  cnelCode?: string;
  levelId?: string;
  levelCode?: string;
  levelLabel?: string;
  qualificationLabel?: string;
  monthlyPayments?: number;
  hourlyDivisor?: number;
  minGrossMonthly?: number;
  minGrossHourly?: number;

  // Compensation
  proposedGrossMonthly?: number;
  proposedGrossHourly?: number;
  proposedGrossAnnual?: number;
  salaryNotes?: string;

  status: EmploymentOfferStatus;
  notes?: string;

  // 7K-D Communication & Token Tracking
  publicAccessTokenHash?: string;
  publicAccessTokenExpiresAt?: any; // Firestore Timestamp
  sentAt?: any;
  sentBy?: string;
  viewedAt?: any;
  respondedAt?: any;
  candidateResponse?: "accepted" | "declined";
  declinedReason?: string;
  resendCount?: number;
  lastResentAt?: any;
  lastResentBy?: string;

  // Revision Tracking
  previousOfferId?: string | null;
  revisionNumber: number;
  revisionReason?: string | null;

  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}

/**
 * Sanitized version of the offer for public candidate view.
 * Excludes internal notes, audit fields, and sensitive metadata.
 */
export interface PublicOfferDTO {
  entityName: string;
  candidateDisplayName: string;
  jobTitleName: string;
  departmentName?: string;
  worksiteName?: string;
  contractType: string;
  proposedStartDate: string;
  proposedEndDate?: string;
  weeklyHours: number;
  trialPeriodDays?: number;
  ccnlName?: string;
  levelCode?: string;
  levelLabel?: string;
  qualificationLabel?: string;
  proposedGrossMonthly?: number;
  proposedGrossAnnual?: number;
  salaryNotes?: string;
  status: EmploymentOfferStatus;
  expiresAt: string;
}
