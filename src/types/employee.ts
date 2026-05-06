import { FieldValue } from "firebase/firestore";

export type EmployeeStatus = "active" | "suspended" | "terminated" | "archived";

export interface Employee {
  employeeId: string;
  personId: string;
  entityId: string;
  sourceCandidateId?: string;
  sourceInterviewId?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  taxCode: string;
  birthDate: string;
  hireDate: string;
  departmentId: string;
  jobRoleId: string;
  mainWorksiteId: string;
  operationalWorksiteIds: string[];
  managerUserId?: string;
  activeContractId?: string;
  status: EmployeeStatus;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}