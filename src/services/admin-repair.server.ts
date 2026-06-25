
/**
 * @fileOverview Server-side administration and data repair services using Firebase Admin SDK.
 * Bypasses client-side security rules for global scans and deterministic repairs.
 */

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

function isMissingEmployeeId(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function matchesIdentity(value: unknown, exactIdentityIds: string[], identityKeys: string[]): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return exactIdentityIds.includes(value) || identityKeys.includes(value.toLowerCase());
}

export interface RepairResults {
  employeesAnalyzed: number;
  contractsRepaired: number;
  documentsRepaired: number;
  employeePointersUpdated: number;
  exactIdentityIds: string[];
  identityKeys: string[];
  totalContractsScanned: number;
  totalDocumentsScanned: number;
  matchedContractIds: string[];
  matchedDocumentIds: string[];
  skippedConflicts: string[];
  dryRun: boolean;
}

/**
 * Performs a deterministic scan of an entity's records to repair missing employeeId links.
 * Server-only: Uses Admin SDK to bypass client-side list limitations.
 */
export async function repairEntityDataLinkageServer(params: {
  entityId: string;
  actorUid: string;
  dryRun: boolean;
  targetEmployeeId?: string;
}): Promise<RepairResults> {
  const { entityId, actorUid, dryRun, targetEmployeeId } = params;

  const results: RepairResults = {
    employeesAnalyzed: 0,
    contractsRepaired: 0,
    documentsRepaired: 0,
    employeePointersUpdated: 0,
    exactIdentityIds: [],
    identityKeys: [],
    totalContractsScanned: 0,
    totalDocumentsScanned: 0,
    matchedContractIds: [],
    matchedDocumentIds: [],
    skippedConflicts: [],
    dryRun
  };

  if (!targetEmployeeId) {
    // Global mode: Read all employees to report conflicts
    const allEmpSnap = await adminDb.collection("entities").doc(entityId).collection("employees").get();
    results.employeesAnalyzed = allEmpSnap.size;
    
    const personIdToEmployees = new Map<string, string[]>();
    allEmpSnap.docs.forEach(d => {
      const data = d.data();
      if (data.personId) {
        const list = personIdToEmployees.get(data.personId) || [];
        list.push(d.id);
        personIdToEmployees.set(data.personId, list);
      }
    });

    personIdToEmployees.forEach((ids, pid) => {
      if (ids.length > 1) {
        results.skippedConflicts.push(`Identity Conflict: Person ${pid} is shared by ${ids.length} employees: ${ids.join(', ')}`);
      }
    });

    return results;
  }

  // --- FORCED CANONICAL MODE ---
  const empRef = adminDb.collection("entities").doc(entityId).collection("employees").doc(targetEmployeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) throw new Error(`Employee ${targetEmployeeId} not found in entity ${entityId}`);
  const emp = empSnap.data()!;

  results.employeesAnalyzed = 1;
  const exactIdentityIds = Array.from(new Set([emp.personId, emp.sourceCandidateId].filter(Boolean) as string[]));
  const identityKeys = exactIdentityIds.map(id => id.toLowerCase());
  
  results.exactIdentityIds = exactIdentityIds;
  results.identityKeys = identityKeys;

  // 1. Scan ALL Contracts for the entity (Deterministic admin scan)
  const contractsRef = adminDb.collection("entities").doc(entityId).collection("contracts");
  const contractsSnap = await contractsRef.get();
  results.totalContractsScanned = contractsSnap.size;

  const contractsToUpdate: { id: string, ref: FirebaseFirestore.DocumentReference }[] = [];
  contractsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    
    // Skip if already linked to a DIFFERENT employee
    if (!isMissingEmployeeId(data.employeeId) && data.employeeId !== targetEmployeeId) {
       // We don't report this as conflict in targeted mode unless it matches our identity
       if (matchesIdentity(data.personId, exactIdentityIds, identityKeys)) {
          results.skippedConflicts.push(`Contract ${docSnap.id} matches identity but is already linked to ${data.employeeId}`);
       }
       return;
    }

    // Match orphaned records
    if (isMissingEmployeeId(data.employeeId) && matchesIdentity(data.personId, exactIdentityIds, identityKeys)) {
      contractsToUpdate.push({ id: docSnap.id, ref: docSnap.ref });
      results.matchedContractIds.push(docSnap.id);
      results.contractsRepaired++;
    }
  });

  // 2. Scan ALL Documents for the entity
  const docsRef = adminDb.collection("entities").doc(entityId).collection("documents");
  const docsSnap = await docsRef.get();
  results.totalDocumentsScanned = docsSnap.size;

  const docsToUpdate: { id: string, ref: FirebaseFirestore.DocumentReference, data: any }[] = [];
  docsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    
    if (!isMissingEmployeeId(data.employeeId) && data.employeeId !== targetEmployeeId) {
       return;
    }

    if (isMissingEmployeeId(data.employeeId) && (matchesIdentity(data.personId, exactIdentityIds, identityKeys) || matchesIdentity(data.candidateId, exactIdentityIds, identityKeys))) {
      docsToUpdate.push({ id: docSnap.id, ref: docSnap.ref, data });
      results.matchedDocumentIds.push(docSnap.id);
      results.documentsRepaired++;
    }
  });

  // 3. Apply Updates
  if (!dryRun) {
    const batch = adminDb.batch();
    const now = FieldValue.serverTimestamp();

    contractsToUpdate.forEach(item => {
      batch.update(item.ref, {
        employeeId: targetEmployeeId,
        personId: emp.personId, // Normalization: Align casing with employee record
        updatedAt: now,
        updatedBy: actorUid
      });
    });

    docsToUpdate.forEach(item => {
      const updatePayload: any = {
        employeeId: targetEmployeeId,
        employeeDisplayName: emp.displayName,
        updatedAt: now,
        updatedBy: actorUid
      };
      // Normalize personId if it matched our target identity
      if (matchesIdentity(item.data.personId, exactIdentityIds, identityKeys)) {
        updatePayload.personId = emp.personId;
      }
      batch.update(item.ref, updatePayload);
    });

    if (contractsToUpdate.length > 0 || docsToUpdate.length > 0) {
      await batch.commit();
    }

    // 4. Pointer Repair: Check for exactly one active contract
    const allLinkedContractsSnap = await adminDb.collection("entities").doc(entityId).collection("contracts")
      .where("employeeId", "==", targetEmployeeId)
      .get();
      
    const activeContracts = allLinkedContractsSnap.docs
      .map(d => d.data())
      .filter(c => c.status === "active");

    if (activeContracts.length === 1) {
      const activeId = allLinkedContractsSnap.docs.find(d => d.data().status === "active")!.id;
      if (emp.activeContractId !== activeId) {
        await empRef.update({
          activeContractId: activeId,
          updatedAt: FieldValue.serverTimestamp()
        });
        results.employeePointersUpdated = 1;
      }
    }
  }

  return results;
}

/**
 * Scans the entire memberships collection and repairs missing display metadata.
 * Uses Admin SDK to bypass client-side limitations.
 */
export async function repairMembershipMetadataServer(params: {
  actorUid: string;
  dryRun: boolean;
}) {
  const { actorUid, dryRun } = params;
  
  const results = {
    scanned: 0,
    repaired: 0,
    dryRun,
    logs: [] as string[]
  };

  try {
    const membershipsSnap = await adminDb.collection("memberships").get();
    results.scanned = membershipsSnap.size;

    for (const mDoc of membershipsSnap.docs) {
      const m = mDoc.data();
      const needsUserRepair = !m.userDisplayName || !m.userEmail;
      const needsEntityRepair = !m.entityName || m.entityName === "Entreprise";
      const needsRoleRepair = !m.roleLabel;

      if (needsUserRepair || needsEntityRepair || needsRoleRepair) {
        results.repaired++;
        
        if (dryRun) {
          results.logs.push(`WOULD REPAIR: Membership ${mDoc.id} (User: ${m.uid}, Entity: ${m.entityId})`);
          continue;
        }

        const updateData: any = {
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid
        };

        // 1. Fetch User Data
        if (needsUserRepair) {
          const uSnap = await adminDb.collection("users").doc(m.uid).get();
          if (uSnap.exists) {
            const u = uSnap.data()!;
            updateData.userDisplayName = u.displayName || u.email || "Utilisateur";
            updateData.userEmail = u.email;
          }
        }

        // 2. Fetch Entity Data
        if (needsEntityRepair) {
          const eSnap = await adminDb.collection("entities").doc(m.entityId).get();
          if (eSnap.exists) {
            const e = eSnap.data()!;
            updateData.entityName = e.nomEntreprise || e.name || e.legalName || "Entreprise";
          }
        }

        // 3. Role Label Fallback
        if (needsRoleRepair && m.roleId === 'employee') {
          updateData.roleLabel = "Employé";
        }

        await mDoc.ref.update(updateData);
        results.logs.push(`REPAIRED: Membership ${mDoc.id}`);
      }
    }

    return results;
  } catch (err: any) {
    console.error("[Membership Repair Service] Failed:", err);
    throw err;
  }
}
