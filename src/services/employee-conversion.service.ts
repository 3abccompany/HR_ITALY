'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Person } from "@/types/person";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { PreHireDossier } from "@/types/pre-hire-dossier";

/**
 * Normalization helper for identity identifier (Phase 6B).
 */
function getIdentifier(source: any): string | null {
  if (!source) return null;
  const val = source.codiceFiscale || source.taxCode || source.fiscalCode || source.codeFiscal || source.nationalId || source.fiscalId;
  return typeof val === 'string' ? val.trim().toUpperCase() : null;
}

/**
 * Converts an employment offer to a formal employee record and a draft contract.
 * Automatically synchronizes candidate and person lifecycle documents.
 * Returns the created employeeId.
 * Phase 6B: Hardened identity identifier (taxCode/codiceFiscale) synchronization.
 */
export async function convertOfferToEmployeeAction(params: {
  entityId: string;
  offerId: string;
  actorUid: string;
}): Promise<{ success: true; employeeId: string } | { success: false; error: string }> {
  const { entityId, offerId, actorUid } = params;

  try {
    // --- 1. PRE-CHECK FOR DUPLICATES ---
    const offerDoc = await adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId).get();
    if (!offerDoc.exists) throw new Error("Proposition introuvable.");
    const offerData = offerDoc.data() as EmploymentOffer;

    const personDoc = await adminDb.collection("entities").doc(entityId).collection("persons").doc(offerData.personId).get();
    if (!personDoc.exists) throw new Error("Fiche identité introuvable.");
    const person = personDoc.data() as Person;

    if (offerData.conversionStatus !== 'converted' && !offerData.employeeId) {
      const employeesRef = adminDb.collection("entities").doc(entityId).collection("employees");

      const [byPerson, byTax, byEmail] = await Promise.all([
        employeesRef.where("personId", "==", offerData.personId).where("status", "==", "active").limit(1).get(),
        person.codiceFiscale ? employeesRef.where("taxCode", "==", person.codiceFiscale).where("status", "==", "active").limit(1).get() : Promise.resolve(null),
        person.email ? employeesRef.where("email", "==", person.email.toLowerCase().trim()).where("status", "==", "active").limit(1).get() : Promise.resolve(null)
      ]);

      const hasMatch = !byPerson.empty || (byTax && !byTax.empty) || (byEmail && !byEmail.empty);

      if (hasMatch) {
        return { 
          success: false, 
          error: "Cette personne est déjà employée active. Utilisez une mutation ou une affectation au lieu d'une nouvelle conversion." 
        };
      }
    }

    // --- 1.5. PRE-FETCH DOCUMENTS TO BACKFILL ---
    const docsRef = adminDb.collection("entities").doc(entityId).collection("documents");
    const [docsByPerson, docsByCand] = await Promise.all([
      docsRef.where("personId", "==", offerData.personId).get(),
      offerData.candidateId ? docsRef.where("candidateId", "==", offerData.candidateId).get() : Promise.resolve(null)
    ]);

    return await adminDb.runTransaction(async (transaction) => {
      // --- PHASE 1: READS ---
      
      const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
      const offerSnap = await transaction.get(offerRef);
      const offer = offerSnap.data() as EmploymentOffer;

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const entityRef = adminDb.collection("entities").doc(entityId);
      const mSnap = await transaction.get(adminDb.collection("memberships").doc(`${actorUid}_${entityId}`));

      // UniLav/CPI Linkage
      const requestId = `unilav_${offerId}`;
      const requestRef = adminDb.collection("entities").doc(entityId).collection("employmentRequests").doc(requestId);
      const requestSnap = await transaction.get(requestRef);

      const needRef = offer.recruitmentNeedId 
        ? adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(offer.recruitmentNeedId)
        : null;

      const [candidateSnap, personSnap, entitySnap, needSnap] = await Promise.all([
        transaction.get(candidateRef),
        transaction.get(personRef),
        transaction.get(entityRef),
        needRef ? transaction.get(needRef) : Promise.resolve(null)
      ]);

      const dossierQuery = adminDb.collection("entities").doc(entityId).collection("preHireDossiers").where("employmentOfferId", "==", offerId).limit(1);
      const dossiersSnap = await transaction.get(dossierQuery);

      const commsQuery = adminDb.collection("entities").doc(entityId).collection("mandatoryCommunications")
        .where("employmentOfferId", "==", offerId)
        .where("type", "==", "UNILAV_ASSUNZIONE")
        .limit(1);
      const commsSnap = await transaction.get(commsQuery);

      // --- PHASE 2: VALIDATIONS ---

      if (!mSnap.exists || mSnap.data()?.status !== 'active') throw new Error("Accès refusé.");
      const personData = personSnap.data() as Person;
      const entity = entitySnap.data();

      let employeeId = offer.employeeId || personData.currentEmployeeId;
      let contractId = offer.contractId;
      const isNewEmployee = !employeeId;

      if (!employeeId) employeeId = adminDb.collection("entities").doc(entityId).collection("employees").doc().id;
      if (!contractId) contractId = adminDb.collection("entities").doc(entityId).collection("contracts").doc().id;

      // --- PHASE 6B: Resolve Canonical Identifier ---
      const resolvedTaxCode = getIdentifier(personData) || getIdentifier(offer) || getIdentifier(candidateSnap.data()) || null;

      // --- PHASE 3: WRITES ---

      if (isNewEmployee) {
        transaction.set(adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId), {
          employeeId, 
          personId: personData.personId, 
          entityId, 
          sourceOfferId: offerId, 
          employeeCode: personData.codiceFiscale ? `E-${personData.codiceFiscale.substring(0, 6)}` : `E-${Date.now().toString().slice(-6)}`,
          firstName: personData.firstName, 
          lastName: personData.lastName, 
          displayName: personData.displayName,
          email: personData.email, 
          phone: personData.phone || "", 
          birthDate: personData.dateOfBirth || (personData as any).birthDate || "",
          taxCode: resolvedTaxCode || "", 
          hireDate: offer.proposedStartDate, 
          departmentId: offer.departmentId || "", 
          departmentName: offer.departmentName || "",
          jobTitle: offer.jobTitleName, 
          worksiteName: offer.worksiteName || "", 
          status: "active",
          pendingContractId: contractId,
          createdAt: FieldValue.serverTimestamp(), 
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      // Create Draft Contract
      transaction.set(adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId), {
          contractId, 
          entityId, 
          personId: personData.personId, 
          employeeId, 
          sourceOfferId: offerId,
          employeeDisplayName: personData.displayName,
          taxCode: resolvedTaxCode || "",
          jobTitleName: offer.jobTitleName,
          departmentName: offer.departmentName || "",
          worksiteName: offer.worksiteName || "",
          contractType: offer.contractType,
          startDate: offer.proposedStartDate,
          endDate: offer.proposedEndDate || null,
          weeklyHours: offer.weeklyHours,
          ccnlName: offer.ccnlName,
          levelCode: offer.levelCode,
          grossMonthly: offer.proposedGrossMonthly || 0,
          grossAnnual: offer.proposedGrossAnnual || 0,
          status: "draft",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
      });

      // Synchronize Lifecycle
      transaction.update(candidateRef, { status: "hired", employeeId, updatedAt: FieldValue.serverTimestamp() });
      
      const personUpdate: any = { 
        currentLifecycleStatus: "employee", 
        currentEmployeeId: employeeId, 
        currentCandidateId: null, 
        updatedAt: FieldValue.serverTimestamp() 
      };
      if (resolvedTaxCode) {
        personUpdate.codiceFiscale = resolvedTaxCode;
      }
      transaction.update(personRef, personUpdate);
      
      transaction.update(offerRef, { conversionStatus: "converted", employeeId, contractId, updatedAt: FieldValue.serverTimestamp() });
      
      if (!dossiersSnap.empty) transaction.update(dossiersSnap.docs[0].ref, { status: "converted_to_employee", employeeId, contractId, updatedAt: FieldValue.serverTimestamp() });
      if (requestSnap.exists) transaction.update(requestRef, { employeeId, updatedAt: FieldValue.serverTimestamp() });

      // Backfill Registry Documents
      const allDocsToFix = [...docsByPerson.docs];
      if (docsByCand) allDocsToFix.push(...docsByCand.docs);
      
      const uniqueDocs = new Map(allDocsToFix.map(doc => [doc.id, doc]));
      uniqueDocs.forEach(docSnap => {
        if (!docSnap.data().employeeId) {
          transaction.update(docSnap.ref, {
            employeeId,
            employeeDisplayName: personData.displayName,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid
          });
        }
      });

      return { success: true, employeeId };
    });
  } catch (err: any) {
    return { success: false, error: err.message || "Erreur de conversion." };
  }
}