import type {
  TrainingParticipant,
  TrainingParticipantStatus,
  TrainingRenewalMode,
  TrainingResultStatus,
  TrainingSession,
} from "@/types/training";

export const TRAINING_PARTICIPANT_VALIDITY_FIELDS = [
  "validityRequired",
  "validityStartDate",
  "validityEndDate",
  "validitySource",
  "renewalModeSnapshot",
  "renewalPeriodMonthsSnapshot",
  "validityWarningDaysSnapshot",
] as const;

export type TrainingParticipantValidityField = typeof TRAINING_PARTICIPANT_VALIDITY_FIELDS[number];

export type TrainingParticipantValidityValues = Partial<Record<TrainingParticipantValidityField, boolean | number | string | null>>;

export type TrainingParticipantValidityDerivation = {
  values: TrainingParticipantValidityValues;
  fieldsToDelete: TrainingParticipantValidityField[];
};

export type TrainingValidityState =
  | "non_applicable"
  | "pending_result"
  | "awaiting_final_validation"
  | "not_acquired"
  | "policy_missing"
  | "not_recorded"
  | "valid"
  | "renewal_due"
  | "expired"
  | "renewed";

export const TRAINING_VALIDITY_STATE_LABELS: Record<TrainingValidityState, string> = {
  non_applicable: "Sans renouvellement",
  pending_result: "En attente de résultat",
  awaiting_final_validation: "En attente de validation finale",
  not_acquired: "Non acquise",
  policy_missing: "Politique non renseignée",
  not_recorded: "Validité non renseignée",
  valid: "Valide",
  renewal_due: "À renouveler",
  expired: "Expirée",
  renewed: "Renouvelée",
};

export const TRAINING_VALIDITY_WARNING_FALLBACK_DAYS = 60;

type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  _seconds?: number;
};

export function completionTimestampToDateOnly(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateToDateOnly(new Date(value));
  }

  if (value instanceof Date) {
    return dateToDateOnly(value);
  }

  if (typeof value === "object") {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === "function") {
      return dateToDateOnly(timestamp.toDate());
    }

    const seconds = typeof timestamp.seconds === "number"
      ? timestamp.seconds
      : typeof timestamp._seconds === "number"
        ? timestamp._seconds
        : null;

    if (seconds != null) {
      return dateToDateOnly(new Date(seconds * 1000));
    }
  }

  return null;
}

export function addCalendarMonthsToDateOnly(dateOnly: string, months: number): string | null {
  const parsed = parseDateOnlyParts(dateOnly);
  if (!parsed || !Number.isInteger(months) || months <= 0) return null;

  const targetMonthIndex = parsed.month - 1 + months;
  const targetYear = parsed.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(parsed.day, lastTargetDay);

  return formatDateOnlyParts(targetYear, targetMonth, targetDay);
}

export function isParticipantValidityEligible(
  participantStatus: TrainingParticipantStatus,
  resultStatus?: TrainingResultStatus | null
) {
  return participantStatus === "completed" && resultStatus === "passed";
}

export function clearTrainingParticipantValidityFields(): TrainingParticipantValidityDerivation {
  return {
    values: {},
    fieldsToDelete: [...TRAINING_PARTICIPANT_VALIDITY_FIELDS],
  };
}

export function deriveTrainingParticipantValidity(params: {
  participantStatus: TrainingParticipantStatus;
  resultStatus?: TrainingResultStatus | null;
  completionTimestamp: unknown;
  sessionPolicy: Pick<
    TrainingSession,
    "renewalMode" | "renewalRequired" | "renewalPeriodMonths" | "validityWarningDays"
  >;
}): TrainingParticipantValidityDerivation {
  const { participantStatus, resultStatus, completionTimestamp, sessionPolicy } = params;

  if (!isParticipantValidityEligible(participantStatus, resultStatus)) {
    return clearTrainingParticipantValidityFields();
  }

  const renewalMode = sessionPolicy.renewalMode ?? null;
  const renewalRequired = sessionPolicy.renewalRequired;
  const validityStartDate = completionTimestampToDateOnly(completionTimestamp);

  if (!renewalMode && renewalRequired == null) {
    return { values: {}, fieldsToDelete: [] };
  }

  if (!validityStartDate) {
    return { values: {}, fieldsToDelete: [] };
  }

  if (renewalMode === "none" || renewalRequired === false) {
    return {
      values: {
        validityRequired: false,
        validityStartDate,
        validitySource: "participant_completion",
        renewalModeSnapshot: renewalMode || "none",
      },
      fieldsToDelete: [
        "validityEndDate",
        "renewalPeriodMonthsSnapshot",
        "validityWarningDaysSnapshot",
      ],
    };
  }

  if (renewalMode === "periodic" && renewalRequired === true && isPositiveInteger(sessionPolicy.renewalPeriodMonths)) {
    const validityEndDate = addCalendarMonthsToDateOnly(validityStartDate, sessionPolicy.renewalPeriodMonths);
    if (!validityEndDate) return { values: {}, fieldsToDelete: [] };

    return {
      values: {
        validityRequired: true,
        validityStartDate,
        validityEndDate,
        validitySource: "participant_completion",
        renewalModeSnapshot: "periodic",
        renewalPeriodMonthsSnapshot: sessionPolicy.renewalPeriodMonths,
        ...(isPositiveInteger(sessionPolicy.validityWarningDays)
          ? { validityWarningDaysSnapshot: sessionPolicy.validityWarningDays }
          : {}),
      },
      fieldsToDelete: isPositiveInteger(sessionPolicy.validityWarningDays) ? [] : ["validityWarningDaysSnapshot"],
    };
  }

  if (renewalMode === "event_triggered" && renewalRequired === true) {
    return {
      values: {
        validityRequired: true,
        validityStartDate,
        validitySource: "participant_completion",
        renewalModeSnapshot: "event_triggered",
        ...(isPositiveInteger(sessionPolicy.validityWarningDays)
          ? { validityWarningDaysSnapshot: sessionPolicy.validityWarningDays }
          : {}),
      },
      fieldsToDelete: [
        "validityEndDate",
        "renewalPeriodMonthsSnapshot",
        ...(isPositiveInteger(sessionPolicy.validityWarningDays) ? [] : ["validityWarningDaysSnapshot" as const]),
      ],
    };
  }

  return { values: {}, fieldsToDelete: [] };
}

export function deriveTrainingParticipantValidityState(
  participant: Pick<
    TrainingParticipant,
    | "participantStatus"
    | "resultStatus"
    | "validityRequired"
    | "validityStartDate"
    | "validityEndDate"
    | "renewalModeSnapshot"
    | "validityWarningDaysSnapshot"
  > & { renewedBySessionId?: string | null },
  sessionPolicy?: Pick<TrainingSession, "renewalMode" | "renewalRequired"> | null,
  today: string = getTodayDateOnly()
): TrainingValidityState {
  if (participant.renewedBySessionId) return "renewed";

  const hasParticipantValiditySnapshot =
    participant.validityRequired != null
    || !!participant.validityStartDate
    || !!participant.validityEndDate
    || !!participant.renewalModeSnapshot;

  if (hasParticipantValiditySnapshot && (participant.renewalModeSnapshot === "none" || participant.validityRequired === false)) {
    return "non_applicable";
  }

  if (!isParticipantValidityEligible(participant.participantStatus, participant.resultStatus)) {
    if (isParticipantResultPending(participant.participantStatus, participant.resultStatus)) {
      if (sessionPolicy?.renewalMode === "none" || sessionPolicy?.renewalRequired === false) return "non_applicable";
      if (!sessionPolicy?.renewalMode && sessionPolicy?.renewalRequired == null) return "policy_missing";
      return "pending_result";
    }

    if (isParticipantAwaitingFinalValidation(participant.participantStatus, participant.resultStatus)) {
      return "awaiting_final_validation";
    }

    if (isParticipantOutcomeNotAcquired(participant.participantStatus, participant.resultStatus)) {
      return "not_acquired";
    }

    if (!hasParticipantValiditySnapshot) {
      return sessionPolicy?.renewalMode === "none" || sessionPolicy?.renewalRequired === false
        ? "non_applicable"
        : sessionPolicy?.renewalMode
          ? "not_acquired"
          : "policy_missing";
    }
    return "not_recorded";
  }

  if (!participant.validityRequired || !participant.validityStartDate) {
    return "not_recorded";
  }

  if (!participant.validityEndDate) {
    return participant.renewalModeSnapshot === "event_triggered" ? "valid" : "not_recorded";
  }

  if (today > participant.validityEndDate) {
    return "expired";
  }

  const warningDays = isPositiveInteger(participant.validityWarningDaysSnapshot)
    ? participant.validityWarningDaysSnapshot
    : TRAINING_VALIDITY_WARNING_FALLBACK_DAYS;
  const warningStart = addDaysToDateOnly(participant.validityEndDate, -warningDays);

  if (warningStart && today >= warningStart) {
    return "renewal_due";
  }

  return "valid";
}

export function formatTrainingValidityStateLabel(state: TrainingValidityState) {
  return TRAINING_VALIDITY_STATE_LABELS[state];
}

export function formatTrainingValidityExpiryLabel(params: {
  participant: Pick<TrainingParticipant, "validityEndDate" | "validityRequired" | "renewalModeSnapshot">;
  state: TrainingValidityState;
  sessionPolicy?: Pick<TrainingSession, "renewalMode" | "renewalPeriodMonths"> | null;
  formatDate: (dateOnly: string) => string;
}) {
  const { participant, state, sessionPolicy, formatDate } = params;

  if (participant.validityEndDate) return formatDate(participant.validityEndDate);
  if (state === "valid" && participant.validityRequired && participant.renewalModeSnapshot === "event_triggered") return "Sans échéance";
  if (state === "pending_result" && sessionPolicy?.renewalMode === "periodic" && isPositiveInteger(sessionPolicy.renewalPeriodMonths)) {
    return `${sessionPolicy.renewalPeriodMonths} mois après réussite`;
  }
  if (state === "pending_result" && sessionPolicy?.renewalMode === "event_triggered") {
    return "Après déclenchement";
  }
  return "—";
}

function isParticipantResultPending(
  participantStatus: TrainingParticipantStatus,
  resultStatus?: TrainingResultStatus | null
) {
  return participantStatus === "planned" && !resultStatus;
}

function isParticipantAwaitingFinalValidation(
  participantStatus: TrainingParticipantStatus,
  resultStatus?: TrainingResultStatus | null
) {
  return (participantStatus === "attended" || participantStatus === "completed") && resultStatus === "attended";
}

function isParticipantOutcomeNotAcquired(
  participantStatus: TrainingParticipantStatus,
  resultStatus?: TrainingResultStatus | null
) {
  if (participantStatus === "cancelled") return true;
  if (participantStatus === "absent" && resultStatus === "not_attended") return true;
  if (participantStatus === "completed" && resultStatus === "failed") return true;
  if (participantStatus === "not_completed") return true;
  if (resultStatus === "failed" || resultStatus === "not_attended" || resultStatus === "not_required") return true;
  return false;
}

function dateToDateOnly(value: Date) {
  if (Number.isNaN(value.getTime())) return null;
  return formatDateOnlyParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function parseDateOnlyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatDateOnlyParts(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function getTodayDateOnly() {
  const today = new Date();
  return formatDateOnlyParts(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function addDaysToDateOnly(dateOnly: string, days: number) {
  const parsed = parseDateOnlyParts(dateOnly);
  if (!parsed || !Number.isInteger(days)) return null;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnlyParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}
