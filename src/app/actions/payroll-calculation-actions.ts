"use server";

import { randomUUID } from "crypto";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { calculateTrustedMonthlyPayroll } from "@/services/payroll-calculation.server";

export type PayrollCalculationActionErrorCode =
  | "unauthenticated"
  | "inactive-user"
  | "entity-not-found"
  | "entity-inactive"
  | "membership-not-found"
  | "membership-inactive"
  | "forbidden-payroll-read"
  | "forbidden-payroll-calculate"
  | "forbidden"
  | "invalid-period"
  | "calculation-service-unavailable"
  | "calculation-failed";

export type CalculateMonthlyPayrollActionInput = {
  idToken: string;
  entityId: string;
  year: number;
  month: number;
};

export type CalculateMonthlyPayrollActionResult = {
  success: boolean;
  year?: number;
  month?: number;
  totalEmployees?: number;
  savedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  warningsCount?: number;
  error?: string;
  code?: PayrollCalculationActionErrorCode;
};

const MIN_SUPPORTED_YEAR = 2024;
const MAX_SUPPORTED_YEAR = 2026;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResult(
  code: PayrollCalculationActionErrorCode,
  error: string
): CalculateMonthlyPayrollActionResult {
  return { success: false, code, error };
}

class PayrollCalculationActionError extends Error {
  constructor(
    public readonly code: PayrollCalculationActionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PayrollCalculationActionError";
  }
}

function sanitizeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  return value
    .replace(/https?:\/\/\S+/gi, "[url-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt-redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-redacted]")
    .replace(/\b(?:entities|users|memberships|employees|contracts|attendances|timeOffRequests|holidays|payrollCalculations|payrollParameters|ccnls)\/[^\s),;]+/gi, "[path-redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[identifier-redacted]")
    .replace(/\/documents\/[^)\s]+/gi, "/documents/[redacted]")
    .slice(0, 300);
}

function getSanitizedErrorDiagnostics(error: unknown) {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" || typeof candidate?.code === "number"
    ? String(candidate.code).slice(0, 80)
    : undefined;

  return {
    errorName: sanitizeDiagnosticText(candidate?.name) || "UnknownError",
    errorCode: code,
    errorMessage: sanitizeDiagnosticText(candidate?.message) || "No sanitized message available.",
  };
}

function logUnknownPayrollActionError(input: {
  traceId: string;
  error: unknown;
}) {
  console.error("[payroll-calculation-runtime]", {
    traceId: input.traceId,
    ...getSanitizedErrorDiagnostics(input.error),
  });
}

function toActionError(error: unknown, traceId: string): CalculateMonthlyPayrollActionResult {
  if (error instanceof PayrollCalculationActionError) {
    return errorResult(error.code, error.message);
  }

  if (error instanceof Error && error.message === "PAYROLL_CALCULATION_ALL_EMPLOYEES_FAILED") {
    return errorResult(
      "calculation-failed",
      "Le calcul n'a pu être finalisé pour aucun collaborateur éligible."
    );
  }

  logUnknownPayrollActionError({ traceId, error });

  return errorResult("calculation-failed", "Calcul de synthèse économique temporairement indisponible.");
}

function normalizeInput(params: unknown): CalculateMonthlyPayrollActionInput {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new PayrollCalculationActionError("calculation-failed", "Paramètres de calcul invalides.");
  }

  const input = params as Partial<CalculateMonthlyPayrollActionInput>;
  const idToken = safeString(input.idToken);
  const entityId = safeString(input.entityId);
  const rawYear = input.year;
  const rawMonth = input.month;

  if (!idToken) {
    throw new PayrollCalculationActionError("unauthenticated", "Session requise.");
  }
  if (!entityId) {
    throw new PayrollCalculationActionError("entity-not-found", "Entité introuvable.");
  }
  if (
    !Number.isSafeInteger(rawYear) ||
    !Number.isSafeInteger(rawMonth) ||
    (rawYear as number) < MIN_SUPPORTED_YEAR ||
    (rawYear as number) > MAX_SUPPORTED_YEAR ||
    (rawMonth as number) < 1 ||
    (rawMonth as number) > 12
  ) {
    throw new PayrollCalculationActionError("invalid-period", "Période de calcul invalide.");
  }

  return { idToken, entityId, year: rawYear as number, month: rawMonth as number };
}

async function authorizePayrollCalculation(params: CalculateMonthlyPayrollActionInput) {
  if (!adminDb || !adminAuth) {
    throw new PayrollCalculationActionError("calculation-service-unavailable", "Service indisponible.");
  }

  const decodedToken = await adminAuth.verifyIdToken(params.idToken);
  const uid = decodedToken.uid;

  const userSnapshot = await adminDb.collection("users").doc(uid).get();
  if (!userSnapshot.exists || userSnapshot.data()?.status !== "active") {
    throw new PayrollCalculationActionError("inactive-user", "Utilisateur inactif.");
  }

  if (userSnapshot.data()?.platformRole === "superAdmin") {
    const entitySnapshot = await adminDb.collection("entities").doc(params.entityId).get();
    if (!entitySnapshot.exists) {
      throw new PayrollCalculationActionError("entity-not-found", "Entité introuvable.");
    }
    if (entitySnapshot.data()?.status !== "active") {
      throw new PayrollCalculationActionError("entity-inactive", "Entité inactive.");
    }
    return { uid, entityId: params.entityId };
  }

  const membershipSnapshot = await adminDb.collection("memberships").doc(`${uid}_${params.entityId}`).get();
  if (!membershipSnapshot.exists) {
    throw new PayrollCalculationActionError("forbidden", "Action non autorisée.");
  }

  const membership = membershipSnapshot.data() || {};
  if (membership.status !== "active") {
    throw new PayrollCalculationActionError("forbidden", "Action non autorisée.");
  }

  const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
  if (!permissions.includes("payroll.read")) {
    throw new PayrollCalculationActionError(
      "forbidden",
      "Action non autorisée."
    );
  }

  if (!permissions.includes("payroll.calculate") && !permissions.includes("payroll.write")) {
    throw new PayrollCalculationActionError(
      "forbidden",
      "Action non autorisée."
    );
  }

  const entitySnapshot = await adminDb.collection("entities").doc(params.entityId).get();
  if (!entitySnapshot.exists || entitySnapshot.data()?.status !== "active") {
    throw new PayrollCalculationActionError("forbidden", "Action non autorisée.");
  }

  return { uid, entityId: params.entityId };
}

export async function calculateMonthlyPayrollAction(
  params: CalculateMonthlyPayrollActionInput
): Promise<CalculateMonthlyPayrollActionResult> {
  const traceId = randomUUID();

  try {
    const input = normalizeInput(params);
    const { uid, entityId } = await authorizePayrollCalculation(input);

    const result = await calculateTrustedMonthlyPayroll({
      entityId,
      year: input.year,
      month: input.month,
      actorUid: uid,
    });

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    return toActionError(error, traceId);
  }
}
