import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { executeRenewalActivationServerTransaction, processContractExpirationsServer } from "@/services/contract.server";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/process-contract-activations
 * Automated contract lifecycle management:
 * 1. Step 1: Scan and mark expired CDDs (endDate < today)
 * 2. Step 2: Activate signed CDD renewals on their start date (startDate <= today)
 * 
 * Default: Dry-run. Use ?execute=1 for live writes.
 */
export async function GET(request: NextRequest) {
  // 1. Security Check
  const authHeader = request.headers.get("x-cron-secret");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Cron:Global] CRON_SECRET not configured in environment.");
    return NextResponse.json({ error: "Configuration error" }, { status: 500 });
  }

  if (authHeader !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const execute = searchParams.get("execute") === "1";
  const mode = execute ? "execute" : "dryRun";
  const today = new Date();

  try {
    // 2. Step 1: Process Expirations
    const expirationResults = await processContractExpirationsServer({
      actorUid: "system:cron",
      execute,
      today
    });

    // 3. Step 2: Discover and Process Activations
    const activationResults = {
      scanned: 0,
      eligible: 0,
      activated: 0,
      skipped: 0,
      failed: 0,
      results: [] as any[]
    };

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    // Discover Entities
    const entitiesSnap = await adminDb.collection("entities").get();
    
    for (const entityDoc of entitiesSnap.docs) {
      const entityId = entityDoc.id;
      const entityData = entityDoc.data();
      
      if (entityData.status !== "active") continue;

      // Find candidates for activation
      const contractsSnap = await adminDb
        .collection("entities")
        .doc(entityId)
        .collection("contracts")
        .where("status", "==", "pending_activation")
        .get();

      activationResults.scanned += contractsSnap.size;

      for (const contractDoc of contractsSnap.docs) {
        const contractId = contractDoc.id;
        const contract = contractDoc.data();

        // Date Filtering
        const startDateVal = contract.startDate;
        let startDate: Date | null = null;

        if (startDateVal instanceof Timestamp) {
          startDate = startDateVal.toDate();
        } else if (typeof startDateVal === 'string') {
          startDate = new Date(startDateVal);
        }

        if (!startDate || isNaN(startDate.getTime())) {
          activationResults.skipped++;
          activationResults.results.push({ entityId, contractId, status: "skipped", reason: "Invalid or missing startDate" });
          continue;
        }

        const startCompare = new Date(startDate);
        startCompare.setHours(0, 0, 0, 0);

        if (startCompare > todayStart) {
          // Future contract, wait
          continue;
        }

        activationResults.eligible++;

        // Execution
        if (!execute) {
          activationResults.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "eligible", reason: "Dry run: ready for activation" });
          continue;
        }

        try {
          await executeRenewalActivationServerTransaction({
            entityId,
            newContractId: contractId,
            actorUid: "system:cron"
          });
          
          activationResults.activated++;
          activationResults.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "activated" });
        } catch (err: any) {
          activationResults.failed++;
          console.error(`[Cron:Activation] Failed for ${contractId}:`, err.message);
          activationResults.results.push({ entityId, contractId, employeeId: contract.employeeId, status: "failed", reason: err.message });
        }
      }
    }

    // 4. Combined Response
    return NextResponse.json({
      ok: true,
      mode,
      expirations: {
        scanned: expirationResults.scanned,
        eligible: expirationResults.eligible,
        expired: expirationResults.expired,
        skipped: expirationResults.skipped,
        failed: expirationResults.failed,
        results: expirationResults.results
      },
      activations: activationResults,
      summary: {
        totalScanned: expirationResults.scanned + activationResults.scanned,
        totalEligible: expirationResults.eligible + activationResults.eligible,
        totalWrites: expirationResults.expired + activationResults.activated,
        totalFailed: expirationResults.failed + activationResults.failed
      }
    });

  } catch (err: any) {
    console.error("[Cron:Global] Error:", err);
    return NextResponse.json({ 
      ok: false, 
      error: "Global execution error",
      details: err.message 
    }, { status: 500 });
  }
}