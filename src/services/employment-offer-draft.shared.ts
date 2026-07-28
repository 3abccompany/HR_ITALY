import type { Candidate } from "@/types/candidate";
import type { EmploymentOffer, EmploymentOfferAcceptanceMode, EmploymentOfferStatus } from "@/types/employment-offer";
import type { JobProfile } from "@/types/job-profile";
import type { RecruitmentNeed } from "@/types/recruitment-need";

type TimestampValue = EmploymentOffer["createdAt"];

export type EmploymentOfferDraftOverrides = Partial<
  Pick<
    EmploymentOffer,
    | "entityName"
    | "jobProfileId"
    | "jobTitleName"
    | "departmentId"
    | "departmentName"
    | "worksiteId"
    | "worksiteName"
    | "contractType"
    | "proposedStartDate"
    | "proposedEndDate"
    | "weeklyHours"
    | "workingTime"
    | "trialPeriodDays"
    | "workingScheduleNotes"
    | "workplaceNotes"
    | "ccnlId"
    | "ccnlName"
    | "cnelCode"
    | "levelId"
    | "levelCode"
    | "levelLabel"
    | "qualificationLabel"
    | "monthlyPayments"
    | "hourlyDivisor"
    | "minGrossMonthly"
    | "minGrossHourly"
    | "proposedGrossMonthly"
    | "proposedGrossHourly"
    | "proposedGrossAnnual"
    | "salaryNotes"
    | "payCalculationMode"
    | "notes"
    | "directHireReason"
  >
> & {
  status?: EmploymentOfferStatus;
  acceptanceMode?: EmploymentOfferAcceptanceMode;
  acceptedBy?: string;
  respondedAt?: TimestampValue;
};

export function buildEmploymentOfferDraftPayload(params: {
  offerId: string;
  entityId: string;
  candidate: Candidate;
  need?: RecruitmentNeed | null;
  profile?: JobProfile | null;
  actorUid: string;
  now: TimestampValue;
  revisionNumber: number;
  previousOfferId?: string | null;
  revisionReason?: string | null;
  overrides?: EmploymentOfferDraftOverrides;
}): EmploymentOffer {
  const {
    offerId,
    entityId,
    candidate,
    need,
    profile,
    actorUid,
    now,
    revisionNumber,
    previousOfferId = null,
    revisionReason = null,
    overrides = {},
  } = params;

  const recruitmentNeedId = need?.needId || (candidate as any).recruitmentNeedId || "";
  const recruitmentNeedTitle =
    need?.recruitmentNeedTitle ||
    (need?.jobTitleName
      ? `${need.jobTitleName}${need.departmentName ? ` — ${need.departmentName}` : ""}`
      : "Besoin sans titre");

  const worksiteId = overrides.worksiteId ?? need?.worksiteId ?? "";
  const worksiteName =
    overrides.worksiteName ??
    need?.worksiteName ??
    need?.worksiteNameSnapshot ??
    need?.siteName ??
    need?.location ??
    "Non renseigné";

  const monthlyPayments = overrides.monthlyPayments ?? profile?.defaultMonthlyPayments ?? 13;
  const grossMonthly = overrides.proposedGrossMonthly ?? profile?.defaultMinimumGrossMonthly ?? 0;
  const grossAnnual =
    overrides.proposedGrossAnnual ??
    (grossMonthly > 0 ? Math.round(grossMonthly * monthlyPayments * 100) / 100 : undefined);

  return {
    offerId,
    entityId,
    entityName: overrides.entityName ?? need?.entityName ?? "Non renseigné",
    personId: candidate.personId,
    candidateId: candidate.candidateId,
    recruitmentNeedId: recruitmentNeedId || undefined,
    recruitmentNeedTitle: recruitmentNeedTitle || undefined,
    jobProfileId: overrides.jobProfileId ?? profile?.jobProfileId ?? (candidate as any).jobProfileId ?? need?.jobProfileId ?? "",
    applicationSubmissionId: candidate.applicationSubmissionId,

    candidateDisplayName: candidate.displayName,
    candidateEmail: candidate.email,
    candidatePhone: candidate.phone,

    jobTitleName: overrides.jobTitleName ?? need?.jobTitleName ?? profile?.jobTitleName ?? candidate.positionApplied ?? "",
    departmentId: overrides.departmentId ?? need?.departmentId ?? profile?.departmentId ?? candidate.departmentId ?? candidate.department ?? "",
    departmentName: overrides.departmentName ?? need?.departmentName ?? profile?.departmentName ?? candidate.department ?? "",
    worksiteId,
    worksiteName,

    contractType: overrides.contractType ?? profile?.defaultContractType ?? "Tempo indeterminato",
    proposedStartDate: overrides.proposedStartDate ?? need?.desiredAvailabilityDate ?? new Date().toISOString().split("T")[0],
    proposedEndDate: overrides.proposedEndDate,
    weeklyHours: overrides.weeklyHours ?? profile?.defaultWeeklyHours ?? 40,
    workingTime: overrides.workingTime ?? "Tempo pieno (Full-time)",
    trialPeriodDays: overrides.trialPeriodDays ?? 30,
    workingScheduleNotes: overrides.workingScheduleNotes,
    workplaceNotes: overrides.workplaceNotes,

    ccnlId: overrides.ccnlId ?? profile?.defaultCcnlId ?? "",
    ccnlName: overrides.ccnlName ?? profile?.defaultCcnlName ?? "",
    cnelCode: overrides.cnelCode,
    levelId: overrides.levelId ?? profile?.defaultLevelId ?? "",
    levelCode: overrides.levelCode ?? profile?.defaultLevelCode ?? "",
    levelLabel: overrides.levelLabel ?? profile?.defaultLevelLabel ?? "",
    qualificationLabel: overrides.qualificationLabel,
    monthlyPayments,
    hourlyDivisor: overrides.hourlyDivisor,
    minGrossMonthly: overrides.minGrossMonthly ?? profile?.defaultMinimumGrossMonthly ?? 0,
    minGrossHourly: overrides.minGrossHourly ?? profile?.defaultMinimumGrossHourly ?? 0,

    proposedGrossMonthly: grossMonthly,
    proposedGrossHourly: overrides.proposedGrossHourly ?? profile?.defaultMinimumGrossHourly ?? 0,
    proposedGrossAnnual: grossAnnual,
    salaryNotes: overrides.salaryNotes,
    payCalculationMode: overrides.payCalculationMode,

    status: overrides.status ?? "draft",
    notes: overrides.notes,
    conversionStatus: "pending",
    acceptanceMode: overrides.acceptanceMode,
    acceptedBy: overrides.acceptedBy,
    directHireReason: overrides.directHireReason,
    respondedAt: overrides.respondedAt,
    revisionNumber,
    previousOfferId,
    revisionReason,

    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
}
