
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
  DocumentReference
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
    { type: "id_card", label: "Documento d’identità (Fronte/Retro)", required: true },
    { type: "tax_code", label: "Codice fiscale / Tessera sanitaria", required: true },
    { type: "iban", label: "Coordinate bancarie (IBAN)", required: true },
    { type: "residence", label: "Certificato di residenza o autocertificazione", required: true },
  ];

  defaultItems.forEach((item, i) => {
    const itemRef = doc(collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`));
    const docData: PreHireDocument = {
      itemId: itemRef.id,
      type: item.type,
      label: item.label,
      status: "missing",
      isRequired: item.required,
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
 */
async function evaluateDossierReadiness(entityId: string, dossierId: string, actorUid: string) {
  if (!db) return;
  const itemsSnap = await getDocs(collection(db, `entities/${entityId}/preHireDossiers/${dossierId}/checklist`));
  const items = itemsSnap.docs.map(d => d.data() as PreHireDocument);

  const allRequiredApproved = items
    .filter(i => i.isRequired)
    .every(i => i.status === "approved");

  const dossierRef = doc(db, `entities/${entityId}/preHireDossiers`, dossierId);
  
  if (allRequiredApproved) {
    await updateDoc(dossierRef, {
      status: "ready_for_conversion",
      readyForConversion: true,
      documentsValidatedAt: serverTimestamp(),
      documentsValidatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "preHireDossier.readyForConversion",
      resourceType: "preHireDossier",
      resourceId: dossierId,
    });
  } else {
    // If it was ready but now a doc is rejected or marked missing
    await updateDoc(dossierRef, {
      readyForConversion: false,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
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
  const items = itemsSnap.docs.map(d => d.data() as PreHireDocument).filter(i => i.isRequired);

  const result = await sendDocumentRequestEmailAction({
    to: offer.candidateEmail,
    candidateName: offer.candidateDisplayName,
    companyName: offer.entityName || "L'azienda",
    jobTitle: offer.jobTitleName,
    requiredDocuments: items.map(i => i.label),
    contactEmail: "hr@nexus-studio.com" // Placeholder for entity contact
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
