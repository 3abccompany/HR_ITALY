"use server";

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { Person } from "@/types/person";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { PreHireDossier } from "@/types/pre-hire-dossier";
import { LeaveBalance, LeaveBalanceCounter } from "@/types/time-off";
import {
  EMPLOYEE_MATRICULE_COUNTER_COLLECTION,
  EMPLOYEE_MATRICULE_COUNTER_ID,
  EMPLOYEE_MATRICULE_RESERVATION_COLLECTION,
  allocateEmployeeMatriculeInTransaction,
  getHighestCanonicalEmployeeMatriculeSequence,
} from "./employee-matricule.service";

async function assertIntakePermissions(entityId: string, actorUid: string) {
  if (!actorUid) throw new Error("Accès refusé.");
  const membershipSnap = await adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get();
  const membership = membershipSnap.data();
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  if (!membershipSnap.exists || membership?.status !== "active" || !permissions.includes("employees.create") || !permissions.includes("contracts.create")) {
    throw new Error("Permissions employees.create et contracts.create requises.");
  }
}

/**
 * Checks for an existing person by identity identifier (Codice Fiscale) or email.
 */
export async function findExistingPersonForIntake(entityId: string, identifier: string, actorUid: string) {
  if (!identifier) return null;
  await assertIntakePermissions(entityId, actorUid);
  const term = identifier.trim().toUpperCase();
  
  // Try Codice Fiscale
  const snapCf = await adminDb.collection("entities").doc(entityId).collection("persons").where("codiceFiscale", "==", term).limit(1).get();
  if (!snapCf.empty) return snapCf.docs[0].data() as Person;

  // Try Email
  const snapEmail = await adminDb.collection("entities").doc(entityId).collection("persons").where("email", "==", term.toLowerCase()).limit(1).get();
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

function resolvePayCalculationMode(mode: unknown): Contract["payCalculationMode"] {
  return mode === "actual_worked_hours" ? "actual_worked_hours" : "monthly";
}

function normalizeIntakeOperationId(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Identifiant d'opÃ©ration d'intÃ©gration invalide.");
  }

  const operationId = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationId)) {
    throw new Error("Identifiant d'opÃ©ration d'intÃ©gration invalide.");
  }

  return operationId;
}

/**
 * Atomic transaction to ingest an existing employee into the system.
 * Creates Person (if new), Employee, Active Contract, HR Dossier, and initial Leave Balance.
 */
export async function executeEmployeeIntake(entityId: string, payload: any, actorUid: string) {
  await assertIntakePermissions(entityId, actorUid);
  const intakeOperationId = normalizeIntakeOperationId(payload.intakeOperationId);

  const entityRef = adminDb.collection("entities").doc(entityId);
  const existingEmployeesSnap = await entityRef.collection("employees").get();
  const bootstrapLastSequence = getHighestCanonicalEmployeeMatriculeSequence(
    existingEmployeesSnap.docs.map((employeeDoc) => employeeDoc.data() as Employee)
  );

  const personId = payload.personId || entityRef.collection("persons").doc().id;
  const employeeId = entityRef.collection("employees").doc().id;
  const contractId = entityRef.collection("contracts").doc().id;
  const dossierId = entityRef.collection("preHireDossiers").doc().id;
  const year = new Date().getFullYear();
  const balanceId = `${employeeId}_${year}`;

  const result = await adminDb.runTransaction(async (transaction) => {
    const operationRef = entityRef.collection("employeeIntakeOperations").doc(intakeOperationId);
    const operationSnap = await transaction.get(operationRef);
    if (operationSnap.exists) {
      const operation = operationSnap.data();
      if (operation?.status !== "completed" || !operation.employeeId) {
        throw new Error("Cette opÃ©ration d'intÃ©gration est incomplÃ¨te. Veuillez contacter un administrateur.");
      }

      const existingEmployeeRef = entityRef.collection("employees").doc(operation.employeeId);
      const existingEmployeeSnap = await transaction.get(existingEmployeeRef);
      if (!existingEmployeeSnap.exists) {
        throw new Error("Cette opÃ©ration d'intÃ©gration rÃ©fÃ©rence un employÃ© introuvable. Veuillez contacter un administrateur.");
      }

      const existingEmployee = existingEmployeeSnap.data() as Employee;
      return {
        employeeId: operation.employeeId as string,
        employeeCode: existingEmployee.employeeCode,
        reusedExisting: true,
      };
    }

    const personRef = entityRef.collection("persons").doc(personId);
    const employeeRef = entityRef.collection("employees").doc(employeeId);
    const contractRef = entityRef.collection("contracts").doc(contractId);
    const dossierRef = entityRef.collection("preHireDossiers").doc(dossierId);
    const balanceRef = entityRef.collection("leaveBalances").doc(balanceId);
    const counterRef = entityRef.collection(EMPLOYEE_MATRICULE_COUNTER_COLLECTION).doc(EMPLOYEE_MATRICULE_COUNTER_ID);

    const now = FieldValue.serverTimestamp();
    const { employeeCode } = await allocateEmployeeMatriculeInTransaction({
      transaction,
      employeeRef,
      counterRef,
      makeReservationRef: (code) => entityRef.collection(EMPLOYEE_MATRICULE_RESERVATION_COLLECTION).doc(code),
      entityId,
      employeeId,
      hireDate: payload.hireDate,
      fallbackStartDate: payload.contractStartDate,
      bootstrapLastSequence,
      actorUid,
      timestamp: now,
    });

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
      employeeCode,
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
      jobProfileId: payload.jobProfileId || null,
      mainWorksiteId: payload.worksiteId || "",
      worksiteName: payload.worksiteName || "",
      operationalWorksiteIds: [payload.worksiteId].filter(Boolean),
      status: "active",
      weeklyHours: payload.weeklyHours || 40,
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
      jobProfileId: payload.jobProfileId || null,
      contractType: payload.contractType,
      startDate: payload.contractStartDate || payload.hireDate,
      endDate: payload.contractEndDate || null,
      weeklyHours: payload.weeklyHours || 40,
      ccnlId: payload.ccnlId,
      ccnlName: payload.ccnlName,
      levelId: payload.levelId,
      levelCode: payload.levelCode,
      levelLabel: payload.levelLabel || null,
      qualificationCategory: payload.qualificationCategory || null,
      grossMonthly: payload.grossMonthly || 0,
      grossAnnual: payload.grossAnnual || 0,
      monthlyPayments: payload.monthlyPayments || 13,
      payCalculationMode: resolvePayCalculationMode(payload.payCalculationMode),
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
    const timelineRef = entityRef.collection("personTimeline").doc();
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

    transaction.set(operationRef, {
      operationId: intakeOperationId,
      entityId,
      status: "completed",
      employeeId,
      employeeCode,
      personId,
      contractId,
      dossierId,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });

    return { employeeId, employeeCode, reusedExisting: false };
  });

  if (!result.reusedExisting) {
    try {
      await adminDb.collection("auditLogs").doc().set({
        userId: actorUid,
        entityId,
        action: "employee.historical_intake",
        resourceType: "employee",
        resourceId: result.employeeId,
        details: { hireDate: payload.hireDate, intakeOperationId },
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("New intake audit log failed after successful employee creation.", error);
    }
  }

  return { employeeId: result.employeeId, employeeCode: result.employeeCode };
}
