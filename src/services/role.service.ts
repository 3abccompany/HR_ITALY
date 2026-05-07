
import { db } from "@/lib/firebase/client";
import { doc, serverTimestamp, writeBatch, collection, getDocs } from "firebase/firestore";
import { MVP_ROLES } from "@/config/roles";
import { createAuditLog } from "./audit.service";

/**
 * Seeds the role templates catalogue in Firestore.
 * This function is idempotent: it uses setDoc with merge: true.
 */
export async function seedRoles(adminUid: string): Promise<number> {
  if (!db) throw new Error("Firestore not initialized");

  let count = 0;
  const batch = writeBatch(db);

  for (const def of MVP_ROLES) {
    const roleRef = doc(db, "roles", def.roleId);
    
    batch.set(roleRef, {
      roleId: def.roleId,
      name: def.name,
      label: def.label,
      description: def.description,
      scope: def.scope,
      permissions: def.getPermissions(),
      status: "active",
      updatedAt: serverTimestamp(),
      updatedBy: adminUid,
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
      action: "roles.seeded",
      resourceType: "system",
      resourceId: "roles-catalogue",
      details: { 
        rolesCount: count, 
        roleIds: MVP_ROLES.map(r => r.roleId) 
      }
    });
  } catch (err) {
    console.warn("Failed to write audit log for roles seed:", err);
  }

  return count;
}

/**
 * Retrieves all role templates from the catalogue.
 */
export async function getAllRoles() {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "roles"));
  return snapshot.docs.map(doc => doc.data());
}
