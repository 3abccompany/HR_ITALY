import { FieldValue } from "firebase/firestore";

export type HolidayType = "national" | "regional" | "local" | "company_closure";

export type HolidayStatus = "active" | "archived";

export type HolidayCountry = "IT";

export interface Holiday {
  holidayId: string;
  entityId: string;
  date: string; // YYYY-MM-DD
  name: string;
  type: HolidayType;
  country: HolidayCountry;
  region?: string | null;
  province?: string | null;
  worksiteId?: string | null;
  paid: boolean;
  status: HolidayStatus;
  
  // Audit
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy: string;
}
