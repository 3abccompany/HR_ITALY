import { db } from "@/lib/firebase/client";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  where,
  serverTimestamp,
  Query,
  runTransaction,
  writeBatch
} from "firebase/firestore";
import {
  Training,
  TrainingApprovalStatus,
  TrainingParticipant,
  TrainingParticipantStatus,
  TrainingSession,
  TrainingSessionStatus,
  EmployeeTrainingHistoryItem,
} from "@/types/training";
import { createAuditLog } from "./audit.service";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { createNotification } from "./notification.service";

/**
 * Removes undefined properties from an object before Firestore write.
 * Preserves FieldValue and Timestamp instances.
 */
function sanitizePayload(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (
    obj.constructor?.name === 'FieldValue' || 
    obj.constructor?.name === 'Timestamp' || 
    obj.constructor?.name === 'ServerTimestampValue' ||
    obj._methodName === 'serverTimestamp'
  ) {
    return obj;
  }

  const newObj: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (val !== undefined) {
      newObj[key] = typeof val === 'object' ? sanitizePayload(val) : val;
    }
  }
  return newObj;
}

const TRAINING_SESSION_STATUSES: TrainingSessionStatus[] = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
];

const TRAINING_APPROVAL_STATUSES: TrainingApprovalStatus[] = [
  "not_submitted",
  "pending",
  "approved",
  "rejected",
];

const TRAINING_PARTICIPANT_STATUSES: TrainingParticipantStatus[] = [
  "planned",
  "attended",
  "absent",
  "completed",
  "not_completed",
  "cancelled",
];

function assertNonEmpty(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}

function assertValidSessionStatus(status: TrainingSessionStatus) {
  if (!TRAINING_SESSION_STATUSES.includes(status)) {
    throw new Error("Statut de session de formation invalide.");
  }
}

function assertValidApprovalStatus(status: TrainingApprovalStatus) {
  if (!TRAINING_APPROVAL_STATUSES.includes(status)) {
    throw new Error("Statut d'approbation de formation invalide.");
  }
}

function assertValidParticipantStatus(status: TrainingParticipantStatus) {
  if (!TRAINING_PARTICIPANT_STATUSES.includes(status)) {
    throw new Error("Statut participant de formation invalide.");
  }
}

function buildEmployeeDisplayName(employee: any): string {
  if (typeof employee?.displayName === "string" && employee.displayName.trim()) {
    return employee.displayName.trim();
  }

  return [employee?.firstName, employee?.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();
}

function sessionRef(entityId: string, sessionId: string) {
  if (!db) throw new Error("Firestore not initialized");
  return doc(db, `entities/${entityId}/trainingSessions`, sessionId);
}

function participantRef(entityId: string, sessionId: string, employeeId: string) {
  if (!db) throw new Error("Firestore not initialized");
  return doc(db, `entities/${entityId}/trainingSessions/${sessionId}/participants`, employeeId);
}

export type CreateTrainingSessionInput = Omit<
  Partial<TrainingSession>,
  | "id"
  | "entityId"
  | "status"
  | "approvalStatus"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "submittedForApprovalAt"
  | "submittedForApprovalBy"
  | "approvedAt"
  | "approvedBy"
  | "rejectedAt"
  | "rejectedBy"
  | "rejectionReason"
  | "archivedAt"
  | "archivedBy"
> & Pick<TrainingSession, "title" | "trainingType" | "startDate">;

export type UpdateTrainingSessionInput = Omit<
  Partial<TrainingSession>,
  | "id"
  | "entityId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "approvalStatus"
  | "submittedForApprovalAt"
  | "submittedForApprovalBy"
  | "approvedAt"
  | "approvedBy"
  | "rejectedAt"
  | "rejectedBy"
  | "rejectionReason"
>;

export type SaveTrainingSessionInput = (CreateTrainingSessionInput | UpdateTrainingSessionInput) & {
  status?: TrainingSessionStatus;
};

export async function createTrainingSession(
  entityId: string,
  data: CreateTrainingSessionInput,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(entityId, "Entité requise.");
  assertNonEmpty(actorUid, "Acteur requis.");
  assertNonEmpty(data.title, "Titre de formation requis.");
  assertNonEmpty(data.trainingType, "Type de formation requis.");
  assertNonEmpty(data.startDate, "Date de début requise.");

  const ref = doc(collection(db, `entities/${entityId}/trainingSessions`));
  const sessionId = ref.id;

  const payload: TrainingSession = sanitizePayload({
    ...data,
    id: sessionId,
    entityId,
    status: "draft",
    approvalStatus: "not_submitted",
    certificateRequired: data.certificateRequired ?? false,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }) as TrainingSession;

  await setDoc(ref, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.created",
    resourceType: "trainingSession",
    resourceId: sessionId,
    details: { title: data.title, type: data.trainingType }
  });

  return sessionId;
}

export async function updateTrainingSession(
  entityId: string,
  sessionId: string,
  data: UpdateTrainingSessionInput,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(entityId, "Entité requise.");
  assertNonEmpty(sessionId, "Session de formation requise.");
  assertNonEmpty(actorUid, "Acteur requis.");

  if (data.status) assertValidSessionStatus(data.status);

  const forbiddenKeys = [
    "entityId",
    "createdAt",
    "createdBy",
    "approvalStatus",
    "submittedForApprovalAt",
    "submittedForApprovalBy",
    "approvedAt",
    "approvedBy",
    "rejectedAt",
    "rejectedBy",
    "rejectionReason",
  ];

  for (const key of forbiddenKeys) {
    if (key in (data as Record<string, unknown>)) {
      throw new Error("Champ de session de formation non modifiable par cette opération.");
    }
  }

  const ref = sessionRef(entityId, sessionId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("Session de formation introuvable.");
  if (current.data().entityId !== entityId) throw new Error("Session de formation hors entité.");

  const payload = sanitizePayload({
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await updateDoc(ref, payload);

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.updated",
    resourceType: "trainingSession",
    resourceId: sessionId,
    details: { changes: Object.keys(data) }
  });
}

export async function saveTrainingSessionWithParticipants(
  entityId: string,
  sessionId: string | null,
  data: SaveTrainingSessionInput,
  selectedEmployeeIds: string[],
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(entityId, "Entité requise.");
  assertNonEmpty(actorUid, "Acteur requis.");
  assertNonEmpty(data.title, "Titre de formation requis.");
  assertNonEmpty(data.trainingType, "Type de formation requis.");
  assertNonEmpty(data.startDate, "Date de début requise.");
  if (data.status) assertValidSessionStatus(data.status);

  const isCreate = !sessionId;
  const ref = isCreate
    ? doc(collection(db, `entities/${entityId}/trainingSessions`))
    : sessionRef(entityId, sessionId);
  const resolvedSessionId = ref.id;
  const selected = Array.from(new Set(selectedEmployeeIds.map((id) => id.trim()).filter(Boolean)));
  const created: string[] = [];
  const existing: string[] = [];

  await runTransaction(db, async (transaction) => {
    let currentSession: TrainingSession | null = null;

    if (!isCreate) {
      const sessionSnap = await transaction.get(ref);
      if (!sessionSnap.exists()) throw new Error("Session de formation introuvable.");
      currentSession = sessionSnap.data() as TrainingSession;
      if (currentSession.entityId !== entityId) {
        throw new Error("Session de formation hors entité.");
      }
    }

    const employeeSnaps = await Promise.all(selected.map(async (employeeId) => {
      const employeeRef = doc(db!, `entities/${entityId}/employees`, employeeId);
      const employeeSnap = await transaction.get(employeeRef);
      return { employeeId, employeeSnap };
    }));

    const participantSnaps = await Promise.all(selected.map(async (employeeId) => {
      const pRef = participantRef(entityId, resolvedSessionId, employeeId);
      const participantSnap = await transaction.get(pRef);
      return { employeeId, pRef, participantSnap };
    }));
    const participantSnapByEmployeeId = new Map(
      participantSnaps.map((item) => [item.employeeId, item])
    );

    for (const { employeeId, employeeSnap } of employeeSnaps) {
      if (!employeeSnap.exists()) throw new Error("Collaborateur introuvable.");
      const employee = employeeSnap.data();
      if (!employee) throw new Error("Collaborateur introuvable.");
      if (employee.entityId && employee.entityId !== entityId) {
        throw new Error("Collaborateur hors entité.");
      }
    }

    if (isCreate) {
      const payload: TrainingSession = sanitizePayload({
        ...data,
        id: resolvedSessionId,
        entityId,
        status: data.status || "draft",
        approvalStatus: "not_submitted",
        certificateRequired: data.certificateRequired ?? false,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }) as TrainingSession;

      transaction.set(ref, payload);
    } else {
      const forbiddenKeys = [
        "entityId",
        "createdAt",
        "createdBy",
        "approvalStatus",
        "submittedForApprovalAt",
        "submittedForApprovalBy",
        "approvedAt",
        "approvedBy",
        "rejectedAt",
        "rejectedBy",
        "rejectionReason",
      ];

      for (const key of forbiddenKeys) {
        if (key in (data as Record<string, unknown>)) {
          throw new Error("Champ de session de formation non modifiable par cette opération.");
        }
      }

      if (!currentSession) throw new Error("Session de formation introuvable.");
      transaction.update(ref, sanitizePayload({
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }));
    }

    for (const { employeeId, employeeSnap } of employeeSnaps) {
      const participantRead = participantSnapByEmployeeId.get(employeeId);
      if (!participantRead) throw new Error("Lecture participant introuvable.");

      if (participantRead.participantSnap.exists()) {
        existing.push(employeeId);
        continue;
      }

      const employee = employeeSnap.data();
      if (!employee) throw new Error("Collaborateur introuvable.");
      const displayName = buildEmployeeDisplayName(employee);
      const participant: TrainingParticipant = sanitizePayload({
        id: employeeId,
        entityId,
        sessionId: resolvedSessionId,
        employeeId,
        personId: employee.personId ?? null,
        employeeCodeSnapshot: employee.employeeCode ?? null,
        employeeDisplayNameSnapshot: displayName || null,
        participantStatus: "planned",
        resultStatus: null,
        certificateDocumentId: null,
        assignedAt: serverTimestamp(),
        assignedBy: actorUid,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }) as TrainingParticipant;

      transaction.set(participantRead.pRef, participant);
      created.push(employeeId);
    }
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: isCreate ? "trainingSession.created" : "trainingSession.updated",
    resourceType: "trainingSession",
    resourceId: resolvedSessionId,
    details: {
      changes: Object.keys(data),
      participantCreated: created,
      participantExisting: existing,
    }
  });

  return { sessionId: resolvedSessionId, created, existing };
}

export async function getTrainingSession(entityId: string, sessionId: string): Promise<TrainingSession | null> {
  if (!db) throw new Error("Firestore not initialized");
  const snap = await getDoc(sessionRef(entityId, sessionId));
  if (!snap.exists()) return null;
  const data = snap.data() as TrainingSession;
  if (data.entityId !== entityId) throw new Error("Session de formation hors entité.");
  return { ...data, id: snap.id };
}

export async function listTrainingSessions(entityId: string): Promise<TrainingSession[]> {
  if (!db) throw new Error("Firestore not initialized");
  const q = query(collection(db, `entities/${entityId}/trainingSessions`), orderBy("startDate", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((item) => ({ ...(item.data() as TrainingSession), id: item.id }));
}

export async function submitTrainingSessionForApproval(entityId: string, sessionId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = sessionRef(entityId, sessionId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("Session de formation introuvable.");

  const session = current.data() as TrainingSession;
  if (session.entityId !== entityId) throw new Error("Session de formation hors entité.");
  if (!["not_submitted", "rejected"].includes(session.approvalStatus)) {
    throw new Error("Cette session ne peut pas être soumise pour approbation.");
  }

  await updateDoc(ref, {
    approvalStatus: "pending",
    submittedForApprovalAt: serverTimestamp(),
    submittedForApprovalBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.submittedForApproval",
    resourceType: "trainingSession",
    resourceId: sessionId,
  });
}

export async function approveTrainingSession(entityId: string, sessionId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = sessionRef(entityId, sessionId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("Session de formation introuvable.");

  const session = current.data() as TrainingSession;
  if (session.entityId !== entityId) throw new Error("Session de formation hors entité.");
  if (session.approvalStatus !== "pending") {
    throw new Error("Seule une session en attente peut être approuvée.");
  }

  await updateDoc(ref, {
    approvalStatus: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: actorUid,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.approved",
    resourceType: "trainingSession",
    resourceId: sessionId,
  });
}

export async function rejectTrainingSession(
  entityId: string,
  sessionId: string,
  reason: string,
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(reason, "Motif de rejet requis.");

  const ref = sessionRef(entityId, sessionId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("Session de formation introuvable.");

  const session = current.data() as TrainingSession;
  if (session.entityId !== entityId) throw new Error("Session de formation hors entité.");
  if (session.approvalStatus !== "pending") {
    throw new Error("Seule une session en attente peut être rejetée.");
  }

  await updateDoc(ref, {
    approvalStatus: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: actorUid,
    rejectionReason: reason.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.rejected",
    resourceType: "trainingSession",
    resourceId: sessionId,
    details: { reason: reason.trim() }
  });
}

export async function addTrainingParticipants(
  entityId: string,
  sessionId: string,
  employeeIds: string[],
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(entityId, "Entité requise.");
  assertNonEmpty(sessionId, "Session de formation requise.");
  assertNonEmpty(actorUid, "Acteur requis.");

  const uniqueEmployeeIds = Array.from(new Set(employeeIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueEmployeeIds.length === 0) throw new Error("Aucun collaborateur sélectionné.");

  const created: string[] = [];
  const existing: string[] = [];

  await runTransaction(db, async (transaction) => {
    const sRef = sessionRef(entityId, sessionId);
    const sessionSnap = await transaction.get(sRef);
    if (!sessionSnap.exists()) throw new Error("Session de formation introuvable.");
    if ((sessionSnap.data() as TrainingSession).entityId !== entityId) {
      throw new Error("Session de formation hors entité.");
    }

    const employeeSnaps = await Promise.all(uniqueEmployeeIds.map(async (employeeId) => {
      const employeeRef = doc(db!, `entities/${entityId}/employees`, employeeId);
      const employeeSnap = await transaction.get(employeeRef);
      return { employeeId, employeeRef, employeeSnap };
    }));

    const participantSnaps = await Promise.all(uniqueEmployeeIds.map(async (employeeId) => {
      const pRef = participantRef(entityId, sessionId, employeeId);
      const participantSnap = await transaction.get(pRef);
      return { employeeId, pRef, participantSnap };
    }));
    const participantSnapByEmployeeId = new Map(
      participantSnaps.map((item) => [item.employeeId, item])
    );

    for (const { employeeId, employeeSnap } of employeeSnaps) {
      if (!employeeSnap.exists()) throw new Error("Collaborateur introuvable.");
      const employee = employeeSnap.data();
      if (employee.entityId && employee.entityId !== entityId) {
        throw new Error("Collaborateur hors entité.");
      }

      const participantRead = participantSnapByEmployeeId.get(employeeId);
      if (!participantRead) throw new Error("Lecture participant introuvable.");

      if (participantRead.participantSnap.exists()) {
        existing.push(employeeId);
        continue;
      }

      const displayName = buildEmployeeDisplayName(employee);
      const participant: TrainingParticipant = sanitizePayload({
        id: employeeId,
        entityId,
        sessionId,
        employeeId,
        personId: employee.personId ?? null,
        employeeCodeSnapshot: employee.employeeCode ?? null,
        employeeDisplayNameSnapshot: displayName || null,
        participantStatus: "planned",
        resultStatus: null,
        certificateDocumentId: null,
        assignedAt: serverTimestamp(),
        assignedBy: actorUid,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      }) as TrainingParticipant;

      transaction.set(participantRead.pRef, participant);
      created.push(employeeId);
    }
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingSession.participantsAdded",
    resourceType: "trainingSession",
    resourceId: sessionId,
    details: { created, existing }
  });

  return { created, existing };
}

export async function cancelTrainingParticipant(
  entityId: string,
  sessionId: string,
  employeeId: string,
  actorUid: string,
  cancellationReason?: string | null
) {
  if (!db) throw new Error("Firestore not initialized");
  const ref = participantRef(entityId, sessionId, employeeId);
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error("Participant de formation introuvable.");
  const participant = current.data() as TrainingParticipant;
  if (participant.entityId !== entityId || participant.sessionId !== sessionId || participant.employeeId !== employeeId) {
    throw new Error("Participant de formation hors contexte.");
  }
  if (["completed", "attended"].includes(participant.participantStatus)) {
    throw new Error("Une participation déjà réalisée ne peut pas être annulée par cette opération.");
  }

  await updateDoc(ref, sanitizePayload({
    participantStatus: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: actorUid,
    cancellationReason: cancellationReason?.trim() || null,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "trainingParticipant.cancelled",
    resourceType: "trainingParticipant",
    resourceId: `${sessionId}/${employeeId}`,
    details: { sessionId, employeeId, cancellationReason: cancellationReason?.trim() || null }
  });
}

export async function getTrainingParticipants(entityId: string, sessionId: string): Promise<TrainingParticipant[]> {
  if (!db) throw new Error("Firestore not initialized");
  const snap = await getDocs(collection(db, `entities/${entityId}/trainingSessions/${sessionId}/participants`));
  return snap.docs
    .map((item) => ({ ...(item.data() as TrainingParticipant), id: item.id }))
    .filter((participant) => participant.entityId === entityId && participant.sessionId === sessionId);
}

export async function syncTrainingSessionParticipants(
  entityId: string,
  sessionId: string,
  selectedEmployeeIds: string[],
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  assertNonEmpty(entityId, "Entité requise.");
  assertNonEmpty(sessionId, "Session de formation requise.");
  assertNonEmpty(actorUid, "Acteur requis.");

  const selected = Array.from(new Set(selectedEmployeeIds.map((id) => id.trim()).filter(Boolean)));
  const selectedSet = new Set(selected);
  const currentParticipants = await getTrainingParticipants(entityId, sessionId);
  const activeParticipants = currentParticipants.filter((participant) => participant.participantStatus !== "cancelled");
  const activeParticipantIds = new Set(activeParticipants.map((participant) => participant.employeeId));
  const toAdd = selected.filter((employeeId) => !activeParticipantIds.has(employeeId));
  const toCancel = activeParticipants.filter((participant) => !selectedSet.has(participant.employeeId));

  const added: string[] = [];
  const existing: string[] = [];
  if (toAdd.length > 0) {
    const addResult = await addTrainingParticipants(entityId, sessionId, toAdd, actorUid);
    added.push(...addResult.created);
    existing.push(...addResult.existing);
  }

  const cancelled: string[] = [];
  const skipped: string[] = [];
  for (const participant of toCancel) {
    const hasHistoricalOutcome =
      participant.participantStatus !== "planned" ||
      !!participant.resultStatus ||
      !!participant.completedAt ||
      !!participant.certificateDocumentId;

    if (hasHistoricalOutcome) {
      skipped.push(participant.employeeId);
      continue;
    }

    await cancelTrainingParticipant(
      entityId,
      sessionId,
      participant.employeeId,
      actorUid,
      "Retiré de la sélection avant réalisation."
    );
    cancelled.push(participant.employeeId);
  }

  return { added, existing, cancelled, skipped };
}

export function mapLegacyTrainingToHistoryItem(training: Training): EmployeeTrainingHistoryItem {
  return {
    id: training.id,
    entityId: training.entityId,
    employeeId: training.employeeId,
    source: "legacy",
    legacyTrainingId: training.id,
    sessionId: training.sessionId ?? null,
    title: training.title,
    trainingType: training.trainingType,
    providerName: training.provider,
    startDate: training.startDate || training.courseDate,
    endDate: training.endDate ?? null,
    durationHours: training.durationHours ?? null,
    status: training.status,
    approvalStatus: null,
    participantStatus: null,
    resultStatus: training.resultStatus ?? null,
    certificateDocumentId: training.certificateDocumentId ?? null,
  };
}

export async function getEmployeeTrainingHistory(
  entityId: string,
  employeeId: string,
  options?: { includeLegacy?: boolean }
): Promise<EmployeeTrainingHistoryItem[]> {
  if (!db) throw new Error("Firestore not initialized");

  if (options?.includeLegacy === false) {
    return [];
  }

  const legacyQuery = query(
    collection(db, `entities/${entityId}/trainings`),
    where("employeeId", "==", employeeId)
  );
  const legacySnap = await getDocs(legacyQuery);
  const legacyItems = legacySnap.docs.map((item) => mapLegacyTrainingToHistoryItem({
    ...(item.data() as Training),
    id: item.id,
  }));

  return [
    ...legacyItems,
  ];
}

export async function createTraining(entityId: string, data: Partial<Training>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const trainingRef = doc(collection(db, `entities/${entityId}/trainings`));
  const trainingId = trainingRef.id;

  // Backward compatibility: ensure courseDate and startDate are consistent
  const startDate = data.startDate || data.courseDate || new Date().toISOString().split('T')[0];

  const payload: Partial<Training> = {
    ...data,
    id: trainingId,
    entityId,
    startDate,
    courseDate: startDate, // Maintain legacy field
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Create Training
      transaction.set(trainingRef, sanitizePayload(payload));

      // 2. Timeline Event
      if (data.personId) {
        const timelineRef = doc(collection(db!, `entities/${entityId}/personTimeline`));
        transaction.set(timelineRef, {
          eventId: timelineRef.id,
          entityId,
          personId: data.personId,
          type: "training.created",
          label: "Formation enregistrée",
          description: `Formation "${data.title}" (${data.trainingType}) enregistrée.`,
          sourceCollection: "trainings",
          sourceId: trainingId,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        });
      }
    });

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "training.created",
      resourceType: "training",
      resourceId: trainingId,
      details: { title: data.title, type: data.trainingType, employeeId: data.employeeId }
    });

    // Notify Employee (Non-blocking)
    if (data.employeeId) {
      const empId = data.employeeId;
      void (async () => {
        try {
          const empSnap = await getDoc(doc(db!, `entities/${entityId}/employees`, empId));
          const empData = empSnap.data();
          if (empData?.userId) {
            await createNotification(entityId, {
              targetUid: empData.userId,
              audience: "employee",
              category: "training",
              severity: "info",
              title: "Formation planifiée",
              message: "Une formation vous a été planifiée.",
              actionUrl: `/entity/${entityId}/my-space`,
              dedupKey: `training_planned:${trainingId}`
            });
          }
        } catch (notifErr) {
          console.warn("[Notification] Training notification failed (silent):", notifErr);
        }
      })();
    }

    return trainingId;
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: trainingRef.path,
        operation: 'create',
        requestResourceData: payload,
        debugLabel: 'createTraining'
      }));
    }
    throw err;
  }
}

/**
 * Creates a batch of training records for multiple employees.
 * Each employee gets their own independent record, linked by a batchId.
 */
export async function createTrainingBatch(
  entityId: string, 
  payload: Partial<Training>, 
  employees: { employeeId: string; personId: string | null }[], 
  actorUid: string
) {
  if (!db) throw new Error("Firestore not initialized");
  if (employees.length === 0) throw new Error("Aucun collaborateur sélectionné.");

  const batch = writeBatch(db);
  const now = serverTimestamp();
  const batchId = doc(collection(db, "temp")).id;
  const startDate = payload.startDate || payload.courseDate || new Date().toISOString().split('T')[0];

  const createdIds: string[] = [];

  for (const emp of employees) {
    const trainingRef = doc(collection(db, `entities/${entityId}/trainings`));
    const trainingId = trainingRef.id;
    createdIds.push(trainingId);

    const docData: Partial<Training> = {
      ...payload,
      id: trainingId,
      entityId,
      employeeId: emp.employeeId,
      personId: emp.personId,
      startDate,
      courseDate: startDate,
      batchId,
      createdFromBatch: true,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    };

    batch.set(trainingRef, sanitizePayload(docData));

    // Individual Timeline Event
    if (emp.personId) {
      const timelineRef = doc(collection(db, `entities/${entityId}/personTimeline`));
      batch.set(timelineRef, {
        eventId: timelineRef.id,
        entityId: entityId,
        personId: emp.personId,
        type: "training.created",
        label: "Formation enregistrée (groupe)",
        description: `Formation "${payload.title}" (${payload.trainingType}) enregistrée via session de groupe.`,
        sourceCollection: "trainings",
        sourceId: trainingId,
        createdAt: now,
        createdBy: actorUid,
      });
    }
  }

  await batch.commit();

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "training.batch_created",
    resourceType: "training",
    resourceId: batchId,
    details: { count: employees.length, title: payload.title }
  });

  // Notify Each Employee Individually (Non-blocking)
  void (async () => {
    try {
      for (let i = 0; i < employees.length; i++) {
        const empId = employees[i].employeeId;
        const trainingId = createdIds[i];
        
        const empSnap = await getDoc(doc(db!, `entities/${entityId}/employees`, empId));
        const empData = empSnap.data();
        
        if (empData?.userId) {
          await createNotification(entityId, {
            targetUid: empData.userId,
            audience: "employee",
            category: "training",
            severity: "info",
            title: "Formation planifiée",
            message: "Une formation vous a été planifiée.",
            actionUrl: `/entity/${entityId}/my-space`,
            dedupKey: `training_planned:${trainingId}`
          });
        }
      }
    } catch (notifErr) {
      console.warn("[Notification] Batch training notification loop failed (silent):", notifErr);
    }
  })();

  return { batchId, count: employees.length };
}

export async function updateTraining(entityId: string, trainingId: string, data: Partial<Training>, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");

  const trainingRef = doc(db, `entities/${entityId}/trainings`, trainingId);
  
  // Ensure startDate and legacy courseDate stay synchronized
  const updateData = { ...data };
  if (updateData.startDate) updateData.courseDate = updateData.startDate;
  if (!updateData.startDate && updateData.courseDate) updateData.startDate = updateData.courseDate;

  const payload = {
    ...updateData,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  };

  try {
    await updateDoc(trainingRef, sanitizePayload(payload));

    await createAuditLog({
      userId: actorUid,
      entityId,
      action: "training.updated",
      resourceType: "training",
      resourceId: trainingId,
      details: { changes: Object.keys(data) }
    });
  } catch (err: any) {
    if (err.code === 'permission-denied') {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: trainingRef.path,
        operation: 'update',
        requestResourceData: payload,
        debugLabel: 'updateTraining'
      }));
    }
    throw err;
  }
}

export async function archiveTraining(entityId: string, trainingId: string, actorUid: string) {
  if (!db) throw new Error("Firestore not initialized");
  
  const trainingRef = doc(db, `entities/${entityId}/trainings`, trainingId);
  await updateDoc(trainingRef, {
    status: "archived",
    archivedAt: serverTimestamp(),
    archivedBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  await createAuditLog({
    userId: actorUid,
    entityId,
    action: "training.archived",
    resourceType: "training",
    resourceId: trainingId,
  });
}
