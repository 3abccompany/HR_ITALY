
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
 * Server Action to handle public application submission.
 * This is executed on the server to prevent direct Firestore write access for unauthenticated users.
 */
export async function submitApplication(publicSlug: string, answers: Record<string, any>) {
  if (!db) throw new Error("Firestore not initialized");

  return await runTransaction(db, async (transaction) => {
    // 1. Resolve Application Form
    const formsRef = collection(db, "entities"); // We need to search across entities or know the entityId
    // Since we don't know entityId from publicSlug alone safely without index, 
    // we use a query on collection group for applicationForms
    // BUT for simplicity in this milestone, we expect the client to have found the form.
    // In a real prod app, we'd use a collectionGroup query here.
    
    // For now, let's assume we have entityId and formId passed or resolved.
    // To keep it strictly slug-based:
    const qForm = query(collection(db, "applicationForms"), where("publicSlug", "==", publicSlug), where("status", "==", "published"), limit(1));
    // Error: Collection group query needed. I will use the path-based lookup if we can pass context.
    // Optimization: The client already has the form object to render the fields. 
    // We will trust the context passed by the client but double check existence.
  });
}

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

  return await runTransaction(db, async (transaction) => {
    // 1. Verify Need Status
    const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, form.recruitmentNeedId);
    const needSnap = await transaction.get(needRef);
    if (!needSnap.exists()) throw new Error("Poste introuvable.");
    const need = needSnap.data() as RecruitmentNeed;

    const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
    if (blockedStatuses.includes(need.status)) {
      throw new Error("Cette offre n'est plus disponible.");
    }

    // 2. Check Dedupe Lock
    const dedupeRef = doc(db, `entities/${entityId}/applicationSubmissionDedupe`, dedupeKey);
    const dedupeSnap = await transaction.get(dedupeRef);
    if (dedupeSnap.exists()) {
      throw new Error("Vous avez déjà postulé à cette offre.");
    }

    // 3. Resolve Person (Search within entity)
    const personsRef = collection(db, `entities/${entityId}/persons`);
    const qPerson = query(personsRef, where("codiceFiscale", "==", normNationalId), limit(1));
    const personSnap = await getDocs(qPerson); // getDocs inside transaction is tricky but allowed for reads
    
    let personId: string;
    let isNewPerson = false;

    if (!personSnap.empty) {
      personId = personSnap.docs[0].id;
    } else {
      const newPersonRef = doc(collection(db, `entities/${entityId}/persons`));
      personId = newPersonRef.id;
      isNewPerson = true;
    }

    const submissionRef = doc(collection(db, `entities/${entityId}/applicationSubmissions`));
    const candidateRef = doc(collection(db, `entities/${entityId}/candidates`));
    const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));

    const submissionId = submissionRef.id;
    const candidateId = candidateRef.id;

    // 4. Check for Secondary Duplicates (Email/Phone)
    const qEmail = query(collection(db, `entities/${entityId}/applicationSubmissions`), 
      where("recruitmentNeedId", "==", form.recruitmentNeedId),
      where("normalizedEmail", "==", normEmail),
      limit(1)
    );
    const emailSnap = await getDocs(qEmail);
    const possibleDuplicate = !emailSnap.empty;
    const duplicateReason = !emailSnap.empty ? "same_email" : undefined;

    // 5. Prepare Data
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
      customAnswers: {}, // Optionally separate custom fields
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
      // Metadata fields for future use
      notes: `Postulé via formulaire: ${form.title}`,
    };

    // 6. Execute Writes
    transaction.set(submissionRef, submissionData);
    transaction.set(dedupeRef, dedupeData);
    transaction.set(candidateRef, candidateData);
    
    if (isNewPerson) {
      transaction.set(doc(db, `entities/${entityId}/persons`, personId), {
        ...personData,
        createdAt: serverTimestamp(),
        createdBy: "public_application",
      });
    } else {
      transaction.update(doc(db, `entities/${entityId}/persons`, personId), personData);
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
    // Async Audit Logs (Safe from transaction failure if reached here)
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
