import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { AttachmentMetadata } from "@/types/application-submission";

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

  // Handle specialized Admin SDK objects like FieldValue
  if (obj.constructor && obj.constructor.name === 'FieldValue') {
    return obj;
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
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizePhone = (phone: string) => phone.toString().replace(/\D/g, "");

/**
 * SHA-256 Hashing for privacy-safe deduplication keys.
 */
export function computeDedupeKey(entityId: string, needId: string, email: string): string {
  const input = `${entityId}:${needId}:${email}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Transactional Submission Logic using Admin SDK.
 * Now includes support for attachments and stable submissionId.
 */
export async function executeSubmissionTransaction(
  entityId: string, 
  form: any, 
  answers: Record<string, any>,
  attachments: AttachmentMetadata[] = [],
  submissionId?: string
) {
  if (!adminDb) throw new Error("Firestore Admin SDK is not initialized.");
  if (!entityId) throw new Error("Missing entityId context.");
  if (!form?.formId) throw new Error("Missing form context.");

  const firstName = (answers.firstName || "").toString().trim();
  const lastName = (answers.lastName || "").toString().trim();
  const email = (answers.email || "").toString().trim();
  const phone = (answers.phone || "").toString().trim();

  if (!email) throw new Error("L'email est obligatoire.");

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const dedupeKey = computeDedupeKey(entityId, form.recruitmentNeedId, normEmail);

  // 1. Lookups
  const personsRef = adminDb.collection("entities").doc(entityId).collection("persons");
  const personSnap = await personsRef.where("email", "==", normEmail).limit(1).get();
  const existingPersonId = personSnap.empty ? null : personSnap.docs[0].id;

  const submissionsRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissions");
  const emailSnap = await submissionsRef
    .where("recruitmentNeedId", "==", form.recruitmentNeedId)
    .where("normalizedEmail", "==", normEmail)
    .limit(1)
    .get();
    
  const possibleDuplicate = !emailSnap.empty;

  return await adminDb.runTransaction(async (transaction) => {
    // 2. Verify Need
    const needRef = adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(form.recruitmentNeedId);
    const needSnap = await transaction.get(needRef);
    if (!needSnap.exists) throw new Error("Offre d'emploi introuvable.");

    // 3. Check Dedupe
    const dedupeRef = adminDb.collection("entities").doc(entityId).collection("applicationSubmissionDedupe").doc(dedupeKey);
    const dedupeSnap = await transaction.get(dedupeRef);
    if (dedupeSnap.exists) {
      throw new Error("ALREADY_APPLIED_TO_THIS_JOB");
    }

    let personId = existingPersonId;
    const isNewPerson = !personId;

    if (!personId) {
      const newPersonRef = adminDb.collection("entities").doc(entityId).collection("persons").doc();
      personId = newPersonRef.id;
    }

    // Use provided submissionId or generate a new one
    const submissionRef = submissionId 
      ? adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc(submissionId)
      : adminDb.collection("entities").doc(entityId).collection("applicationSubmissions").doc();
    
    const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc();
    const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();

    const finalSubmissionId = submissionRef.id;
    const candidateId = candidateRef.id;

    // 4. Data
    const submissionData = sanitizePayload({
      submissionId: finalSubmissionId,
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
      answers: answers || {},
      attachments: attachments.map(a => sanitizePayload(a)),
      consentAccepted: true,
      consentAcceptedAt: FieldValue.serverTimestamp(),
      dedupeKey,
      possibleDuplicate,
      personId,
      candidateId,
      status: "submitted",
      source: "public_application_form",
      submittedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const candidateData = sanitizePayload({
      candidateId,
      entityId,
      personId,
      applicationSubmissionId: finalSubmissionId,
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
    });

    // 5. Writes
    transaction.set(submissionRef, submissionData);
    transaction.set(dedupeRef, {
      dedupeKey,
      entityId,
      recruitmentNeedId: form.recruitmentNeedId,
      normalizedEmail: normEmail,
      applicationSubmissionId: finalSubmissionId,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(candidateRef, candidateData);
    
    if (isNewPerson) {
      transaction.set(adminDb.collection("entities").doc(entityId).collection("persons").doc(personId), {
        personId,
        entityId,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        email: normEmail,
        phone: normPhone,
        currentLifecycleStatus: "candidate",
        currentCandidateId: candidateId,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "public_application",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "public_application",
      });
    } else {
      transaction.update(adminDb.collection("entities").doc(entityId).collection("persons").doc(personId), {
        currentLifecycleStatus: "candidate",
        currentCandidateId: candidateId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(timelineRef, {
      eventId: timelineRef.id,
      entityId,
      personId,
      type: "candidate.created",
      label: "Candidature reçue",
      description: `Candidature reçue avec ${attachments.length} pièces jointes.`,
      sourceCollection: "applicationSubmissions",
      sourceId: finalSubmissionId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "public_application",
    });

    return { submissionId: finalSubmissionId, candidateId, personId };
  });
}
