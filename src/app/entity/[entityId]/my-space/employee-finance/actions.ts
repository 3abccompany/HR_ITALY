"use server";

import {
  assertAllowedKeys,
  authorizeEmployeeFinanceSelf,
  createEmployeeFinanceRequest,
  getEmployeeFinanceRequest,
  listEmployeeFinanceRequests,
  sanitizeEmployeeFinanceError,
  submitEmployeeFinanceDraft,
  updateEmployeeFinanceDraft,
  type EmployeeFinanceActionResult,
  type EmployeeFinanceRequestInput,
} from "@/services/employee-finance.server";
import type { EmployeeFinancialRequestDto } from "@/types/employee-finance";

type MyRequestListResult = EmployeeFinanceActionResult<{ requests: EmployeeFinancialRequestDto[] }>;
type MyRequestDetailsResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto }>;
type MyRequestSaveResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto; requestId: string }>;
type MyRequestSubmitResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto; requestId: string; alreadySubmitted: boolean }>;

const myInputKeys = [
  "idToken",
  "entityId",
  "requestId",
  "requestType",
  "requestedAmount",
  "reason",
  "requestedRepaymentMonths",
  "requestedMonthlyAmount",
  "requestedFirstInstallmentPeriod",
];

export async function getMyEmployeeFinancialRequestsAction(params: {
  idToken: string;
  entityId: string;
}): Promise<MyRequestListResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId"]);
    const actor = await authorizeEmployeeFinanceSelf(params.entityId, params.idToken);
    const requests = await listEmployeeFinanceRequests(params.entityId, actor.employee.employeeId);
    return { success: true, requests };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de charger vos demandes financières.") };
  }
}

export async function getMyEmployeeFinancialRequestDetailsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MyRequestDetailsResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    const actor = await authorizeEmployeeFinanceSelf(params.entityId, params.idToken);
    const request = await getEmployeeFinanceRequest(params.entityId, params.requestId, { expectedEmployeeId: actor.employee.employeeId });
    return { success: true, request };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de charger votre demande financière.") };
  }
}

export async function createMyEmployeeFinancialRequestAction(params: {
  idToken: string;
  entityId: string;
} & EmployeeFinanceRequestInput): Promise<MyRequestSaveResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, myInputKeys.filter((key) => key !== "requestId"));
    const actor = await authorizeEmployeeFinanceSelf(params.entityId, params.idToken);
    const request = await createEmployeeFinanceRequest({
      entityId: params.entityId,
      actor,
      employee: actor.employee,
      input: params,
      origin: "employee_self_service",
    });
    return { success: true, request, requestId: request.id };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de créer votre demande financière.") };
  }
}

export async function updateMyEmployeeFinancialRequestDraftAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
} & EmployeeFinanceRequestInput): Promise<MyRequestSaveResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, myInputKeys);
    const actor = await authorizeEmployeeFinanceSelf(params.entityId, params.idToken);
    const request = await updateEmployeeFinanceDraft({
      entityId: params.entityId,
      requestId: params.requestId,
      actor,
      input: params,
      origin: "employee_self_service",
      employee: actor.employee,
      allowEmployeeChange: false,
    });
    return { success: true, request, requestId: request.id };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de modifier votre brouillon.") };
  }
}

export async function submitMyEmployeeFinancialRequestAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<MyRequestSubmitResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    const actor = await authorizeEmployeeFinanceSelf(params.entityId, params.idToken);
    const request = await submitEmployeeFinanceDraft({
      entityId: params.entityId,
      requestId: params.requestId,
      actor,
      origin: "employee_self_service",
      employeeId: actor.employee.employeeId,
    });
    return { success: true, request, requestId: request.id, alreadySubmitted: request.alreadySubmitted };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de soumettre votre demande.") };
  }
}
