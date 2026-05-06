import { db } from "@/lib/firebase/client";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";

export interface AuditLogInput {
  userId: string;
  entityId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: any;
}

export async function createAuditLog(input: AuditLogInput) {
  const auditRef = doc(collection(db, "auditLogs"));
  await setDoc(auditRef, {
    ...input,
    timestamp: serverTimestamp(),
  });
}