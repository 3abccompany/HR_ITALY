'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Person } from "@/types/person";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { PreHireDossier } from "@/types/pre-hire-dossier";

/**
 * Converts an employment offer to a formal employee record and a draft contract.
 * Automatically synchronizes candidate and person lifecycle documents.
 * Returns the created employeeId.
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
      const offerRef = adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId);
      const offerSnap = await transaction.get(offerRef);
      if (!offerSnap.exists) throw new Error("Proposition introuvable.");
      const offer = offerSnap.data() as EmploymentOffer;

      // Identity Guard: Ensure candidate and person IDs are present for sync
      if (!offer.candidateId) throw new Error("CANDIDATE_ID_MISSING: Le dossier ne contient pas d'identifiant candidat.");
      if (!offer.personId) throw new Error("PERSON_ID_MISSING: Le dossier ne contient pas d'identifiant personne.");

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const entityRef = adminDb.collection("entities").doc(entityId);
      const membershipId = `${actorUid}_${entityId}`;
      const membershipRef = adminDb.collection("memberships").doc(membershipId);

      const [candidateSnap, personSnap, entitySnap, mSnap] = await Promise.all([
        transaction.get(candidateRef),
        transaction.get(personRef),
        transaction.get(entityRef),
        transaction.get(membershipRef)
      ]);

      if (!mSnap.exists || mSnap.data()?.status !== 'active') throw new Error("Accès refusé: Membership inactif.");
      if (!candidateSnap.exists) throw new Error("Dossier candidat introuvable.");
      if (!personSnap.exists) throw new Error("Fiche identité introuvable.");

      const person = personSnap.data() as Person;
      const entity = entitySnap.data();

      // Permissions check
      const permissions = mSnap.data()?.permissions || [];
      if (!permissions.includes("employees.create") || !permissions.includes("contracts.create")) throw new Error("Permissions insuffisantes.");

      // Compliance Gate check
      const dossierQuery = adminDb.collection("entities").doc(entityId).collection("preHireDossiers").where("employmentOfferId", "==", offerId).limit(1);
      const dossiersSnap = await transaction.get(dossierQuery);
      if (dossiersSnap.empty) throw new Error("Dossier d'embauche non initialisé.");
      const dossier = dossiersSnap.docs[0].data() as PreHireDossier;
      if (!dossier.readyForConversion) throw new Error("CONVERSION_BLOCKED: Documents candidats non validés.");

      // Mandatory Communication check (UniLav)
      const commsSnap = await transaction.get(
        adminDb.collection("entities").doc(entityId).collection("mandatoryCommunications")
          .where("employmentOfferId", "==", offerId)
          .where("type", "==", "UNILAV_ASSUNZIONE")
          .limit(1)
      );
      const communication = commsSnap.empty ? null : commsSnap.docs[0].data();
      const isUniLavDone = communication?.status === 'receipt_received' || communication?.status === 'completed' || communication?.testMode === true;
      if (!isUniLavDone) throw new Error("CONVERSION_BLOCKED: Protocole UniLav obligatoire non enregistré.");

      // --- PHASE 2: IDEMPOTENCY / REPAIR LOGIC ---
      const isAlreadyConverted = offer.conversionStatus === "converted";
      let employeeId = offer.employeeId || person.currentEmployeeId;
      let contractId = offer.contractId;

      const isNewEmployee = !employeeId;
      const isNewContract = !contractId;

      if (!employeeId) {
        const newEmpRef = adminDb.collection("entities").doc(entityId).collection("employees").doc();
        employeeId = newEmpRef.id;
      }
      if (!contractId) {
        const newContractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc();
        contractId = newContractRef.id;
      }

      // --- PHASE 3: WRITES ---

      // A. Create Employee record
      if (isNewEmployee) {
        const employeeCode = person.codiceFiscale 
          ? `E-${person.codiceFiscale.substring(0, 6)}` 
          : `E-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

        transaction.set(adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId), {
          employeeId, 
          personId: person.personId, 
          entityId, 
          sourceOfferId: offerId, 
          employeeCode,
          firstName: person.firstName, 
          lastName: person.lastName, 
          displayName: person.displayName,
          email: person.email, 
          phone: person.phone || "", 
          birthDate: person.dateOfBirth || (person as any).birthDate || "",
          taxCode: person.codiceFiscale || "", 
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

      // B. Create Draft Contract
      if (isNewContract) {
        const companyAddress = entity ? `${entity.adresseSiegeSocial || ""}, ${entity.codePostal || ""} ${entity.ville || ""} (${entity.province || ""})` : "";
        const employeeAddress = person ? `${person.address || ""}, ${person.postalCode || ""} ${person.city || ""} (${person.province || ""})` : "";

        transaction.set(adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId), {
          contractId, 
          entityId, 
          personId: person.personId, 
          employeeId, 
          sourceOfferId: offerId,
          employeeDisplayName: person.displayName,
          employeeCode: isNewEmployee ? `E-...` : null, // Will be patched by system if needed
          taxCode: person.codiceFiscale || "",
          employeeAddressSnapshot: employeeAddress,
          dateOfBirth: person.dateOfBirth || (person as any).birthDate || "",
          placeOfBirth: person.placeOfBirth || "",
          entityName: entity?.nomEntreprise || "",
          entityLegalName: entity?.raisonSociale || "",
          entityVatNumber: entity?.numeroTVA || "",
          companyAddressSnapshot: companyAddress,
          legalRepresentativeName: entity?.referentEntreprise || "",
          jobTitleName: offer.jobTitleName,
          departmentName: offer.departmentName || "",
          worksiteName: offer.worksiteName || "",
          contractType: offer.contractType,
          startDate: offer.proposedStartDate,
          endDate: offer.proposedEndDate || null,
          weeklyHours: offer.weeklyHours,
          trialPeriodDays: offer.trialPeriodDays || 30,
          isPartTime: offer.workingTime?.toLowerCase().includes("part"),
          ccnlName: offer.ccnlName,
          levelCode: offer.levelCode,
          levelLabel: offer.levelLabel,
          grossMonthly: offer.proposedGrossMonthly || 0,
          grossAnnual: offer.proposedGrossAnnual || 0,
          monthlyPayments: offer.monthlyPayments || 13,
          uniLavProtocolNumber: communication?.protocolNumber || "",
          uniLavSubmissionDate: communication?.submittedAt ? 
            (typeof (communication.submittedAt as any).toDate === 'function' ? (communication.submittedAt as any).toDate().toISOString().split('T')[0] : 
            (communication.submittedAt.seconds ? new Date(communication.submittedAt.seconds * 1000).toISOString().split('T')[0] : "")) : "",
          status: "draft",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
        });
      }

      // C. AUTOMATIC LIFECYCLE SYNCHRONIZATION
      
      // Update Candidate to HIRED status
      transaction.update(candidateRef, {
        status: "hired",
        employeeId,
        hiredAt: candidateSnap.data()?.hiredAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // Update Person to EMPLOYEE lifecycle
      transaction.update(personRef, {
        currentLifecycleStatus: "employee",
        currentEmployeeId: employeeId,
        currentCandidateId: null, // Candidate process finished
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // Mark Offer as CONVERTED
      transaction.update(offerSnap.ref, {
        conversionStatus: "converted",
        employeeId,
        contractId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // Mark Dossier as COMPLETED
      transaction.update(dossiersSnap.docs[0].ref, {
        status: "converted_to_employee",
        employeeId,
        contractId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // D. Update Read Models (Views)
      const candidateViewRef = adminDb.collection("entities").doc(entityId).collection("candidateViews").doc(offer.candidateId);
      transaction.set(candidateViewRef, {
        status: "hired",
        employeeId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      }, { merge: true });

      const employeeViewRef = adminDb.collection("entities").doc(entityId).collection("employeeViews").doc(employeeId);
      transaction.set(employeeViewRef, {
        id: employeeId,
        employeeId,
        displayName: person.displayName,
        status: "active",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // E. Recruitment Need Progression (Headcount Protection)
      if (offer.recruitmentNeedId && !isAlreadyConverted) {
        const needRef = adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(offer.recruitmentNeedId);
        const needSnap = await transaction.get(needRef);
        if (needSnap.exists) {
          const need = needSnap.data() as RecruitmentNeed;
          const newFulfilled = (need.fulfilledHeadcount || 0) + 1;
          transaction.update(needRef, {
            fulfilledHeadcount: newFulfilled,
            remainingHeadcount: Math.max(0, need.requestedHeadcount - newFulfilled),
            status: newFulfilled >= need.requestedHeadcount ? "fulfilled" : "partially_fulfilled",
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      }

      // F. Timeline Event
      const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();
      transaction.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId: person.personId,
        type: "employee.created",
        label: isAlreadyConverted ? "Synchronisation Lifecycle" : "Embauche finalisée",
        description: isAlreadyConverted ? "Données de candidature synchronisées avec le profil employé." : `Candidat embauché. EmployeeId: ${employeeId}`,
        sourceCollection: "employees",
        sourceId: employeeId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });

      return { success: true, employeeId };
    });
  } catch (err: any) {
    console.error("[Conversion Error]", err);
    return { success: false, error: err.message || "Erreur lors de la conversion en employé." };
  }
}
