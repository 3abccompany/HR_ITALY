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
  getDocs
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

    if (contract.status !== "pending_signature") {
      throw new Error("L'enregistrement du document n'est possible qu'en phase de signature.");
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
    details: { title: data.title, replacementReason: data.replacementReason }
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

