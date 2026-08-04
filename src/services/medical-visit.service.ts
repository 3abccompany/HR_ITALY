import { db } from "@/lib/firebase/client";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

/**
 * Temporary legacy certificate-link helper.
 *
 * Medical visit create/update/result/archive mutations now use secured Server
 * Actions. Certificate upload/view/link hardening is intentionally deferred to
 * Medical Visits Batch 1B, so this helper preserves the existing certificate
 * workflow without keeping the former broad updateMedicalVisit export active.
 */
export async function linkMedicalVisitCertificateClientSide(
  entityId: string,
  visitId: string,
  documentId: string,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const visitRef = doc(db, `entities/${entityId}/medicalVisits`, visitId);
  await updateDoc(visitRef, {
    documentId,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}
