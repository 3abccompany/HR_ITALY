import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp, 
  getDocs, 
  query, 
  where, 
  limit 
} from "firebase/firestore";
import { Person } from "@/types/person";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { PreHireDossier } from "@/types/pre-hire-dossier";
import { LeaveBalance, LeaveBalanceCounter } from "@/types/time-off";
import { createAuditLog } from "./audit.service";

/**
 * Checks for an existing person by identity identifier (Codice Fiscale) or email.
 */
export async function findExistingPersonForIntake(entityId: string, identifier: string) {
  if (!db || !identifier) return null;
  const term = identifier.trim().toUpperCase();
  
  // Try Codice Fiscale
  const qCf = query(collection(db, `entities/${entityId}/persons`), where("codiceFiscale", "==", term), limit(1));
  const snapCf = await getDocs(qCf);
  if (!snapCf.empty) return snapCf.docs[0].data() as Person;

  // Try Email
  const qEmail = query(collection(db, `entities/${entityId}/persons`), where("email", "==", term.toLowerCase()), limit(1));
  const snapEmail = await getDocs(qEmail);
  if (!snapEmail.empty) return snapEmail.docs[0].data() as Person;

  return null;
}

/**
 * Recursively removes undefined values from an object before Firestore write.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj.constructor?.name === 'FieldValue' || obj.constructor?.name === 'Timestamp' || obj._methodName === 'serverTimestamp') {
    return obj;
  }
  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

/**
 * Atomic transaction to ingest an existing employee into the system.
 * Creates Person (if new), Employee, Active Contract, HR Dossier, and initial Leave Balance.
 */
export async function executeEmployeeIntake(entityId: string, payload: any, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const personId = payload.personId || doc(collection(db, `entities/${entityId}/persons`)).id;
  const employeeId = doc(collection(db, `entities/${entityId}/employees`)).id;
  const contractId = doc(collection(db, `entities/${entityId}/contracts`)).id;
  const dossierId = doc(collection(db, `entities/${entityId}/preHireDossiers`)).id;
  const year = new Date().getFullYear();
  const balanceId = `${employeeId}_${year}`;

  return await runTransaction(db, async (transaction) => {
    const personRef = doc(db, `entities/${entityId}/persons`, personId);
    const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);
    const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
    const dossierRef = doc(db, `entities/${entityId}/preHireDossiers`, dossierId);
    const balanceRef = doc(db, `entities/${entityId}/leaveBalances`, balanceId);

    const now = serverTimestamp();

    // 1. Person Creation or Update
    const personData: Partial<Person> = {
      personId,
      entityId,
      firstName: payload.firstName,
      lastName: payload.lastName,
      displayName: `${payload.firstName} ${payload.lastName}`,
      codiceFiscale: (payload.codiceFiscale || "").toUpperCase(),
      email: (payload.email || "").toLowerCase(),
      phone: payload.phone || "",
      address: payload.address || "",
      city: payload.city || "",
      province: payload.province || "",
      postalCode: payload.postalCode || "",
      country: payload.country || "Italie",
      dateOfBirth: payload.birthDate || "",
      currentLifecycleStatus: "employee",
      currentEmployeeId: employeeId,
      status: "active",
      updatedAt: now,
      updatedBy: actorUid
    };

    if (payload.isNewPerson) {
      (personData as any).createdAt = now;
      (personData as any).createdBy = actorUid;
      transaction.set(personRef, sanitizePayload(personData));
    } else {
      transaction.update(personRef, sanitizePayload(personData));
    }

    // 2. Employee Creation
    const employeeData: Employee = {
      employeeId,
      personId,
      entityId,
      employeeCode: payload.employeeCode || `E-${Date.now().toString().slice(-6)}`,
      firstName: payload.firstName,
      lastName: payload.lastName,
      displayName: `${payload.firstName} ${payload.lastName}`,
      taxCode: (payload.codiceFiscale || "").toUpperCase(),
      email: (payload.email || "").toLowerCase(),
      phone: payload.phone || "",
      birthDate: payload.birthDate || "",
      hireDate: payload.hireDate,
      departmentId: payload.departmentId || "",
      departmentName: payload.departmentName || "",
      jobRoleId: payload.jobTitle || "",
      jobTitle: payload.jobTitle || "",
      mainWorksiteId: payload.worksiteId || "",
      worksiteName: payload.worksiteName || "",
      operationalWorksiteIds: [payload.worksiteId].filter(Boolean),
      status: "active",
      source: payload.intakeSource || "direct_hr_creation",
      activeContractId: contractId,
      createdAt: now,
      updatedAt: now,
    };
    transaction.set(employeeRef, sanitizePayload(employeeData));

    // 3. Active Contract Creation
    const contractData: Contract = {
      contractId,
      entityId,
      personId,
      employeeId,
      employeeDisplayName: employeeData.displayName,
      employeeCode: employeeData.employeeCode,
      taxCode: employeeData.taxCode,
      employeeAddressSnapshot: personData.address,
      jobTitleName: employeeData.jobTitle,
      departmentName: employeeData.departmentName,
      worksiteName: employeeData.worksiteName,
      contractType: payload.contractType,
      startDate: payload.contractStartDate || payload.hireDate,
      endDate: payload.contractEndDate || null,
      weeklyHours: payload.weeklyHours || 40,
      ccnlId: payload.ccnlId,
      ccnlName: payload.ccnlName,
      levelId: payload.levelId,
      levelCode: payload.levelCode,
      grossMonthly: payload.grossMonthly || 0,
      grossAnnual: payload.grossAnnual || 0,
      monthlyPayments: payload.monthlyPayments || 13,
      status: "active",
      source: payload.intakeSource || "direct_hr_creation",
      activatedAt: now,
      activatedBy: actorUid,
      preHireDossierId: dossierId,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };
    transaction.set(contractRef, sanitizePayload(contractData));

    // 4. Historical HR Dossier
    const dossierData: Partial<PreHireDossier> = {
      dossierId,
      entityId,
      personId,
      employeeId,
      contractId,
      status: "converted_to_employee",
      readyForConversion: true,
      title: "Dossier RH de reprise",
      source: payload.intakeSource || "historical_import",
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };
    transaction.set(dossierRef, sanitizePayload(dossierData));

    // 5. Initial Leave Balance
    const ferie = payload.openingFerie || { report: 0, acquis: 0, utilisé: 0 };
    const rol = payload.openingRol || { report: 0, acquis: 0, utilisé: 0 };
    const exF = payload.openingExFest || { report: 0, acquis: 0, utilisé: 0 };

    const buildCounter = (data: any, unit: "days" | "hours"): LeaveBalanceCounter => ({
      entitlement: payload.annualEntitlementFerie || 0,
      carriedOver: Number(data.report) || 0,
      accrued: Number(data.acquis) || 0,
      used: Number(data.utilisé) || 0,
      pending: 0,
      remaining: (Number(data.report) || 0) + (Number(data.acquis) || 0) - (Number(data.utilisé) || 0),
      unit
    });

    const balanceData: LeaveBalance = {
      entityId,
      employeeId,
      year,
      ccnlSnapshot: {
        ccnlId: payload.ccnlId,
        ccnlName: payload.ccnlName,
        levelId: payload.levelId,
        levelCode: payload.levelCode,
        source: "manual",
        capturedAt: now
      },
      counters: {
        paid_leave: buildCounter(ferie, "days"),
        rol: buildCounter(rol, "hours"),
        ex_holidays: buildCounter(exF, "hours")
      },
      updatedAt: now,
      updatedByUid: actorUid,
      updatedByRole: "companyHR"
    };
    transaction.set(balanceRef, sanitizePayload(balanceData));

    // 6. Timeline Event
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId,
      employeeId,
      contractId,
      type: "employee.historical_intake",
      label: "Reprise historique",
      description: `Importation manuelle du dossier employé. Date d'embauche réelle: ${payload.hireDate}.`,
      sourceCollection: "employees",
      sourceId: employeeId,
      createdAt: now,
      createdBy: actorUid,
    });

    return { employeeId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "employee.historical_intake",
      resourceType: "employee",
      resourceId: res.employeeId,
      details: { hireDate: payload.hireDate }
    });
    return res;
  });
}
