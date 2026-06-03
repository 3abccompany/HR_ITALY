'use server';

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { EmploymentOffer } from "@/types/employment-offer";
import { Person } from "@/types/person";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { PreHireDossier } from "@/types/pre-hire-dossier";

function normalizeName(name: string): string {
  if (!name) return "";
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Converts an employment offer to a formal employee record and a draft contract.
 * Captures legal snapshots of employer, employee, and compliance data.
 * Updated: Now robustly handles linking existing records to fix lifecycle inconsistencies.
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
      const entityRef = adminDb.collection("entities").doc(entityId);
      const mSnap = await transaction.get(adminDb.collection("memberships").doc(membershipId));
      const offerSnap = await transaction.get(adminDb.collection("entities").doc(entityId).collection("employmentOffers").doc(offerId));

      if (!mSnap.exists || mSnap.data()?.status !== 'active') throw new Error("Accès refusé.");
      if (!offerSnap.exists) throw new Error("Proposition introuvable.");

      const offer = offerSnap.data() as EmploymentOffer;

      // Identity Guard: Ensure candidate and person IDs are present
      if (!offer.candidateId) {
        console.error(`[Conversion Error] Offer ${offerId} is missing candidateId.`);
        throw new Error("CANDIDATE_ID_MISSING: Le dossier ne contient pas d'identifiant candidat.");
      }
      if (!offer.personId) {
        console.error(`[Conversion Error] Offer ${offerId} is missing personId.`);
        throw new Error("PERSON_ID_MISSING: Le dossier ne contient pas d'identifiant personne.");
      }

      // Compliance Guard
      const dossiersSnap = await transaction.get(
        adminDb.collection("entities").doc(entityId).collection("preHireDossiers").where("employmentOfferId", "==", offerId).limit(1)
      );
      
      if (dossiersSnap.empty) {
        throw new Error("COMPLIANCE_PENDING: Le dossier d'embauche n'a pas été initialisé.");
      }
      
      const dossier = dossiersSnap.docs[0].data() as PreHireDossier;
      if (!dossier.readyForConversion) {
        throw new Error("COMPLIANCE_PENDING: Les documents obligatoires ne sont pas encore validés.");
      }

      // Mandatory Communication (UniLav) Lookup
      const commsSnap = await transaction.get(
        adminDb.collection("entities").doc(entityId).collection("mandatoryCommunications")
          .where("employmentOfferId", "==", offerId)
          .where("type", "==", "UNILAV_ASSUNZIONE")
          .limit(1)
      );
      const communication = commsSnap.empty ? null : commsSnap.docs[0].data();

      const candidateRef = adminDb.collection("entities").doc(entityId).collection("candidates").doc(offer.candidateId);
      const personRef = adminDb.collection("entities").doc(entityId).collection("persons").doc(offer.personId);
      const needRef = offer.recruitmentNeedId ? adminDb.collection("entities").doc(entityId).collection("recruitmentNeeds").doc(offer.recruitmentNeedId) : null;

      const [candidateSnap, personSnap, needSnap, entitySnap] = await Promise.all([
        transaction.get(candidateRef),
        transaction.get(personRef),
        needRef ? transaction.get(needRef) : Promise.resolve(null),
        transaction.get(entityRef)
      ]);

      if (!candidateSnap.exists) {
        console.error(`[Conversion Error] Candidate doc ${offer.candidateId} not found.`);
        throw new Error("CANDIDATE_NOT_FOUND: Le document candidat est introuvable.");
      }

      // --- PHASE 2: VALIDATIONS ---
      const permissions = mSnap.data()?.permissions || [];
      if (!permissions.includes("employees.create") || !permissions.includes("contracts.create")) throw new Error("Permissions insuffisantes.");

      // Handling Already Converted (Idempotent repair mode)
      const isAlreadyConverted = offer.conversionStatus === "converted";
      
      const person = personSnap.data() as Person;
      const entity = entitySnap.data();

      // --- PHASE 3: PREPARE SNAPSHOTS ---
      // Use existing IDs if this is a re-link or repair
      let employeeId = offer.employeeId || person.currentEmployeeId;
      let contractId = offer.contractId;
      
      const isNewEmployee = !employeeId;
      const isNewContract = !contractId;

      if (!employeeId) {
        employeeId = adminDb.collection("entities").doc(entityId).collection("employees").doc().id;
      }
      if (!contractId) {
        contractId = adminDb.collection("entities").doc(entityId).collection("contracts").doc().id;
      }

      const employeeCode = person.codiceFiscale 
        ? `E-${person.codiceFiscale.substring(0, 6)}` 
        : `E-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        
      const birthDateStr = person.dateOfBirth || (person as any).birthDate || "";
      const companyAddress = entity ? `${entity.adresseSiegeSocial || ""}, ${entity.codePostal || ""} ${entity.ville || ""} (${entity.province || ""})` : "";
      const employeeAddress = person ? `${person.address || ""}, ${person.postalCode || ""} ${person.city || ""} (${person.province || ""})` : "";

      // --- PHASE 4: WRITES ---
      
      // 1. Formal Employee Record (Only if it doesn't already exist)
      if (isNewEmployee) {
        transaction.set(adminDb.collection("entities").doc(entityId).collection("employees").doc(employeeId), {
          employeeId, personId: person.personId, entityId, sourceOfferId: offerId, employeeCode,
          firstName: person.firstName, lastName: person.lastName, displayName: person.displayName,
          email: person.email, phone: person.phone || "", birthDate: birthDateStr, taxCode: person.codiceFiscale || "",
          hireDate: offer.proposedStartDate, departmentId: offer.departmentId || "", departmentName: offer.departmentName || "",
          jobTitle: offer.jobTitleName, worksiteName: offer.worksiteName || "", status: "active",
          pendingContractId: contractId,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        });
      }

      // 2. Draft Contract (Only if it doesn't already exist)
      if (isNewContract) {
        transaction.set(adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId), {
          contractId, entityId, personId: person.personId, employeeId, sourceOfferId: offerId,
          
          // Identity Snapshot
          employeeDisplayName: person.displayName,
          employeeCode: employeeCode,
          taxCode: person.codiceFiscale || "",
          employeeAddressSnapshot: employeeAddress,
          dateOfBirth: birthDateStr,
          placeOfBirth: person.placeOfBirth || "",

          // Employer Snapshot
          entityName: entity?.nomEntreprise || "",
          entityLegalName: entity?.raisonSociale || "",
          entityVatNumber: entity?.numeroTVA || "",
          companyAddressSnapshot: companyAddress,
          legalRepresentativeName: entity?.referentEntreprise || "",
          legalRepresentativeTitle: "Rappresentante Legale",

          // Job Snapshot
          jobTitleName: offer.jobTitleName,
          departmentName: offer.departmentName || "",
          worksiteName: offer.worksiteName || "",
          missionsSnapshot: offer.missionsSnapshot || (needSnap?.exists ? needSnap.data()?.jobOfferMissions : []),

          // Terms Snapshot
          contractType: offer.contractType,
          startDate: offer.proposedStartDate,
          endDate: offer.proposedEndDate || null,
          weeklyHours: offer.weeklyHours,
          trialPeriodDays: offer.trialPeriodDays || 30,
          trialPeriodUnit: "days",
          isPartTime: offer.workingTime?.toLowerCase().includes("part"),
          workingScheduleNotes: offer.workingScheduleNotes || "",

          // Classification & Remuneration Snapshot
          ccnlName: offer.ccnlName,
          levelCode: offer.levelCode,
          levelLabel: offer.levelLabel,
          qualificationCategory: offer.qualificationLabel || "",
          grossMonthly: offer.proposedGrossMonthly || 0,
          grossAnnual: offer.proposedGrossAnnual || 0,
          monthlyPayments: offer.monthlyPayments || 13,
          overtimeNote: "",

          // Compliance Snapshot
          uniLavProtocolNumber: communication?.protocolNumber || "",
          uniLavSubmissionDate: communication?.submittedAt ? 
            (typeof (communication.submittedAt as any).toDate === 'function' ? (communication.submittedAt as any).toDate().toISOString().split('T')[0] : 
            (communication.submittedAt.seconds ? new Date(communication.submittedAt.seconds * 1000).toISOString().split('T')[0] : "")) : "",
          uniLavReceiptUrl: communication?.receiptPdfUrl || "",

          status: "draft",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
        });
      }

      // 3. Status Updates (Ensuring full lifecycle synchronization)
      transaction.update(offerSnap.ref, { 
        conversionStatus: "converted", 
        employeeId, 
        contractId, 
        updatedAt: FieldValue.serverTimestamp() 
      });
      
      transaction.update(candidateRef, { 
        status: "hired", 
        employeeId, 
        hiredAt: candidateSnap.data()?.hiredAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      transaction.update(personRef, { 
        currentLifecycleStatus: "employee", 
        currentCandidateId: null, 
        currentEmployeeId: employeeId, 
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      transaction.update(dossiersSnap.docs[0].ref, {
        status: "converted_to_employee",
        employeeId,
        contractId,
        convertedAt: dossiersSnap.docs[0].data()?.convertedAt || FieldValue.serverTimestamp(),
        convertedBy: dossiersSnap.docs[0].data()?.convertedBy || actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid
      });

      // 4. Read Model Synchronization (Views)
      const candidateViewRef = adminDb.collection("entities").doc(entityId).collection("candidateViews").doc(offer.candidateId);
      transaction.set(candidateViewRef, {
        status: "hired",
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

      // 5. Recruitment Need Impact (Only if not already processed for this specific offer)
      if (needRef && needSnap?.exists && !isAlreadyConverted) {
        const need = needSnap.data() as RecruitmentNeed;
        const newFulfilled = (need.fulfilledHeadcount || 0) + 1;
        transaction.update(needRef, { 
          fulfilledHeadcount: newFulfilled, 
          remainingHeadcount: Math.max(0, need.requestedHeadcount - newFulfilled),
          status: newFulfilled >= need.requestedHeadcount ? "fulfilled" : "partially_fulfilled",
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      // 6. Timeline Entry
      const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();
      transaction.set(timelineRef, {
        eventId: timelineRef.id,
        entityId,
        personId: person.personId,
        type: "employee.created",
        label: isAlreadyConverted ? "Synchronisation Recrutement" : "Recrutement finalisé",
        description: isAlreadyConverted ? "Données de candidature synchronisées avec le profil employé." : `Candidat embauché avec succès. Matricule : ${employeeCode}`,
        sourceCollection: "employees",
        sourceId: employeeId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      });

      return { success: true, employeeId };
    });
  } catch (err: any) {
    console.error("[Conversion Error]", err);
    return { success: false, error: err.message };
  }
}
