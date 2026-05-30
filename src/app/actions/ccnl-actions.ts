'use server';
/**
 * @fileOverview Server actions for CCNL and classification levels.
 * Bypasses client-side Firestore rule limits for reference data fetching.
 */

import { adminDb } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";

/**
 * Fetches classification levels for a specific CCNL securely.
 * Verifies entity membership before returning data.
 */
export async function getLevelsForCcnlAction(entityId: string, ccnlId: string, idToken: string) {
  if (!entityId || !ccnlId || !idToken) {
    throw new Error("PARAM_MISSING: Paramètres manquants pour la récupération des niveaux.");
  }

  try {
    // 1. Verify Authentication
    let uid: string;
    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      uid = decodedToken.uid;
    } catch (authErr) {
      console.error("[CCNL Action] Auth Verification Failed", authErr);
      throw new Error("AUTH_INVALID: Session invalide ou expirée.");
    }

    // 2. Verify Membership (Security Gate)
    const membershipId = `${uid}_${entityId}`;
    const mSnap = await adminDb.collection("memberships").doc(membershipId).get();
    
    if (!mSnap.exists || mSnap.data()?.status !== 'active') {
      throw new Error("ACCESS_DENIED: Vous n'avez pas accès à cette entreprise.");
    }

    // 3. Fetch Levels
    const levelsRef = adminDb
      .collection("entities")
      .doc(entityId)
      .collection("ccnls")
      .doc(ccnlId)
      .collection("levels");
    
    try {
      const snap = await levelsRef
        .where("status", "==", "active")
        .orderBy("levelCode", "asc")
        .get();
      
      return snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (dbErr: any) {
      if (dbErr.code === 9) { // FAILED_PRECONDITION (usually missing index)
        console.error("[CCNL Action] Index missing. Please check firestore.indexes.json", dbErr);
        throw new Error("DB_INDEX_MISSING: Le système nécessite une mise à jour d'indexation.");
      }
      throw dbErr;
    }

  } catch (err: any) {
    console.error("[CCNL Action Error]", err);
    throw new Error(err.message || "Erreur lors de la récupération des niveaux CCNL.");
  }
}
