import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  updateDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  limit,
  runTransaction,
  orderBy,
  Query
} from "firebase/firestore";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { JobProfile } from "@/types/job-profile";
import { createAuditLog } from "./audit.service";

/**
 * Checks if an active offer draft already exists for a candidate.
 * Includes 'accepted' to prevent duplicate drafting after a successful recruitment cycle.
 */
export async function getActiveOfferForCandidate(entityId: string, candidateId: string): Promise<EmploymentOffer | null> {
  if (!db) return null;
  const q = query(
    collection(db, `entities/${entityId}/employmentOffers`),
    where("candidateId", "==", candidateId),
    where("status", "in", ["draft", "internal_review", "ready_to_send", "sent", "viewed", "accepted"]),
    limit(1)
  ) as Query<EmploymentOffer>;
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * Fetches the latest terminal offer to determine revision numbers.
 */
export async function getLatestOfferForCandidate(entityId: string, candidateId: string): Promise<EmploymentOffer | null> {
  if (!db) return null;
  const q = query(
    collection(db, `entities/${entityId}/employmentOffers`),
    where("candidateId", "==", candidateId),
    orderBy("createdAt", "desc"),
    limit(1)
  ) as Query<EmploymentOffer>;
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * Pre-fills and creates a new employment offer draft.
 * Uses a transaction to ensure one active offer rule is enforced server-side.
 */
export async function createEmploymentOfferDraft(params: {
  entityId: string;
  candidate: Candidate;
  need?: RecruitmentNeed | null;
  profile?: JobProfile | null;
  actorUid: string;
  revisionReason?: string;
}): Promise<{ offerId: string; alreadyExists?: boolean }> {
  const { entityId, candidate, need, profile, actorUid, revisionReason } = params;
  if (!db) throw new Error("Firestore not initialized");

  return await runTransaction(db, async (transaction) => {
    // 1. Double check for active offers (Transactional enforcement)
    const activeQuery = query(
      collection(db, `entities/${entityId}/employmentOffers`),
      where("candidateId", "==", candidate.candidateId),
      where("status", "in", ["draft", "internal_review", "ready_to_send", "sent", "viewed", "accepted"]),
      limit(1)
    ) as Query<EmploymentOffer>;
    const activeSnap = await getDocs(activeQuery);
    
    if (!activeSnap.empty) {
      return { 
        offerId: activeSnap.docs[0].id, 
        alreadyExists: true 
      };
    }

    // 2. Determine revision number
    const latestQuery = query(
      collection(db, `entities/${entityId}/employmentOffers`),
      where("candidateId", "==", candidate.candidateId),
      orderBy("createdAt", "desc"),
      limit(1)
    ) as Query<EmploymentOffer>;
    const latestSnap = await getDocs(latestQuery);
    
    let revisionNumber = 1;
    let previousOfferId = null;
    
    if (!latestSnap.empty) {
      const latest = latestSnap.docs[0].data();
      revisionNumber = (latest.revisionNumber || 1) + 1;
      previousOfferId = latest.offerId;
    }

    // 3. Create new Draft
    const offerRef = doc(collection(db, `entities/${entityId}/employmentOffers`));
    const offerId = offerRef.id;

    const recruitmentNeedId = need?.needId || (candidate as any).recruitmentNeedId || "";
    const recruitmentNeedTitle = need?.recruitmentNeedTitle || 
      (need?.jobTitleName ? `${need.jobTitleName}${need.departmentName ? ` — ${need.departmentName}` : ''}` : "Besoin sans titre");

    const worksiteId = need?.worksiteId || "";
    const worksiteName = need?.worksiteName || need?.worksiteNameSnapshot || need?.siteName || need?.location || "Non renseigné";

    const payload: EmploymentOffer = {
      offerId,
      entityId,
      entityName: need?.entityName || "Non renseigné",
      personId: candidate.personId,
      candidateId: candidate.candidateId,
      recruitmentNeedId: recruitmentNeedId || undefined,
      recruitmentNeedTitle: recruitmentNeedTitle || undefined,
      jobProfileId: profile?.jobProfileId || (candidate as any).jobProfileId || need?.jobProfileId || "",
      applicationSubmissionId: candidate.applicationSubmissionId,
      
      candidateDisplayName: candidate.displayName,
      candidateEmail: candidate.email,
      candidatePhone: candidate.phone,

      jobTitleName: need?.jobTitleName || profile?.jobTitleName || candidate.positionApplied || "",
      departmentId: need?.departmentId || profile?.departmentId || candidate.department || "",
      departmentName: need?.departmentName || profile?.departmentName || candidate.department || "",
      worksiteId,
      worksiteName,

      contractType: profile?.defaultContractType || "Tempo indeterminato",
      proposedStartDate: need?.desiredAvailabilityDate || new Date().toISOString().split('T')[0],
      weeklyHours: profile?.defaultWeeklyHours || 40,
      workingTime: "Tempo pieno (Full-time)",
      trialPeriodDays: 30,

      ccnlId: profile?.defaultCcnlId || "",
      ccnlName: profile?.defaultCcnlName || "",
      levelId: profile?.defaultLevelId || "",
      levelCode: profile?.defaultLevelCode || "",
      levelLabel: profile?.defaultLevelLabel || "",
      monthlyPayments: profile?.defaultMonthlyPayments || 13,
      minGrossMonthly: profile?.defaultMinimumGrossMonthly || 0,

      proposedGrossMonthly: profile?.defaultMinimumGrossMonthly || 0,
      proposedGrossHourly: profile?.defaultMinimumGrossHourly || 0,

      status: "draft",
      revisionNumber,
      previousOfferId,
      revisionReason: revisionReason || null,
      
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    };

    transaction.set(offerRef, payload);

    return { offerId };
  }).then(async (result) => {
    if (!result.alreadyExists) {
      await createAuditLog({
        userId: actorUid,
        entityId,
        action: "employmentOffer.draft_created",
        resourceType: "employmentOffer",
        resourceId: result.offerId,
        details: { candidateId: candidate.candidateId, revisionNumber: 1 } 
      });
    }
    return result;
  });
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

/**
 * 7K-D: Sends the offer to the candidate via Server Action.
 * This function triggers the secure token generation and email dispatch.
 */
export async function initiateOfferSend(entityId: string, offerId: string, actorUid: string) {
  // Use dynamic import to keep crypto/admin logic server-side
  const { sendOfferToCandidateAction } = await import("@/app/offer/[token]/actions");
  
  const result = await sendOfferToCandidateAction({
    entityId,
    offerId,
    actorUid
  });

  if (result.success) {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "employmentOffer.sent",
      resourceType: "employmentOffer",
      resourceId: offerId,
    });
  }

  return result;
}
