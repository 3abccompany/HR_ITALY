import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Normalization helpers
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizePhone = (phone: string) => phone.replace(/\D/g, "");
const normalizeNationalId = (id: string) => id.trim().toUpperCase().replace(/\s/g, "");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { publicSlug, answers } = body;

    if (!publicSlug) return NextResponse.json({ error: "Missing publicSlug" }, { status: 400 });
    if (!answers) return NextResponse.json({ error: "Missing answers" }, { status: 400 });

    // 1. Resolve Application Form
    const formsSnap = await adminDb.collectionGroup('applicationForms')
      .where('publicSlug', '==', publicSlug)
      .where('status', '==', 'published')
      .limit(1)
      .get();

    if (formsSnap.empty) return NextResponse.json({ error: "Offre introuvable ou fermée." }, { status: 404 });
    
    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Resolve Recruitment Need
    const needRef = adminDb.doc(`entities/${entityId}/recruitmentNeeds/${form.recruitmentNeedId}`);
    const needSnap = await needRef.get();
    
    if (!needSnap.exists) return NextResponse.json({ error: "Besoin RH introuvable." }, { status: 404 });
    const need = needSnap.data()!;

    const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
    if (blockedStatuses.includes(need.status)) {
      return NextResponse.json({ error: "Cette offre n’est plus disponible." }, { status: 400 });
    }

    // 3. Normalization & Dedupe Check
    const firstName = (answers.firstName || "").trim();
    const lastName = (answers.lastName || "").trim();
    const email = (answers.email || "").trim();
    const phone = (answers.phone || "").trim();
    const nationalId = (answers.nationalId || "").trim();

    const normEmail = normalizeEmail(email);
    const normPhone = normalizePhone(phone);
    const normNationalId = normalizeNationalId(nationalId);

    const dedupeKey = `${form.recruitmentNeedId}_${normNationalId}`;

    // 4. Pre-transaction checks for Person
    const personsRef = adminDb.collection(`entities/${entityId}/persons`);
    const personQuery = await personsRef.where('codiceFiscale', '==', normNationalId).limit(1).get();
    const existingPersonId = personQuery.empty ? null : personQuery.docs[0].id;

    // 5. Execution Transaction
    const result = await adminDb.runTransaction(async (transaction) => {
      const dedupeRef = adminDb.doc(`entities/${entityId}/applicationSubmissionDedupe/${dedupeKey}`);
      const dedupeSnap = await transaction.get(dedupeRef);
      
      if (dedupeSnap.exists) {
        throw new Error("ALREADY_APPLIED");
      }

      let personId = existingPersonId;
      const isNewPerson = !personId;

      if (!personId) {
        const newPersonRef = adminDb.collection(`entities/${entityId}/persons`).doc();
        personId = newPersonRef.id;
      }

      const submissionRef = adminDb.collection(`entities/${entityId}/applicationSubmissions`).doc();
      const candidateRef = adminDb.collection(`entities/${entityId}/candidates`).doc();
      const timelineRef = adminDb.collection(`entities/${entityId}/personTimeline`).doc();

      const submissionId = submissionRef.id;
      const candidateId = candidateRef.id;

      const now = FieldValue.serverTimestamp();

      // Write Dedupe Lock
      transaction.set(dedupeRef, {
        dedupeKey,
        entityId,
        recruitmentNeedId: form.recruitmentNeedId,
        normalizedNationalId: normNationalId,
        applicationSubmissionId: submissionId,
        personId,
        candidateId,
        createdAt: now,
        source: "public_application_form",
      });

      // Write Submission
      transaction.set(submissionRef, {
        submissionId,
        entityId,
        formId: form.formId,
        publicSlug,
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
        consentAcceptedAt: now,
        dedupeKey,
        personId,
        candidateId,
        status: "submitted",
        source: "public_application_form",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Write Candidate
      transaction.set(candidateRef, {
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
        notes: `Postulé via formulaire: ${form.title}`,
        createdAt: now,
        createdBy: "public_application",
        updatedAt: now,
        updatedBy: "public_application",
      });

      // Write/Update Person
      const personDocRef = adminDb.doc(`entities/${entityId}/persons/${personId}`);
      const personPayload = {
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
        updatedAt: now,
        updatedBy: "public_application",
      };

      if (isNewPerson) {
        transaction.set(personDocRef, { ...personPayload, createdAt: now, createdBy: "public_application" });
      } else {
        transaction.update(personDocRef, personPayload);
      }

      // Write Timeline
      transaction.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId,
        type: "candidate.created",
        label: "Candidature reçue",
        description: `Candidature reçue via formulaire public pour le poste de ${form.jobTitleName}.`,
        sourceCollection: "applicationSubmissions",
        sourceId: submissionId,
        createdAt: now,
        createdBy: "public_application",
      });

      return { submissionId };
    });

    // 6. Audit Log
    await adminDb.collection('auditLogs').add({
      userId: "public_application",
      entityId,
      action: "applicationSubmission.created",
      resourceType: "applicationSubmission",
      resourceId: result.submissionId,
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("API Submission Error:", error);
    if (error.message === 'ALREADY_APPLIED') {
      return NextResponse.json({ error: "Vous avez déjà postulé à cette offre." }, { status: 400 });
    }
    return NextResponse.json({ error: "Une erreur est survenue lors de l'envoi." }, { status: 500 });
  }
}
