'use server';

/**
 * @fileOverview Server actions for CCNL and classification levels.
 * Bypasses client-side Firestore rule limits for reference data fetching.
 */

import { adminDb } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";

function serializeForClient(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Firebase Admin Timestamp
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  // Timestamp-like object fallback
  if (
    typeof value === "object" &&
    typeof value._seconds === "number" &&
    typeof value._nanoseconds === "number"
  ) {
    return new Date(
      value._seconds * 1000 + Math.floor(value._nanoseconds / 1_000_000)
    ).toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeForClient);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        serializeForClient(nestedValue),
      ])
    );
  }

  return value;
}

/**
 * Fetches classification levels for a specific CCNL securely.
 * Verifies entity membership before returning data.
 */
export async function getLevelsForCcnlAction(
  entityId: string,
  ccnlId: string,
  idToken: string
) {
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

    // 2. Verify Membership
    const membershipId = `${uid}_${entityId}`;
    const mSnap = await adminDb
      .collection("memberships")
      .doc(membershipId)
      .get();

    if (!mSnap.exists || mSnap.data()?.status !== "active") {
      throw new Error("ACCESS_DENIED: Vous n'avez pas accès à cette entreprise.");
    }

    // 3. Fetch Levels without composite index dependency
    const levelsRef = adminDb
      .collection("entities")
      .doc(entityId)
      .collection("ccnls")
      .doc(ccnlId)
      .collection("levels");

    const snap = await levelsRef.get();

    const levels = snap.docs
      .map((doc) => ({
        id: doc.id,
        ...serializeForClient(doc.data()),
      }))
      .filter((level: any) => level.status === "active")
      .sort((a: any, b: any) => {
        const aKey = String(
          a.levelCode ||
            a.levelName ||
            a.name ||
            a.label ||
            ""
        ).toLowerCase();

        const bKey = String(
          b.levelCode ||
            b.levelName ||
            b.name ||
            b.label ||
            ""
        ).toLowerCase();

        return aKey.localeCompare(bKey, "fr", {
          numeric: true,
          sensitivity: "base",
        });
      });

    return levels;
  } catch (err: any) {
    console.error("[CCNL Action Error]", err);
    throw new Error(err.message || "Erreur lors de la récupération des niveaux CCNL.");
  }
}