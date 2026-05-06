import { db } from "@/lib/firebase/client";
import { doc, getDoc, getDocs, collection, runTransaction, serverTimestamp } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { createAuditLog } from "./audit.service";
import { createPersonTimelineEvent } from "./timeline.service";

export async function acceptCandidateAndCreateEmployee(input: Partial<Employee> & { 
  entityId: string; 
  personId: string; 
  employeeId: string; 
  sourceCandidateId: string; 
  sourceInterviewId: string;
  userId: string;
}) {
  return await runTransaction(db, async (transaction) => {
    const personRef = doc(db, `entities/${input.entityId}/persons`, input.personId);
    const candidateRef = doc(db, `entities/${input.entityId}/candidates`, input.sourceCandidateId);
    const interviewRef = doc(db, `entities/${input.entityId}/interviews`, input.sourceInterviewId);
    const employeeRef = doc(db, `entities/${input.entityId}/employees`, input.employeeId);

    const personSnap = await transaction.get(personRef);
    const candidateSnap = await transaction.get(candidateRef);
    const interviewSnap = await transaction.get(interviewRef);

    if (!personSnap.exists()) throw new Error("PERSON_NOT_FOUND");
    if (!candidateSnap.exists()) throw new Error("CANDIDATE_NOT_FOUND");
    if (!interviewSnap.exists()) throw new Error("INTERVIEW_NOT_FOUND");

    const candidateData = candidateSnap.data();
    const interviewData = interviewSnap.data();

    if (candidateData.entityId !== input.entityId || interviewData.entityId !== input.entityId) throw new Error("ENTITY_MISMATCH");
    if (candidateData.personId !== input.personId || interviewData.personId !== input.personId) throw new Error("PERSON_MISMATCH");
    if (interviewData.candidateId !== input.sourceCandidateId) throw new Error("CANDIDATE_MISMATCH");

    // Create Employee
    transaction.set(employeeRef, {
      ...input,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Update Candidate
    transaction.update(candidateRef, {
      status: "hired",
      employeeId: input.employeeId,
      updatedAt: serverTimestamp(),
    });

    // Update Interview
    transaction.update(interviewRef, {
      decision: "accepted",
      hiredEmployeeId: input.employeeId,
      updatedAt: serverTimestamp(),
    });

    // Update Person
    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: input.employeeId,
      updatedAt: serverTimestamp(),
    });

    // Timeline Event
    const timelineRef = doc(collection(db, `entities/${input.entityId}/personTimeline`));
    transaction.set(timelineRef, {
      entityId: input.entityId,
      personId: input.personId,
      type: "candidate_to_employee",
      title: "Candidat embauché",
      description: `Candidat converti en employé (Code: ${input.employeeCode})`,
      createdBy: input.userId,
      timestamp: serverTimestamp(),
    });

    return input.employeeId;
  }).then(async (employeeId) => {
    await createAuditLog({
      userId: input.userId,
      entityId: input.entityId,
      action: "employee.created",
      resourceType: "employee",
      resourceId: employeeId,
      details: { conversion: true, sourceCandidateId: input.sourceCandidateId }
    });
    return employeeId;
  });
}

export async function createEmployeeDirectly(input: Partial<Employee> & { entityId: string; personId: string; employeeId: string; userId: string }) {
  const employeeRef = doc(db, `entities/${input.entityId}/employees`, input.employeeId);
  await doc(db, `entities/${input.entityId}/employees`, input.employeeId);
  
  await runTransaction(db, async (transaction) => {
    transaction.set(employeeRef, {
      ...input,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const personRef = doc(db, `entities/${input.entityId}/persons`, input.personId);
    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: input.employeeId,
      updatedAt: serverTimestamp(),
    });
  });

  await createAuditLog({
    userId: input.userId,
    entityId: input.entityId,
    action: "employee.created",
    resourceType: "employee",
    resourceId: input.employeeId,
  });
}

export async function getEmployeeById(entityId: string, employeeId: string): Promise<Employee | null> {
  const snap = await getDoc(doc(db, `entities/${entityId}/employees`, employeeId));
  return snap.exists() ? (snap.data() as Employee) : null;
}

export async function getEmployeesByEntityId(entityId: string): Promise<Employee[]> {
  const snapshot = await getDocs(collection(db, `entities/${entityId}/employees`));
  return snapshot.docs.map(doc => doc.data() as Employee);
}