import { db } from "@/lib/firebase/client";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { Employee } from "@/types/employee";
import {
  KilometerReimbursement,
  KilometerReimbursementMonthlySummary,
  KilometerReimbursementPolicy,
} from "@/types/kilometer-reimbursement";
import { createAuditLog } from "./audit.service";

type PeriodInput = {
  year: number;
  month: number;
  startDate?: string;
  endDate?: string;
};

type ItemInput = Pick<
  KilometerReimbursement,
  | "employeeId"
  | "employeeName"
  | "tripDate"
  | "origin"
  | "destination"
  | "reason"
  | "kilometers"
  | "ratePerKm"
  | "policyId"
  | "vehicleInfo"
  | "notes"
  | "status"
>;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function getKilometerReimbursementMonthRange(year: number, month: number) {
  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function getKilometerReimbursementMonthlySummaryId(employeeId: string, year: number, month: number) {
  return `${employeeId}_${year}_${pad2(month)}`;
}

function overlapsPeriod(policy: KilometerReimbursementPolicy, startDate: string, endDate: string) {
  return policy.effectiveFrom <= endDate && (!policy.effectiveTo || policy.effectiveTo >= startDate);
}

function chooseLatestPolicy(policies: KilometerReimbursementPolicy[], startDate: string, endDate: string) {
  return policies
    .filter((policy) => policy.status === "active" && overlapsPeriod(policy, startDate, endDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
}

export async function resolveKilometerReimbursementPolicyForEmployee(
  entityId: string,
  employeeId: string,
  contractId: string | null | undefined,
  period: PeriodInput
): Promise<KilometerReimbursementPolicy | null> {
  if (!db) throw new Error("Firestore not initialized");

  const { startDate, endDate } = {
    ...getKilometerReimbursementMonthRange(period.year, period.month),
    ...period,
  };

  const policiesRef = collection(db, `entities/${entityId}/kilometerReimbursementPolicies`);
  const snap = await getDocs(query(policiesRef, where("status", "==", "active")));
  const policies = snap.docs.map((d) => ({ ...d.data(), id: d.id } as KilometerReimbursementPolicy));

  return resolveKilometerReimbursementPolicyFromList(policies, employeeId, contractId, {
    year: period.year,
    month: period.month,
    startDate,
    endDate,
  });
}

export function resolveKilometerReimbursementPolicyFromList(
  policies: KilometerReimbursementPolicy[],
  employeeId: string,
  contractId: string | null | undefined,
  period: PeriodInput
) {
  const { startDate, endDate } = {
    ...getKilometerReimbursementMonthRange(period.year, period.month),
    ...period,
  };

  return (
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "employee" && policy.employeeId === employeeId),
      startDate,
      endDate
    ) ||
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "contract" && !!contractId && policy.contractId === contractId),
      startDate,
      endDate
    ) ||
    chooseLatestPolicy(
      policies.filter((policy) => policy.scope === "entity"),
      startDate,
      endDate
    )
  );
}

export function calculateReimbursementItemTotal(kilometers: number, ratePerKm: number) {
  return roundMoney((Number(kilometers) || 0) * (Number(ratePerKm) || 0));
}

export function calculateKilometerReimbursementMonthlyPreview({
  entityId,
  employees,
  items,
  year,
  month,
  generatedBy,
}: {
  entityId: string;
  employees: Pick<Employee, "employeeId" | "displayName">[];
  items: KilometerReimbursement[];
  year: number;
  month: number;
  generatedBy?: string;
}): KilometerReimbursementMonthlySummary[] {
  return employees.map((employee) => {
    const approvedItems = items.filter(
      (item) =>
        item.employeeId === employee.employeeId &&
        item.year === year &&
        item.month === month &&
        item.status === "approved"
    );

    return {
      id: `${employee.employeeId}_${year}_${pad2(month)}_preview`,
      entityId,
      employeeId: employee.employeeId,
      employeeName: employee.displayName,
      year,
      month,
      totalKilometers: approvedItems.reduce((sum, item) => sum + (Number(item.kilometers) || 0), 0),
      totalAmount: roundMoney(approvedItems.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0)),
      itemCount: approvedItems.length,
      approvedItemIds: approvedItems.map((item) => item.id).filter(Boolean) as string[],
      status: "preview",
      generatedAt: new Date(),
      generatedBy,
    };
  });
}

export async function saveEntityKilometerReimbursementPolicy(
  entityId: string,
  data: Pick<
    KilometerReimbursementPolicy,
    | "effectiveFrom"
    | "effectiveTo"
    | "ratePerKm"
    | "rateSource"
    | "aciReferenceLabel"
    | "notes"
    | "status"
  >,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const policiesRef = collection(db, `entities/${entityId}/kilometerReimbursementPolicies`);
  const existingSnap = await getDocs(
    query(
      policiesRef,
      where("scope", "==", "entity"),
      where("status", "==", "active")
    )
  );

  const overlappingPolicies = existingSnap.docs
    .map((d) => ({ ...d.data(), id: d.id } as KilometerReimbursementPolicy))
    .filter((policy) => overlapsPeriod(policy, data.effectiveFrom, data.effectiveTo || "9999-12-31"));

  if (data.status === "active" && overlappingPolicies.length > 0) {
    throw new Error(
      "Une politique kilométrique active existe déjà sur cette période. Créez une période non chevauchante ou désactivez l'ancienne politique."
    );
  }

  const policyRef = doc(policiesRef);
  const policyId = policyRef.id;
  const payload: KilometerReimbursementPolicy = {
    id: policyId,
    entityId,
    scope: "entity",
    employeeId: null,
    contractId: null,
    vehicleId: null,
    ...data,
    effectiveTo: data.effectiveTo || null,
    aciReferenceLabel: data.aciReferenceLabel || null,
    notes: data.notes || null,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  await setDoc(policyRef, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "kilometer_reimbursement.policy_created",
    resourceType: "kilometerReimbursementPolicy",
    resourceId: policyId,
    details: {
      scope: "entity",
      ratePerKm: data.ratePerKm,
      rateSource: data.rateSource,
      status: data.status,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo || null,
    },
  });

  return policyId;
}

export async function saveKilometerReimbursementItem(
  entityId: string,
  data: ItemInput,
  actorUid: string,
  itemId?: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const collectionRef = collection(db, `entities/${entityId}/kilometerReimbursements`);
  const ref = itemId ? doc(db, `entities/${entityId}/kilometerReimbursements`, itemId) : doc(collectionRef);
  const id = itemId || ref.id;
  const tripDate = data.tripDate;
  const tripMonth = Number(tripDate.slice(5, 7));
  const tripYear = Number(tripDate.slice(0, 4));
  const totalAmount = calculateReimbursementItemTotal(data.kilometers, data.ratePerKm);

  const payload: KilometerReimbursement = {
    id,
    entityId,
    employeeId: data.employeeId,
    employeeName: data.employeeName,
    year: tripYear,
    month: tripMonth,
    tripDate,
    origin: data.origin,
    destination: data.destination,
    reason: data.reason,
    kilometers: Number(data.kilometers) || 0,
    ratePerKm: Number(data.ratePerKm) || 0,
    totalAmount,
    policyId: data.policyId || null,
    vehicleInfo: data.vehicleInfo || null,
    status: data.status || "draft",
    notes: data.notes || null,
    attachmentIds: [],
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
    ...(itemId ? {} : { createdAt: serverTimestamp(), createdBy: actorUid }),
  };

  await setDoc(ref, payload, { merge: true });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: itemId ? "kilometer_reimbursement.item_updated" : "kilometer_reimbursement.item_created",
    resourceType: "kilometerReimbursement",
    resourceId: id,
    details: {
      employeeId: data.employeeId,
      tripDate,
      kilometers: payload.kilometers,
      ratePerKm: payload.ratePerKm,
      totalAmount,
      status: payload.status,
    },
  });

  return id;
}

export async function updateKilometerReimbursementStatus(
  entityId: string,
  itemId: string,
  status: "approved" | "rejected",
  actorUid: string,
  rejectionReason?: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const ref = doc(db, `entities/${entityId}/kilometerReimbursements`, itemId);
  await updateDoc(ref, {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
    ...(status === "approved"
      ? { approvedAt: serverTimestamp(), approvedBy: actorUid, rejectedAt: null, rejectedBy: null, rejectionReason: null }
      : { rejectedAt: serverTimestamp(), rejectedBy: actorUid, rejectionReason: rejectionReason || "Rejeté par RH" }),
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: `kilometer_reimbursement.item_${status}`,
    resourceType: "kilometerReimbursement",
    resourceId: itemId,
    details: { status, rejectionReason: rejectionReason || null },
  });
}

export async function deleteDraftKilometerReimbursementItem(entityId: string, itemId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  await deleteDoc(doc(db, `entities/${entityId}/kilometerReimbursements`, itemId));
  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "kilometer_reimbursement.item_deleted",
    resourceType: "kilometerReimbursement",
    resourceId: itemId,
    details: { deletedAsDraft: true },
  });
}

export async function confirmKilometerReimbursementMonth(
  entityId: string,
  summaries: KilometerReimbursementMonthlySummary[],
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");

  const batch = writeBatch(db);
  const generatedAt = serverTimestamp();
  const summaryIds: string[] = [];

  for (const summary of summaries) {
    const summaryId = getKilometerReimbursementMonthlySummaryId(summary.employeeId, summary.year, summary.month);
    const ref = doc(db, `entities/${entityId}/kilometerReimbursementMonthlySummaries`, summaryId);
    summaryIds.push(summaryId);

    batch.set(ref, {
      ...summary,
      id: summaryId,
      entityId,
      status: "confirmed",
      generatedAt,
      generatedBy: actorUid,
    } satisfies KilometerReimbursementMonthlySummary);
  }

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "kilometer_reimbursement.month_confirmed",
    resourceType: "kilometerReimbursementMonthlySummary",
    resourceId: `${summaries[0]?.year || "unknown"}_${summaries[0]?.month || "unknown"}`,
    details: {
      year: summaries[0]?.year,
      month: summaries[0]?.month,
      employeesConfirmed: summaries.length,
      totalKilometers: summaries.reduce((sum, summary) => sum + (summary.totalKilometers || 0), 0),
      totalAmount: summaries.reduce((sum, summary) => sum + (summary.totalAmount || 0), 0),
      summaryIds,
    },
  });

  return { confirmed: summaries.length, summaryIds };
}
