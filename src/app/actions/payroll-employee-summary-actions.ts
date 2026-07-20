"use server";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { Employee } from "@/types/employee";
import type { PayrollCalculation } from "@/types/payroll";

type PayrollEmployeeSummaryErrorCode =
  | "unauthenticated"
  | "inactive-user"
  | "entity-not-found"
  | "entity-inactive"
  | "membership-not-found"
  | "membership-inactive"
  | "forbidden-payroll-read"
  | "invalid-calculation-ids"
  | "too-many-calculations"
  | "summary-load-failed";

export type PayrollEmployeeSummary = {
  calculationId: string;
  employeeId: string;
  displayName: string;
  employeeCode?: string | null;
};

export type GetPayrollEmployeeSummariesResult = {
  success: boolean;
  summaries?: PayrollEmployeeSummary[];
  error?: string;
  code?: PayrollEmployeeSummaryErrorCode;
};

type GetPayrollEmployeeSummariesParams = {
  idToken: string;
  entityId: string;
  calculationIds: string[];
};

const MAX_CALCULATION_IDS = 100;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResult(
  code: PayrollEmployeeSummaryErrorCode,
  error: string
): GetPayrollEmployeeSummariesResult {
  return { success: false, code, error };
}

class PayrollEmployeeSummaryActionError extends Error {
  constructor(
    public readonly code: PayrollEmployeeSummaryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PayrollEmployeeSummaryActionError";
  }
}

function toActionError(error: unknown): GetPayrollEmployeeSummariesResult {
  if (error instanceof PayrollEmployeeSummaryActionError) {
    return errorResult(error.code, error.message);
  }
  return errorResult("summary-load-failed", "Identité collaborateur temporairement indisponible.");
}

function normalizeCalculationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new PayrollEmployeeSummaryActionError(
      "invalid-calculation-ids",
      "Liste de synthèses invalide."
    );
  }

  const calculationIds = Array.from(
    new Set(value.map(safeString).filter((id) => id.length > 0))
  );

  if (calculationIds.length > MAX_CALCULATION_IDS) {
    throw new PayrollEmployeeSummaryActionError(
      "too-many-calculations",
      "Trop de synthèses demandées."
    );
  }

  return calculationIds;
}

async function authorizePayrollSummaryRead(
  params: Pick<GetPayrollEmployeeSummariesParams, "idToken" | "entityId">
) {
  if (!adminDb || !adminAuth) {
    throw new PayrollEmployeeSummaryActionError("summary-load-failed", "Service indisponible.");
  }

  const entityId = safeString(params.entityId);
  if (!entityId) {
    throw new PayrollEmployeeSummaryActionError("entity-not-found", "Entité introuvable.");
  }

  const idToken = safeString(params.idToken);
  if (!idToken) {
    throw new PayrollEmployeeSummaryActionError("unauthenticated", "Session requise.");
  }

  const decodedToken = await adminAuth.verifyIdToken(idToken);
  const uid = decodedToken.uid;

  const userSnapshot = await adminDb.collection("users").doc(uid).get();
  if (!userSnapshot.exists || userSnapshot.data()?.status !== "active") {
    throw new PayrollEmployeeSummaryActionError("inactive-user", "Utilisateur inactif.");
  }

  const entitySnapshot = await adminDb.collection("entities").doc(entityId).get();
  if (!entitySnapshot.exists) {
    throw new PayrollEmployeeSummaryActionError("entity-not-found", "Entité introuvable.");
  }
  if (entitySnapshot.data()?.status !== "active") {
    throw new PayrollEmployeeSummaryActionError("entity-inactive", "Entité inactive.");
  }

  if (userSnapshot.data()?.platformRole === "superAdmin") {
    return { uid, entityId };
  }

  const membershipId = `${uid}_${entityId}`;
  const membershipSnapshot = await adminDb.collection("memberships").doc(membershipId).get();
  if (!membershipSnapshot.exists) {
    throw new PayrollEmployeeSummaryActionError("membership-not-found", "Affectation introuvable.");
  }

  const membership = membershipSnapshot.data() || {};
  if (membership.status !== "active") {
    throw new PayrollEmployeeSummaryActionError("membership-inactive", "Affectation inactive.");
  }

  const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
  if (!permissions.includes("payroll.read")) {
    throw new PayrollEmployeeSummaryActionError(
      "forbidden-payroll-read",
      "Autorisation synthèse économique requise."
    );
  }

  return { uid, entityId };
}

function toDisplayName(employee: Employee): string {
  return (
    safeString(employee.displayName) ||
    [safeString(employee.firstName), safeString(employee.lastName)].filter(Boolean).join(" ") ||
    "Collaborateur non renseigné"
  );
}

export async function getPayrollEmployeeSummariesAction(
  params: GetPayrollEmployeeSummariesParams
): Promise<GetPayrollEmployeeSummariesResult> {
  try {
    const calculationIds = normalizeCalculationIds(params.calculationIds);
    const { entityId } = await authorizePayrollSummaryRead(params);

    if (calculationIds.length === 0) {
      return { success: true, summaries: [] };
    }

    const calculationSnapshots = await Promise.all(
      calculationIds.map((calculationId) =>
        adminDb
          .collection("entities")
          .doc(entityId)
          .collection("payrollCalculations")
          .doc(calculationId)
          .get()
      )
    );

    const calculationEmployeeIds = new Map<string, string>();
    const uniqueEmployeeIds = new Set<string>();

    calculationSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;

      const calculation = snapshot.data() as PayrollCalculation;
      if (calculation.entityId !== entityId) return;

      const employeeId = safeString(calculation.employeeId);
      if (!employeeId) return;

      calculationEmployeeIds.set(snapshot.id, employeeId);
      uniqueEmployeeIds.add(employeeId);
    });

    const employeeSnapshots = await Promise.all(
      Array.from(uniqueEmployeeIds).map((employeeId) =>
        adminDb
          .collection("entities")
          .doc(entityId)
          .collection("employees")
          .doc(employeeId)
          .get()
      )
    );

    const employeesById = new Map<string, Employee>();
    employeeSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;

      const employee = snapshot.data() as Employee;
      if (employee.entityId !== entityId) return;

      employeesById.set(snapshot.id, employee);
    });

    const summaries: PayrollEmployeeSummary[] = [];
    calculationEmployeeIds.forEach((employeeId, calculationId) => {
      const employee = employeesById.get(employeeId);
      if (!employee) return;

      summaries.push({
        calculationId,
        employeeId,
        displayName: toDisplayName(employee),
        employeeCode: safeString(employee.employeeCode) || null,
      });
    });

    return { success: true, summaries };
  } catch (error) {
    return toActionError(error);
  }
}
