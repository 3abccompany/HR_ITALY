import { db } from "@/lib/firebase/client";
import { 
  doc, 
  runTransaction, 
  serverTimestamp,
  getDoc
} from "firebase/firestore";
import { ContractStatus } from "@/types/contract";
import { createAuditLog } from "./audit.service";

/**
 * Moves a contract from draft to pending_signature.
 */
export async function sendContractToSignature(entityId: string, contractId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);

  await runTransaction(db, async (transaction) => {
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
 * Activates a contract and updates the linked employee.
 * Strictly prevents overwriting an existing active contract of a different ID.
 */
export async function activateContractAction(entityId: string, contractId: string, employeeId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  if (!employeeId) throw new Error("ID Employé manquant.");

  const contractRef = doc(db, `entities/${entityId}/contracts`, contractId);
  const employeeRef = doc(db, `entities/${entityId}/employees`, employeeId);

  await runTransaction(db, async (transaction) => {
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

import { updateDoc } from "firebase/firestore";
