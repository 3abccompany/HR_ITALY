"use server";

import { adminAuth, adminBucket, adminDb } from "@/lib/firebase/admin";
import type { Contract } from "@/types/contract";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const CONTRACT_READ_PERMISSION = "contracts.read";
const DOCUMENT_READ_PERMISSION = "documents.read";

type EmployeeSignedContractUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

async function authorizeSignedContractRead(entityId: string, idToken: string) {
  if (!entityId || !idToken || !adminAuth || !adminDb) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const actorUid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap] = await Promise.all([
    adminDb.collection("users").doc(actorUid).get(),
    adminDb.collection("entities").doc(entityId).get(),
    adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  if (!entitySnap.exists || entitySnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const membership = membershipSnap.data();
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  if (
    !membershipSnap.exists
    || membership?.status !== "active"
    || !permissions.includes(CONTRACT_READ_PERMISSION)
    || !permissions.includes(DOCUMENT_READ_PERMISSION)
  ) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { actorUid };
}

function isSameContractSignedStoragePath(storagePath: string, entityId: string, contractId: string) {
  return (
    storagePath.startsWith(`entities/${entityId}/contracts/${contractId}/signed-contract/`)
    || storagePath.startsWith(`entities/${entityId}/contracts/${contractId}/signed-returns/`)
  );
}

export async function getEmployeeSignedContractUrlAction(params: {
  idToken: string;
  entityId: string;
  contractId: string;
}): Promise<EmployeeSignedContractUrlResult> {
  try {
    const { idToken, entityId, contractId } = params;
    if (!adminDb || !adminBucket) throw new Error("Service administrateur indisponible.");
    if (!contractId) throw new Error("Contrat requis.");

    await authorizeSignedContractRead(entityId, idToken);

    const contractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId);
    const contractSnap = await contractRef.get();
    if (!contractSnap.exists) throw new Error(SAFE_FORBIDDEN_MESSAGE);

    const contract = { ...(contractSnap.data() as Contract), contractId: contractSnap.id };
    if (contract.entityId !== entityId || contract.contractId !== contractId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }

    let storagePath = "";
    let fileName = contract.signedDocumentFileName || "contrat-signe.pdf";

    if (contract.signedDocumentId) {
      const documentSnap = await adminDb
        .collection("entities")
        .doc(entityId)
        .collection("documents")
        .doc(contract.signedDocumentId)
        .get();

      if (!documentSnap.exists) throw new Error(SAFE_FORBIDDEN_MESSAGE);

      const documentData = documentSnap.data() || {};
      const linkedToContract = (
        documentData.contractId === contractId
        || (documentData.relatedModule === "contracts" && documentData.relatedId === contractId)
        || documentData.sourceKey === `contract:${contractId}:signed_document`
        || (!!contract.signedDocumentStoragePath && documentData.storagePath === contract.signedDocumentStoragePath)
      );

      if (
        documentData.entityId !== entityId
        || documentData.documentType !== "signed_contract"
        || !linkedToContract
        || !documentData.storagePath
      ) {
        throw new Error(SAFE_FORBIDDEN_MESSAGE);
      }

      storagePath = documentData.storagePath;
      fileName = documentData.fileName || fileName;
    } else if (contract.signedDocumentStoragePath) {
      storagePath = contract.signedDocumentStoragePath;
    }

    if (!storagePath || !isSameContractSignedStoragePath(storagePath, entityId, contractId)) {
      throw new Error("Document signé introuvable.");
    }

    const [url] = await adminBucket.file(storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
      responseDisposition: `inline; filename="${fileName}"`,
    });

    return { success: true, url };
  } catch (err: any) {
    console.error("[Contract Signed Document] URL failed:", err);
    return { success: false, error: err.message || "Document indisponible." };
  }
}
