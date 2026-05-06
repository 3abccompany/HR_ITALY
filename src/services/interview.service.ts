import { db } from "@/lib/firebase/client";
import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { Interview, InterviewDecision } from "@/types/interview";
import { attachInterviewToCandidate, getCandidateById } from "./candidate.service";

export async function scheduleInterview(input: Partial<Interview> & { entityId: string; personId: string; candidateId: string; interviewId: string }) {
  const candidate = await getCandidateById(input.entityId, input.candidateId);
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
  if (candidate.personId !== input.personId) throw new Error("PERSON_MISMATCH");

  const interviewRef = doc(db, `entities/${input.entityId}/interviews`, input.interviewId);
  await setDoc(interviewRef, {
    ...input,
    decision: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await attachInterviewToCandidate(input.entityId, input.candidateId, input.interviewId);
  return input.interviewId;
}

export async function decideInterview(input: { entityId: string; interviewId: string; personId: string; candidateId: string; decision: InterviewDecision; score?: number; notes?: string }) {
  const interviewDoc = await getDoc(doc(db, `entities/${input.entityId}/interviews`, input.interviewId));
  if (!interviewDoc.exists()) throw new Error("INTERVIEW_NOT_FOUND");
  const interviewData = interviewDoc.data() as Interview;
  if (interviewData.personId !== input.personId) throw new Error("PERSON_MISMATCH");
  if (interviewData.candidateId !== input.candidateId) throw new Error("CANDIDATE_MISMATCH");

  await updateDoc(doc(db, `entities/${input.entityId}/interviews`, input.interviewId), {
    decision: input.decision,
    score: input.score,
    notes: input.notes,
    updatedAt: serverTimestamp(),
  });

  let candidateStatus = "interview_done";
  if (input.decision === "accepted") candidateStatus = "accepted";
  if (input.decision === "rejected") candidateStatus = "rejected";

  await updateDoc(doc(db, `entities/${input.entityId}/candidates`, input.candidateId), {
    status: candidateStatus,
    updatedAt: serverTimestamp(),
  });
}