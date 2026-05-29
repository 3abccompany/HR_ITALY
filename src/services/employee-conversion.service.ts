'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { Contract } from "@/types/contract";
import { Employee } from "@/types/employee";

/**
 * 7K-E Server Action: Converts an accepted offer into Employee + Contract.
 * Atomic transaction to ensure recruitment lifecycle terminal consistency.
 */
export async function convertOfferToEmployeeAction(params: {
  entityId: string;
  offerId: string;
  actorUid: string;
}) {
  const { entityId, offerId, actorUid } = params;

  try {
    return await adminDb.runTransaction(async (transaction) => {
      // 1. Fetch Context
      const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
      const offerSnap = await transaction.get(offerRef);
      if (!offerSnap.exists) throw new Error("Proposition introuvable.");
      const offer = offerSnap.data() as EmploymentOffer;

      if (offer.status !== "accepted") throw new Error("La proposition doit être acceptée pour être convertie.");
      if (offer.conversionStatus === "converted" || offer.employeeId) throw new Error("Cette proposition a déjà été convertie.");

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const candidateSnap = await transaction.get(candidateRef);
      if (!candidateSnap.exists) throw new Error("Candidat introuvable.");
      const candidate = candidateSnap.data() as Candidate;

      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const personSnap = await transaction.get(personRef);
      if (!personSnap.exists) throw new Error("Fiche identité introuvable.");
      const person = personSnap.data() as Person;

      // 2. Business Validation
      const isFixedTerm = ["tempo determinato", "cdd", "fixed term"].includes(offer.contractType.toLowerCase());
      if (isFixedTerm && !offer.proposedEndDate) {
        throw new Error("La date de fin est obligatoire pour un contrat à durée déterminée.");
      }

      // 3. Prepare IDs and Codes
      const employeeId = adminDb.collection("entities").doc(entityId).collection("employees").doc().id;
      const contractId = adminDb.collection("entities").doc(entityId).collection("contracts").doc().id;
      const employeeCode = `E-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // 4. Create Employee
      const employeeData: Employee = {
        employeeId,
        personId: person.personId,
        entityId,
        sourceCandidateId: offer.candidateId,
        sourceInterviewId: offer.interviewId || null,
        employeeCode,
        firstName: person.firstName,
        lastName: person.lastName,
        displayName: person.displayName,
        taxCode: person.codiceFiscale,
        birthDate: person.dateOfBirth || "",
        hireDate: offer.proposedStartDate,
        departmentId: offer.departmentId || "",
        jobRoleId: offer.jobProfileId || "",
        jobTitle: offer.jobTitleName,
        mainWorksiteId: offer.worksiteId || "",
        operationalWorksiteIds: [],
        activeContractId: contractId,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      } as any;

      transaction.set(adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId), employeeData);

      // 5. Create Initial Contract
      const contractData: Contract = {
        contractId,
        entityId,
        personId: person.personId,
        employeeId,
        sourceOfferId: offerId,
        contractType: offer.contractType,
        startDate: offer.proposedStartDate,
        endDate: offer.proposedEndDate || null,
        weeklyHours: offer.weeklyHours,
        ccnlId: offer.ccnlId || null,
        ccnlName: offer.ccnlName || null,
        levelId: offer.levelId || null,
        levelCode: offer.levelCode || null,
        levelLabel: offer.levelLabel || null,
        grossMonthly: offer.proposedGrossMonthly || 0,
        grossAnnual: offer.proposedGrossAnnual || 0,
        monthlyPayments: offer.monthlyPayments || 13,
        status: "active",
        signedDocumentId: null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      } as any;

      transaction.set(adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId), contractData);

      // 6. Update Offer
      transaction.update(offerRef, {
        conversionStatus: "converted",
        employeeId,
        contractId,
        convertedAt: FieldValue.serverTimestamp(),
        convertedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 7. Update Candidate (Terminal status)
      transaction.update(candidateRef, {
        status: "hired",
        employeeId,
        hiredAt: FieldValue.serverTimestamp(),
        hiredBy: actorUid,
        sourceOfferId: offerId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 8. Update Person Lifecycle
      transaction.update(personRef, {
        currentLifecycleStatus: "employee",
        currentEmployeeId: employeeId,
        activeContractId: contractId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 9. Update Interview if exists
      if (offer.interviewId) {
        const intRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(offer.interviewId);
        transaction.update(intRef, {
          hiredEmployeeId: employeeId,
          sourceOfferId: offerId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
        });
      }

      // 10. Timeline Events
      const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline");
      
      transaction.set(timelineRef.doc(), {
        eventId: timelineRef.doc().id,
        entityId,
        personId: person.personId,
        type: "employee.created",
        label: "Embauche finalisée",
        description: `Création du profil employé ${employeeCode} suite à l'acceptation de l'offre.`,
        sourceCollection: "employmentOffers",
        sourceId: offerId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });

      transaction.set(timelineRef.doc(), {
        eventId: timelineRef.doc().id,
        entityId,
        personId: person.personId,
        type: "contract.created",
        label: "Contrat initial créé",
        description: `Contrat ${offer.contractType} généré automatiquement.`,
        sourceCollection: "contracts",
        sourceId: contractId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });

      // 11. Audit Logs
      const auditRef = adminDb.collection("auditLogs");
      transaction.set(auditRef.doc(), {
        userId: actorUid,
        entityId,
        action: "employmentOffer.converted",
        resourceType: "employmentOffer",
        resourceId: offerId,
        details: { employeeId, contractId },
        timestamp: FieldValue.serverTimestamp()
      });

      return { success: true, employeeId, contractId };
    });
  } catch (err: any) {
    console.error("[Offer Conversion Error]", err);
    return { success: false, error: err.message };
  }
}
