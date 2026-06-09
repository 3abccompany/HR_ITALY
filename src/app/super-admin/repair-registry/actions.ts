'use server';

/**
 * @fileOverview Server actions for administrative repairs.
 * Encapsulates security verification and Admin SDK logic.
 */

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { repairEntityDataLinkageServer, RepairResults } from "@/services/admin-repair.server";

interface RepairActionParams {
  entityId: string;
  dryRun: boolean;
  canonicalEmployeeId?: string;
  idToken: string;
}

export async function repairEntityDataLinkageAction(params: RepairActionParams): Promise<{ success: boolean; results?: RepairResults; error?: string }> {
  const { entityId, dryRun, canonicalEmployeeId, idToken } = params;

  try {
    // 1. Authenticate and authorize session
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userSnap = await adminDb.collection("users").doc(uid).get();
    const userData = userSnap.data();
    
    if (userData?.platformRole !== "superAdmin") {
      throw new Error("ACCES_REFUSE: Privilèges de Super Administrateur requis.");
    }

    // 2. Execute Repair
    const results = await repairEntityDataLinkageServer({
      entityId,
      actorUid: uid,
      dryRun,
      targetEmployeeId: canonicalEmployeeId
    });

    return { 
      success: true, 
      results 
    };
  } catch (err: any) {
    console.error("[Repair Action Error]", err);
    return { 
      success: false, 
      error: err.message || "Une erreur technique est survenue lors de la réparation." 
    };
  }
}
