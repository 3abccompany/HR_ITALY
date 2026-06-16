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
