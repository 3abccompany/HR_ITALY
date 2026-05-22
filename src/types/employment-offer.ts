import { FieldValue } from "firebase/firestore";

export type EmploymentOfferStatus = "draft" | "internal_review" | "ready_to_send" | "cancelled";

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

  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
