/**
 * @fileOverview Read-only service to resolve expected daily work hours for employees.
 * Follows the priority: CCNL Level Schedule -> CCNL Root Schedule -> Null.
 */

import { Firestore, doc, getDoc } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { CCNL, CCNLLevel, WeeklySchedule } from "@/types/ccnl";
import { ResolvedWorkSchedule, WeekdayName } from "@/types/work-schedule";

/**
 * Normalizes a potential schedule value (number or string) into a valid float.
 * Supports comma separators (e.g. "6,5").
 */
function normalizeScheduleValue(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;
  
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }

  if (typeof val === 'string') {
    const clean = val.replace(',', '.').trim();
    const parsed = parseFloat(clean);
    return !isNaN(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

/**
 * Timezone-safe weekday resolution from YYYY-MM-DD.
 */
function getWeekdayName(dateIso: string): WeekdayName | null {
  const parts = dateIso.split('-');
  if (parts.length !== 3) return null;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

  // month is 0-indexed in JS Date constructor
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return null;

  const days: WeekdayName[] = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
  ];
  
  return days[date.getDay()];
}

/**
 * Resolves the expected work duration for a specific employee on a specific date.
 * Hierarchy: CCNL Level > CCNL Root.
 */
export async function resolveWorkSchedule(
  db: Firestore,
  entityId: string,
  employeeId: string,
  dateIso: string
): Promise<ResolvedWorkSchedule> {
  // 1. Date Validation
  const weekday = getWeekdayName(dateIso);
  if (!weekday) {
    return { expectedDailyHours: null, source: "invalid_date", isReliable: false, weekday: undefined };
  }

  try {
    // 2. Load Employee
    const empRef = doc(db, `entities/${entityId}/employees`, employeeId);
    const empSnap = await getDoc(empRef);
    if (!empSnap.exists()) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday };
    }
    const emp = empSnap.data() as Employee;

    const activeContractId = emp.activeContractId;
    if (!activeContractId) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday };
    }

    // 3. Load Contract
    const contractRef = doc(db, `entities/${entityId}/contracts`, activeContractId);
    const contractSnap = await getDoc(contractRef);
    if (!contractSnap.exists()) {
      return { expectedDailyHours: null, source: "missing_contract", isReliable: false, weekday, contractId: activeContractId };
    }
    const contract = contractSnap.data() as Contract;
    
    const { ccnlId, levelId } = contract;
    if (!ccnlId) {
      return { expectedDailyHours: null, source: "missing_ccnl", isReliable: false, weekday, contractId: activeContractId };
    }

    // 4. Load CCNL Root (For fallback)
    const ccnlRef = doc(db, `entities/${entityId}/ccnls`, ccnlId);
    const ccnlSnap = await getDoc(ccnlRef);
    const ccnlData = ccnlSnap.exists() ? ccnlSnap.data() as CCNL : null;

    // 5. Try resolving from Level first
    if (levelId) {
      const levelRef = doc(db, `entities/${entityId}/ccnls/${ccnlId}/levels`, levelId);
      const levelSnap = await getDoc(levelRef);
      
      if (levelSnap.exists()) {
        const level = levelSnap.data() as CCNLLevel;
        const levelValue = level.weeklySchedule ? normalizeScheduleValue((level.weeklySchedule as any)[weekday]) : null;
        
        if (levelValue !== null) {
          return {
            expectedDailyHours: levelValue,
            source: "level_schedule",
            isReliable: true,
            weekday,
            contractId: activeContractId,
            ccnlId,
            ccnlLevelId: levelId
          };
        }
      }
    }

    // 6. Try resolving from CCNL Root
    if (ccnlData && ccnlData.weeklySchedule) {
      const rootValue = normalizeScheduleValue((ccnlData.weeklySchedule as any)[weekday]);
      if (rootValue !== null) {
        return {
          expectedDailyHours: rootValue,
          source: "ccnl_schedule",
          isReliable: true,
          weekday,
          contractId: activeContractId,
          ccnlId
        };
      }
    }

    // 7. No schedule found
    return {
      expectedDailyHours: null,
      source: "missing_schedule",
      isReliable: false,
      weekday,
      contractId: activeContractId,
      ccnlId
    };

  } catch (err: any) {
    console.error("[WorkScheduleResolver] Error:", err);
    return {
      expectedDailyHours: null,
      source: "missing_schedule",
      isReliable: false,
      weekday,
      warning: `Technical error: ${err.message}`
    };
  }
}
