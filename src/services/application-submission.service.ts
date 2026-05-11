'use server';

import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  runTransaction, 
  serverTimestamp,
  limit
} from "firebase/firestore";
import { ApplicationSubmission, ApplicationSubmissionDedupe } from "@/types/application-submission";
import { ApplicationForm } from "@/types/application-form";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { Person } from "@/types/person";
import { Candidate } from "@/types/candidate";
import { createAuditLog } from "./audit.service";

/**
 * Normalization helpers
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizePhone = (phone: string) => phone.replace(/\D/g, "");
const normalizeNationalId = (id: string) => id.trim().toUpperCase().replace(/\s/g, "");

/**
 * Transactional Submission Logic
 */
export async function executeSubmissionTransaction(
  entityId: string, 
  form: ApplicationForm, 
  answers: Record<string, any>
) {
  if (!db) throw new Error("Firestore not initialized");

  // Normalization
  const firstName = (answers.firstName || "").trim();
  const lastName = (answers.lastName || "").trim();
  const email = (answers.email || "").trim();
  const phone = (answers.phone || "").trim();
  const nationalId = (answers.nationalId || "").trim();

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const normNationalId = normalizeNationalId(nationalId);

  const dedupeKey = `${form.recruitmentNeedId}_${normNationalId}`;

  // 1. Pre-transaction Lookups (Firestore doesn't allow getDocs inside transactions)
  // Check for existing person
  const personsRef = collection(db, `entities/${entityId}/persons`);
  const qPerson = query(personsRef, where("codiceFiscale", "==", normNationalId), limit(1));
  const personSnap = await getDocs(qPerson);
  
  const existingPersonId = personSnap.empty ? null : personSnap.docs[0].id;

  // Check for secondary duplicates (same email for same need)
  const qEmail = query(collection(db, `entities/${entityId}/applicationSubmissions`), 
    where("recruitmentNeedId", "==", form.recruitmentNeedId),
    where("normalizedEmail", "==", normEmail),
    limit(1)
  );
  const emailSnap = await getDocs(qEmail);
  const possibleDuplicate = !emailSnap.empty;
  const duplicateReason = !emailSnap.empty ? "same_email" : undefined;

  return await runTransaction(db, async (transaction) => {
    // 2. Verify Need Status
    const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, form.recruitmentNeedId);
    const needSnap = await transaction.get(needRef);
    if (!needSnap.exists()) throw new Error("Poste introuvable.");
    const need = needSnap.data() as RecruitmentNeed;

    const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
    if (blockedStatuses.includes(need.status)) {
      throw new Error("Cette offre n'est plus disponible.");
    }

    // 3. Check Dedupe Lock
    const dedupeRef = doc(db, `entities/${entityId}/applicationSubmissionDedupe`, dedupeKey);
    const dedupeSnap = await transaction.get(dedupeRef);
    if (dedupeSnap.exists()) {
      throw new Error("Vous avez déjà postulé à cette offre.");
    }

    let personId = existingPersonId;
    let isNewPerson = !personId;

    if (!personId) {
      const newPersonRef = doc(collection(db, `entities/${entityId}/persons`));
      personId = newPersonRef.id;
    }

    const submissionRef = doc(collection(db, `entities/${entityId}/applicationSubmissions`));
    const candidateRef = doc(collection(db, `entities/${entityId}/candidates`));
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));

    const submissionId = submissionRef.id;
    const candidateId = candidateRef.id;

    // 4. Prepare Data
    const submissionData: ApplicationSubmission = {
      submissionId,
      entityId,
      formId: form.formId,
      publicSlug: form.publicSlug,
      recruitmentNeedId: form.recruitmentNeedId,
      jobProfileId: form.jobProfileId,
      departmentId: form.departmentId,
      departmentName: form.departmentName,
      jobTitleId: form.jobTitleId,
      jobTitleName: form.jobTitleName,
      worksiteId: form.worksiteId,
      worksiteName: form.worksiteName,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      email,
      normalizedEmail: normEmail,
      phone,
      normalizedPhone: normPhone,
      nationalId,
      normalizedNationalId: normNationalId,
      answers,
      customAnswers: {},
      consentAccepted: true,
      consentAcceptedAt: serverTimestamp(),
      dedupeKey,
      possibleDuplicate,
      duplicateReason,
      personId,
      candidateId,
      status: "submitted",
      source: "public_application_form",
      submittedAt: serverTimestamp(),
      convertedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const dedupeData: ApplicationSubmissionDedupe = {
      dedupeKey,
      entityId,
      recruitmentNeedId: form.recruitmentNeedId,
      normalizedNationalId: normNationalId,
      applicationSubmissionId: submissionId,
      personId,
      candidateId,
      createdAt: serverTimestamp(),
      source: "public_application_form",
    };

    const personData: Partial<Person> = {
      personId,
      entityId,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      email: normEmail,
      phone: normPhone,
      codiceFiscale: normNationalId,
      currentLifecycleStatus: "candidate",
      currentCandidateId: candidateId,
      status: "active",
      updatedAt: serverTimestamp(),
      updatedBy: "public_application",
    };

    const candidateData: Candidate = {
      candidateId,
      entityId,
      personId,
      displayName: `${firstName} ${lastName}`,
      email: normEmail,
      phone: normPhone,
      source: "public_application_form",
      positionApplied: form.jobTitleName,
      department: form.departmentName,
      applicationDate: new Date().toISOString().split('T')[0],
      availabilityDate: answers.availableFrom || "",
      expectedSalary: "",
      status: "new",
      createdAt: serverTimestamp(),
      createdBy: "public_application",
      updatedAt: serverTimestamp(),
      updatedBy: "public_application",
      notes: `Postulé via formulaire: ${form.title}`,
    };

    // 5. Execute Writes
    transaction.set(submissionRef, submissionData);
    transaction.set(dedupeRef, dedupeData);
    transaction.set(candidateRef, candidateData);
    
    const personDocRef = doc(db, `entities/${entityId}/persons`, personId);
    if (isNewPerson) {
      transaction.set(personDocRef, {
        ...personData,
        createdAt: serverTimestamp(),
        createdBy: "public_application",
      });
    } else {
      transaction.update(personDocRef, personData);
    }

    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId,
      type: "candidate.created",
      label: "Candidature reçue",
      description: `Candidature reçue via formulaire public pour le poste de ${form.jobTitleName}.`,
      sourceCollection: "applicationSubmissions",
      sourceId: submissionId,
      createdAt: serverTimestamp(),
      createdBy: "public_application",
    });

    return { submissionId, candidateId, personId };
  }).then(async (result) => {
    // 6. Async Audit Logs
    await createAuditLog({
      userId: "public_application",
      entityId,
      action: "applicationSubmission.created",
      resourceType: "applicationSubmission",
      resourceId: result.submissionId,
      details: { personId: result.personId, candidateId: result.candidateId }
    });
    return result;
  });
}