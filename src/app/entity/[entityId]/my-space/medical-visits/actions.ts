"use server";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { MedicalVisitStatus, MedicalVisitType } from "@/types/medical-visit";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";

export type MyMedicalVisitItem = {
  id: string;
  entityId: string;
  visitType: MedicalVisitType;
  visitDate: string;
  visitStartTime: string | null;
  visitEndTime: string | null;
  providerName: string | null;
  location: string | null;
  instructions: string | null;
  status: MedicalVisitStatus;
  nextVisitDate: string | null;
  plannedFromRequest: boolean;
  certificateAvailable: boolean;
};

type MyMedicalVisitsResult =
  | { success: true; employeeId: string; visits: MyMedicalVisitItem[] }
  | { success: false; error: string };

async function verifySelfServiceEmployee(entityId: string, idToken: string) {
  if (!entityId || !idToken || !adminAuth || !adminDb) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const uid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap, employeeSnap] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("entities").doc(entityId).get(),
    adminDb.collection("memberships").doc(`${uid}_${entityId}`).get(),
    adminDb
      .collection("entities")
      .doc(entityId)
      .collection("employees")
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .limit(2)
      .get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  if (!entitySnap.exists || entitySnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  if (!membershipSnap.exists || membershipSnap.data()?.status !== "active") {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  if (employeeSnap.empty) {
    throw new Error("Aucun profil employé actif trouvé pour cet utilisateur.");
  }
  if (employeeSnap.size !== 1) {
    throw new Error("Plusieurs profils employés actifs sont liés à ce compte. Contactez RH.");
  }

  const employeeDoc = employeeSnap.docs[0];
  const employee = employeeDoc.data() || {};
  if (employee.entityId && employee.entityId !== entityId) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }
  if (employee.userId !== uid) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { uid, employeeId: employeeDoc.id };
}

function serializeTimestamp(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

async function resolveProviderInstructions(entityId: string, visit: Record<string, any>) {
  const requestId = String(visit.medicalVisitRequestId || "").trim();
  const slotId = String(visit.providerSlotId || "").trim();
  if (!adminDb || !requestId || !slotId) return null;

  const slotSnap = await adminDb
    .collection("entities")
    .doc(entityId)
    .collection("medicalVisitRequests")
    .doc(requestId)
    .collection("slots")
    .doc(slotId)
    .get();
  if (!slotSnap.exists) return null;

  const slot = slotSnap.data() || {};
  if (slot.entityId !== entityId || slot.requestId !== requestId || String(slot.slotId || slotSnap.id) !== slotId) {
    return null;
  }

  return String(slot.instructions || "").trim() || null;
}

export async function getMyMedicalVisitsAction(params: {
  idToken: string;
  entityId: string;
}): Promise<MyMedicalVisitsResult> {
  try {
    if (!adminDb) throw new Error("Service administrateur indisponible.");
    const allowedKeys = new Set(["idToken", "entityId"]);
    const unknownKeys = Object.keys(params as Record<string, unknown>).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) throw new Error("Champs non autorisés dans la requête.");

    const { employeeId } = await verifySelfServiceEmployee(params.entityId, params.idToken);
    const visitsSnap = await adminDb
      .collection("entities")
      .doc(params.entityId)
      .collection("medicalVisits")
      .where("employeeId", "==", employeeId)
      .get();

    const visits = await Promise.all(visitsSnap.docs.map(async (visitDoc) => {
      const visit = visitDoc.data() || {};
      if (
        visit.entityId !== params.entityId
        || visit.employeeId !== employeeId
        || visit.id !== visitDoc.id
      ) {
        return null;
      }

      const item: MyMedicalVisitItem = {
        id: visitDoc.id,
        entityId: params.entityId,
        visitType: visit.visitType,
        visitDate: String(visit.visitDate || ""),
        visitStartTime: visit.visitStartTime || null,
        visitEndTime: visit.visitEndTime || null,
        providerName: visit.doctorName || null,
        location: visit.medicalCenter || null,
        instructions: await resolveProviderInstructions(params.entityId, visit),
        status: visit.status || "scheduled",
        nextVisitDate: typeof visit.nextVisitDate === "string" ? visit.nextVisitDate : serializeTimestamp(visit.nextVisitDate),
        plannedFromRequest: visit.plannedFromRequest === true,
        certificateAvailable: !!visit.documentId,
      };

      return item;
    }));

    const sortedVisits = visits
      .filter((item): item is MyMedicalVisitItem => item !== null)
      .sort((a, b) => {
        const dateA = `${a.visitDate || ""}T${a.visitStartTime || "00:00"}`;
        const dateB = `${b.visitDate || ""}T${b.visitStartTime || "00:00"}`;
        return dateB.localeCompare(dateA);
      });

    return { success: true, employeeId, visits: sortedVisits };
  } catch (err: any) {
    console.error("[My Medical Visits] Load failed:", err);
    return { success: false, error: err.message || "Impossible de charger vos visites médicales." };
  }
}
