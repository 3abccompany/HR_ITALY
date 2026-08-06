"use server";

import {
  assertAllowedKeys,
  authorizeEmployeeFinanceAdmin,
  createEmployeeFinanceRequest,
  getEmployeeFinanceRequest,
  listEmployeeFinanceAdminEmployees,
  listEmployeeFinanceRequests,
  resolveEmployeeContext,
  sanitizeEmployeeFinanceError,
  submitEmployeeFinanceDraft,
  updateEmployeeFinanceDraft,
  type AdminEmployeeFinanceRequestInput,
  type EmployeeFinanceActionResult,
  type EmployeeFinanceAdminEmployeeOption,
} from "@/services/employee-finance.server";
import type { EmployeeFinancialRequestDto } from "@/types/employee-finance";

const READ_PERMISSION = "employeeFinance.read";
const CREATE_PERMISSION = "employeeFinance.create";
const UPDATE_PERMISSION = "employeeFinance.update";
const SUBMIT_PERMISSION = "employeeFinance.submit";

type RequestListResult = EmployeeFinanceActionResult<{ requests: EmployeeFinancialRequestDto[] }>;
type RequestDetailsResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto }>;
type RequestSaveResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto; requestId: string }>;
type RequestSubmitResult = EmployeeFinanceActionResult<{ request: EmployeeFinancialRequestDto; requestId: string; alreadySubmitted: boolean }>;
type EmployeeOptionsResult = EmployeeFinanceActionResult<{ employees: EmployeeFinanceAdminEmployeeOption[] }>;

const adminInputKeys = [
  "idToken",
  "entityId",
  "requestId",
  "employeeId",
  "requestType",
  "requestedAmount",
  "reason",
  "requestedRepaymentMonths",
  "requestedMonthlyAmount",
  "requestedFirstInstallmentPeriod",
];

export async function getEmployeeFinancialRequestsAction(params: {
  idToken: string;
  entityId: string;
}): Promise<RequestListResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId"]);
    await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, READ_PERMISSION);
    const requests = await listEmployeeFinanceRequests(params.entityId, undefined, { includeAdminContractLink: true });
    return { success: true, requests };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de charger les demandes financières.") };
  }
}

export async function getEmployeeFinancialRequestDetailsAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<RequestDetailsResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, READ_PERMISSION);
    const request = await getEmployeeFinanceRequest(params.entityId, params.requestId, { includeAdminContractLink: true });
    return { success: true, request };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de charger la demande financière.") };
  }
}

export async function getEmployeeFinanceEmployeeOptionsAction(params: {
  idToken: string;
  entityId: string;
}): Promise<EmployeeOptionsResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId"]);
    await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, READ_PERMISSION);
    const employees = await listEmployeeFinanceAdminEmployees(params.entityId);
    return { success: true, employees };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de charger les employés.") };
  }
}

export async function createEmployeeFinancialRequestAction(params: {
  idToken: string;
  entityId: string;
} & AdminEmployeeFinanceRequestInput): Promise<RequestSaveResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, adminInputKeys.filter((key) => key !== "requestId"));
    const actor = await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, CREATE_PERMISSION);
    const employee = await resolveEmployeeContext(params.entityId, params.employeeId);
    const request = await createEmployeeFinanceRequest({
      entityId: params.entityId,
      actor,
      employee,
      input: params,
      origin: "hr_on_behalf",
    });
    return { success: true, request, requestId: request.id };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de créer la demande financière.") };
  }
}

export async function updateEmployeeFinancialRequestDraftAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
} & AdminEmployeeFinanceRequestInput): Promise<RequestSaveResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, adminInputKeys);
    const actor = await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, UPDATE_PERMISSION);
    const employee = await resolveEmployeeContext(params.entityId, params.employeeId);
    const request = await updateEmployeeFinanceDraft({
      entityId: params.entityId,
      requestId: params.requestId,
      actor,
      input: params,
      origin: "hr_on_behalf",
      employee,
      allowEmployeeChange: true,
    });
    return { success: true, request, requestId: request.id };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de modifier le brouillon.") };
  }
}

export async function submitEmployeeFinancialRequestAction(params: {
  idToken: string;
  entityId: string;
  requestId: string;
}): Promise<RequestSubmitResult> {
  try {
    assertAllowedKeys(params as Record<string, unknown>, ["idToken", "entityId", "requestId"]);
    const actor = await authorizeEmployeeFinanceAdmin(params.entityId, params.idToken, SUBMIT_PERMISSION);
    const request = await submitEmployeeFinanceDraft({
      entityId: params.entityId,
      requestId: params.requestId,
      actor,
      origin: "hr_on_behalf",
    });
    return { success: true, request, requestId: request.id, alreadySubmitted: request.alreadySubmitted };
  } catch (error) {
    return { success: false, error: sanitizeEmployeeFinanceError(error, "Impossible de soumettre la demande.") };
  }
}
