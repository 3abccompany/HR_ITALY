import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp, 
  writeBatch,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { Holiday, HolidayType } from "@/types/holiday";
import { createAuditLog } from "./audit.service";
import { format, addDays, startOfDay } from "date-fns";

/**
 * Calculates Easter Sunday for a given year using the Meeus/Jones/Butcher algorithm.
 */
function calculateEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Returns Easter Monday as YYYY-MM-DD.
 */
export function calculateEasterMonday(year: number): string {
  const sunday = calculateEasterSunday(year);
  const monday = addDays(sunday, 1);
  return format(monday, "yyyy-MM-dd");
}

/**
 * Generates the list of 11 standard Italian national holidays.
 */
export function generateItalianNationalHolidays(year: number, options?: { includeSanFrancesco?: boolean }) {
  const holidays = [
    { date: `${year}-01-01`, name: "Capodanno" },
    { date: `${year}-01-06`, name: "Epifania" },
    { date: calculateEasterMonday(year), name: "Lunedì dell'Angelo (Pasquetta)" },
    { date: `${year}-04-25`, name: "Festa della Liberazione" },
    { date: `${year}-05-01`, name: "Festa del Lavoro" },
    { date: `${year}-06-02`, name: "Festa della Repubblica" },
    { date: `${year}-08-15`, name: "Assunzione di Maria (Ferragosto)" },
    { date: `${year}-11-01`, name: "Ognissanti" },
    { date: `${year}-12-08`, name: "Immacolata Concezione" },
    { date: `${year}-12-25`, name: "Natale" },
    { date: `${year}-12-26`, name: "Santo Stefano" },
  ];

  if (options?.includeSanFrancesco) {
    holidays.push({ date: `${year}-10-04`, name: "San Francesco d'Assisi" });
  }

  return holidays;
}

/**
 * Lists holidays for an entity within a date range.
 */
export async function listHolidays(entityId: string, startDate: string, endDate: string) {
  if (!db) return [];
  const q = query(
    collection(db, `entities/${entityId}/holidays`),
    where("date", ">=", startDate),
    where("date", "<=", endDate)
  );
  
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ ...d.data(), holidayId: d.id } as Holiday))
    .filter(h => h.status === "active")
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Seeds national holidays for a specific year.
 * Prevents duplicates by using a deterministic ID: h_YYYY-MM-DD
 */
export async function seedItalianNationalHolidays(
  entityId: string, 
  year: number, 
  actorUid: string, 
  options?: { includeSanFrancesco?: boolean }
) {
  if (!db) throw new Error("Firestore not initialized");

  const nationalList = generateItalianNationalHolidays(year, options);
  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const h of nationalList) {
    const holidayId = `h_${h.date}`;
    const ref = doc(db, `entities/${entityId}/holidays`, holidayId);
    
    batch.set(ref, {
      holidayId,
      entityId,
      date: h.date,
      name: h.name,
      type: "national" as HolidayType,
      country: "IT",
      paid: true,
      status: "active",
      updatedAt: now,
      updatedBy: actorUid,
      createdAt: now,
      createdBy: actorUid,
    }, { merge: true });
  }

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "holidays.seeded_national",
    resourceType: "holiday",
    resourceId: `${year}`,
    details: { year, count: nationalList.length }
  });

  return { success: true, count: nationalList.length };
}

/**
 * Creates a custom holiday record.
 */
export async function createHoliday(entityId: string, data: Partial<Holiday>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = doc(collection(db, `entities/${entityId}/holidays`));
  const holidayId = ref.id;

  const payload: Holiday = {
    ...(data as any),
    holidayId,
    entityId,
    country: "IT",
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(ref, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "holiday.created",
    resourceType: "holiday",
    resourceId: holidayId,
    details: { name: payload.name, date: payload.date }
  });

  return holidayId;
}

/**
 * Archives a holiday (status = archived).
 */
export async function archiveHoliday(entityId: string, holidayId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = doc(db, `entities/${entityId}/holidays`, holidayId);
  
  await updateDoc(ref, {
    status: "archived",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "holiday.archived",
    resourceType: "holiday",
    resourceId: holidayId,
  });
}
