import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDoc, 
  updateDoc, 
  getDocs, 
  serverTimestamp, 
  query, 
  where 
} from "firebase/firestore";
import { Membership } from "@/types/membership";
import { createAuditLog } from "./audit.service";
import { getEntityById } from "./entity.service";

export async function disableMembership(membershipId: string, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const membershipRef = doc(db, "memberships", membershipId);
  
  await updateDoc(membershipRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: adminUid,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

  try {
    await createAuditLog({
      userId: adminUid,
      action: "membership.disabled",
      resourceType: "membership",
      resourceId: membershipId,
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }
}

export async function reactivateMembership(membershipId: string, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const membershipRef = doc(db, "memberships", membershipId);
  
  await updateDoc(membershipRef, {
    status: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: adminUid,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

  try {
    await createAuditLog({
      userId: adminUid,
      action: "membership.reactivated",
      resourceType: "membership",
      resourceId: membershipId,
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }
}

export async function getActiveMembershipsByUid(uid: string): Promise<Membership[]> {
  if (!db) return [];
  const q = query(
    collection(db, "memberships"),
    where("uid", "==", uid),
    where("status", "==", "active")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Membership));
}

/**
 * Fetches active memberships and verifies that the linked entity is also active.
 */
export async function getValidActiveMembershipsByUid(uid: string): Promise<Membership[]> {
  const activeMemberships = await getActiveMembershipsByUid(uid);
  const validMemberships: Membership[] = [];

  for (const m of activeMemberships) {
    const entity = await getEntityById(m.entityId);
    if (entity && entity.status === "active") {
      validMemberships.push(m);
    }
  }

  return validMemberships;
}

/**
 * Fetches a specific membership and verifies both membership and entity are active.
 */
export async function getActiveMembershipForEntity(uid: string, entityId: string): Promise<{ membership: Membership, entity: any } | null> {
  if (!db) return null;
  const membershipId = `${uid}_${entityId}`;
  const mSnap = await getDoc(doc(db, "memberships", membershipId));
  
  if (!mSnap.exists()) return null;
  const membership = mSnap.data() as Membership;
  if (membership.status !== "active") return null;

  const entity = await getEntityById(entityId);
  if (!entity || entity.status !== "active") return null;

  return { membership, entity };
}

export async function getAllMemberships(): Promise<Membership[]> {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "memberships"));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Membership));
}
