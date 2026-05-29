'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { Contract } from "@/types/contract";
import { Employee } from "@/types/employee";
import { RecruitmentNeed } from "@/types/recruitment-need";

/**
 * Normalizes a name for strict comparison (lowercase, no accents, collapsed spaces).
 */
function normalizeName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\s+/g, " ") // collapse multiple spaces
    .trim();
}

/**
 * 7K-E Server Action: Converts an accepted offer into Employee + Contract.
 * Atomic transaction to ensure recruitment lifecycle terminal consistency.
 * Reinforced with server-side membership and permission checks.
 * Updated to synchronize source Recruitment Need progress.
 */
export async function convertOfferToEmployeeAction(params: {
  entityId: string;
  offerId: string;
  actorUid: string;
}) {
  const { entityId, offerId, actorUid } = params;

  try {
    return await adminDb.runTransaction(async (transaction) => {
      // 0. Server-side Security & Permission Check
      const membershipId = `${actorUid}_${entityId}`;
      const mRef = adminDb.collection("memberships").doc(membershipId);
      const mSnap = await transaction.get(mRef);
      
      if (!mSnap.exists || mSnap.data()?.status !== 'active') {
        throw new Error("Accès refusé: Aucun membership actif trouvé.");
      }

      const permissions = mSnap.data()?.permissions || [];
      if (!permissions.includes("employees.create") || !permissions.includes("contracts.create")) {
        throw new Error("Accès refusé: Permissions insuffisantes pour créer un employé ou un contrat.");
      }

      // 1. Fetch Context
      const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
      const offerSnap = await transaction.get(offerRef);
      if (!offerSnap.exists) throw new Error("Proposition introuvable.");
      const offer = offerSnap.data() as EmploymentOffer;

      // Cross-tenant protection
      if (offer.entityId !== entityId) {
        throw new Error("Incohérence d'entité : tentative de conversion inter-tenant bloquée.");
      }

      if (offer.status !== "accepted") throw new Error("La proposition doit être acceptée pour être convertie.");
      if (offer.conversionStatus === "converted" || offer.employeeId) throw new Error("Cette proposition a déjà été convertie.");

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const candidateSnap = await transaction.get(candidateRef);
      if (!candidateSnap.exists) throw new Error("Candidat introuvable.");
      const candidate = candidateSnap.data() as Candidate;

      if (candidate.status === "hired") throw new Error("Le candidat est déjà marqué comme embauché.");

      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const personSnap = await transaction.get(personRef);
      if (!personSnap.exists) throw new Error("Fiche identité introuvable.");
      const person = personSnap.data() as Person;

      // 1b. Identity Consistency Validation (7K-E Identity Guard)
      const normOfferName = normalizeName(offer.candidateDisplayName);
      const normPersonName = normalizeName(person.displayName);
      const normCandidateName = normalizeName(candidate.displayName);

      if (normOfferName !== normPersonName || normCandidateName !== normPersonName) {
        throw new Error(`IDENTITY_MISMATCH: Incohérence d'identité détectée. La proposition acceptée (${offer.candidateDisplayName}) ne correspond pas à la fiche personne liée (${person.displayName}). Veuillez corriger la fiche personne avant de finaliser l'embauche.`);
      }

      // 2. Business Validation
      const isFixedTerm = ["tempo determinato", "cdd", "fixed term", "fixed_term"].includes((offer.contractType || "").toLowerCase());
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
        sourceOfferId: offerId,
        employeeCode,
        firstName: person.firstName,
        lastName: person.lastName,
        displayName: person.displayName,
        taxCode: person.codiceFiscale || "",
        email: person.email,
        phone: person.phone || "",
        birthDate: person.dateOfBirth || "",
        hireDate: offer.proposedStartDate,
        departmentId: offer.departmentId || "",
        departmentName: offer.departmentName || "",
        jobRoleId: offer.jobProfileId || "",
        jobTitle: offer.jobTitleName,
        mainWorksiteId: offer.worksiteId || "",
        worksiteName: offer.worksiteName || "",
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

      // 6. Create EmployeeView (Read Model for optimized lists)
      const viewRef = adminDb.collection("entities").doc(entityId).collection("employeeViews").doc(employeeId);
      transaction.set(viewRef, {
        employeeId,
        employeeCode,
        displayName: person.displayName,
        jobTitle: offer.jobTitleName,
        departmentName: offer.departmentName || "",
        worksiteName: offer.worksiteName || "",
        hireDate: offer.proposedStartDate,
        status: "active",
        updatedAt: FieldValue.serverTimestamp()
      });

      // 7. Update Offer
      transaction.update(offerRef, {
        conversionStatus: "converted",
        employeeId,
        contractId,
        convertedAt: FieldValue.serverTimestamp(),
        convertedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 8. Update Candidate (Terminal status)
      transaction.update(candidateRef, {
        status: "hired",
        employeeId,
        hiredAt: FieldValue.serverTimestamp(),
        hiredBy: actorUid,
        sourceOfferId: offerId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 9. Update Person Lifecycle
      transaction.update(personRef, {
        currentLifecycleStatus: "employee",
        currentEmployeeId: employeeId,
        activeContractId: contractId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 10. Update Interview if exists
      if (offer.interviewId) {
        const intRef = adminDb.collection("entities").doc(entityId).collection("interviews").doc(offer.interviewId);
        transaction.update(intRef, {
          hiredEmployeeId: employeeId,
          sourceOfferId: offerId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
        });
      }

      // 11. Update Recruitment Need Progress (Besoin RH)
      if (offer.recruitmentNeedId) {
        const needRef = adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(offer.recruitmentNeedId);
        const needSnap = await transaction.get(needRef);
        if (needSnap.exists) {
          const need = needSnap.data() as RecruitmentNeed;
          const newFulfilled = (need.fulfilledHeadcount || 0) + 1;
          const newRemaining = Math.max(0, (need.requestedHeadcount || 1) - newFulfilled);
          
          let newStatus = need.status;
          // Status auto-transition logic based on progress
          if (!["cancelled", "archived"].includes(need.status)) {
            if (newRemaining <= 0) {
              newStatus = "fulfilled";
            } else if (newFulfilled > 0) {
              newStatus = "partially_fulfilled";
            }
          }

          transaction.update(needRef, {
            fulfilledHeadcount: newFulfilled,
            remainingHeadcount: newRemaining,
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid
          });

          // Audit for the specific need update
          const needAuditRef = adminDb.collection("auditLogs").doc();
          transaction.set(needAuditRef, {
            userId: actorUid,
            entityId,
            action: "recruitmentNeed.fulfillment_increment",
            resourceType: "recruitmentNeed",
            resourceId: offer.recruitmentNeedId,
            details: { employeeId, offerId, previousFulfilled: need.fulfilledHeadcount, newFulfilled },
            timestamp: FieldValue.serverTimestamp()
          });
        }
      }

      // 12. Timeline Events
      const timelineColl = adminDb.collection("entities").doc(entityId).collection("personTimeline");
      
      const t1 = timelineColl.doc();
      transaction.set(t1, {
        eventId: t1.id,
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

      const t2 = timelineColl.doc();
      transaction.set(t2, {
        eventId: t2.id,
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

      // 13. Main Audit Log
      const auditRef = adminDb.collection("auditLogs").doc();
      transaction.set(auditRef, {
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
