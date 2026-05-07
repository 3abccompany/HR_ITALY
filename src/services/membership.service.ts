import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  getDocs, 
  serverTimestamp, 
  query, 
  where 
} from "firebase/firestore";
import { Membership } from "@/types/membership";
import { createAuditLog } from "./audit.service";
import { getEntityById } from "./entity.service";

export async function createMembership(data: {
  uid: string;
  entityId: string;
  roleId: string;
  userDisplayName: string;
  userEmail: string;
  entityName: string;
  roleLabel: string;
  permissions: string[];
  notes?: string;
}, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const membershipId = `${data.uid}_${data.entityId}`;
  const membershipRef = doc(db, "memberships", membershipId);
  
  const existing = await getDoc(membershipRef);
  if (existing.exists()) {
    throw new Error("Une affectation existe déjà pour cet utilisateur et cette entreprise.");
  }

  const membershipData: Membership = {
    ...data,
    membershipId,
    userId: data.uid,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid,
  };

  await setDoc(membershipRef, membershipData);

  try {
    await createAuditLog({
      userId: adminUid,
      entityId: data.entityId,
      action: "membership.created",
      resourceType: "membership",
      resourceId: membershipId,
      details: { uid: data.uid, roleId: data.roleId }
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }

  return membershipId;
}

export async function updateMembership(membershipId: string, data: Partial<Membership>, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const membershipRef = doc(db, "memberships", membershipId);
  
  await updateDoc(membershipRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

  try {
    await createAuditLog({
      userId: adminUid,
      action: "membership.updated",
      resourceType: "membership",
      resourceId: membershipId,
      details: data
    });
  } catch (err) {
    console.warn("Audit log failed:", err);
  }
}

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
