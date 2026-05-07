
import { db } from "@/lib/firebase/client";
import { doc, setDoc, serverTimestamp, writeBatch, collection, getDocs } from "firebase/firestore";
import { MVP_PERMISSIONS } from "@/config/permissions";
import { createAuditLog } from "./audit.service";

/**
 * Seeds the permission catalogue in Firestore.
 * This function is idempotent: it uses setDoc with merge: true.
 */
export async function seedPermissions(adminUid: string): Promise<number> {
  if (!db) throw new Error("Firestore not initialized");

  let count = 0;
  
  // Using batches for efficiency (Firestore allows up to 500 operations per batch)
  const batch = writeBatch(db);

  for (const def of MVP_PERMISSIONS) {
    const permRef = doc(db, "permissions", def.code);
    
    // We only set fields if they don't exist or need update, merge: true preserves custom fields
    batch.set(permRef, {
      ...def,
      status: "active",
      updatedAt: serverTimestamp(),
      updatedBy: adminUid,
      // Note: createdAt and createdBy would ideally be set only if not exists, 
      // but set with merge is simpler for a seed tool.
      createdAt: serverTimestamp(),
      createdBy: adminUid
    }, { merge: true });
    
    count++;
  }

  await batch.commit();

  // Audit Log
  try {
    await createAuditLog({
      userId: adminUid,
      action: "permissions.seeded",
      resourceType: "system",
      resourceId: "catalogue",
      details: { permissionsCount: count }
    });
  } catch (err) {
    console.warn("Failed to write audit log for permissions seed:", err);
  }

  return count;
}

/**
 * Retrieves all permissions from the catalogue.
 */
export async function getAllPermissions() {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "permissions"));
  return snapshot.docs.map(doc => doc.data());
}
