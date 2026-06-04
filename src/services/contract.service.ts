import { db } from "@/lib/firebase/client";
import { 
  doc, 
  runTransaction, 
  serverTimestamp,
  getDoc,
  updateDoc
} from "firebase/firestore";
import { Contract, ContractStatus } from "@/types/contract";
import { createAuditLog } from "./audit.service";
import { registerSignedContractDocument } from "./document.service";

/**
 * Normalizes an object by removing undefined properties to satisfy Firestore.
 */
function sanitizePayload<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (key, value) => (value === undefined ? null : value)));
}

/**
 * Updates contract data.
 * STRICT RULE: Only allowed if contract.status === "draft".
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

    transaction.update(contractRef, {
      ...cleanData,
      contentUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
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

    transaction.update(contractRef, {
      status: "pending_signature",
      sentForSignatureAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });
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

    transaction.update(contractRef, {
      ...payload,
      signedDocumentPreviousReferences: previousRefs,
      signedDocumentReplacedAt: isReplacement ? serverTimestamp() : null,
      signedDocumentReplacedBy: isReplacement ? actorUid : null,
      signedDocumentReplacementReason: isReplacement ? (data.replacementReason || null) : null
    });
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

  await runTransaction(db, async (transaction) => {
    // ALL READS FIRST
    const snap = await transaction.get(contractRef);
    const empSnap = await transaction.get(employeeRef);

    // VALIDATIONS
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

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
    transaction.update(contractRef, {
      status: "active",
      activatedAt: serverTimestamp(),
      signedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.update(employeeRef, {
      activeContractId: contractId,
      pendingContractId: null, // Clear onboarding link if it matches
      updatedAt: serverTimestamp(),
    });
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.activated",
    resourceType: "contract",
    resourceId: contractId,
    details: { employeeId }
  });
}

/**
 * Moves a contract back to draft.
 */
export async function rollbackToDraft(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await updateDoc(contractRef, {
    status: "draft",
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

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
 * Updates both the contract document and the linked employee.
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
  }
) {
  if (!db) throw new Error("Firestore not initialized");
  if (!employeeId) throw new Error("ID Employé manquant.");

  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const snap = await transaction.get(contractRef);
    const empSnap = await transaction.get(employeeRef);

    // 2. VALIDATIONS
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    if (contract.status !== "active") {
      throw new Error("Seul un contrat actif peut être terminé.");
    }

    // Basic date validation: end date cannot be before start date
    if (new Date(terminationData.actualEndDate) < new Date(contract.startDate)) {
      throw new Error("La date de fin ne peut pas être antérieure à la date de début.");
    }

    // 3. ALL WRITES AFTER ALL READS
    transaction.update(contractRef, {
      status: "terminated",
      actualEndDate: terminationData.actualEndDate,
      terminationReason: terminationData.terminationReason,
      terminationNotes: terminationData.terminationNotes || null,
      terminatedAt: serverTimestamp(),
      terminatedBy: actorUid,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    if (empSnap.exists() && empSnap.data().activeContractId === contractId) {
      transaction.update(employeeRef, {
        activeContractId: null,
        updatedAt: serverTimestamp(),
      });
    }

    // Implicitly return from transaction
    return { employeeId };
  }).then(async (res) => {
    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "contract.terminated",
      resourceType: "contract",
      resourceId: contractId,
      details: { employeeId: res.employeeId, ...terminationData }
    });
  });
}

/**
 * Archives a contract.
 */
export async function archiveContractAction(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await updateDoc(contractRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.archived",
    resourceType: "contract",
    resourceId: contractId,
  });
}
