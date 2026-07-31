"use server";

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { EmploymentOffer } from "@/types/employment-offer";
import {
  EMPLOYEE_MATRICULE_COUNTER_COLLECTION,
  EMPLOYEE_MATRICULE_COUNTER_ID,
  EMPLOYEE_MATRICULE_RESERVATION_COLLECTION,
  allocateEmployeeMatriculeInTransaction,
  getHighestCanonicalEmployeeMatriculeSequence,
} from "./employee-matricule.service";

async function assertRepairPermission(entityId: string, actorUid: string) {
  if (!actorUid) throw new Error("Accès refusé.");
  const [membershipSnap, userSnap] = await Promise.all([
    adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get(),
    adminDb.collection("users").doc(actorUid).get(),
  ]);
  const membership = membershipSnap.data();
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  const isPlatformAdmin = userSnap.data()?.platformRole === "superAdmin" && userSnap.data()?.status === "active";
  if (!isPlatformAdmin && (!membershipSnap.exists || membership?.status !== "active" || !permissions.includes("employees.update"))) {
    throw new Error("Permission employees.update requise.");
  }
}

/**
 * REPAIR ONLY: Recreates a missing employee document for a finalized recruitment.
 */
export async function repairCandidateEmployeeRecord(entityId: string, candidateId: string, actorUid: string) {
  await assertRepairPermission(entityId, actorUid);
  const entityRef = adminDb.collection("entities").doc(entityId);
  const existingEmployeesSnap = await entityRef.collection("employees").get();
  const bootstrapLastSequence = getHighestCanonicalEmployeeMatriculeSequence(
    existingEmployeesSnap.docs.map((employeeDoc) => employeeDoc.data() as any)
  );

  return await adminDb.runTransaction(async (transaction) => {
    const candidateRef = entityRef.collection("candidates").doc(candidateId);
    const candidateSnap = await transaction.get(candidateRef);
    if (!candidateSnap.exists) throw new Error(`Candidat ${candidateId} introuvable.`);
    const candidate = candidateSnap.data() as Candidate;

    const personRef = entityRef.collection("persons").doc(candidate.personId);
    const personSnap = await transaction.get(personRef);
    if (!personSnap.exists) throw new Error("Fiche identité introuvable.");
    const person = personSnap.data() as Person;

    const offerSnap = await entityRef.collection("employmentOffers").where("candidateId", "==", candidateId).get();
    const offer = !offerSnap.empty ? (offerSnap.docs[0].data() as EmploymentOffer) : null;

    const employeeId = candidate.employeeId || person.currentEmployeeId || offer?.employeeId;
    if (!employeeId) {
      throw new Error("Aucun EmployeeID n'est associé à ce candidat ou à cette personne. La conversion n'a probablement jamais eu lieu.");
    }

    const employeeRef = entityRef.collection("employees").doc(employeeId);
    const employeeSnap = await transaction.get(employeeRef);

    if (!employeeSnap.exists) {
      const hireDate = offer?.proposedStartDate || candidate.applicationDate || "";
      const { employeeCode } = await allocateEmployeeMatriculeInTransaction({
        transaction,
        employeeRef,
        counterRef: entityRef.collection(EMPLOYEE_MATRICULE_COUNTER_COLLECTION).doc(EMPLOYEE_MATRICULE_COUNTER_ID),
        makeReservationRef: (code) => entityRef.collection(EMPLOYEE_MATRICULE_RESERVATION_COLLECTION).doc(code),
        entityId,
        employeeId,
        hireDate,
        fallbackStartDate: offer?.proposedStartDate || null,
        bootstrapLastSequence,
        actorUid,
        timestamp: FieldValue.serverTimestamp(),
      });

      transaction.set(employeeRef, {
        employeeId,
        personId: person.personId,
        entityId,
        sourceCandidateId: candidateId,
        sourceOfferId: offer?.offerId || null,
        employeeCode,
        firstName: person.firstName,
        lastName: person.lastName,
        displayName: person.displayName,
        taxCode: person.codiceFiscale || "",
        email: person.email,
        phone: person.phone || "",
        birthDate: person.dateOfBirth || (person as any).birthDate || "",
        hireDate,
        departmentId: candidate.departmentId || offer?.departmentId || "",
        departmentName: candidate.department || offer?.departmentName || "",
        jobTitle: candidate.positionApplied || offer?.jobTitleName || "",
        worksiteName: offer?.worksiteName || "",
        status: "active",
        createdAt: candidate.statusUpdatedAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(candidateRef, {
      status: "hired",
      employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (offer) {
      transaction.update(entityRef.collection("employmentOffers").doc(offer.offerId), {
        employeeId,
        conversionStatus: "converted",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(entityRef.collection("candidateViews").doc(employeeId), {
      id: employeeId,
      employeeId,
      displayName: person.displayName,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { employeeId };
  }).then(async (res) => {
    await adminDb.collection("auditLogs").doc().set({
      userId: actorUid,
      entityId,
      action: "admin.repair_employee_record",
      resourceType: "employee",
      resourceId: res.employeeId,
      details: { candidateId },
      timestamp: FieldValue.serverTimestamp(),
    });
    return res;
  });
}

/**
 * REPAIR ONLY: Links a specific EmploymentRequest and its linked receipt document to an existing employeeId.
 */
export async function repairCpiLink(entityId: string, offerId: string, actorUid: string) {
  await assertRepairPermission(entityId, actorUid);
  const entityRef = adminDb.collection("entities").doc(entityId);
  const requestId = `unilav_${offerId}`;

  return await adminDb.runTransaction(async (transaction) => {
    const requestRef = entityRef.collection("employmentRequests").doc(requestId);
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) throw new Error(`Dossier CPI ${requestId} introuvable.`);
    const request = requestSnap.data() as any;

    let employeeId = request.employeeId;

    if (!employeeId && request.personId) {
      const personSnap = await transaction.get(entityRef.collection("persons").doc(request.personId));
      employeeId = personSnap.exists ? personSnap.data()?.currentEmployeeId : null;
    }

    if (!employeeId && request.candidateId) {
      const candidateSnap = await transaction.get(entityRef.collection("candidates").doc(request.candidateId));
      employeeId = candidateSnap.exists ? candidateSnap.data()?.employeeId : null;
    }

    if (!employeeId) {
      const offerSnap = await transaction.get(entityRef.collection("employmentOffers").doc(offerId));
      employeeId = offerSnap.exists ? offerSnap.data()?.employeeId : null;
    }

    if (!employeeId) throw new Error("CONVERSION_NOT_FOUND: Impossible de résoudre l'EmployeeId pour ce dossier.");

    const employeeRef = entityRef.collection("employees").doc(employeeId);
    const employeeSnap = await transaction.get(employeeRef);
    if (!employeeSnap.exists) throw new Error(`EMPLOYEE_MISSING: Le document employé ${employeeId} n'existe pas.`);
    const employeeData = employeeSnap.data()!;

    transaction.update(requestRef, {
      employeeId,
      candidateDisplayName: employeeData.displayName,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });

    if (request.receiptDocumentId) {
      transaction.update(entityRef.collection("documents").doc(request.receiptDocumentId), {
        employeeId,
        employeeDisplayName: employeeData.displayName,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
    }

    return { employeeId, receiptDocumentId: request.receiptDocumentId };
  }).then(async (res) => {
    await adminDb.collection("auditLogs").doc().set({
      userId: actorUid,
      entityId,
      action: "admin.repair_cpi_link",
      resourceType: "employmentRequest",
      resourceId: requestId,
      details: res,
      timestamp: FieldValue.serverTimestamp(),
    });
    return res;
  });
}
