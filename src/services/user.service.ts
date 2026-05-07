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
  orderBy 
} from "firebase/firestore";
import { AppUser } from "@/types/user";
import { createAuditLog } from "./audit.service";

export async function getUserProfile(uid: string): Promise<AppUser | null> {
  if (!db) return null;
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? (snap.data() as AppUser) : null;
}

export async function createUserProfile(data: Omit<AppUser, 'createdAt' | 'updatedAt' | 'status'>, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const userRef = doc(db, "users", data.uid);
  const existing = await getDoc(userRef);
  
  if (existing.exists()) {
    throw new Error("A profile for this UID already exists.");
  }

  const userData: AppUser = {
    ...data,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid,
  };

  await setDoc(userRef, userData);
  
  await createAuditLog({
    userId: adminUid,
    action: "user.created",
    resourceType: "user",
    resourceId: data.uid,
    details: { email: data.email, platformRole: data.platformRole }
  });

  return data.uid;
}

export async function updateUserProfile(uid: string, data: Partial<AppUser>, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

  await createAuditLog({
    userId: adminUid,
    action: "user.updated",
    resourceType: "user",
    resourceId: uid,
    details: data
  });
}

export async function disableUserProfile(uid: string, adminUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    status: "inactive",
    disabledAt: serverTimestamp(),
    disabledBy: adminUid,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

  await createAuditLog({
    userId: adminUid,
    action: "user.disabled",
    resourceType: "user",
    resourceId: uid,
  });
}

export async function getAllUserProfiles(): Promise<AppUser[]> {
  if (!db) return [];
  const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as AppUser);
}
