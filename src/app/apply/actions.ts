'use server';

import { adminDb } from "@/lib/firebase/admin";

/**
 * Server Action to securely retrieve published form details for external candidates.
 * Uses Admin SDK to bypass client-side security rules while sanitizing output.
 */
export async function getPublicFormBySlugAction(slug: string) {
  if (!slug) return null;

  try {
    // 1. Find form by slug using collectionGroup
    // This allows finding the form without knowing the entityId beforehand
    const formsSnap = await adminDb.collectionGroup("applicationForms")
      .where("publicSlug", "==", slug)
      .where("status", "==", "published")
      .limit(1)
      .get();

    if (formsSnap.empty) return null;

    const formDoc = formsSnap.docs[0];
    const form = formDoc.data();
    const entityId = form.entityId;

    // 2. Fetch related Recruitment Need using Admin SDK (bypasses rules)
    const needSnap = await adminDb.collection("entities")
      .doc(entityId)
      .collection("recruitmentNeeds")
      .doc(form.recruitmentNeedId)
      .get();
    
    if (!needSnap.exists) return null;
    const need = needSnap.data()!;

    // 3. Status Validation
    // The recruitment need must still be open or partially fulfilled
    const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
    if (blockedStatuses.includes(need.status)) return null;

    // 4. Return sanitized DTO (No internal HR fields exposed)
    return {
      formId: form.formId,
      entityId: form.entityId,
      recruitmentNeedId: form.recruitmentNeedId,
      entityName: form.entityName || need.entityName,
      title: form.title,
      description: form.description || need.jobOfferText,
      departmentName: form.departmentName,
      worksiteName: form.worksiteName,
      jobTitleName: form.jobTitleName,
      jobOfferLocation: need.jobOfferLocation,
      jobOfferPlanning: need.jobOfferPlanning,
      jobOfferBenefits: need.jobOfferBenefits,
      desiredAvailabilityDate: need.desiredAvailabilityDate,
      fields: (form.fields || [])
        .filter((f: any) => f.enabled !== false)
        .sort((a: any, b: any) => a.order - b.order)
        .map((f: any) => ({
          fieldId: f.fieldId,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          options: f.options || []
        })),
      status: form.status,
      publicSlug: form.publicSlug
    };
  } catch (err) {
    console.error("[Action: getPublicFormBySlug] Error:", err);
    return null;
  }
}
