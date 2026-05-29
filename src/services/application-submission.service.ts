import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { AttachmentMetadata } from "@/types/application-submission";

/**
 * Recursively removes undefined values from an object and replaces them with null
 * to satisfy Firestore's strict rules about unsupported field values.
 * Updated to preserve Firestore FieldValue and Timestamp instances.
 */
function sanitizePayload(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }

  // Handle specialized Admin SDK objects like FieldValue or Timestamp
  if (obj instanceof FieldValue || obj instanceof Timestamp) {
    return obj;
  }

  // Fallback check for cases where instanceof might fail due to package version mismatches
  const constructorName = obj.constructor?.name;
  if (constructorName === 'FieldValue' || constructorName === 'Timestamp' || constructorName === 'ServerTimestampValue') {
    return obj;
  }

  const newObj: any = {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = sanitizePayload(val);
    } else {
      newObj[key] = null;
    }
  }
  return newObj;
}

/**
 * Normalization helpers
 */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizePhone = (phone: string) => phone.toString().replace(/\D/g, "");
export const normalizeName = (name: string) => (name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/**
 * SHA-256 Hashing for privacy-safe deduplication keys.
 */
export function computeDedupeKey(entityId: string, needId: string, email: string): string {
  const input = `${entityId}:${needId}:${email}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Transactional Submission Logic using Admin SDK.
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

  // Extract location fields
  const address = (answers.address || "").toString().trim();
  const city = (answers.city || "").toString().trim();
  const province = (answers.province || "").toString().trim();
  const country = (answers.country || "").toString().trim();

  if (!email) throw new Error("L'email est obligatoire.");

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const dedupeKey = computeDedupeKey(entityId, form.recruitmentNeedId, normEmail);

  // 1. Lookups
  const personsRef = adminDb.collection("entities").doc(entityId).collection("persons");
  const personSnap = await personsRef.where("email", "==", normEmail).limit(1).get();
  const existingPersonId = personSnap.empty ? null : personSnap.docs[0].id;

  // 1b. Identity Conflict Guard (CRITICAL FIX)
  // If email already exists, verify that the name matches. 
  // Prevents linking a new candidate to a wrong person record due to testing/email reuse.
  if (!personSnap.empty) {
    const existingPerson = personSnap.docs[0].data();
    const submittedNormName = normalizeName(`${firstName} ${lastName}`);
    const existingNormName = normalizeName(existingPerson.displayName || "");

    if (submittedNormName !== existingNormName) {
      throw new Error(`IDENTITY_CONFLICT: Cette adresse email est déjà associée à un profil différent (${existingPerson.displayName}). Veuillez utiliser une adresse email unique ou corriger votre saisie.`);
    }

    // Optional: Check tax code if provided
    const submittedTaxCode = (answers.nationalId || answers.codiceFiscale || "").toString().trim().toUpperCase();
    const existingTaxCode = (existingPerson.codiceFiscale || "").toString().trim().toUpperCase();
    if (submittedTaxCode && existingTaxCode && submittedTaxCode !== existingTaxCode) {
      throw new Error("IDENTITY_CONFLICT: Conflit de Code Fiscal. Cette adresse email appartient à un profil existant avec un identifiant national différent.");
    }
  }

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
      possibleDuplicate: false, 
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
        address: address || null,
        city: city || null,
        province: province || null,
        country: country || null,
        currentLifecycleStatus: "candidate",
        currentCandidateId: candidateId,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "public_application",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "public_application",
      });
    } else {
      const personUpdate: any = {
        currentLifecycleStatus: "candidate",
        currentCandidateId: candidateId,
        updatedAt: FieldValue.serverTimestamp(),
      };
      
      if (address) personUpdate.address = address;
      if (city) personUpdate.city = city;
      if (province) personUpdate.province = province;
      if (country) personUpdate.country = country;

      transaction.update(adminDb.collection("entities").doc(entityId).collection("persons").doc(personId), personUpdate);
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
