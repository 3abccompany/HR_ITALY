import { db } from "@/lib/firebase/client";
import { collection, query, where, getDocs } from "firebase/firestore";
import { Membership } from "@/types/membership";

export async function getActiveMembershipsByUid(uid: string): Promise<Membership[]> {
  const q = query(
    collection(db, "memberships"),
    where("uid", "==", uid),
    where("status", "==", "active")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Membership));
}

export async function getMembershipsByEntityId(entityId: string): Promise<Membership[]> {
  const q = query(
    collection(db, "memberships"),
    where("entityId", "==", entityId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Membership));
}