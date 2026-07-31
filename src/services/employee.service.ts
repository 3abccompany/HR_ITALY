"use server";

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { Employee } from "@/types/employee";
import {
  EMPLOYEE_MATRICULE_COUNTER_COLLECTION,
  EMPLOYEE_MATRICULE_COUNTER_ID,
  EMPLOYEE_MATRICULE_RESERVATION_COLLECTION,
  allocateEmployeeMatriculeInTransaction,
  getHighestCanonicalEmployeeMatriculeSequence,
} from "./employee-matricule.service";

async function assertEmployeeCreatePermission(entityId: string, actorUid: string) {
  if (!actorUid) throw new Error("Accès refusé.");
  const membershipSnap = await adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get();
  const membership = membershipSnap.data();
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  if (!membershipSnap.exists || membership?.status !== "active" || !permissions.includes("employees.create")) {
    throw new Error("Permission employees.create requise.");
  }
}

export async function acceptCandidateAndCreateEmployee(input: Partial<Employee> & { 
  entityId: string; 
  personId: string; 
  employeeId: string; 
  sourceCandidateId: string; 
  sourceInterviewId: string;
  userId: string;
}) {
  await assertEmployeeCreatePermission(input.entityId, input.userId);
  const entityRef = adminDb.collection("entities").doc(input.entityId);
  const existingEmployeesSnap = await entityRef.collection("employees").get();
  const bootstrapLastSequence = getHighestCanonicalEmployeeMatriculeSequence(
    existingEmployeesSnap.docs.map((employeeDoc) => employeeDoc.data() as Employee)
  );

  return await adminDb.runTransaction(async (transaction) => {
    const personRef = entityRef.collection("persons").doc(input.personId);
    const candidateRef = entityRef.collection("candidates").doc(input.sourceCandidateId);
    const interviewRef = entityRef.collection("interviews").doc(input.sourceInterviewId);
    const employeeRef = entityRef.collection("employees").doc(input.employeeId);

    const personSnap = await transaction.get(personRef);
    const candidateSnap = await transaction.get(candidateRef);
    const interviewSnap = await transaction.get(interviewRef);

    if (!personSnap.exists) throw new Error("PERSON_NOT_FOUND");
    if (!candidateSnap.exists) throw new Error("CANDIDATE_NOT_FOUND");
    if (!interviewSnap.exists) throw new Error("INTERVIEW_NOT_FOUND");

    const candidateData = candidateSnap.data()!;
    const interviewData = interviewSnap.data()!;

    if (candidateData.entityId !== input.entityId || interviewData.entityId !== input.entityId) throw new Error("ENTITY_MISMATCH");
    if (candidateData.personId !== input.personId || interviewData.personId !== input.personId) throw new Error("PERSON_MISMATCH");
    if (interviewData.candidateId !== input.sourceCandidateId) throw new Error("CANDIDATE_MISMATCH");

    const { employeeCode } = await allocateEmployeeMatriculeInTransaction({
      transaction,
      employeeRef,
      counterRef: entityRef.collection(EMPLOYEE_MATRICULE_COUNTER_COLLECTION).doc(EMPLOYEE_MATRICULE_COUNTER_ID),
      makeReservationRef: (code) => entityRef.collection(EMPLOYEE_MATRICULE_RESERVATION_COLLECTION).doc(code),
      entityId: input.entityId,
      employeeId: input.employeeId,
      hireDate: input.hireDate,
      fallbackStartDate: input.hireDate,
      bootstrapLastSequence,
      actorUid: input.userId,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Create Employee
    transaction.set(employeeRef, {
      ...input,
      employeeCode,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update Candidate
    transaction.update(candidateRef, {
      status: "hired",
      employeeId: input.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update Interview
    transaction.update(interviewRef, {
      decision: "accepted",
      hiredEmployeeId: input.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update Person
    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: input.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Timeline Event
    const timelineRef = entityRef.collection("personTimeline").doc();
    transaction.set(timelineRef, {
      entityId: input.entityId,
      personId: input.personId,
      type: "candidate_to_employee",
      title: "Candidat embauché",
      description: `Candidat converti en employé (Code: ${employeeCode})`,
      createdBy: input.userId,
      timestamp: FieldValue.serverTimestamp(),
    });

    return input.employeeId;
  }).then(async (employeeId) => {
    await adminDb.collection("auditLogs").doc().set({
      userId: input.userId,
      entityId: input.entityId,
      action: "employee.created",
      resourceType: "employee",
      resourceId: employeeId,
      details: { conversion: true, sourceCandidateId: input.sourceCandidateId },
      timestamp: FieldValue.serverTimestamp(),
    });
    return employeeId;
  });
}

export async function createEmployeeDirectly(input: Partial<Employee> & { entityId: string; personId: string; employeeId: string; userId: string }) {
  await assertEmployeeCreatePermission(input.entityId, input.userId);
  const entityRef = adminDb.collection("entities").doc(input.entityId);
  const employeeRef = entityRef.collection("employees").doc(input.employeeId);
  const existingEmployeesSnap = await entityRef.collection("employees").get();
  const bootstrapLastSequence = getHighestCanonicalEmployeeMatriculeSequence(
    existingEmployeesSnap.docs.map((employeeDoc) => employeeDoc.data() as Employee)
  );
  
  await adminDb.runTransaction(async (transaction) => {
    const { employeeCode } = await allocateEmployeeMatriculeInTransaction({
      transaction,
      employeeRef,
      counterRef: entityRef.collection(EMPLOYEE_MATRICULE_COUNTER_COLLECTION).doc(EMPLOYEE_MATRICULE_COUNTER_ID),
      makeReservationRef: (code) => entityRef.collection(EMPLOYEE_MATRICULE_RESERVATION_COLLECTION).doc(code),
      entityId: input.entityId,
      employeeId: input.employeeId,
      hireDate: input.hireDate,
      fallbackStartDate: input.hireDate,
      bootstrapLastSequence,
      actorUid: input.userId,
      timestamp: FieldValue.serverTimestamp(),
    });

    transaction.set(employeeRef, {
      ...input,
      employeeCode,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const personRef = entityRef.collection("persons").doc(input.personId);
    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: input.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await adminDb.collection("auditLogs").doc().set({
    userId: input.userId,
    entityId: input.entityId,
    action: "employee.created",
    resourceType: "employee",
    resourceId: input.employeeId,
    timestamp: FieldValue.serverTimestamp(),
  });
}

export async function getEmployeeById(entityId: string, employeeId: string): Promise<Employee | null> {
  const snap = await adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId).get();
  return snap.exists ? (snap.data() as Employee) : null;
}

export async function getEmployeesByEntityId(entityId: string): Promise<Employee[]> {
  const snapshot = await adminDb.collection("entities").doc(entityId).collection("employees").get();
  return snapshot.docs.map(doc => doc.data() as Employee);
}
