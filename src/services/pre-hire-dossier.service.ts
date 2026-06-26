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
  writeBatch,
  deleteDoc,
  Timestamp
} from "firebase/firestore";
import { PreHireDossier, PreHireDocument, PreHireDocumentStatus } from "@/types/pre-hire-dossier";
import { EmploymentOffer } from "@/types/employment-offer";
import { createAuditLog } from "./audit.service";
import { sendDocumentRequestEmailAction } from "./email.service";

/**
 * Initializes a new Pre-Hire Dossier with a default Italian checklist.
 */
export async function ensurePreHireDossier(entityId: string, offer: EmploymentOffer, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const dossierQuery = query(
    collection(db, `entities/${entityId}/preHireDossiers`),
    where("employmentOfferId", "==", offer.offerId)
  );
  const snap = await getDocs(dossierQuery);

  if (!snap.empty) {
    return snap.docs[0].id;
  }

  const dossierRef = doc(collection(db, `entities/${entityId}/preHireDossiers`));
  const dossierId = dossierRef.id;

  const dossierData: PreHireDossier = {
    dossierId,
    entityId,
    personId: offer.personId,
    candidateId: offer.candidateId,
    employmentOfferId: offer.offerId,
    recruitmentNeedId: offer.recruitmentNeedId,
    status: "documents_required",
    readyForConversion: false,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  const batch = writeBatch(db);
  batch.set(dossierRef, dossierData);

  const defaultItems = [
    { type: "identity_document", label: "Carte d’identité", required: true },
    { type: "health_card", label: "Tessera sanitaria", required: true },
    { type: "hiring_request", label: "Richiesta assunzione", required: true },
  ];

  defaultItems.forEach((item) => {
    const itemRef = doc(collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`));
    const docData: PreHireDocument = {
      itemId: itemRef.id,
      type: item.type,
      label: item.label,
      status: "missing",
      isRequired: item.required,
      isCustom: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(itemRef, docData);
  });

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "preHireDossier.created",
    resourceType: "preHireDossier",
    resourceId: dossierId,
    details: { offerId: offer.offerId }
  });

  return dossierId;
}

/**
 * Adds a custom document requirement to the dossier checklist.
 */
export async function addCustomPreHireDocumentRequest(params: {
  entityId: string;
  dossierId: string;
  label: string;
  type: string;
  isRequired: boolean;
  description?: string;
  actorUid: string;
}) {
  const { entityId, dossierId, label, type, isRequired, description, actorUid } = params;
  if (!db) throw new Error("Firestore not initialized");

  // Duplicate prevention (case-insensitive)
  const checklistRef = collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`);
  const snap = await getDocs(checklistRef);
  const exists = snap.docs.some(d => d.data().label.toLowerCase().trim() === label.toLowerCase().trim());
  if (exists) throw new Error("Un document avec ce libellé est déjà présent dans la checklist.");

  const itemRef = doc(checklistRef);
  const docData: PreHireDocument = {
    itemId: itemRef.id,
    type: type || "other",
    label: label.trim(),
    description: description || undefined,
    status: "missing",
    isRequired,
    isCustom: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(itemRef, docData);
  await evaluateDossierReadiness(entityId, dossierId, actorUid);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "preHireDocument.custom_added",
    resourceType: "preHireDossier",
    resourceId: dossierId,
    details: { label: docData.label, isRequired }
  });

  return itemRef.id;
}

/**
 * Removes a custom document request from the checklist.
 * Allowed only if isCustom and no file uploaded.
 */
export async function deleteCustomPreHireDocumentRequest(entityId: string, dossierId: string, itemId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const itemRef = doc(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`, itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) return;
  const data = snap.data() as PreHireDocument;

  if (!data.isCustom) throw new Error("Seuls les documents personnalisés peuvent être supprimés.");
  if (data.fileId || data.status !== 'missing') throw new Error("Impossible de supprimer un document déjà reçu ou validé.");

  await deleteDoc(itemRef);
  await evaluateDossierReadiness(entityId, dossierId, actorUid);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "preHireDocument.custom_deleted",
    resourceType: "preHireDossier",
    resourceId: dossierId,
    details: { label: data.label }
  });
}

/**
 * Updates a specific document requirement status.
 */
export async function updateDocumentStatus(
  entityId: string, 
  dossierId: string, 
  itemId: string, 
  status: PreHireDocumentStatus, 
  actorUid: string,
  rejectionReason?: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const itemRef = doc(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`, itemId);
  await updateDoc(itemRef, {
    status,
    rejectionReason: rejectionReason || null,
    reviewedBy: actorUid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Re-evaluate dossier readiness
  await evaluateDossierReadiness(entityId, dossierId, actorUid);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: `preHireDocument.${status}`,
    resourceType: "preHireDocument",
    resourceId: itemId,
    details: { dossierId, status }
  });
}

/**
 * Evaluates if all required documents are approved to mark dossier as ready for conversion.
 * Logic: only 'approved' or 'not_applicable' items allow readiness.
 */
async function evaluateDossierReadiness(entityId: string, dossierId: string, actorUid: string) {
  if (!db) return;
  const itemsSnap = await getDocs(collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`));
  const items = itemsSnap.docs.map(d => d.data() as PreHireDocument);

  const requiredItems = items.filter(i => i.isRequired);
  
  // A dossier is ready ONLY if all required items are either approved or not applicable
  const allRequiredApproved = requiredItems.length > 0 && requiredItems.every(i => 
    i.status === "approved" || i.status === "not_applicable"
  );

  const dossierRef = doc(db, `entities/${entityId}/preHireDossiers`, dossierId);
  const snap = await getDoc(dossierRef);
  if (!snap.exists()) return;
  const current = snap.data() as PreHireDossier;
  
  if (allRequiredApproved !== current.readyForConversion) {
    await updateDoc(dossierRef, {
      readyForConversion: allRequiredApproved,
      status: allRequiredApproved ? "ready_for_conversion" : "documents_required",
      ...(allRequiredApproved && { 
        documentsValidatedAt: serverTimestamp(), 
        documentsValidatedBy: actorUid 
      }),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    if (allRequiredApproved) {
      await createAuditLog({
        userId: actorUid,
        entityId,
        action: "preHireDossier.readyForConversion",
        resourceType: "preHireDossier",
        resourceId: dossierId,
      });
    }
  }
}

/**
 * Triggers the document request email to the candidate.
 */
export async function sendDocumentRequestEmail(entityId: string, dossierId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const dossierSnap = await getDoc(doc(db, `entities/${entityId}/preHireDossiers`, dossierId));
  if (!dossierSnap.exists()) throw new Error("Dossier introuvable.");
  const dossier = dossierSnap.data() as PreHireDossier;

  const offerSnap = await getDoc(doc(db, `entities/${entityId}/employmentOffers`, dossier.employmentOfferId));
  if (!offerSnap.exists()) throw new Error("Proposition introuvable.");
  const offer = offerSnap.data() as EmploymentOffer;

  const itemsSnap = await getDocs(collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`));
  const items = itemsSnap.docs.map(d => d.data() as PreHireDocument).filter(i => i.isRequired && i.status !== "not_required" && i.status !== "approved" && i.status !== "not_applicable");

  const result = await sendDocumentRequestEmailAction({
    entityId,
    to: offer.candidateEmail,
    candidateName: offer.candidateDisplayName,
    companyName: offer.entityName || "L'azienda",
    jobTitle: offer.jobTitleName,
    requiredDocuments: items.map(i => i.label),
    contactEmail: "hr@nexus-studio.com" // Placeholder
  });

  if (result.success) {
    await updateDoc(doc(db, `entities/${entityId}/preHireDossiers`, dossierId), {
      status: "document_request_sent",
      documentRequestSentAt: serverTimestamp(),
      documentRequestSentBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "preHireDocument.requestSent",
      resourceType: "preHireDossier",
      resourceId: dossierId,
    });
  }

  return result;
}
