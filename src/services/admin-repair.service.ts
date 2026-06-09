import { db } from "@/lib/firebase/client";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  runTransaction,
  collection,
  query,
  where,
  getDocs
} from "firebase/firestore";
import { Candidate } from "@/types/candidate";
import { Person } from "@/types/person";
import { EmploymentOffer } from "@/types/employment-offer";
import { createAuditLog } from "./audit.service";

/**
 * REPAIR ONLY: Recreates a missing employee document for a finalized recruitment.
 * Target Candidate: bbJ1tMjhE2pUrcUsv9jy
 */
export async function repairCandidateEmployeeRecord(entityId: string, candidateId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  return await runTransaction(db, async (transaction) => {
    // 1. Fetch Candidate
    const candidateRef = doc(db, `entities/${entityId}/candidates`, candidateId);
    const candidateSnap = await transaction.get(candidateRef);
    if (!candidateSnap.exists()) throw new Error(`Candidat ${candidateId} introuvable.`);
    const candidate = candidateSnap.data() as Candidate;

    // 2. Fetch Person
    const personRef = doc(db, `entities/${entityId}/persons`, candidate.personId);
    const personSnap = await transaction.get(personRef);
    if (!personSnap.exists()) throw new Error("Fiche identité introuvable.");
    const person = personSnap.data() as Person;

    // 3. Fetch Offer (if exists)
    const offersRef = collection(db, `entities/${entityId}/employmentOffers`);
    const offerQ = query(offersRef, where("candidateId", "==", candidateId));
    const offerSnap = await getDocs(offerQ);
    const offer = !offerSnap.empty ? (offerSnap.docs[0].data() as EmploymentOffer) : null;

    // 4. Resolve Employee ID
    const employeeId = candidate.employeeId || person.currentEmployeeId || offer?.employeeId;
    if (!employeeId) {
       throw new Error("Aucun EmployeeID n'est associé à ce candidat ou à cette personne. La conversion n'a probablement jamais eu lieu.");
    }

    // 5. Check if Employee Document exists
    const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);
    const employeeSnap = await transaction.get(employeeRef);

    if (employeeSnap.exists()) {
      console.log("L'employé existe déjà. Réparation des liens uniquement.");
    } else {
      console.log("L'employé est manquant. Recréation du document...");
      
      const employeeCode = person.codiceFiscale 
        ? `E-${person.codiceFiscale.substring(0, 6)}` 
        : `E-REPAIR-${candidateId.substring(0, 4)}`;

      const employeeData: any = {
        employeeId,
        personId: person.personId,
        entityId,
        sourceCandidateId: candidateId,
        sourceOfferId: offer?.offerId || null,
        employeeCode,
        firstName: person.firstName,
        lastName: person.lastName,
        displayName: person.displayName,
        taxCode: person.codiceFiscale || "",
        email: person.email,
        phone: person.phone || "",
        birthDate: person.dateOfBirth || (person as any).birthDate || "",
        hireDate: offer?.proposedStartDate || candidate.applicationDate || "",
        departmentId: candidate.departmentId || offer?.departmentId || "",
        departmentName: candidate.department || offer?.departmentName || "",
        jobTitle: candidate.positionApplied || offer?.jobTitleName || "",
        worksiteName: offer?.worksiteName || "",
        status: "active",
        createdAt: candidate.statusUpdatedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      transaction.set(employeeRef, employeeData);
    }

    // 6. Repair Links & Lifecycle
    transaction.update(candidateRef, {
      status: "hired",
      employeeId: employeeId,
      updatedAt: serverTimestamp(),
    });

    transaction.update(personRef, {
      currentLifecycleStatus: "employee",
      currentEmployeeId: employeeId,
      updatedAt: serverTimestamp(),
    });

    if (offer) {
      const oRef = doc(db, `entities/${entityId}/employmentOffers`, offer.offerId);
      transaction.update(oRef, {
        employeeId: employeeId,
        conversionStatus: "converted",
        updatedAt: serverTimestamp(),
      });
    }

    // 7. View Update
    const viewRef = doc(db, `entities/${entityId}/candidateViews`, employeeId);
    transaction.set(viewRef, {
      id: employeeId,
      employeeId,
      displayName: person.displayName,
      status: "active",
      updatedAt: serverTimestamp()
    }, { merge: true });

    return { employeeId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "admin.repair_employee_record",
      resourceType: "employee",
      resourceId: res.employeeId,
      details: { candidateId }
    });
    return res;
  });
}

/**
 * REPAIR ONLY: Links a specific EmploymentRequest and its linked receipt document to an existing employeeId.
 * Derived from offerId.
 */
export async function repairCpiLink(entityId: string, offerId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const requestId = `unilav_${offerId}`;
  
  return await runTransaction(db, async (transaction) => {
    const requestRef = doc(db, `entities/${entityId}/employmentRequests`, requestId);
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) throw new Error(`Dossier CPI ${requestId} introuvable.`);
    const request = requestSnap.data() as any;

    // Try to resolve employeeId from various links
    let employeeId = request.employeeId;
    
    if (!employeeId) {
      const personRef = doc(db, `entities/${entityId}/persons`, request.personId);
      const personSnap = await transaction.get(personRef);
      employeeId = personSnap.exists() ? personSnap.data().currentEmployeeId : null;
    }
    
    if (!employeeId) {
      const candidateRef = doc(db, `entities/${entityId}/candidates`, request.candidateId);
      const candidateSnap = await transaction.get(candidateRef);
      employeeId = candidateSnap.exists() ? candidateSnap.data().employeeId : null;
    }

    if (!employeeId) {
      const offerRef = doc(db, `entities/${entityId}/employmentOffers`, offerId);
      const offerSnap = await transaction.get(offerRef);
      employeeId = offerSnap.exists() ? offerSnap.data().employeeId : null;
    }

    if (!employeeId) throw new Error("CONVERSION_NOT_FOUND: Impossible de résoudre l'EmployeeId pour ce dossier.");

    // Verify employee exists
    const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);
    const employeeSnap = await transaction.get(employeeRef);
    if (!employeeSnap.exists()) throw new Error(`EMPLOYEE_MISSING: Le document employé ${employeeId} n'existe pas.`);
    const employeeData = employeeSnap.data();

    // 1. Update EmploymentRequest
    transaction.update(requestRef, {
      employeeId,
      candidateDisplayName: employeeData.displayName,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid
    });

    // 2. Update Receipt Document
    if (request.receiptDocumentId) {
      const docRef = doc(db, `entities/${entityId}/documents`, request.receiptDocumentId);
      transaction.update(docRef, {
        employeeId,
        employeeDisplayName: employeeData.displayName,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });
    }

    return { employeeId, receiptDocumentId: request.receiptDocumentId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "admin.repair_cpi_link",
      resourceType: "employmentRequest",
      resourceId: requestId,
      details: res
    });
    return res;
  });
}
