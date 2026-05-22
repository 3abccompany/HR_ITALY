import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  limit
} from "firebase/firestore";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { JobProfile } from "@/types/job-profile";
import { createAuditLog } from "./audit.service";

/**
 * Checks if an active offer draft already exists for a candidate.
 */
export async function getActiveOfferForCandidate(entityId: string, candidateId: string): Promise<EmploymentOffer | null> {
  if (!db) return null;
  const q = query(
    collection(db, `entities/${entityId}/employmentOffers`),
    where("candidateId", "==", candidateId),
    where("status", "in", ["draft", "internal_review", "ready_to_send"]),
    limit(1)
  );
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as EmploymentOffer);
}

/**
 * Pre-fills and creates a new employment offer draft.
 */
export async function createEmploymentOfferDraft(params: {
  entityId: string;
  candidate: Candidate;
  need?: RecruitmentNeed | null;
  profile?: JobProfile | null;
  actorUid: string;
}) {
  const { entityId, candidate, need, profile, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  const offerRef = doc(collection(db, `entities/${entityId}/employmentOffers`));
  const offerId = offerRef.id;

  const payload: EmploymentOffer = {
    offerId,
    entityId,
    personId: candidate.personId,
    candidateId: candidate.candidateId,
    recruitmentNeedId: need?.needId || candidate.recruitmentNeedId || "",
    jobProfileId: profile?.jobProfileId || candidate.jobProfileId || "",
    
    // Candidate Identity Snapshot
    candidateDisplayName: candidate.displayName,
    candidateEmail: candidate.email,
    candidatePhone: candidate.phone,

    // Job Details Snapshot
    jobTitleName: need?.jobTitleName || profile?.jobTitleName || candidate.positionApplied || "",
    departmentId: need?.departmentId || profile?.departmentId || "",
    departmentName: need?.departmentName || profile?.departmentName || candidate.department || "",
    worksiteId: need?.worksiteId || "",
    worksiteName: need?.worksiteNameSnapshot || need?.worksiteName || "",

    // Contractual Defaults from Job Profile
    contractType: profile?.defaultContractType || "Tempo indeterminato",
    proposedStartDate: need?.desiredAvailabilityDate || new Date().toISOString().split('T')[0],
    weeklyHours: profile?.defaultWeeklyHours || 40,
    trialPeriodDays: 30,

    // CCNL Snapshot from Job Profile Defaults
    ccnlId: profile?.defaultCcnlId || "",
    ccnlName: profile?.defaultCcnlName || "",
    levelId: profile?.defaultLevelId || "",
    levelCode: profile?.defaultLevelCode || "",
    levelLabel: profile?.defaultLevelLabel || "",
    monthlyPayments: profile?.defaultMonthlyPayments || 13,
    minGrossMonthly: profile?.defaultMinimumGrossMonthly || 0,

    // Remuneration initial values
    proposedGrossMonthly: profile?.defaultMinimumGrossMonthly || 0,
    proposedGrossHourly: profile?.defaultMinimumGrossHourly || 0,

    status: "draft",
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(offerRef, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentOffer.draft_created",
    resourceType: "employmentOffer",
    resourceId: offerId,
    details: { candidateId: candidate.candidateId }
  });

  return offerId;
}

export async function updateEmploymentOffer(entityId: string, offerId: string, data: Partial<EmploymentOffer>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const offerRef = doc(db, `entities/${entityId}/employmentOffers`, offerId);
  
  await updateDoc(offerRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentOffer.updated",
    resourceType: "employmentOffer",
    resourceId: offerId,
  });
}

export async function cancelEmploymentOffer(entityId: string, offerId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const offerRef = doc(db, `entities/${entityId}/employmentOffers`, offerId);
  
  await updateDoc(offerRef, {
    status: "cancelled",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "employmentOffer.cancelled",
    resourceType: "employmentOffer",
    resourceId: offerId,
  });
}
