const CANONICAL_EMPLOYEE_MATRICULE_PATTERN = /^E-(\d+)-\d{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const EMPLOYEE_MATRICULE_COUNTER_ID = "employeeMatricule";
export const EMPLOYEE_MATRICULE_COUNTER_COLLECTION = "counters";
export const EMPLOYEE_MATRICULE_RESERVATION_COLLECTION = "employeeMatricules";

type TransactionLike = {
  get: (ref: any) => Promise<any>;
  set: (ref: any, data: any, options?: any) => any;
};

export interface AllocateEmployeeMatriculeParams {
  transaction: TransactionLike;
  employeeRef: any;
  counterRef: any;
  makeReservationRef: (employeeCode: string) => any;
  entityId: string;
  employeeId: string;
  hireDate?: string | null;
  fallbackStartDate?: string | null;
  bootstrapLastSequence: number;
  actorUid?: string | null;
  timestamp: any;
}

export interface EmployeeMatriculeAllocation {
  employeeCode: string;
  sequence: number;
  year: number;
  reusedExisting: boolean;
}

function snapshotExists(snapshot: any): boolean {
  const exists = snapshot?.exists;
  return typeof exists === "function" ? exists.call(snapshot) : Boolean(exists);
}

function snapshotData(snapshot: any): any {
  return typeof snapshot?.data === "function" ? snapshot.data() : null;
}

function normalizeDate(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ISO_DATE_PATTERN.test(trimmed) ? trimmed : null;
}

export function formatEmployeeMatricule(sequence: number, year: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("INVALID_EMPLOYEE_MATRICULE_SEQUENCE");
  }
  if (!Number.isInteger(year) || year < 1900) {
    throw new Error("INVALID_EMPLOYEE_MATRICULE_YEAR");
  }

  const yy = String(year % 100).padStart(2, "0");
  return `E-${String(sequence).padStart(3, "0")}-${yy}`;
}

export function parseEmployeeMatriculeSequence(employeeCode: unknown): number | null {
  if (typeof employeeCode !== "string") return null;
  const match = employeeCode.trim().toUpperCase().match(CANONICAL_EMPLOYEE_MATRICULE_PATTERN);
  if (!match) return null;

  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

export function getHighestCanonicalEmployeeMatriculeSequence(employees: Array<{ employeeCode?: unknown }>): number {
  return employees.reduce((highest, employee) => {
    const sequence = parseEmployeeMatriculeSequence(employee.employeeCode);
    return sequence && sequence > highest ? sequence : highest;
  }, 0);
}

export function resolveEmployeeMatriculeYear(hireDate?: string | null, fallbackStartDate?: string | null): number {
  const resolved = normalizeDate(hireDate) || normalizeDate(fallbackStartDate);
  if (!resolved) {
    throw new Error("VALIDATION_ERROR: Date d'embauche obligatoire pour générer le matricule.");
  }
  return Number(resolved.slice(0, 4));
}

export async function allocateEmployeeMatriculeInTransaction(
  params: AllocateEmployeeMatriculeParams
): Promise<EmployeeMatriculeAllocation> {
  const {
    transaction,
    employeeRef,
    counterRef,
    makeReservationRef,
    entityId,
    employeeId,
    hireDate,
    fallbackStartDate,
    bootstrapLastSequence,
    actorUid,
    timestamp,
  } = params;

  if (!entityId || !employeeId) {
    throw new Error("VALIDATION_ERROR: Contexte employé invalide pour générer le matricule.");
  }

  const employeeSnap = await transaction.get(employeeRef);
  if (snapshotExists(employeeSnap)) {
    const existingCode = snapshotData(employeeSnap)?.employeeCode;
    const existingSequence = parseEmployeeMatriculeSequence(existingCode);
    if (typeof existingCode === "string" && existingCode.trim()) {
      return {
        employeeCode: existingCode,
        sequence: existingSequence || 0,
        year: resolveEmployeeMatriculeYear(hireDate, fallbackStartDate),
        reusedExisting: true,
      };
    }
  }

  const year = resolveEmployeeMatriculeYear(hireDate, fallbackStartDate);
  const counterSnap = await transaction.get(counterRef);
  const counterData = snapshotExists(counterSnap) ? snapshotData(counterSnap) : null;
  let lastSequence = Math.max(
    Number.isSafeInteger(counterData?.lastSequence) ? counterData.lastSequence : 0,
    Number.isSafeInteger(bootstrapLastSequence) ? bootstrapLastSequence : 0
  );

  let sequence = lastSequence;
  let employeeCode = "";
  let reservationRef: any = null;
  let reservationData: any = null;

  for (let attempts = 0; attempts < 1000; attempts += 1) {
    sequence += 1;
    employeeCode = formatEmployeeMatricule(sequence, year);
    reservationRef = makeReservationRef(employeeCode);

    const reservationSnap = await transaction.get(reservationRef);
    if (!snapshotExists(reservationSnap)) {
      reservationData = null;
      break;
    }

    reservationData = snapshotData(reservationSnap);
    if (reservationData?.employeeId === employeeId) {
      break;
    }
  }

  if (!employeeCode || !reservationRef) {
    throw new Error("EMPLOYEE_MATRICULE_ALLOCATION_FAILED");
  }

  if (reservationData?.employeeId && reservationData.employeeId !== employeeId) {
    throw new Error("EMPLOYEE_MATRICULE_RESERVATION_CONFLICT");
  }

  const counterPayload = {
    lastSequence: sequence,
    updatedAt: timestamp,
    updatedBy: actorUid || null,
  };

  transaction.set(counterRef, counterPayload, { merge: true });

  transaction.set(reservationRef, {
    employeeCode,
    employeeId,
    entityId,
    sequence,
    year,
    createdAt: reservationData?.createdAt || timestamp,
    createdBy: reservationData?.createdBy || actorUid || null,
    updatedAt: timestamp,
    updatedBy: actorUid || null,
  }, { merge: true });

  return {
    employeeCode,
    sequence,
    year,
    reusedExisting: false,
  };
}
