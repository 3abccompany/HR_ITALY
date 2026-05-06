import { auth, db } from "@/lib/firebase/client";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { AppUser } from "@/types/user";
import { getActiveMembershipsByUid } from "./membership.service";
import { Membership } from "@/types/membership";

export async function loginWithEmailAndPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}

export function listenToAuthState(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function getAppUserByUid(uid: string): Promise<AppUser> {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) {
    throw new Error("APP_USER_NOT_FOUND");
  }
  const data = userDoc.data() as AppUser;
  if (data.status !== "active") {
    throw new Error("USER_DISABLED");
  }
  return data;
}

export async function getCurrentUserContext(firebaseUser: FirebaseUser) {
  const appUser = await getAppUserByUid(firebaseUser.uid);
  const memberships = await getActiveMembershipsByUid(firebaseUser.uid);
  return { appUser, memberships };
}