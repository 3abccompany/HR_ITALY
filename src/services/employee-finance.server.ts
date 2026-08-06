import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { createTrustedAuditLog } from "@/services/audit.server";
import type {
  EmployeeFinancialActiveContractSummary,
  EmployeeFinancialRequest,
  EmployeeFinancialRequestDto,
  EmployeeFinancialRequestOrigin,
  EmployeeFinancialRequestStatus,
  EmployeeFinancialRequestType,
} from "@/types/employee-finance";

const SAFE_FORBIDDEN_MESSAGE = "Accès refusé.";
const REQUEST_COLLECTION = "employeeFinancialRequests";
const SCHEDULE_COLLECTION = "employeeRepaymentSchedules";
const DEFAULT_CURRENCY = "EUR";
const MAX_AMOUNT_CENTS = 100_000_000_00;
const REQUEST_TYPES: EmployeeFinancialRequestType[] = ["salary_advance", "internal_loan", "employee_debt"];
const ACTIVE_BATCH_STATUSES: EmployeeFinancialRequestStatus[] = ["draft", "submitted"];

export type EmployeeFinanceActionResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

export type EmployeeFinanceRequestInput = {
  requestType: string;
  requestedAmount: string;
  reason: string;
  requestedRepaymentMonths?: string | number | null;
  requestedMonthlyAmount?: string | null;
  requestedFirstInstallmentPeriod?: string | null;
};

export type AdminEmployeeFinanceRequestInput = EmployeeFinanceRequestInput & {
  employeeId: string;
};

export type EmployeeFinanceAdminEmployeeOption = {
  employeeId: string;
  displayName: string;
  matricule: string;
  activeContractId: string | null;
  activeContractWarning: boolean;
};

type ActorContext = {
  uid: string;
  actorName: string;
  entity: Record<string, any>;
};

type EmployeeContext = {
  employeeId: string;
  personId: string | null;
  displayName: string;
  matricule: string;
  activeContractId: string | null;
  activeContractWarning: boolean;
};

type EmployeeFinanceReadOptions = {
  includeAdminContractLink?: boolean;
  expectedEmployeeId?: string;
};

function assertAdminReady() {
  if (!adminAuth || !adminDb) {
    throw new Error("Service administrateur indisponible.");
  }
}

export function sanitizeEmployeeFinanceError(error: unknown, fallback = "Action Finance employés impossible.") {
  const message = error instanceof Error ? error.message : "";
  if (!message) return fallback;
  if (/Firebase|Firestore|permission|token|uid|document|collection|path/i.test(message) && message !== SAFE_FORBIDDEN_MESSAGE) {
    return fallback;
  }
  return message;
}

export function parseMoneyToCents(value: unknown, fieldLabel = "Montant") {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${fieldLabel} requis.`);
  if (/e/i.test(raw)) throw new Error(`${fieldLabel} invalide.`);
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) throw new Error(`${fieldLabel} invalide.`);
  const separatorCount = (raw.match(/[.,]/g) || []).length;
  if (separatorCount > 1) throw new Error(`${fieldLabel} invalide.`);
  const [wholePart, decimalPart = ""] = raw.replace(",", ".").split(".");
  const cents = Number(wholePart) * 100 + Number((decimalPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    throw new Error(`${fieldLabel} invalide.`);
  }
  return cents;
}

function serializeTimestamp(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function formatContractDisplayDate(value: unknown) {
  const serialized = serializeTimestamp(value);
  if (!serialized) return null;
  const date = new Date(serialized);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function localizeContractType(value: unknown) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) return "Contrat actif";
  if (["cdi", "indeterminato", "indefinite", "permanent"].some((keyword) => normalized.includes(keyword))) return "CDI";
  if (["cdd", "determinato", "fixed"].some((keyword) => normalized.includes(keyword))) return "Contrat à durée déterminée";
  if (normalized.includes("apprentissage")) return "Contrat d’apprentissage";
  if (normalized.includes("stage")) return "Stage";
  return raw;
}

function buildContractDisplayLabel(contract: Record<string, any>) {
  const reference = String(
    contract.contractNumber ||
    contract.contractReference ||
    contract.reference ||
    contract.contractCode ||
    contract.protocolNumber ||
    contract.uniLavProtocolNumber ||
    ""
  ).trim();
  if (reference) return `Contrat ${reference}`;

  const title = String(contract.title || contract.name || contract.contractTitle || "").trim();
  if (title) return title;

  const typeLabel = localizeContractType(contract.contractType);
  const startDate = formatContractDisplayDate(contract.startDate);
  if (startDate) {
    const normalizedType = String(contract.contractType || "").toLowerCase();
    const indefinite = ["cdi", "indeterminato", "indefinite", "permanent"].some((keyword) => normalizedType.includes(keyword));
    return indefinite ? `${typeLabel} — depuis le ${startDate}` : `${typeLabel} — ${startDate}`;
  }
  return typeLabel || "Contrat actif";
}

async function resolveActiveContractSummary(
  entityId: string,
  request: Pick<EmployeeFinancialRequestDto, "activeContractId" | "employeeId">,
  options: EmployeeFinanceReadOptions = {},
): Promise<EmployeeFinancialActiveContractSummary | null> {
  const contractId = String(request.activeContractId || "").trim();
  if (!contractId) return null;

  const contractSnap = await adminDb!
    .collection("entities")
    .doc(entityId)
    .collection("contracts")
    .doc(contractId)
    .get();

  if (!contractSnap.exists) {
    return { id: contractId, displayLabel: "Contrat actif introuvable", href: null };
  }

  const contract = contractSnap.data() || {};
  const contractEntityId = String(contract.entityId || entityId);
  const contractEmployeeId = String(contract.employeeId || "");
  if (contractEntityId !== entityId || contractEmployeeId !== request.employeeId) {
    return { id: contractId, displayLabel: "Contrat actif introuvable", href: null };
  }

  return {
    id: contractId,
    displayLabel: buildContractDisplayLabel(contract),
    href: options.includeAdminContractLink ? `/entity/${entityId}/contracts/${contractId}` : null,
  };
}

async function enrichEmployeeFinancialRequestDto(
  entityId: string,
  request: EmployeeFinancialRequestDto,
  options: EmployeeFinanceReadOptions = {},
) {
  return {
    ...request,
    activeContractSummary: await resolveActiveContractSummary(entityId, request, options),
  };
}

function actorDisplayName(user: Record<string, any>) {
  return String(user.displayName || user.name || user.email || "Utilisateur").trim();
}

export function assertAllowedKeys(input: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error("Champs non autorisés dans la requête.");
  }
}

export async function authorizeEmployeeFinanceAdmin(entityId: string, idToken: string, permission: string): Promise<ActorContext> {
  assertAdminReady();
  if (!entityId || !idToken) throw new Error(SAFE_FORBIDDEN_MESSAGE);

  let decodedToken;
  try {
    decodedToken = await adminAuth!.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const uid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap] = await Promise.all([
    adminDb!.collection("users").doc(uid).get(),
    adminDb!.collection("entities").doc(entityId).get(),
    adminDb!.collection("memberships").doc(`${uid}_${entityId}`).get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (!entitySnap.exists || entitySnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);

  const membership = membershipSnap.data();
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  if (!membershipSnap.exists || membership?.status !== "active" || !permissions.includes(permission)) {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  return { uid, actorName: actorDisplayName(userSnap.data() || {}), entity: entitySnap.data() || {} };
}

export async function authorizeEmployeeFinanceSelf(entityId: string, idToken: string): Promise<ActorContext & { employee: EmployeeContext }> {
  assertAdminReady();
  if (!entityId || !idToken) throw new Error(SAFE_FORBIDDEN_MESSAGE);

  let decodedToken;
  try {
    decodedToken = await adminAuth!.verifyIdToken(idToken);
  } catch {
    throw new Error(SAFE_FORBIDDEN_MESSAGE);
  }

  const uid = decodedToken.uid;
  const [userSnap, entitySnap, membershipSnap, employeeSnap] = await Promise.all([
    adminDb!.collection("users").doc(uid).get(),
    adminDb!.collection("entities").doc(entityId).get(),
    adminDb!.collection("memberships").doc(`${uid}_${entityId}`).get(),
    adminDb!
      .collection("entities")
      .doc(entityId)
      .collection("employees")
      .where("userId", "==", uid)
      .where("status", "==", "active")
      .limit(2)
      .get(),
  ]);

  if (!userSnap.exists || userSnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (!entitySnap.exists || entitySnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (!membershipSnap.exists || membershipSnap.data()?.status !== "active") throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (employeeSnap.empty) throw new Error("Aucun profil employé actif trouvé pour cet utilisateur.");
  if (employeeSnap.size !== 1) throw new Error("Plusieurs profils employés actifs sont liés à ce compte. Contactez RH.");

  const employeeDoc = employeeSnap.docs[0];
  const employee = await resolveEmployeeContext(entityId, employeeDoc.id);
  return { uid, actorName: actorDisplayName(userSnap.data() || {}), entity: entitySnap.data() || {}, employee };
}

export function resolveEntityCurrency(entity: Record<string, any>) {
  const candidate = String(entity.currency || entity.defaultCurrency || entity.payrollCurrency || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(candidate)) return candidate;
  return DEFAULT_CURRENCY;
}

async function resolveActiveContractId(entityId: string, employeeId: string, employee: Record<string, any>) {
  const explicitContractId = String(employee.activeContractId || "").trim();
  if (explicitContractId) {
    const contractSnap = await adminDb!
      .collection("entities")
      .doc(entityId)
      .collection("contracts")
      .doc(explicitContractId)
      .get();
    const contract = contractSnap.data() || {};
    if (contractSnap.exists && contract.entityId === entityId && contract.employeeId === employeeId && contract.status === "active") {
      return explicitContractId;
    }
  }

  const activeContractsSnap = await adminDb!
    .collection("entities")
    .doc(entityId)
    .collection("contracts")
    .where("employeeId", "==", employeeId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  return activeContractsSnap.empty ? null : activeContractsSnap.docs[0].id;
}

export async function resolveEmployeeContext(entityId: string, employeeId: string): Promise<EmployeeContext> {
  assertAdminReady();
  const cleanEmployeeId = String(employeeId || "").trim();
  if (!entityId || !cleanEmployeeId) throw new Error("Employé requis.");

  const employeeSnap = await adminDb!
    .collection("entities")
    .doc(entityId)
    .collection("employees")
    .doc(cleanEmployeeId)
    .get();
  if (!employeeSnap.exists) throw new Error("Employé introuvable.");

  const employee = employeeSnap.data() || {};
  if ((employee.entityId && employee.entityId !== entityId) || employee.status !== "active") {
    throw new Error("Employé non éligible.");
  }

  const activeContractId = await resolveActiveContractId(entityId, cleanEmployeeId, employee);
  const displayName = String(employee.displayName || `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "Employé").trim();
  const matricule = String(employee.employeeCode || employee.matricule || cleanEmployeeId).trim();
  const personId = typeof employee.personId === "string" && employee.personId.trim() ? employee.personId.trim() : null;

  return {
    employeeId: cleanEmployeeId,
    personId,
    displayName,
    matricule,
    activeContractId,
    activeContractWarning: !activeContractId,
  };
}

function parseOptionalPositiveInteger(value: unknown, fieldLabel: string) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${fieldLabel} invalide.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 360) throw new Error(`${fieldLabel} invalide.`);
  return parsed;
}

function parseFirstInstallmentPeriod(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) throw new Error("Première période de remboursement invalide.");
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("Première période de remboursement invalide.");
  return raw;
}

export function validateRequestInput(input: EmployeeFinanceRequestInput) {
  const requestType = String(input.requestType || "").trim() as EmployeeFinancialRequestType;
  if (!REQUEST_TYPES.includes(requestType)) throw new Error("Type de demande invalide.");

  const requestedAmountCents = parseMoneyToCents(input.requestedAmount, requestType === "employee_debt" ? "Montant de la dette" : "Montant demandé");
  const reason = String(input.reason || "").trim();
  if (reason.length < 3 || reason.length > 2000) {
    throw new Error("Le motif doit contenir entre 3 et 2000 caractères.");
  }

  const requestedRepaymentMonths = parseOptionalPositiveInteger(input.requestedRepaymentMonths, "Nombre de mois");
  const requestedMonthlyAmountCents = input.requestedMonthlyAmount === null || input.requestedMonthlyAmount === undefined || String(input.requestedMonthlyAmount).trim() === ""
    ? null
    : parseMoneyToCents(input.requestedMonthlyAmount, "Montant mensuel proposé");
  const requestedFirstInstallmentPeriod = parseFirstInstallmentPeriod(input.requestedFirstInstallmentPeriod);

  return {
    requestType,
    requestedAmountCents,
    reason,
    requestedRepaymentMonths,
    requestedMonthlyAmountCents,
    requestedFirstInstallmentPeriod,
  };
}

export function serializeEmployeeFinancialRequest(docId: string, data: Record<string, any>): EmployeeFinancialRequestDto {
  return {
    id: String(data.id || docId),
    entityId: String(data.entityId || ""),
    personId: data.personId || null,
    employeeId: String(data.employeeId || ""),
    employeeSnapshot: {
      displayName: String(data.employeeSnapshot?.displayName || "Employé"),
      matricule: String(data.employeeSnapshot?.matricule || ""),
    },
    requestOrigin: data.requestOrigin,
    requestType: data.requestType,
    requestDate: serializeTimestamp(data.requestDate),
    currency: String(data.currency || DEFAULT_CURRENCY),
    requestedAmountCents: Number(data.requestedAmountCents || 0),
    reason: String(data.reason || ""),
    requestedRepaymentMonths: data.requestedRepaymentMonths ?? null,
    requestedMonthlyAmountCents: data.requestedMonthlyAmountCents ?? null,
    requestedFirstInstallmentPeriod: data.requestedFirstInstallmentPeriod ?? null,
    status: data.status,
    submittedAt: serializeTimestamp(data.submittedAt),
    submittedBy: data.submittedBy || null,
    submittedByName: data.submittedByName || null,
    decisionBy: data.decisionBy || null,
    decisionByName: data.decisionByName || null,
    decisionAt: serializeTimestamp(data.decisionAt),
    decisionReason: data.decisionReason || null,
    approvedAmountCents: data.approvedAmountCents ?? null,
    approvedRepaymentMonths: data.approvedRepaymentMonths ?? null,
    approvedMonthlyAmountCents: data.approvedMonthlyAmountCents ?? null,
    approvedFirstInstallmentPeriod: data.approvedFirstInstallmentPeriod ?? null,
    agreementDocumentId: data.agreementDocumentId || null,
    agreementVersion: data.agreementVersion ?? null,
    agreementGeneratedAt: serializeTimestamp(data.agreementGeneratedAt),
    agreementGeneratedBy: data.agreementGeneratedBy || null,
    signedAgreementDocumentId: data.signedAgreementDocumentId || null,
    signedAgreementUploadedAt: serializeTimestamp(data.signedAgreementUploadedAt),
    signedAgreementUploadedBy: data.signedAgreementUploadedBy || null,
    signatureStatus: data.signatureStatus || "not_generated",
    signatureValidatedAt: serializeTimestamp(data.signatureValidatedAt),
    signatureValidatedBy: data.signatureValidatedBy || null,
    signatureValidatedByName: data.signatureValidatedByName || null,
    signatureRejectionReason: data.signatureRejectionReason || null,
    disbursementDocumentId: data.disbursementDocumentId || null,
    repaymentScheduleId: data.repaymentScheduleId || null,
    activeContractId: data.activeContractId || null,
    activeContractWarning: data.activeContractWarning === true,
    activeContractSummary: null,
    createdAt: serializeTimestamp(data.createdAt),
    createdBy: String(data.createdBy || ""),
    createdByName: String(data.createdByName || ""),
    updatedAt: serializeTimestamp(data.updatedAt),
    updatedBy: String(data.updatedBy || ""),
    updatedByName: String(data.updatedByName || ""),
    archivedAt: serializeTimestamp(data.archivedAt),
    archivedBy: data.archivedBy || null,
    version: Number(data.version || 1),
  };
}

function baseFutureFields(): Pick<EmployeeFinancialRequest,
  | "submittedAt"
  | "submittedBy"
  | "submittedByName"
  | "decisionBy"
  | "decisionByName"
  | "decisionAt"
  | "decisionReason"
  | "approvedAmountCents"
  | "approvedRepaymentMonths"
  | "approvedMonthlyAmountCents"
  | "approvedFirstInstallmentPeriod"
  | "agreementDocumentId"
  | "agreementVersion"
  | "agreementGeneratedAt"
  | "agreementGeneratedBy"
  | "signedAgreementDocumentId"
  | "signedAgreementUploadedAt"
  | "signedAgreementUploadedBy"
  | "signatureStatus"
  | "signatureValidatedAt"
  | "signatureValidatedBy"
  | "signatureValidatedByName"
  | "signatureRejectionReason"
  | "disbursementDocumentId"
  | "repaymentScheduleId"
  | "archivedAt"
  | "archivedBy"
> {
  return {
    submittedAt: null,
    submittedBy: null,
    submittedByName: null,
    decisionBy: null,
    decisionByName: null,
    decisionAt: null,
    decisionReason: null,
    approvedAmountCents: null,
    approvedRepaymentMonths: null,
    approvedMonthlyAmountCents: null,
    approvedFirstInstallmentPeriod: null,
    agreementDocumentId: null,
    agreementVersion: null,
    agreementGeneratedAt: null,
    agreementGeneratedBy: null,
    signedAgreementDocumentId: null,
    signedAgreementUploadedAt: null,
    signedAgreementUploadedBy: null,
    signatureStatus: "not_generated",
    signatureValidatedAt: null,
    signatureValidatedBy: null,
    signatureValidatedByName: null,
    signatureRejectionReason: null,
    disbursementDocumentId: null,
    repaymentScheduleId: null,
    archivedAt: null,
    archivedBy: null,
  };
}

async function createAuditAndTimeline(params: {
  action: "employeeFinance.request_created" | "employeeFinance.request_updated" | "employeeFinance.request_submitted";
  timelineLabel: "employee_finance_request_created" | "employee_finance_request_updated" | "employee_finance_request_submitted";
  entityId: string;
  requestId: string;
  employee: EmployeeContext;
  origin: EmployeeFinancialRequestOrigin;
  actorUid: string;
  actorName: string;
  version: number;
}) {
  await createTrustedAuditLog({
    actorUid: params.actorUid,
    entityId: params.entityId,
    action: params.action,
    resourceType: "employeeFinancialRequest",
    resourceId: params.requestId,
    details: {
      requestOrigin: params.origin,
      employeeId: params.employee.employeeId,
      requestId: params.requestId,
      version: params.version,
    },
  });

  if (!params.employee.personId) return;

  const deterministicKey = params.action === "employeeFinance.request_submitted"
    ? `employeeFinance.submitted:${params.entityId}:${params.requestId}`
    : params.action === "employeeFinance.request_created"
      ? `employeeFinance.created:${params.entityId}:${params.requestId}`
      : `employeeFinance.updated:${params.entityId}:${params.requestId}:${params.version}`;

  await adminDb!
    .collection("entities")
    .doc(params.entityId)
    .collection("personTimeline")
    .doc(deterministicKey)
    .set({
      eventId: deterministicKey,
      entityId: params.entityId,
      personId: params.employee.personId,
      type: params.timelineLabel,
      label: params.timelineLabel,
      description: params.action === "employeeFinance.request_submitted"
        ? "Demande financière soumise."
        : params.action === "employeeFinance.request_updated"
          ? "Demande financière mise à jour."
          : "Demande financière créée.",
      sourceCollection: REQUEST_COLLECTION,
      sourceId: params.requestId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: params.actorUid,
      metadata: {
        requestOrigin: params.origin,
        employeeId: params.employee.employeeId,
        actorName: params.actorName,
        version: params.version,
      },
    }, { merge: false });
}

export async function listEmployeeFinanceAdminEmployees(entityId: string): Promise<EmployeeFinanceAdminEmployeeOption[]> {
  assertAdminReady();
  const snap = await adminDb!
    .collection("entities")
    .doc(entityId)
    .collection("employees")
    .where("status", "==", "active")
    .get();

  const options = await Promise.all(snap.docs.map(async (doc) => {
    const ctx = await resolveEmployeeContext(entityId, doc.id);
    return {
      employeeId: ctx.employeeId,
      displayName: ctx.displayName,
      matricule: ctx.matricule,
      activeContractId: ctx.activeContractId,
      activeContractWarning: ctx.activeContractWarning,
    };
  }));

  return options.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

export async function listEmployeeFinanceRequests(
  entityId: string,
  employeeId?: string,
  options: EmployeeFinanceReadOptions = {},
): Promise<EmployeeFinancialRequestDto[]> {
  assertAdminReady();
  let query: FirebaseFirestore.Query = adminDb!
    .collection("entities")
    .doc(entityId)
    .collection(REQUEST_COLLECTION);

  if (employeeId) {
    query = query.where("employeeId", "==", employeeId);
  }

  const snap = await query.get();
  const requests = snap.docs
    .map((doc) => serializeEmployeeFinancialRequest(doc.id, doc.data() || {}))
    .filter((request) => request.entityId === entityId && (!employeeId || request.employeeId === employeeId));
  const enrichedRequests = await Promise.all(requests.map((request) => enrichEmployeeFinancialRequestDto(entityId, request, options)));
  return enrichedRequests.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export async function getEmployeeFinanceRequest(
  entityId: string,
  requestId: string,
  options: EmployeeFinanceReadOptions = {},
): Promise<EmployeeFinancialRequestDto> {
  assertAdminReady();
  const snap = await adminDb!
    .collection("entities")
    .doc(entityId)
    .collection(REQUEST_COLLECTION)
    .doc(requestId)
    .get();
  if (!snap.exists) throw new Error("Demande financière introuvable.");
  const request = serializeEmployeeFinancialRequest(snap.id, snap.data() || {});
  if (request.entityId !== entityId || request.id !== requestId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  if (options.expectedEmployeeId && request.employeeId !== options.expectedEmployeeId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
  return enrichEmployeeFinancialRequestDto(entityId, request, options);
}

export async function createEmployeeFinanceRequest(params: {
  entityId: string;
  actor: ActorContext;
  employee: EmployeeContext;
  input: EmployeeFinanceRequestInput;
  origin: EmployeeFinancialRequestOrigin;
}): Promise<EmployeeFinancialRequestDto> {
  assertAdminReady();
  const validated = validateRequestInput(params.input);
  const currency = resolveEntityCurrency(params.actor.entity);
  const requestRef = adminDb!
    .collection("entities")
    .doc(params.entityId)
    .collection(REQUEST_COLLECTION)
    .doc();
  const now = FieldValue.serverTimestamp();

  const payload: EmployeeFinancialRequest = {
    id: requestRef.id,
    entityId: params.entityId,
    personId: params.employee.personId,
    employeeId: params.employee.employeeId,
    employeeSnapshot: {
      displayName: params.employee.displayName,
      matricule: params.employee.matricule,
    },
    requestOrigin: params.origin,
    requestType: validated.requestType,
    requestDate: now,
    currency,
    requestedAmountCents: validated.requestedAmountCents,
    reason: validated.reason,
    requestedRepaymentMonths: validated.requestedRepaymentMonths,
    requestedMonthlyAmountCents: validated.requestedMonthlyAmountCents,
    requestedFirstInstallmentPeriod: validated.requestedFirstInstallmentPeriod,
    status: "draft",
    ...baseFutureFields(),
    activeContractId: params.employee.activeContractId,
    activeContractWarning: params.employee.activeContractWarning,
    createdAt: now,
    createdBy: params.actor.uid,
    createdByName: params.actor.actorName,
    updatedAt: now,
    updatedBy: params.actor.uid,
    updatedByName: params.actor.actorName,
    version: 1,
  };

  await requestRef.set(payload);
  await createAuditAndTimeline({
    action: "employeeFinance.request_created",
    timelineLabel: "employee_finance_request_created",
    entityId: params.entityId,
    requestId: requestRef.id,
    employee: params.employee,
    origin: params.origin,
    actorUid: params.actor.uid,
    actorName: params.actor.actorName,
    version: 1,
  });

  return getEmployeeFinanceRequest(params.entityId, requestRef.id);
}

export async function updateEmployeeFinanceDraft(params: {
  entityId: string;
  requestId: string;
  actor: ActorContext;
  input: EmployeeFinanceRequestInput;
  origin: EmployeeFinancialRequestOrigin;
  employee?: EmployeeContext;
  allowEmployeeChange: boolean;
}): Promise<EmployeeFinancialRequestDto> {
  assertAdminReady();
  const validated = validateRequestInput(params.input);
  const requestRef = adminDb!
    .collection("entities")
    .doc(params.entityId)
    .collection(REQUEST_COLLECTION)
    .doc(params.requestId);

  let updatedEmployee: EmployeeContext | null = null;
  let updatedVersion = 0;

  await adminDb!.runTransaction(async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists) throw new Error("Demande financière introuvable.");
    const current = snap.data() || {};
    if (current.entityId !== params.entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
    if (current.status !== "draft") throw new Error("Seuls les brouillons peuvent être modifiés.");
    if (current.requestOrigin !== params.origin) throw new Error("Origine de demande non modifiable.");

    const currentEmployeeId = String(current.employeeId || "");
    if (!params.allowEmployeeChange && params.employee?.employeeId !== currentEmployeeId) {
      throw new Error(SAFE_FORBIDDEN_MESSAGE);
    }
    updatedEmployee = params.employee || await resolveEmployeeContext(params.entityId, currentEmployeeId);
    const nextVersion = Number(current.version || 1) + 1;
    updatedVersion = nextVersion;

    transaction.update(requestRef, {
      requestType: validated.requestType,
      requestedAmountCents: validated.requestedAmountCents,
      reason: validated.reason,
      requestedRepaymentMonths: validated.requestedRepaymentMonths,
      requestedMonthlyAmountCents: validated.requestedMonthlyAmountCents,
      requestedFirstInstallmentPeriod: validated.requestedFirstInstallmentPeriod,
      ...(params.allowEmployeeChange && updatedEmployee ? {
        personId: updatedEmployee.personId,
        employeeId: updatedEmployee.employeeId,
        employeeSnapshot: {
          displayName: updatedEmployee.displayName,
          matricule: updatedEmployee.matricule,
        },
      } : {}),
      activeContractId: updatedEmployee?.activeContractId || null,
      activeContractWarning: updatedEmployee?.activeContractWarning === true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actor.uid,
      updatedByName: params.actor.actorName,
      version: nextVersion,
    });
  });

  if (!updatedEmployee) throw new Error("Employé introuvable.");
  await createAuditAndTimeline({
    action: "employeeFinance.request_updated",
    timelineLabel: "employee_finance_request_updated",
    entityId: params.entityId,
    requestId: params.requestId,
    employee: updatedEmployee,
    origin: params.origin,
    actorUid: params.actor.uid,
    actorName: params.actor.actorName,
    version: updatedVersion,
  });

  return getEmployeeFinanceRequest(params.entityId, params.requestId);
}

export async function submitEmployeeFinanceDraft(params: {
  entityId: string;
  requestId: string;
  actor: ActorContext;
  origin: EmployeeFinancialRequestOrigin;
  employeeId?: string;
}): Promise<EmployeeFinancialRequestDto & { alreadySubmitted: boolean }> {
  assertAdminReady();
  const requestRef = adminDb!
    .collection("entities")
    .doc(params.entityId)
    .collection(REQUEST_COLLECTION)
    .doc(params.requestId);

  let mutationEmployee: EmployeeContext | null = null;
  let mutationVersion = 0;
  let alreadySubmitted = false;

  await adminDb!.runTransaction(async (transaction) => {
    const snap = await transaction.get(requestRef);
    if (!snap.exists) throw new Error("Demande financière introuvable.");
    const current = snap.data() || {};
    if (current.entityId !== params.entityId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
    if (current.requestOrigin !== params.origin) throw new Error("Origine de demande non modifiable.");
    if (params.employeeId && current.employeeId !== params.employeeId) throw new Error(SAFE_FORBIDDEN_MESSAGE);
    if (current.status === "submitted") {
      alreadySubmitted = true;
      return;
    }
    if (current.status !== "draft") throw new Error("Cette demande ne peut plus être soumise.");

    const employee = await resolveEmployeeContext(params.entityId, String(current.employeeId || ""));
    if (!REQUEST_TYPES.includes(current.requestType)) throw new Error("Type de demande invalide.");
    if (!Number.isSafeInteger(current.requestedAmountCents) || current.requestedAmountCents <= 0) throw new Error("Montant demandé invalide.");
    const reason = String(current.reason || "").trim();
    if (reason.length < 3 || reason.length > 2000) throw new Error("Le motif doit contenir entre 3 et 2000 caractères.");

    const nextVersion = Number(current.version || 1) + 1;
    mutationEmployee = employee;
    mutationVersion = nextVersion;
    transaction.update(requestRef, {
      status: "submitted",
      submittedAt: FieldValue.serverTimestamp(),
      submittedBy: params.actor.uid,
      submittedByName: params.actor.actorName,
      activeContractId: employee.activeContractId,
      activeContractWarning: employee.activeContractWarning,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actor.uid,
      updatedByName: params.actor.actorName,
      version: nextVersion,
    });
  });

  if (mutationEmployee) {
    await createAuditAndTimeline({
      action: "employeeFinance.request_submitted",
      timelineLabel: "employee_finance_request_submitted",
      entityId: params.entityId,
      requestId: params.requestId,
      employee: mutationEmployee,
      origin: params.origin,
      actorUid: params.actor.uid,
      actorName: params.actor.actorName,
      version: mutationVersion,
    });
  }

  const request = await getEmployeeFinanceRequest(params.entityId, params.requestId);
  return { ...request, alreadySubmitted };
}

export const employeeFinanceCollections = {
  requests: REQUEST_COLLECTION,
  schedules: SCHEDULE_COLLECTION,
  installmentsPath: "employeeRepaymentSchedules/{scheduleId}/installments/{installmentId}",
  activeBatchStatuses: ACTIVE_BATCH_STATUSES,
};
