import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { executeRenewalActivationServerTransaction } from "@/services/contract.server";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/process-contract-activations
 * Automatically activates signed CDD renewals on their start date.
 * Default: Dry-run. Use ?execute=1 for live writes.
 */
export async function GET(request: NextRequest) {
  // 1. Security Check
  const authHeader = request.headers.get("x-cron-secret");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Cron:ContractActivation] CRON_SECRET not configured in environment.");
    return NextResponse.json({ error: "Configuration error" }, { status: 500 });
  }

  if (authHeader !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const execute = searchParams.get("execute") === "1";
  const mode = execute ? "execute" : "dryRun";

  const summary = {
    ok: true,
    mode,
    scanned: 0,
    eligible: 0,
    activated: 0,
    skipped: 0,
    failed: 0,
    results: [] as any[]
  };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 2. Discover Entities
    const entitiesSnap = await adminDb.collection("entities").get();
    
    for (const entityDoc of entitiesSnap.docs) {
      const entityId = entityDoc.id;
      const entityData = entityDoc.data();
      
      if (entityData.status !== "active") continue;

      // 3. Find candidates for activation
      const contractsSnap = await adminDb
        .collection("entities")
        .doc(entityId)
        .collection("contracts")
        .where("status", "==", "pending_activation")
        .get();

      summary.scanned += contractsSnap.size;

      for (const contractDoc of contractsSnap.docs) {
        const contractId = contractDoc.id;
        const contract = contractDoc.data();

        // 4. Date Filtering
        const startDateVal = contract.startDate;
        let startDate: Date | null = null;

        if (startDateVal instanceof Timestamp) {
          startDate = startDateVal.toDate();
        } else if (typeof startDateVal === 'string') {
          startDate = new Date(startDateVal);
        }

        if (!startDate || isNaN(startDate.getTime())) {
          summary.skipped++;
          summary.results.push({ entityId, contractId, status: "skipped", reason: "Invalid or missing startDate" });
          continue;
        }

        const startCompare = new Date(startDate);
        startCompare.setHours(0, 0, 0, 0);

        if (startCompare > today) {
          // Future contract, wait
          continue;
        }

        summary.eligible++;

        // 5. Execution
        if (!execute) {
          summary.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "eligible", reason: "Dry run: ready for activation" });
          continue;
        }

        try {
          await executeRenewalActivationServerTransaction({
            entityId,
            newContractId: contractId,
            actorUid: "system:cron"
          });
          
          summary.activated++;
          summary.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "activated" });
        } catch (err: any) {
          summary.failed++;
          console.error(`[Cron:ContractActivation] Failed for ${contractId}:`, err.message);
          summary.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "failed", reason: err.message });
        }
      }
    }

    return NextResponse.json(summary);

  } catch (err: any) {
    console.error("[Cron:ContractActivation] Global Error:", err);
    return NextResponse.json({ 
      ok: false, 
      error: "Global execution error",
      details: err.message 
    }, { status: 500 });
  }
}
