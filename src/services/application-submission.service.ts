'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Recursively removes undefined values from an object and replaces them with null
 * to satisfy Firestore's strict rules about unsupported field values.
 */
function sanitizePayload(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }

  const newObj: any = {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = sanitizePayload(val);
    }
  }
  return newObj;
}

/**
 * Normalization helpers
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizePhone = (phone: string) => phone.replace(/\D/g, "");
const normalizeNationalId = (id: string) => id.trim().toUpperCase().replace(/\s/g, "");

/**
 * Transactional Submission Logic using Admin SDK
 */
export async function executeSubmissionTransaction(
  entityId: string, 
  form: any, 
  answers: Record<string, any>
) {
  // Defensive validation
  if (!adminDb) throw new Error("Firestore Admin SDK is not initialized.");
  if (!entityId) throw new Error("Missing entityId context.");
  if (!form?.formId) throw new Error("Missing form context.");
  if (!form?.recruitmentNeedId) throw new Error("Missing recruitment need context.");

  // Data extraction and normalization
  const firstName = (answers.firstName || "").toString().trim();
  const lastName = (answers.lastName || "").toString().trim();
  const email = (answers.email || "").toString().trim();
  const phone = (answers.phone || "").toString().trim();
  const nationalId = (answers.nationalId || "").toString().trim();

  if (!nationalId) {
    throw new Error("L'identifiant national est obligatoire pour postuler.");
  }

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const normNationalId = normalizeNationalId(nationalId);

  console.log(`[Submission Service] Processing identity: ${firstName} ${lastName} (${normNationalId})`);

  const dedupeKey = `${form.recruitmentNeedId}_${normNationalId}`;

  // 1. Pre-transaction Lookups (Server-side)
  // Note: We perform these queries before the transaction because Firestore transactions 
  // do not support getDocs (queries) - only getDoc (by reference).
  
  const personsRef = adminDb.collection("entities").doc(entityId).collection("persons");
  const personSnap = await personsRef.where("codiceFiscale", "==", normNationalId).limit(1).get();
  const existingPersonId = personSnap.empty ? null : personSnap.docs[0].id;

  const submissionsRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions");
  const emailSnap = await submissionsRef
    .where("recruitmentNeedId", "==", form.recruitmentNeedId)
    .where("normalizedEmail", "==", normEmail)
    .limit(1)
    .get();
    
  const possibleDuplicate = !emailSnap.empty;
  const duplicateReason = !emailSnap.empty ? "same_email" : null;

  return await adminDb.runTransaction(async (transaction) => {
    // 2. Verify Need Status
    const needRef = adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(form.recruitmentNeedId);
    const needSnap = await transaction.get(needRef);
    if (!needSnap.exists) throw new Error("L'offre d'emploi correspondante est introuvable.");
    const need = needSnap.data() as any;

    const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
    if (blockedStatuses.includes(need.status)) {
      throw new Error("Désolé, cette offre n'est plus disponible aux candidatures.");
    }

    // 3. Check Dedupe Lock
    const dedupeRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissionDedupe").doc(dedupeKey);
    const dedupeSnap = await transaction.get(dedupeRef);
    if (dedupeSnap.exists) {
      throw new Error("Vous avez déjà postulé à cette offre d'emploi.");
    }

    let personId = existingPersonId;
    let isNewPerson = !personId;

    if (!personId) {
      const newPersonRef = adminDb.collection("entities").doc(entityId).collection("persons").doc();
      personId = newPersonRef.id;
    }

    const submissionRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc();
    const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc();
    const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();

    const submissionId = submissionRef.id;
    const candidateId = candidateRef.id;

    // 4. Prepare Sanitized Data
    const submissionData = sanitizePayload({
      submissionId,
      entityId,
      formId: form.formId,
      publicSlug: form.publicSlug || "",
      recruitmentNeedId: form.recruitmentNeedId,
      jobProfileId: form.jobProfileId || "",
      departmentId: form.departmentId || "",
      departmentName: form.departmentName || "",
      jobTitleId: form.jobTitleId || "",
      jobTitleName: form.jobTitleName || "",
      worksiteId: form.worksiteId || null,
      worksiteName: form.worksiteName || "",
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      email,
      normalizedEmail: normEmail,
      phone,
      normalizedPhone: normPhone,
      nationalId,
      normalizedNationalId: normNationalId,
      answers: answers || {},
      consentAccepted: true,
      consentAcceptedAt: FieldValue.serverTimestamp(),
      dedupeKey,
      possibleDuplicate,
      duplicateReason,
      personId,
      candidateId,
      status: "submitted",
      source: "public_application_form",
      submittedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const dedupeData = sanitizePayload({
      dedupeKey,
      entityId,
      recruitmentNeedId: form.recruitmentNeedId,
      normalizedNationalId: normNationalId,
      applicationSubmissionId: submissionId,
      personId,
      candidateId,
      createdAt: FieldValue.serverTimestamp(),
      source: "public_application_form",
    });

    const personData = sanitizePayload({
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
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "public_application",
    });

    const candidateData = sanitizePayload({
      candidateId,
      entityId,
      personId,
      displayName: `${firstName} ${lastName}`,
      email: normEmail,
      phone: normPhone,
      source: "public_application_form",
      positionApplied: form.jobTitleName || "",
      department: form.departmentName || "",
      applicationDate: new Date().toISOString().split('T')[0],
      status: "new",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "public_application",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "public_application",
      notes: `Postulé via formulaire: ${form.title}`,
    });

    // 5. Execute Atomic Writes
    transaction.set(submissionRef, submissionData);
    transaction.set(dedupeRef, dedupeData);
    transaction.set(candidateRef, candidateData);
    
    const personDocRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(personId);
    if (isNewPerson) {
      transaction.set(personDocRef, {
        ...personData,
        createdAt: FieldValue.serverTimestamp(),
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
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "public_application",
    });

    // 6. Global Audit Log
    const auditRef = adminDb.collection("auditLogs").doc();
    transaction.set(auditRef, {
      userId: "public_application",
      entityId,
      action: "applicationSubmission.created",
      resourceType: "applicationSubmission",
      resourceId: submissionId,
      details: { personId, candidateId },
      timestamp: FieldValue.serverTimestamp(),
    });

    return { submissionId, candidateId, personId };
  });
}
