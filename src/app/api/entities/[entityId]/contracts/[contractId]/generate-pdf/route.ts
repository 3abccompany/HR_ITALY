import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { ContractPdfTemplate } from "@/components/contracts/ContractPdfTemplate";
import { Contract } from "@/types/contract";

export const dynamic = 'force-dynamic';

/**
 * Validates that the contract contains all mandatory legal snapshots.
 */
function validateContractData(contract: Contract) {
  const missing: string[] = [];
  if (!contract.entityLegalName) missing.push("Raison sociale employeur");
  if (!contract.companyAddressSnapshot) missing.push("Adresse employeur");
  if (!contract.employeeDisplayName) missing.push("Nom salarié");
  if (!contract.taxCode) missing.push("Code fiscal");
  if (!contract.employeeAddressSnapshot) missing.push("Adresse salarié");
  if (!contract.jobTitleName) missing.push("Intitulé poste");
  if (!contract.ccnlName) missing.push("Convention collective (CCNL)");
  if (!contract.startDate) missing.push("Date début");
  
  const grossMonthly = (contract as any).grossMonthly;
  if (grossMonthly === undefined || grossMonthly === null || isNaN(Number(grossMonthly))) {
    missing.push("Rémunération");
  }
  
  if (!contract.weeklyHours) missing.push("Temps de travail");

  return missing;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string, contractId: string }> }
) {
  const { entityId, contractId } = await params;

  try {
    // 1. Auth & Permission Check
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const token = authHeader.split(" ")[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    const uid = decodedToken.uid;

    const membershipId = `${uid}_${entityId}`;
    const mSnap = await adminDb.collection("memberships").doc(membershipId).get();
    
    if (!mSnap.exists || mSnap.data()?.status !== 'active') {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const permissions = mSnap.data()?.permissions || [];
    if (!permissions.includes("contracts.create") && !permissions.includes("contracts.update")) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // 2. Load Contract
    const contractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId);
    const contractSnap = await contractRef.get();

    if (!contractSnap.exists) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const contract = contractSnap.data() as Contract;

    // 3. Status Check
    if (contract.status === "active" || contract.status === "terminated") {
      return NextResponse.json({ error: "Cannot regenerate PDF for an active or terminated contract." }, { status: 400 });
    }

    // 4. Content Validation
    const missingFields = validateContractData(contract);
    if (missingFields.length > 0) {
      return NextResponse.json({ 
        error: "Impossible de générer le contrat PDF. Champs légaux manquants.",
        details: missingFields 
      }, { status: 400 });
    }

    // 5. Render PDF
    // Cast to any to satisfy react-pdf renderer element type requirements
    const buffer = await renderToBuffer(React.createElement(ContractPdfTemplate, { contract }) as any);

    // 6. Upload to Storage
    const nextVersion = (contract.generatedPdfVersion || 0) + 1;
    const fileName = `contract-v${nextVersion}.pdf`;
    const storagePath = `entities/${entityId}/contracts/${contractId}/generated/${fileName}`;
    const file = adminBucket.file(storagePath);

    await file.save(buffer, {
      contentType: 'application/pdf',
      metadata: {
        metadata: {
          contractId,
          version: nextVersion,
          generatedBy: uid
        }
      }
    });

    // 7. Get Signed URL (6 days expiration)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 6 * 24 * 60 * 60 * 1000,
    });

    // 8. Update Contract Document
    const updatePayload = {
      generatedPdfUrl: signedUrl,
      generatedPdfStoragePath: storagePath,
      generatedPdfFileName: fileName,
      generatedPdfVersion: nextVersion,
      generatedPdfAt: FieldValue.serverTimestamp(),
      generatedPdfBy: uid,
      generatedPdfStatus: "generated",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid
    };

    await contractRef.update(updatePayload);

    // 9. Mirror to Centralized Documents Registry (Phase 2A)
    // Server-side call using Admin SDK to bypass client security rules for automated mirror
    (async () => {
       const mirrorSourceKey = `contract:${contractId}:generated_pdf:v${nextVersion}`;
       const mirrorTitle = `PDF contrat généré - ${contract.employeeDisplayName || "Salarié"} (V${nextVersion})`;
       
       const docsRef = adminDb.collection("entities").doc(entityId).collection("documents");
       const mirrorSnap = await docsRef.where("sourceKey", "==", mirrorSourceKey).limit(1).get();
       
       const mirrorPayload = {
         entityId,
         title: mirrorTitle,
         documentType: "generated_contract_pdf",
         status: "valid",
         relatedModule: "contracts",
         relatedId: contractId,
         contractId,
         employeeId: contract.employeeId,
         personId: contract.personId,
         employeeDisplayName: contract.employeeDisplayName || "Salarié",
         fileName: fileName,
         mimeType: "application/pdf",
         storagePath: storagePath,
         source: "contract_pdf_generation",
         sourceKey: mirrorSourceKey,
         version: nextVersion,
         generatedAt: FieldValue.serverTimestamp(),
         generatedBy: uid,
         isSensitive: true,
         isRequired: true,
         uploadedAt: FieldValue.serverTimestamp(),
         uploadedBy: uid,
         uploadedByDisplayName: "Système",
         updatedAt: FieldValue.serverTimestamp(),
         updatedBy: uid,
         // Mirror expiry for fixed-term contracts
         expiresAt: contract.contractType === 'Tempo determinato' ? (contract.endDate || null) : null,
         contractType: contract.contractType || null,
         contractStartDate: contract.startDate || null,
         contractEndDate: contract.endDate || null
       };

       if (!mirrorSnap.empty) {
         await docsRef.doc(mirrorSnap.docs[0].id).update(mirrorPayload);
       } else {
         const newMirrorRef = docsRef.doc();
         await newMirrorRef.set({
           ...mirrorPayload,
           id: newMirrorRef.id,
           createdAt: FieldValue.serverTimestamp(),
           createdBy: uid
         });
       }
    })().catch(err => console.error("[Documents Mirroring Error] PDF registration failed:", err));

    return NextResponse.json({ 
      success: true, 
      url: signedUrl,
      version: nextVersion 
    });

  } catch (err: any) {
    console.error("[PDF Generation API Error]", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
