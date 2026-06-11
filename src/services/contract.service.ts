import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp, 
  updateDoc,
  getDoc,
  setDoc,
  query,
  where,
  getDocs,
  arrayUnion
} from "firebase/firestore";
import { Contract, ContractStatus } from "@/types/contract";
import { createAuditLog } from "./audit.service";
import { registerSignedContractDocument } from "./document.service";
import { Employee } from "@/types/employee";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';

/**
 * Normalizes an object by removing undefined properties to satisfy Firestore.
 * Preserves FieldValue and Timestamp identities.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

/**
 * Updates contract data.
 * STRICT RULE: Only allowed if contract.status === "draft".
 * Implementation: Only bumps contentUpdatedAt if relevant content fields have changed.
 */
export async function updateContract(entityId: string, contractId: string, data: Partial<Contract>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  const cleanData = sanitizePayload(data);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(contractRef);
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    if (contract.status !== "draft") {
      throw new Error("Ce contrat n'est plus modifiable (statut: " + contract.status + ")");
    }

    // Metadata fields to exclude from content change detection
    const metadataFields = [
      'status', 'updatedAt', 'updatedBy', 'createdBy', 'createdAt', 'notes',
      'contentUpdatedAt', 'contentVersion', 'contentHash',
      'sentForSignatureAt', 'signedAt', 'activatedAt', 'terminatedAt', 'archivedAt',
      'generatedPdfUrl', 'generatedPdfStoragePath', 'generatedPdfFileName', 
      'generatedPdfVersion', 'generatedPdfAt', 'generatedPdfBy', 'generatedPdfStatus',
      'signedDocumentId', 'signedDocumentTitle', 'signedDocumentUrl', 
      'signedDocumentFileName', 'signedDocumentStoragePath', 'signedDocumentMimeType',
      'signedDocumentUploadedAt', 'signedDocumentUploadedBy', 'signedDocumentReplacedAt',
      'signedDocumentReplacedBy', 'signedDocumentReplacementReason', 'signedDocumentPreviousReferences',
      'actualEndDate', 'terminationReason', 'terminationNotes', 'terminationDocumentId', 'terminationDocumentUrl',
      'terminatedBy', 'previousContractId', 'renewedByContractId', 'pendingRenewalContractId', 'isRenewal',
      'renewalDraftCreatedAt', 'renewalDraftCreatedBy'
    ];

    let hasContentChanges = false;
    for (const [key, value] of Object.entries(cleanData)) {
      if (metadataFields.includes(key)) continue;

      const oldValue = (contract as any)[key];
      
      // Robust comparison helper: treat undefined, null, and "" as equivalent for content comparison
      const normalize = (v: any) => (v === undefined || v === null || v === "") ? null : v;
      const nNew = normalize(value);
      const nOld = normalize(oldValue);

      if (Array.isArray(nNew) || Array.isArray(nOld)) {
        if (JSON.stringify(nNew) !== JSON.stringify(nOld)) {
          hasContentChanges = true;
          break;
        }
      } else if (nNew !== nOld) {
        hasContentChanges = true;
        break;
      }
    }

    const updatePayload: any = {
      ...cleanData,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    };

    // Only bump content threshold if a business-relevant field changed
    if (hasContentChanges) {
      updatePayload.contentUpdatedAt = serverTimestamp();
    }

    transaction.update(contractRef, updatePayload);
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.updated",
    resourceType: "contract",
    resourceId: contractId,
  });
}

/**
 * Moves a contract from draft to pending_signature.
 */
export async function sendContractToSignature(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(contractRef);
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    if (contract.status !== "draft") {
      throw new Error("Action impossible pour le statut actuel.");
    }

    transaction.update(contractRef, sanitizePayload({
      status: "pending_signature",
      sentForSignatureAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.sent_for_signature",
    resourceType: "contract",
    resourceId: contractId,
  });
}

/**
 * Records or replaces a reference to the signed contract document.
 * Allowed in pending_signature only.
 */
export async function recordSignedDocumentReference(
  entityId: string, 
  contractId: string, 
  data: { 
    title: string, 
    url?: string, 
    reference?: string,
    fileName?: string | null,
    storagePath?: string | null,
    mimeType?: string | null,
    replacementReason?: string
  }, 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  const payload = sanitizePayload({
    signedDocumentTitle: data.title,
    signedDocumentUrl: data.url || null,
    signedDocumentId: data.reference || null,
    signedDocumentFileName: data.fileName || null,
    signedDocumentStoragePath: data.storagePath || null,
    signedDocumentMimeType: data.mimeType || null,
    signedDocumentUploadedAt: serverTimestamp(),
    signedDocumentUploadedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  let contractData: Contract | null = null;
  let isReplacement = false;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(contractRef);
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;
    contractData = contract;

    if (contract.status !== "pending_signature" && contract.status !== "draft") {
      throw new Error("L'enregistrement du document n'est possible qu'en phase de signature ou brouillon.");
    }

    const previousRefs = contract.signedDocumentPreviousReferences || [];
    isReplacement = !!(
      contract.signedDocumentTitle || 
      contract.signedDocumentUrl || 
      contract.signedDocumentId || 
      contract.signedDocumentStoragePath
    );

    if (isReplacement) {
      previousRefs.push({
        signedDocumentTitle: contract.signedDocumentTitle || null,
        signedDocumentUrl: contract.signedDocumentUrl || null,
        signedDocumentId: contract.signedDocumentId || null,
        signedDocumentFileName: contract.signedDocumentFileName || null,
        signedDocumentStoragePath: contract.signedDocumentStoragePath || null,
        signedDocumentMimeType: contract.signedDocumentMimeType || null,
        signedDocumentUploadedAt: contract.signedDocumentUploadedAt || null,
        signedDocumentUploadedBy: contract.signedDocumentUploadedBy || null,
        replacedAt: new Date().toISOString(),
        replacementReason: data.replacementReason || "Non spécifié"
      });
    }

    transaction.update(contractRef, sanitizePayload({
      ...payload,
      signedDocumentPreviousReferences: previousRefs,
      signedDocumentReplacedAt: isReplacement ? serverTimestamp() : null,
      signedDocumentReplacedBy: isReplacement ? actorUid : null,
      signedDocumentReplacementReason: isReplacement ? (data.replacementReason || null) : null
    }));
  });

  // Mirror to Centralized Documents Registry (Phase 2A)
  if (contractData) {
    const c = contractData as Contract;
    registerSignedContractDocument({
      entityId,
      contractId,
      employeeId: c.employeeId,
      personId: c.personId,
      employeeDisplayName: c.employeeDisplayName || "Salarié",
      signedDocumentTitle: data.title,
      signedDocumentUrl: data.url,
      signedDocumentId: data.reference,
      signedDocumentStoragePath: data.storagePath,
      signedDocumentFileName: data.fileName,
      signedDocumentUploadedAt: new Date(),
      signedDocumentUploadedBy: actorUid,
      // Pass expiry info for CDD mirroring
      contractType: c.contractType,
      contractStartDate: c.startDate,
      contractEndDate: c.endDate
    }).catch(err => console.error("[Documents Mirroring Error] Signed contract registration failed:", err));
  }

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: isReplacement ? "contract.signed_document_replaced" : "contract.signed_document_recorded",
    resourceType: "contract",
    resourceId: contractId,
    details: sanitizePayload({ 
      title: data.title, 
      replacementReason: data.replacementReason 
    })
  });
}

/**
 * Activates a contract and updates the linked employee.
 * STRICT GATE: Requires a signed document proof.
 */
export async function activateContractAction(entityId: string, contractId: string, employeeId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!employeeId) throw new Error("ID Employé manquant.");

  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);

  const activated = await runTransaction(db, async (transaction) => {
    // ALL READS FIRST
    const snap = await transaction.get(contractRef);
    const empSnap = await transaction.get(employeeRef);

    // VALIDATIONS
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    // Guard: Prevent duplicate activation and timeline events
    if (contract.status === "active") {
      return { success: true, alreadyActive: true };
    }

    const hasProof = !!(
      contract.signedDocumentId || 
      contract.signedDocumentUrl || 
      contract.signedDocumentTitle || 
      contract.signedDocumentFileName || 
      contract.signedDocumentStoragePath
    );

    if (!hasProof) {
      throw new Error("Veuillez enregistrer le contrat signé avant activation.");
    }

    if (!empSnap.exists()) throw new Error("L'employé rattaché n'existe pas.");
    const empData = empSnap.data();

    if (empData.activeContractId && empData.activeContractId !== contractId) {
      throw new Error("ALREADY_HAS_ACTIVE_CONTRACT");
    }

    // ALL WRITES AFTER
    transaction.update(contractRef, sanitizePayload({
      status: "active",
      activatedAt: serverTimestamp(),
      signedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));

    transaction.update(employeeRef, {
      activeContractId: contractId,
      pendingContractId: null, // Clear onboarding link if it matches
      updatedAt: serverTimestamp(),
    });

    // Timeline Event
    if (contract.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: contract.personId,
        employeeId,
        contractId,
        type: "contract.activated",
        label: "Contrat activé",
        description: `Le contrat ${contract.employeeCode || contractId} a été activé.`,
        sourceCollection: "contracts",
        sourceId: contractId,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      }));
    }

    return { success: true };
  });

  if (activated && !(activated as any).alreadyActive) {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "contract.activated",
      resourceType: "contract",
      resourceId: contractId,
      details: { employeeId }
    });
  }
}

/**
 * Moves a contract back to draft.
 */
export async function rollbackToDraft(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await updateDoc(contractRef, sanitizePayload({
    status: "draft",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.rolled_back",
    resourceType: "contract",
    resourceId: contractId,
  });
}

/**
 * Terminates an active contract.
 * Updates the contract, the linked employee status, read models, and timeline.
 */
export async function terminateContractAction(
  entityId: string, 
  contractId: string, 
  employeeId: string, 
  actorUid: string,
  terminationData: {
    actualEndDate: string;
    terminationReason: string;
    terminationNotes?: string;
  },
  terminationDocumentId?: string
) {
  if (!db) throw new Error("Firestore not initialized");
  if (!employeeId) throw new Error("ID Employé manquant.");

  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);
  const employeeViewRef = doc(db, `entities/${entityId}/employeeViews`, employeeId);

  // 1. Fetch other active contracts BEFORE transaction (reads must happen before writes)
  const q = query(
    collection(db, `entities/${entityId}/contracts`),
    where("employeeId", "==", employeeId),
    where("status", "==", "active")
  );
  const otherActiveSnap = await getDocs(q);
  const otherActiveContracts = otherActiveSnap.docs
    .map(d => ({ ...d.data(), contractId: d.id } as Contract))
    .filter(c => c.contractId !== contractId);

  // 1b. Fetch termination document metadata if provided
  let terminationDocMetadata: any = null;
  if (terminationDocumentId) {
     const docSnap = await getDoc(doc(db, `entities/${entityId}/documents`, terminationDocumentId));
     if (docSnap.exists()) {
       terminationDocMetadata = docSnap.data();
     }
  }

  return await runTransaction(db, async (transaction): Promise<{ employeeId: string }> => {
    // 2. READ SNAPSHOTS
    const snap = await transaction.get(contractRef);
    const empSnap = await transaction.get(employeeRef);

    // 3. VALIDATIONS
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    if (contract.status !== "active") {
      throw new Error("Seul un contrat actif peut être terminé.");
    }

    if (new Date(terminationData.actualEndDate) < new Date(contract.startDate)) {
      throw new Error("La date de fin ne peut pas être antérieure à la date de début.");
    }

    if (terminationDocumentId && !terminationDocMetadata) {
      throw new Error("Document de clôture introuvable dans le registre.");
    }

    if (terminationDocMetadata) {
       if (terminationDocMetadata.entityId !== entityId || terminationDocMetadata.contractId !== contractId) {
         throw new Error("Incohérence sur le document de clôture (entité/contrat).");
       }
    }

    // 4. WRITES
    
    // A. Terminate Contract
    transaction.update(contractRef, sanitizePayload({
      status: "terminated",
      actualEndDate: terminationData.actualEndDate,
      terminationReason: terminationData.terminationReason,
      terminationNotes: terminationData.terminationNotes || null,
      terminationDocumentId: terminationDocumentId || null,
      terminatedAt: serverTimestamp(),
      terminatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));

    // B. Synchronize Employee
    if (empSnap.exists()) {
      const empData = empSnap.data() as Employee;
      const isCurrentlyActiveContract = empData.activeContractId === contractId;

      if (isCurrentlyActiveContract) {
        if (otherActiveContracts.length > 0) {
          // Promote next available active contract
          const nextContract = otherActiveContracts[0];
          transaction.update(employeeRef, {
            activeContractId: nextContract.contractId,
            updatedAt: serverTimestamp(),
          });
          
          // Sync View Model
          transaction.set(employeeViewRef, sanitizePayload({
            activeContractId: nextContract.contractId,
            updatedAt: serverTimestamp(),
          }), { merge: true });
        } else {
          // No more active contracts: Mark employee as terminated
          transaction.update(employeeRef, sanitizePayload({
            activeContractId: null,
            status: "terminated",
            terminationDate: terminationData.actualEndDate,
            terminationReason: terminationData.terminationReason,
            updatedAt: serverTimestamp(),
          }));

          // Sync View Model
          transaction.set(employeeViewRef, sanitizePayload({
            activeContractId: null,
            status: "terminated",
            updatedAt: serverTimestamp(),
          }), { merge: true });

          // Update Person Lifecycle Status
          if (contract.personId) {
             const personRef = doc(db, `entities/${entityId}/persons`, contract.personId);
             transaction.update(personRef, sanitizePayload({
               currentLifecycleStatus: "former_employee",
               updatedAt: serverTimestamp(),
               updatedBy: actorUid
             }));
          }
        }
      }
    }

    // C. Record Timeline Event
    if (contract.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: contract.personId,
        employeeId,
        contractId,
        type: "contract.terminated",
        label: "Contrat terminé",
        description: `Le contrat ${contract.employeeCode || contractId} a été terminé le ${terminationData.actualEndDate}. Motif: ${terminationData.terminationReason}.${terminationDocumentId ? " Document de clôture joint." : ""}`,
        sourceCollection: "contracts",
        sourceId: contractId,
        metadata: {
           terminationDocumentId: terminationDocumentId || null
        },
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      }));
    }

    return { employeeId };
  }).then(async (res) => {
    // 5. Audit Logging (Outside transaction for better performance)
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "contract.terminated",
      resourceType: "contract",
      resourceId: contractId,
      details: sanitizePayload({ 
        employeeId: res.employeeId, 
        ...terminationData,
        terminationDocumentId: terminationDocumentId || null
      })
    });
  });
}

/**
 * Archives a contract.
 */
export async function archiveContractAction(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await updateDoc(contractRef, sanitizePayload({
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.archived",
    resourceType: "contract",
    resourceId: contractId,
  });
}

/**
 * Phase 1: Prepares a renewal draft for a fixed-term contract (CDD).
 * Creates a new contract linked to the old one.
 */
export async function prepareContractRenewalAction(
  entityId: string, 
  oldContractId: string, 
  payload: { 
    newStartDate: string, 
    newEndDate: string, 
    renewalReason?: string, 
    actorUid: string 
  }
) {
  if (!db) throw new Error("Firestore not initialized");
  const { newStartDate, newEndDate, renewalReason, actorUid } = payload;

  const oldContractRef = doc(db, `entities/${entityId}/contracts`, oldContractId);
  const newContractRef = doc(collection(db, `entities/${entityId}/contracts`));
  const newContractId = newContractRef.id;

  const result = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(oldContractRef);
    if (!snap.exists()) throw new Error("Contrat d'origine introuvable.");
    const old = snap.data() as Contract;

    // 1. Validations
    if (old.entityId !== entityId) throw new Error("Incohérence d'entité.");
    if (!old.employeeId) throw new Error("ID Employé manquant sur le contrat d'origine.");

    // Detect CDD / Fixed term
    const cddLabels = ["fixed_term", "Tempo determinato", "CDD"];
    const isCDD = cddLabels.some(l => old.contractType?.toLowerCase().includes(l.toLowerCase()));
    if (!isCDD) throw new Error("Seul un contrat à durée déterminée (CDD) peut être renouvelé.");

    if (old.renewedByContractId || old.pendingRenewalContractId) {
      throw new Error("Une demande de renouvellement existe déjà pour ce contrat.");
    }

    if (!newStartDate || !newEndDate) throw new Error("Dates de début et de fin requises.");
    if (new Date(newEndDate) <= new Date(newStartDate)) {
      throw new Error("La date de fin doit être postérieure à la date de début.");
    }

    // 2. Prepare New Contract (Cloning core snapshots)
    const newContractData: any = {
      contractId: newContractId,
      entityId,
      personId: old.personId,
      employeeId: old.employeeId,
      sourceOfferId: old.sourceOfferId || null,
      employeeDisplayName: old.employeeDisplayName,
      employeeCode: old.employeeCode,
      
      // Legal Employer Snapshot
      entityName: old.entityName,
      entityLegalName: old.entityLegalName,
      entityVatNumber: old.entityVatNumber,
      companyAddressSnapshot: old.companyAddressSnapshot,
      legalRepresentativeName: old.legalRepresentativeName,
      legalRepresentativeTitle: old.legalRepresentativeTitle,
      
      // Legal Employee Snapshot
      taxCode: old.taxCode,
      employeeAddressSnapshot: old.employeeAddressSnapshot,
      dateOfBirth: old.dateOfBirth,
      placeOfBirth: old.placeOfBirth,
      
      // Job & Workplace
      jobTitleName: old.jobTitleName,
      departmentName: old.departmentName,
      worksiteName: old.worksiteName,
      missionsSnapshot: old.missionsSnapshot || [],
      
      // Contractual Parameters
      contractType: old.contractType,
      weeklyHours: old.weeklyHours,
      isPartTime: old.isPartTime ?? null,
      workingScheduleNotes: old.workingScheduleNotes || null,
      
      // Classification
      ccnlName: old.ccnlName,
      levelCode: old.levelCode,
      levelLabel: old.levelLabel,
      qualificationCategory: old.qualificationCategory,
      
      // Remuneration
      grossMonthly: old.grossMonthly,
      grossAnnual: old.grossAnnual,
      monthlyPayments: old.monthlyPayments,

      // Renewal specific
      status: "draft",
      previousContractId: oldContractId,
      isRenewal: true,
      renewalReason: renewalReason || null,
      startDate: newStartDate,
      endDate: newEndDate,
      
      // Audit
      createdAt: serverTimestamp(),
      createdBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    };

    // 3. Perform Writes
    transaction.set(newContractRef, sanitizePayload(newContractData));
    
    transaction.update(oldContractRef, {
      pendingRenewalContractId: newContractId,
      renewalDraftCreatedAt: serverTimestamp(),
      renewalDraftCreatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    // 4. Timeline Event
    if (old.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: old.personId,
        employeeId: old.employeeId,
        contractId: newContractId,
        type: "contract.renewal_prepared",
        label: "Renouvellement CDD initié",
        description: `Brouillon de renouvellement créé pour la période du ${newStartDate} au ${newEndDate}.`,
        sourceCollection: "contracts",
        sourceId: newContractId,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      }));
    }

    return { 
      newContractId, 
      oldContractId, 
      employeeId: old.employeeId, 
      status: "draft" as ContractStatus 
    };
  });

  // 5. Post-transaction Audit Log
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.renewal_draft_created",
    resourceType: "contract",
    resourceId: newContractId,
    details: { oldContractId, newStartDate, newEndDate }
  });

  return result;
}

/**
 * Validates a signed renewal contract and marks it as pending_activation.
 */
export async function markContractAsReadyForActivationAction(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  // Pre-check for existing pending activations for this employee
  const tempRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const tempSnap = await getDoc(tempRef);
  if (!tempSnap.exists()) throw new Error("Contrat introuvable.");
  const contractData = tempSnap.data() as Contract;

  const pendingQ = query(
    collection(db, `entities/${entityId}/contracts`),
    where("employeeId", "==", contractData.employeeId),
    where("status", "==", "pending_activation")
  );
  const pendingSnap = await getDocs(pendingQ);
  const others = pendingSnap.docs.filter(d => d.id !== contractId);
  if (others.length > 0) {
    throw new Error("Un autre contrat est déjà en attente d'activation pour ce collaborateur.");
  }

  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(tempRef);
    const contract = snap.data() as Contract;

    if (!contract.isRenewal || !contract.previousContractId) {
      throw new Error("Ce contrat n'est pas un renouvellement valide.");
    }

    if (contract.status !== "draft" && contract.status !== "pending_signature") {
      throw new Error("Action impossible pour le statut actuel (" + contract.status + ")");
    }

    const hasProof = !!(
      contract.signedDocumentId || 
      contract.signedDocumentUrl || 
      contract.signedDocumentTitle || 
      contract.signedDocumentFileName || 
      contract.signedDocumentStoragePath
    );

    if (!hasProof) throw new Error("Veuillez enregistrer le contrat signé avant de le marquer comme prêt.");

    if (!contract.startDate) throw new Error("Date de début manquante.");
    
    const isCDD = ["fixed_term", "Tempo determinato", "CDD"].some(l => 
      contract.contractType?.toLowerCase().includes(l.toLowerCase())
    );

    if (isCDD) {
      if (!contract.endDate) throw new Error("Date de fin manquante (requis pour CDD).");
      if (new Date(contract.endDate) <= new Date(contract.startDate)) {
        throw new Error("La date de fin doit être postérieure à la date de début.");
      }
    }

    if (!contract.ccnlId && !contract.ccnlName) throw new Error("Informations CCNL manquantes.");
    if (!contract.levelId && !contract.levelCode) throw new Error("Classification (Niveau) manquante.");
    
    if (contract.grossMonthly !== undefined && contract.grossMonthly < 0) throw new Error("Salaire brut mensuel invalide.");
    if (contract.grossAnnual !== undefined && contract.grossAnnual < 0) throw new Error("Salaire brut annuel invalide.");

    const oldContractRef = doc(db, `entities/${entityId}/contracts`, contract.previousContractId);
    const oldSnap = await transaction.get(oldContractRef);
    if (!oldSnap.exists()) throw new Error("Contrat d'origine introuvable.");
    const old = oldSnap.data() as Contract;

    if (old.status !== "active") {
      throw new Error("Le contrat précédent doit être 'Actif' pour planifier un renouvellement.");
    }

    if (old.pendingRenewalContractId !== contractId) {
      throw new Error("Incohérence de lien de renouvellement.");
    }

    const employeeRef = doc(db, `entities/${entityId}/employees`, contract.employeeId);
    const empSnap = await transaction.get(employeeRef);
    if (!empSnap.exists()) throw new Error("Employé introuvable.");
    const emp = empSnap.data();

    if (emp.activeContractId !== contract.previousContractId) {
      throw new Error("L'employé possède un autre contrat actif qui bloque le renouvellement.");
    }

    const now = serverTimestamp();
    transaction.update(tempRef, sanitizePayload({
      status: "pending_activation",
      readyForActivationAt: now,
      readyForActivationBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    }));

    if (contract.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: contract.personId,
        employeeId: contract.employeeId,
        contractId,
        type: "contract.ready_for_activation",
        label: "Renouvellement validé",
        description: `Le contrat de renouvellement a été signé et validé. Activation prévue le ${contract.startDate}.`,
        sourceCollection: "contracts",
        sourceId: contractId,
        createdAt: now,
        createdBy: actorUid,
      }));
    }

    return { 
      contractId, 
      previousContractId: contract.previousContractId, 
      employeeId: contract.employeeId, 
      status: "pending_activation" 
    };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "contract.marked_ready",
      resourceType: "contract",
      resourceId: contractId,
      details: { previousContractId: res.previousContractId }
    });
    return res;
  });
}

/**
 * Atomic transition from old active CDD to new active renewal contract.
 * Reusable by cron or manual trigger.
 */
export async function executeContractTransitionTransaction(entityId: string, newContractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const newContractRef = doc(db, `entities/${entityId}/contracts`, newContractId);

  return await runTransaction(db, async (transaction) => {
    const newSnap = await transaction.get(newContractRef);
    if (!newSnap.exists()) throw new Error("Nouveau contrat introuvable.");
    const newContract = newSnap.data() as Contract;

    if (newContract.status !== "pending_activation") {
      throw new Error("Seul un contrat en attente d'activation peut être activé.");
    }

    const today = new Date().toISOString().split('T')[0];
    if (newContract.startDate > today) {
      throw new Error("Activation anticipée non autorisée (Date prévue: " + newContract.startDate + ")");
    }

    const oldContractRef = doc(db, `entities/${entityId}/contracts`, newContract.previousContractId!);
    const oldSnap = await transaction.get(oldContractRef);
    if (!oldSnap.exists()) throw new Error("Contrat d'origine introuvable.");
    const oldContract = oldSnap.data() as Contract;

    const employeeRef = doc(db, `entities/${entityId}/employees`, newContract.employeeId);
    const empSnap = await transaction.get(employeeRef);
    if (!empSnap.exists()) throw new Error("Employé introuvable.");
    const empData = empSnap.data();

    if (oldContract.status !== "active") {
      throw new Error("L'ancien contrat n'est pas 'Actif' (Statut: " + oldContract.status + ")");
    }

    if (empData.activeContractId !== newContract.previousContractId) {
      throw new Error("Désynchronisation de la chaîne : l'employé n'est pas sur le contrat attendu.");
    }

    const now = serverTimestamp();

    // A. Terminate Old (Status Renewed)
    transaction.update(oldContractRef, {
      status: "renewed",
      renewedByContractId: newContractId,
      updatedAt: now,
      updatedBy: actorUid
    });

    // B. Activate New
    transaction.update(newContractRef, {
      status: "active",
      activatedAt: now,
      activatedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid
    });

    // C. Update Employee Pointer
    transaction.update(employeeRef, {
      activeContractId: newContractId,
      updatedAt: now
    });

    // D. Timeline Event
    if (newContract.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      transaction.set(timelineRef, sanitizePayload({
        eventId: timelineRef.id,
        entityId,
        personId: newContract.personId,
        employeeId: newContract.employeeId,
        contractId: newContractId,
        type: "contract.auto_activated",
        label: "Contrat de renouvellement activé",
        description: `Le renouvellement ${newContract.employeeCode || newContractId} est désormais actif.`,
        sourceCollection: "contracts",
        sourceId: newContractId,
        createdAt: now,
        createdBy: actorUid,
      }));
    }

    return { success: true, employeeId: newContract.employeeId, newContractId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "contract.transition_executed",
      resourceType: "contract",
      resourceId: newContractId,
      details: { actor: actorUid }
    });
    return res;
  });
}
