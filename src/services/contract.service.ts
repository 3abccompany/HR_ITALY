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
 * Records a manual reference to the signed contract document.
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
    mimeType?: string | null
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

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(contractRef);
    if (!snap.exists()) throw new Error("Contrat introuvable.");
    const contract = snap.data() as Contract;

    if (contract.status !== "pending_signature") {
      throw new Error("L'enregistrement du document n'est possible qu'en phase de signature.");
    }

    transaction.update(contractRef, payload);
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.signed_document_recorded",
    resourceType: "contract",
    resourceId: contractId,
    details: { title: data.title }
  });
}

/**
 * Activates a contract and updates the linked employee.
 * STRICT GATE: Requires a signed document reference.
 */
export async function activateContractAction(entityId: string, contractId: string, employeeId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!employeeId) throw new Error("ID Employé manquant.");

  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(contractRef);
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

    const empSnap = await transaction.get(employeeRef);
    if (!empSnap.exists()) throw new Error("L'employé rattaché n'existe pas.");
    const empData = empSnap.data();

    if (empData.activeContractId && empData.activeContractId !== contractId) {
      throw new Error("ALREADY_HAS_ACTIVE_CONTRACT");
    }

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
 */
export async function terminateContractAction(entityId: string, contractId: string, employeeId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = employeeId ? doc(db, `entities/${entityId}/employees`, employeeId) : null;

  await runTransaction(db, async (transaction) => {
    transaction.update(contractRef, {
      status: "terminated",
      terminatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    if (employeeRef) {
      const empSnap = await transaction.get(employeeRef);
      if (empSnap.exists() && empSnap.data().activeContractId === contractId) {
        transaction.update(employeeRef, {
          activeContractId: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "contract.terminated",
    resourceType: "contract",
    resourceId: contractId,
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
