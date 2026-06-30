'use server';

/**
 * @fileOverview Secure server actions for employee contract management.
 * Focuses on allowing employees to access their own contracts and return signed copies.
 */

import { adminDb, adminAuth, adminBucket } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Validates the authenticated user and retrieves their employee profile.
 */
async function getVerifiedEmployee(entityId: string, idToken: string) {
  const decodedToken = await adminAuth.verifyIdToken(idToken);
  const uid = decodedToken.uid;

  const employeeSnap = await adminDb.collection("entities").doc(entityId).collection("employees")
    .where("userId", "==", uid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (employeeSnap.empty) {
    throw new Error("Aucun profil employé actif trouvé pour cet utilisateur.");
  }

  return { uid, employee: employeeSnap.docs[0].data(), employeeRef: employeeSnap.docs[0].ref };
}

/**
 * Generates a secure, short-lived signed URL for an employee to view a contract file.
 * Verifies ownership before generating the link.
 */
export async function getContractSignedUrlAction(params: {
  entityId: string;
  contractId: string;
  idToken: string;
  type: "generated" | "signed";
}) {
  const { entityId, contractId, idToken, type } = params;
  if (!adminDb || !adminBucket) throw new Error("Service indisponible.");

  const { employee } = await getVerifiedEmployee(entityId, idToken);
  
  const contractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId);
  const contractSnap = await contractRef.get();
  
  if (!contractSnap.exists) throw new Error("Contrat introuvable.");
  const contract = contractSnap.data()!;

  // Security: Ownership check
  if (contract.employeeId !== employee.employeeId) {
    throw new Error("Action non autorisée.");
  }

  let storagePath = "";
  if (type === "generated") {
    storagePath = contract.generatedPdfStoragePath;
  } else {
    if (!contract.signedDocumentId) throw new Error("Document signé introuvable.");
    const docSnap = await adminDb.collection("entities").doc(entityId).collection("documents").doc(contract.signedDocumentId).get();
    storagePath = docSnap.data()?.storagePath;
  }

  if (!storagePath) {
    throw new Error("Le fichier demandé n'est pas encore disponible.");
  }

  const file = adminBucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  });

  return { url };
}

/**
 * Uploads a signed contract PDF returned by the employee.
 * Updates the contract record with the new signedDocumentId.
 */
export async function uploadSignedContractAction(params: {
  entityId: string;
  contractId: string;
  idToken: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
}) {
  const { entityId, contractId, idToken, fileBase64, fileName, mimeType } = params;
  if (!adminDb || !adminBucket) throw new Error("Service indisponible.");

  const { uid, employee } = await getVerifiedEmployee(entityId, idToken);

  const contractRef = adminDb.collection("entities").doc(entityId).collection("contracts").doc(contractId);

  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(contractRef);
    if (!snap.exists) throw new Error("Contrat introuvable.");
    const contract = snap.data()!;

    // Security: Ownership and context checks
    if (contract.employeeId !== employee.employeeId) throw new Error("Action non autorisée.");
    
    // Status check: only allow upload if not already active/terminated
    const allowedStatuses = ["draft", "pending_signature", "pending_activation"];
    if (!allowedStatuses.includes(contract.status)) {
      throw new Error(`Le statut actuel du contrat (${contract.status}) ne permet pas l'import d'une signature.`);
    }

    // 1. Process File Buffer
    const base64Data = fileBase64.split(',')[1] || fileBase64;
    const buffer = Buffer.from(base64Data, 'base64');
    
    if (buffer.length > 10 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 10Mo).");
    const allowedMimes = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowedMimes.includes(mimeType)) throw new Error("Format non supporté (PDF, PNG, JPG uniquement).");

    const docId = adminDb.collection("entities").doc(entityId).collection("documents").doc().id;
    const extension = fileName.split('.').pop() || (mimeType === 'application/pdf' ? 'pdf' : 'jpg');
    const storagePath = `entities/${entityId}/contracts/${contractId}/signed-returns/${docId}_${Date.now()}.${extension}`;
    const file = adminBucket.file(storagePath);

    await file.save(buffer, {
      contentType: mimeType,
      metadata: { 
        metadata: { 
          contractId, 
          employeeId: employee.employeeId, 
          uploadedBy: uid,
          source: "employee_my_space" 
        } 
      }
    });

    // 2. Create HRDocument metadata
    const docRef = adminDb.collection("entities").doc(entityId).collection("documents").doc(docId);
    const now = FieldValue.serverTimestamp();
    
    transaction.set(docRef, {
      id: docId,
      entityId,
      title: `Contrat signé retourné - ${employee.displayName}`,
      documentType: "signed_contract",
      status: "valid",
      storagePath,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      employeeId: employee.employeeId,
      employeeDisplayName: employee.displayName,
      personId: employee.personId || null,
      contractId,
      relatedModule: "contracts",
      relatedId: contractId,
      version: 1,
      isSensitive: false,
      uploadedAt: now,
      uploadedBy: uid,
      uploadedByDisplayName: employee.displayName,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    // 3. Update Contract Pointer
    transaction.update(contractRef, {
      signedDocumentId: docId,
      signedDocumentUploadedBy: "employee",
      signedDocumentUploadedAt: now,
      updatedAt: now
    });

    return { docId };
  });

  // 4. Trigger Notification for HR (Non-blocking)
  try {
    const hrNotifRef = adminDb.collection("entities").doc(entityId).collection("notifications").doc();
    await hrNotifRef.set({
      id: hrNotifRef.id,
      entityId,
      targetPermission: "contracts.read",
      audience: "hr",
      category: "contract",
      severity: "success",
      title: "Contrat signé reçu",
      message: `Un contrat signé a été transmis par ${employee.displayName}.`,
      actionUrl: `/entity/${entityId}/contracts/${contractId}`,
      status: "unread",
      dedupKey: `contract:${contractId}:signed_uploaded`,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.warn("[uploadSignedContractAction] Notification failed:", err);
  }

  return { success: true, documentId: result.docId };
}
