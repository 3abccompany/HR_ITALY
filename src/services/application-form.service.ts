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
  limit,
  collectionGroup,
  serverTimestamp 
} from "firebase/firestore";
import { ApplicationForm, ApplicationFormField } from "@/types/application-form";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { createAuditLog } from "./audit.service";

/**
 * Generates the standard system fields for a new application form.
 * Updated: National ID removed for privacy. Email and Phone are required for dedupe.
 */
export function getInitialSystemFields(): ApplicationFormField[] {
  const fields: Omit<ApplicationFormField, 'order'>[] = [
    { fieldId: "f1", key: "firstName", label: "Prénom", type: "text", required: true, systemField: true, enabled: true, options: [] },
    { fieldId: "f2", key: "lastName", label: "Nom", type: "text", required: true, systemField: true, enabled: true, options: [] },
    { fieldId: "f3", key: "email", label: "Email", type: "email", required: true, systemField: true, enabled: true, options: [] },
    { fieldId: "f4", key: "phone", label: "Téléphone", type: "phone", required: true, systemField: true, enabled: true, options: [] },
    { fieldId: "f6", key: "birthDate", label: "Date de naissance", type: "date", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f7", key: "address", label: "Adresse", type: "text", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f8", key: "city", label: "Ville", type: "text", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f9", key: "province", label: "Province", type: "text", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f10", key: "country", label: "Pays", type: "text", required: false, systemField: true, enabled: true, options: [] },
    { 
      fieldId: "f11", key: "availability", label: "Disponibilité", type: "select", required: true, systemField: true, enabled: true,
      options: ["Immédiate", "15 jours", "1 mois", "Autre"]
    },
    { fieldId: "f12", key: "availableFrom", label: "Disponible à partir du", type: "date", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f13", key: "experienceYears", label: "Années d'expérience", type: "number", required: false, systemField: true, enabled: true, options: [] },
    { 
      fieldId: "f14", key: "educationLevel", label: "Niveau d'étude", type: "select", required: false, systemField: true, enabled: true,
      options: ["Sans diplôme", "Bac", "Bac+2", "Bac+3", "Bac+5", "Autre"]
    },
    { fieldId: "f15", key: "currentPosition", label: "Poste actuel ou dernier poste occupé", type: "text", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f16", key: "motivationMessage", label: "Message de motivation", type: "textarea", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f17", key: "cv", label: "CV", type: "file", required: true, systemField: true, enabled: true, options: [] },
    { fieldId: "f18", key: "coverLetter", label: "Lettre de motivation", type: "file", required: false, systemField: true, enabled: true, options: [] },
    { fieldId: "f19", key: "consent", label: "J'accepte que mes données soient utilisées pour le traitement de ma candidature.", type: "checkbox", required: true, systemField: true, enabled: true, options: [] },
  ];

  return fields.map((f, i) => ({ ...f, order: i + 1 }));
}

export async function createApplicationForm(entityId: string, need: RecruitmentNeed, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const formRef = doc(collection(db, `entities/${entityId}/applicationForms`));
  const formId = formRef.id;

  const formData: ApplicationForm = {
    formId,
    entityId,
    entityName: need.entityName || "Non renseigné",
    recruitmentNeedId: need.needId,
    recruitmentNeedTitle: need.recruitmentNeedTitle || need.jobTitleName || "Besoin sans titre",
    jobProfileId: need.jobProfileId,
    jobProfileTitle: need.jobProfileTitle,
    departmentId: need.departmentId,
    departmentName: need.departmentName,
    jobTitleId: need.jobTitleId,
    jobTitleName: need.jobTitleName,
    worksiteId: need.worksiteId,
    worksiteName: need.worksiteName || need.worksiteNameSnapshot || "Non renseigné",
    title: need.jobTitleName,
    description: need.jobOfferText || "",
    publicSlug: "", 
    status: "draft",
    fields: getInitialSystemFields(),
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(formRef, formData);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "applicationForm.created",
    resourceType: "applicationForm",
    resourceId: formId,
    details: { needId: need.needId, title: formData.title }
  });

  return formId;
}

export async function updateApplicationForm(entityId: string, formId: string, data: Partial<ApplicationForm>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const formRef = doc(db, `entities/${entityId}/applicationForms`, formId);
  await updateDoc(formRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "applicationForm.updated",
    resourceType: "applicationForm",
    resourceId: formId,
  });
}

export async function publishApplicationForm(entityId: string, formId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const formRef = doc(db, `entities/${entityId}/applicationForms`, formId);
  const snap = await getDoc(formRef);
  if (!snap.exists()) throw new Error("Form not found");
  const form = snap.data() as ApplicationForm;

  const publicSlug = form.publicSlug || `${form.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${formId.substring(0, 5)}`;

  await updateDoc(formRef, {
    status: "published",
    publicSlug,
    publishedAt: serverTimestamp(),
    publishedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "applicationForm.published",
    resourceType: "applicationForm",
    resourceId: formId,
  });
}

export async function closeApplicationForm(entityId: string, formId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const formRef = doc(db, `entities/${entityId}/applicationForms`, formId);
  await updateDoc(formRef, {
    status: "closed",
    closedAt: serverTimestamp(),
    closedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "applicationForm.closed",
    resourceType: "applicationForm",
    resourceId: formId,
  });
}

export async function archiveApplicationForm(entityId: string, formId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const formRef = doc(db, `entities/${entityId}/applicationForms`, formId);
  await updateDoc(formRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "applicationForm.archived",
    resourceType: "applicationForm",
    resourceId: formId,
  });
}

/**
 * Server Action to securely retrieve published form details for external candidates.
 */
export async function getPublicFormBySlug(slug: string) {
  if (!db) throw new Error("Firestore not initialized");

  // 1. Find form by slug using collectionGroup
  const q = query(
    collectionGroup(db, "applicationForms"),
    where("publicSlug", "==", slug),
    where("status", "==", "published"),
    limit(1)
  );
  
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const formDoc = snap.docs[0];
  const form = formDoc.data() as ApplicationForm;
  const entityId = form.entityId;

  // 2. Fetch related Recruitment Need
  const needRef = doc(db, `entities/${entityId}/recruitmentNeeds`, form.recruitmentNeedId);
  const needSnap = await getDoc(needRef);
  
  if (!needSnap.exists()) return null;
  const need = needSnap.data() as RecruitmentNeed;

  // 3. Status Validation
  const blockedStatuses = ["fulfilled", "cancelled", "archived", "closed"];
  if (blockedStatuses.includes(need.status)) return null;

  // 4. Sanitization (Return only public-safe fields)
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
    fields: form.fields
      .filter(f => f.enabled !== false)
      .sort((a, b) => a.order - b.order)
      .map(f => ({
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
}
