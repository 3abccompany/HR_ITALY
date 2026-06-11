/**
 * @fileOverview Server-only contract services using Firebase Admin SDK.
 * Bypasses client-side security rules for atomic system-level transitions.
 */

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Normalizes various date formats into a comparable YYYY-MM-DD string or Date object.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val instanceof Timestamp) return val.toDate();
  if (typeof val === 'object' && (val._seconds !== undefined || val.seconds !== undefined)) {
    return new Date((val._seconds || val.seconds) * 1000);
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Sanitizes a payload for Firestore by removing undefined values.
 */
function sanitize(obj: any): any {
  return JSON.parse(JSON.stringify(obj, (k, v) => (v === undefined ? null : v)));
}

/**
 * Performs an atomic transition from an old active or expired contract to a new renewal contract.
 * Validates integrity across multiple documents: Old Contract, New Contract, and Employee.
 */
export async function executeRenewalActivationServerTransaction(params: {
  entityId: string;
  newContractId: string;
  actorUid: string;
}): Promise<{
  entityId: string;
  oldContractId: string;
  newContractId: string;
  employeeId: string;
  status: "activated";
}> {
  const { entityId, newContractId, actorUid } = params;

  const newContractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(newContractId);

  return await adminDb.runTransaction(async (transaction) => {
    // 1. READ: New Contract
    const newSnap = await transaction.get(newContractRef);
    if (!newSnap.exists) throw new Error(`Contract ${newContractId} not found.`);
    const newContract = newSnap.data()!;

    // 2. VALIDATE: New Contract State
    if (newContract.status !== "pending_activation") {
      throw new Error(`Ineligible status: ${newContract.status}. Expected pending_activation.`);
    }

    const startDate = parseSafeDate(newContract.startDate);
    if (!startDate) throw new Error("Missing or invalid start date.");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startCompare = new Date(startDate);
    startCompare.setHours(0, 0, 0, 0);

    if (startCompare > today) {
      throw new Error(`Start date ${newContract.startDate} is in the future.`);
    }

    if (!newContract.previousContractId) throw new Error("Not a renewal: missing previousContractId.");
    if (!newContract.employeeId) throw new Error("Missing employeeId.");
    if (!newContract.signedDocumentId && !newContract.signedDocumentStoragePath) {
      throw new Error("Activation blocked: signed document missing.");
    }

    // 3. READ: Old Contract, Employee, and check for unrelated active contracts
    const oldContractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(newContract.previousContractId);
    const employeeRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(newContract.employeeId);
    
    // Safety check query: Find any contract for this employee with 'active' status
    const otherActiveQuery = adminDb.collection("entities")
      .doc(entityId)
      .collection("contracts")
      .where("employeeId", "==", newContract.employeeId)
      .where("status", "==", "active");

    const [oldSnap, empSnap, activeContractsSnap] = await Promise.all([
      transaction.get(oldContractRef),
      transaction.get(employeeRef),
      transaction.get(otherActiveQuery)
    ]);

    // 4. VALIDATE: Chain Integrity
    if (!oldSnap.exists) throw new Error("Previous contract not found.");
    const oldContract = oldSnap.data()!;

    // Support 'active' or 'expired' old contracts (Phase 4C Support)
    if (!["active", "expired"].includes(oldContract.status)) {
      throw new Error(`Previous contract status is ${oldContract.status}. Expected active or expired.`);
    }

    if (oldContract.pendingRenewalContractId !== newContractId) {
      throw new Error("Chain inconsistency: old contract is not linked to this renewal.");
    }

    if (!empSnap.exists) throw new Error("Employee not found.");
    const employee = empSnap.data()!;

    // Pointer validation rules
    if (oldContract.status === "active") {
      // If the old contract is still active, the employee pointer MUST point to it
      if (employee.activeContractId !== newContract.previousContractId) {
        throw new Error("Safety block: employee active pointer does not match the expected old active contract.");
      }
    } else {
      // If the old contract has expired, the pointer may be null or still point to the old ID.
      // But it MUST NOT point to an unrelated active contract.
      if (employee.activeContractId && employee.activeContractId !== newContract.previousContractId) {
        throw new Error("Safety block: employee already has an active contract that is not part of this renewal chain.");
      }
    }

    // Unrelated active contract conflict prevention
    const unrelatedActive = activeContractsSnap.docs.filter(d => d.id !== newContract.previousContractId);
    if (unrelatedActive.length > 0) {
      throw new Error(`Activation blocked: employee already has an unrelated active contract (${unrelatedActive[0].id}).`);
    }

    // 5. WRITE: Perform Atomic Swap
    const now = FieldValue.serverTimestamp();

    // A. Update Old Contract
    transaction.update(oldContractRef, {
      status: "renewed",
      renewedByContractId: newContractId,
      pendingRenewalContractId: null, // Clear pending status as it's now realized
      updatedAt: now,
      updatedBy: actorUid
    });

    // B. Update New Contract
    transaction.update(newContractRef, {
      status: "active",
      activatedAt: now,
      activatedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid
    });

    // C. Update Employee
    transaction.update(employeeRef, {
      activeContractId: newContractId,
      updatedAt: now
    });

    // D. Record Timeline Event
    if (newContract.personId) {
      const timelineRef = adminDb.collection("entities").doc(entityId).collection("personTimeline").doc();
      transaction.set(timelineRef, sanitize({
        eventId: timelineRef.id,
        entityId,
        personId: newContract.personId,
        employeeId: newContract.employeeId,
        contractId: newContractId,
        type: "contract.auto_activated",
        label: "Renouvellement activé",
        description: `Activation automatique du contrat ${newContract.employeeCode || newContractId} le ${newContract.startDate}.`,
        sourceCollection: "contracts",
        sourceId: newContractId,
        createdAt: now,
        createdBy: actorUid
      }));
    }

    // E. Record Audit Log
    const auditRef = adminDb.collection("auditLogs").doc();
    transaction.set(auditRef, sanitize({
      userId: actorUid,
      entityId,
      action: "contract.auto_activation_executed",
      resourceType: "contract",
      resourceId: newContractId,
      details: {
        oldContractId: newContract.previousContractId,
        employeeId: newContract.employeeId,
        startDate: newContract.startDate
      },
      timestamp: now
    }));

    return {
      entityId,
      oldContractId: newContract.previousContractId as string,
      newContractId,
      employeeId: newContract.employeeId as string,
      status: "activated" as const
    };
  });
}
