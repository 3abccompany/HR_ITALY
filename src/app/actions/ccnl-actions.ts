'use server';
/**
 * @fileOverview Server actions for CCNL and classification levels.
 * Bypasses client-side Firestore rule limits for reference data fetching.
 */

import { adminDb } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";

/**
 * Fetches classification levels for a specific CCNL securely.
 * Verifies entity membership before returning data.
 */
export async function getLevelsForCcnlAction(entityId: string, ccnlId: string, idToken: string) {
  if (!entityId || !ccnlId || !idToken) {
    throw new Error("Paramètres manquants pour la récupération des niveaux.");
  }

  try {
    // 1. Verify Authentication
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 2. Verify Membership (Security Gate)
    const membershipId = `${uid}_${entityId}`;
    const mSnap = await adminDb.collection("memberships").doc(membershipId).get();
    
    if (!mSnap.exists || mSnap.data()?.status !== 'active') {
      throw new Error("Accès refusé : Membership non trouvé ou inactif.");
    }

    // 3. Fetch Levels
    const levelsRef = adminDb
      .collection("entities")
      .doc(entityId)
      .collection("ccnls")
      .doc(ccnlId)
      .collection("levels");
    
    const snap = await levelsRef.where("status", "==", "active").orderBy("levelCode", "asc").get();
    
    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  } catch (err: any) {
    console.error("[CCNL Action Error]", err);
    throw new Error(err.message || "Erreur lors de la récupération des niveaux CCNL.");
  }
}
