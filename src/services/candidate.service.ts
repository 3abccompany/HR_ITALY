import { db } from "@/lib/firebase/client";
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, serverTimestamp, arrayUnion } from "firebase/firestore";
import { Candidate } from "@/types/candidate";

export async function createCandidate(input: Partial<Candidate> & { entityId: string; personId: string; candidateId: string }) {
  const personDoc = await getDoc(doc(db, `entities/${input.entityId}/persons`, input.personId));
  if (!personDoc.exists()) throw new Error("PERSON_NOT_FOUND");

  const candidateRef = doc(db, `entities/${input.entityId}/candidates`, input.candidateId);
  await setDoc(candidateRef, {
    ...input,
    interviewIds: [],
    status: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const personRef = doc(db, `entities/${input.entityId}/persons`, input.personId);
  await updateDoc(personRef, {
    currentLifecycleStatus: "candidate",
    currentCandidateId: input.candidateId,
    updatedAt: serverTimestamp(),
  });

  return input.candidateId;
}

export async function attachInterviewToCandidate(entityId: string, candidateId: string, interviewId: string) {
  const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  await updateDoc(candidateRef, {
    latestInterviewId: interviewId,
    interviewIds: arrayUnion(interviewId),
    status: "interview_scheduled",
    updatedAt: serverTimestamp(),
  });
}

export async function getCandidateById(entityId: string, candidateId: string): Promise<Candidate | null> {
  const docRef = doc(db, `entities/${entityId}/candidates`, candidateId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? (docSnap.data() as Candidate) : null;
}

export async function getCandidatesByEntityId(entityId: string): Promise<Candidate[]> {
  const snapshot = await getDocs(collection(db, `entities/${entityId}/candidates`));
  return snapshot.docs.map(doc => doc.data() as Candidate);
}