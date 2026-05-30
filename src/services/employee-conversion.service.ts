'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { Contract } from "@/types/contract";
import { Employee } from "@/types/employee";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { PreHireDossier } from "@/types/pre-hire-dossier";

function normalizeName(name: string): string {
  if (!name) return "";
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 7K-E Conversion logic reinforced with 7K-F Compliance Check.
 */
export async function convertOfferToEmployeeAction(params: {
  entityId: string;
  offerId: string;
  actorUid: string;
}): Promise<{ success: true; employeeId: string } | { success: false; error: string }> {
  const { entityId, offerId, actorUid } = params;

  try {
    return await adminDb.runTransaction(async (transaction) => {
      // --- PHASE 1: READS ---
      const membershipId = `${actorUid}_${entityId}`;
      const mSnap = await transaction.get(adminDb.collection("memberships").doc(membershipId));
      const offerSnap = await transaction.get(adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId));

      if (!mSnap.exists || mSnap.data()?.status !== 'active') throw new Error("Accès refusé.");
      if (!offerSnap.exists) throw new Error("Proposition introuvable.");

      const offer = offerSnap.data() as EmploymentOffer;

      // 7K-F Compliance Guard: Check for Pre-Hire Dossier status
      const dossiersSnap = await transaction.get(
        adminDb.collection("entities").doc(entityId).collection("preHireDossiers").where("employmentOfferId", "==", offerId).limit(1)
      );
      
      if (dossiersSnap.empty) {
        throw new Error("COMPLIANCE_PENDING: Le dossier d'embauche n'a pas été initialisé.");
      }
      
      const dossier = dossiersSnap.docs[0].data() as PreHireDossier;
      if (!dossier.readyForConversion) {
        throw new Error("COMPLIANCE_PENDING: Les documents obligatoires ne sont pas encore validés. Finalisez le dossier d’embauche avant de créer l’employé.");
      }

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const needRef = offer.recruitmentNeedId ? adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(offer.recruitmentNeedId) : null;

      const [candidateSnap, personSnap, needSnap] = await Promise.all([
        transaction.get(candidateRef),
        transaction.get(personRef),
        needRef ? transaction.get(needRef) : Promise.resolve(null)
      ]);

      // --- PHASE 2: VALIDATIONS ---
      const permissions = mSnap.data()?.permissions || [];
      if (!permissions.includes("employees.create") || !permissions.includes("contracts.create")) throw new Error("Permissions insuffisantes.");

      if (offer.conversionStatus === "converted") throw new Error("Déjà converti.");

      const person = personSnap.data() as Person;
      if (normalizeName(offer.candidateDisplayName) !== normalizeName(person.displayName)) throw new Error("IDENTITY_MISMATCH");

      // --- PHASE 3: WRITES ---
      const employeeId = adminDb.collection("entities").doc(entityId).collection("employees").doc().id;
      const contractId = adminDb.collection("entities").doc(entityId).collection("contracts").doc().id;
      const employeeCode = `E-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const birthDateStr = person.dateOfBirth || (person as any).birthDate || "";

      transaction.set(adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId), {
        employeeId, personId: person.personId, entityId, sourceOfferId: offerId, employeeCode,
        firstName: person.firstName, lastName: person.lastName, displayName: person.displayName,
        email: person.email, phone: person.phone || "", birthDate: birthDateStr, taxCode: person.codiceFiscale || "",
        hireDate: offer.proposedStartDate, departmentId: offer.departmentId || "", departmentName: offer.departmentName || "",
        jobTitle: offer.jobTitleName, worksiteName: offer.worksiteName || "", status: "active",
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      });

      transaction.set(adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId), {
        contractId, entityId, personId: person.personId, employeeId, sourceOfferId: offerId,
        contractType: offer.contractType, startDate: offer.proposedStartDate, weeklyHours: offer.weeklyHours,
        ccnlName: offer.ccnlName, levelCode: offer.levelCode, grossMonthly: offer.proposedGrossMonthly || 0,
        status: "active", createdAt: FieldValue.serverTimestamp(), createdBy: actorUid
      });

      transaction.update(offerSnap.ref, { conversionStatus: "converted", employeeId, contractId, updatedAt: FieldValue.serverTimestamp() });
      
      // Update Dossier Status
      transaction.update(dossiersSnap.docs[0].ref, {
        status: "converted_to_employee",
        employeeId,
        contractId,
        convertedAt: FieldValue.serverTimestamp(),
        convertedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp()
      });

      if (needRef && needSnap?.exists) {
        const need = needSnap.data() as RecruitmentNeed;
        const newFulfilled = (need.fulfilledHeadcount || 0) + 1;
        transaction.update(needRef, { 
          fulfilledHeadcount: newFulfilled, 
          remainingHeadcount: Math.max(0, need.requestedHeadcount - newFulfilled),
          status: newFulfilled >= need.requestedHeadcount ? "fulfilled" : "partially_fulfilled",
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      return { success: true, employeeId };
    });
  } catch (err: any) {
    console.error("[Conversion Error]", err);
    return { success: false, error: err.message };
  }
}
