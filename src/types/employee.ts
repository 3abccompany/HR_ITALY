import { FieldValue } from "firebase/firestore";

export type EmployeeStatus = "active" | "suspended" | "terminated" | "archived";

export interface Employee {
  employeeId: string;
  personId: string;
  entityId: string;
  sourceCandidateId?: string | null;
  sourceInterviewId?: string | null;
  sourceOfferId?: string | null;
  recruitmentNeedId?: string | null;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  taxCode: string;
  email: string;
  phone: string;
  birthDate: string;
  hireDate: string;
  departmentId: string;
  departmentName?: string;
  jobRoleId: string;
  jobTitle: string;
  mainWorksiteId: string;
  worksiteName?: string;
  operationalWorksiteIds: string[];
  managerUserId?: string;
  activeContractId?: string;
  pendingContractId?: string;
  status: EmployeeStatus;
  
  /** 
   * Origin of the employee record 
   * "recruitment": via standard funnel (Offer Acceptance)
   * "direct_hr_creation": manual entry by HR
   * "historical_import": batch or manual intake of pre-existing staff
   */
  source?: "recruitment" | "direct_hr_creation" | "historical_import";

  // Espace Employé / Account Metadata (Phase 1A)
  userId?: string;
  accountEmail?: string;
  accountStatus?: "no_account" | "invited" | "active" | "disabled";
  accountRole?: "employee";
  invitedAt?: Date | FieldValue | null;
  invitedBy?: string | null;
  activatedAt?: Date | FieldValue | null;
  disabledAt?: Date | FieldValue | null;

  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}
