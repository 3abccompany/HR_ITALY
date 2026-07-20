"use server";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { createTrustedAuditLog } from "@/services/audit.server";
import { FieldValue } from "firebase-admin/firestore";

type DepartmentUpdateInput = {
  name: string;
  code: string;
  description?: string;
  responsibleName?: string;
  notes?: string;
};

type DepartmentUpdateResult = {
  success: boolean;
  auditWarning?: string;
  error?: string;
};

const editableDepartmentFields = ["name", "code", "description", "responsibleName", "notes"] as const;

function normalizeDepartmentUpdate(input: Partial<DepartmentUpdateInput>): DepartmentUpdateInput {
  const unknownFields = Object.keys(input).filter(
    (field) => !editableDepartmentFields.includes(field as (typeof editableDepartmentFields)[number])
  );

  if (unknownFields.length > 0) {
    throw new Error("INVALID_FIELDS: Champs de département non autorisés.");
  }

  const normalized = {
    name: String(input.name || "").trim(),
    code: String(input.code || "").trim(),
    description: String(input.description || "").trim(),
    responsibleName: String(input.responsibleName || "").trim(),
    notes: String(input.notes || "").trim(),
  };

  if (!normalized.name) {
    throw new Error("VALIDATION_ERROR: Le nom du département est obligatoire.");
  }

  if (!normalized.code) {
    throw new Error("VALIDATION_ERROR: Le code du département est obligatoire.");
  }

  return normalized;
}

export async function updateDepartmentAction(params: {
  entityId: string;
  departmentId: string;
  data: Partial<DepartmentUpdateInput>;
  idToken: string;
}): Promise<DepartmentUpdateResult> {
  const { entityId, departmentId, data, idToken } = params;

  try {
    if (!adminDb || !adminAuth) {
      throw new Error("SERVICE_UNAVAILABLE: Service administrateur indisponible.");
    }

    if (!entityId || !departmentId || !idToken) {
      throw new Error("PARAM_MISSING: Paramètres de mise à jour incomplets.");
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const actorUid = decodedToken.uid;

    const [userSnap, entitySnap, membershipSnap, departmentSnap] = await Promise.all([
      adminDb.collection("users").doc(actorUid).get(),
      adminDb.collection("entities").doc(entityId).get(),
      adminDb.collection("memberships").doc(`${actorUid}_${entityId}`).get(),
      adminDb.collection("entities").doc(entityId).collection("departments").doc(departmentId).get(),
    ]);

    if (!userSnap.exists || userSnap.data()?.status !== "active") {
      throw new Error("ACCESS_DENIED: Utilisateur inactif ou introuvable.");
    }

    if (!entitySnap.exists || entitySnap.data()?.status !== "active") {
      throw new Error("ACCESS_DENIED: Entité inactive ou introuvable.");
    }

    if (!membershipSnap.exists || membershipSnap.data()?.status !== "active") {
      throw new Error("ACCESS_DENIED: Appartenance inactive ou introuvable.");
    }

    const permissions = membershipSnap.data()?.permissions;
    if (!Array.isArray(permissions) || !permissions.includes("departments.update")) {
      throw new Error("PERMISSION_DENIED: Permission departments.update requise.");
    }

    if (!departmentSnap.exists) {
      throw new Error("NOT_FOUND: Département introuvable.");
    }

    const currentDepartment = departmentSnap.data() || {};
    if (currentDepartment.entityId !== entityId) {
      throw new Error("ACCESS_DENIED: Département hors entité.");
    }

    const updateData = normalizeDepartmentUpdate(data);
    const departmentRef = adminDb.collection("entities").doc(entityId).collection("departments").doc(departmentId);
    const batch = adminDb.batch();
    const now = FieldValue.serverTimestamp();

    batch.update(departmentRef, {
      ...updateData,
      updatedAt: now,
      updatedBy: actorUid,
    });

    if (updateData.name && updateData.name !== currentDepartment.name) {
      const jobTitlesSnap = await adminDb
        .collection("entities")
        .doc(entityId)
        .collection("jobTitles")
        .where("departmentId", "==", departmentId)
        .get();

      jobTitlesSnap.docs.forEach((jobTitleDoc) => {
        batch.update(jobTitleDoc.ref, {
          departmentName: updateData.name,
          updatedAt: now,
          updatedBy: actorUid,
        });
      });
    }

    await batch.commit();

    try {
      const changedFields = editableDepartmentFields.filter(
        (field) => updateData[field] !== (currentDepartment[field] || "")
      );

      await createTrustedAuditLog({
        actorUid,
        entityId,
        action: "department.updated",
        resourceType: "department",
        resourceId: departmentId,
        details: {
          changedFields,
        },
      });
    } catch (auditError) {
      console.warn("[Trusted Audit] Department update logged as business success but audit failed:", auditError);
      return {
        success: true,
        auditWarning: "Le département a été modifié, mais le journal d'audit serveur n'a pas pu être écrit.",
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Erreur lors de la mise à jour du département.",
    };
  }
}
