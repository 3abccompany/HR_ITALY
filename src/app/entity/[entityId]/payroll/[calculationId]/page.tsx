"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  collection,
  doc,
  query,
  where,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Landmark,
  ShieldCheck,
  Utensils,
  User,
} from "lucide-react";

import { useCollection, useDoc, useFirebase } from "@/firebase";
import { useActiveMembership } from "@/hooks/use-active-membership";
import type {
  PayrollCalculation,
  PayrollPayCalculationMode,
  PayrollReconciliationWarning,
  PayrollWeeklyBreakdown,
} from "@/types/payroll";
import type { Employee } from "@/types/employee";
import type { Contract } from "@/types/contract";
import type { CCNL, CCNLLevel } from "@/types/ccnl";
import type { Holiday } from "@/types/holiday";
import type { AttendanceRecord } from "@/types/attendance";
import type { MealTicketMonthlySummary } from "@/types/meal-ticket";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon / Incomplet",
  calculated: "Calculé",
  approved: "Approuvé",
  exported: "Exporté",
  locked: "Verrouillé",
  cancelled: "Annulé",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  calculated: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  exported: "bg-indigo-50 text-indigo-700 border-indigo-200",
  locked: "bg-slate-900 text-white border-slate-900",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

const SOURCE_LABELS: Record<string, string> = {
  payroll_parameter: "Paramètre salarié",
  ccnl_level: "Livello CCNL",
  ccnl_root: "CCNL racine",
  contract: "Contrat",
  manual: "Saisie manuelle",
  missing: "Source manquante",
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  pending_signature: "En attente de signature",
  pending_activation: "En attente d’activation",
  active: "Actif",
  suspended: "Suspendu",
  terminated: "Terminé",
  archived: "Archivé",
  renewed: "Renouvelé",
  expired: "Expiré",
};

const WARNING_LABELS: Record<string, string> = {
  missing_schedule: "Horaire contractuel manquant",
  missing_hours: "Heures manquantes",
  over_expected_hours: "Dépassement des heures prévues",
  non_working_day_work: "Travail un jour non planifié",
  holiday_work: "Travail un jour férié",
  legacy_attendance_split_missing: "Répartition des heures indisponible",
  missing_payroll_rate: "Taux de rémunération manquant",
  missing_monthly_gross: "Brut mensuel manquant",
  missing_premium_rule: "Règle de majoration manquante",
  raw_overtime_not_weekly_reconciled: "Heures supplémentaires à rapprocher",
  missing_time_segments_for_overtime_classification: "Plages horaires indisponibles",
  missing_weekly_schedule: "Seuil hebdomadaire manquant",
  missing_night_window: "Plage de nuit manquante",
  missing_overtime_night_premium: "Majoration de nuit manquante",
  overtime_classification_limited: "Classement des heures supplémentaire limité",
  calculation_failed: "Calcul incomplet",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  classified: "Classé",
  limited: "Partiel",
  not_classified: "Non classé",
};

const MODE_LABELS: Record<PayrollPayCalculationMode, string> = {
  monthly: "Mensualisé",
  hourly: "Horaire historique",
  actual_worked_hours: "Heures réellement travaillées",
};

const MODE_BADGE_STYLES: Record<PayrollPayCalculationMode, string> = {
  monthly: "bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-50",
  hourly: "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100",
  actual_worked_hours: "bg-teal-50 text-teal-700 border-teal-100 hover:bg-teal-50",
};

const BASE_LABELS: Record<PayrollPayCalculationMode, string> = {
  monthly: "Base mensuelle",
  hourly: "Base horaire",
  actual_worked_hours: "Base heures travaillées",
};

const MODE_HELP_TEXT: Record<PayrollPayCalculationMode, string> = {
  monthly:
    "Le salarié est calculé sur une base mensuelle contractuelle. Les heures servent à calculer les variables, majorations et retenues.",
  hourly:
    "Ce calcul provient du mode horaire historique. Les valeurs enregistrées restent affichées telles quelles pour compatibilité.",
  actual_worked_hours:
    "Le salarié est calculé à partir des heures réellement validées. Les majorations sont ajoutées séparément afin d’éviter le double comptage.",
};

const euro = (value?: number | null) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value ?? 0);

const optionalEuro = (value?: number | null) =>
  value == null ? "Non renseigné" : euro(value);

const hours = (value?: number | null) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value ?? 0)} h`;

const optionalHours = (value?: number | null) =>
  value == null ? "Non renseigné" : hours(value);

const persistedAuditActorLabel = (calculation: PayrollCalculation, field: string) => {
  const raw = calculation as unknown as Record<string, unknown>;
  const readableValue =
    raw[`${field}DisplayName`] ||
    raw[`${field}Name`] ||
    raw[`${field}Email`] ||
    raw[`${field}UserEmail`];

  return typeof readableValue === "string" && readableValue.trim().length > 0
    ? readableValue
    : "Non renseigné";
};

const formatIsoDate = (value?: string | null) => {
  if (!value) return "Non renseigné";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "Non renseigné";
};

const getMealTicketMonthlySummaryId = (employeeId: string, year: number, month: number) =>
  `${employeeId}_${year}_${String(month).padStart(2, "0")}`;

function formatStoredDate(value: unknown): string {
  if (!value) return "Non renseigné";

  const date =
    value instanceof Date
      ? value
      : typeof (value as { toDate?: unknown })?.toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : new Date(value as string | number);

  if (Number.isNaN(date.getTime())) return "Non renseigné";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function SnapshotValue({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-primary/10 bg-slate-50/70 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 break-words text-sm font-bold text-slate-800">{value}</div>
    </div>
  );
}

function WarningCard({ warning }: { warning: PayrollReconciliationWarning }) {
  const blocking = warning.severity === "blocking";
  const informational = warning.severity === "info";

  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border p-4",
        blocking
          ? "border-red-200 bg-red-50"
          : informational
            ? "border-blue-200 bg-blue-50"
            : "border-orange-200 bg-orange-50"
      )}
    >
      {blocking ? (
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      ) : informational ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
      )}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {WARNING_LABELS[warning.code] || "Alerte de cohérence"}
          {warning.date ? ` • ${warning.date}` : ""}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-800">{warning.message}</p>
      </div>
    </div>
  );
}

export default function PayrollCalculationDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const calculationId = params.calculationId as string;
  const { db } = useFirebase();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);
  const canRead = hasPermission("payroll.read");
  const canReadMealTickets = hasPermission("mealTickets.read") || hasPermission("mealTickets.manage");

  const calculationRef = useMemo(
    () =>
      db && entityId && calculationId && canRead
        ? (doc(
            db,
            `entities/${entityId}/payrollCalculations`,
            calculationId
          ) as DocumentReference<PayrollCalculation>)
        : null,
    [db, entityId, calculationId, canRead]
  );

  const {
    data: calculation,
    loading: calculationLoading,
    error,
  } = useDoc<PayrollCalculation>(calculationRef, "payroll.calculation-detail");

  const employeeRef = useMemo(
    () =>
      db && entityId && calculation?.employeeId && canRead
        ? (doc(
            db,
            `entities/${entityId}/employees`,
            calculation.employeeId
          ) as DocumentReference<Employee>)
        : null,
    [db, entityId, calculation?.employeeId, canRead]
  );
  const { data: employee } = useDoc<Employee>(employeeRef, "payroll.calculation-employee");

  const contractRef = useMemo(
    () =>
      db && entityId && calculation?.rateSnapshot?.contractId && canRead
        ? (doc(
            db,
            `entities/${entityId}/contracts`,
            calculation.rateSnapshot.contractId
          ) as DocumentReference<Contract>)
        : null,
    [db, entityId, calculation?.rateSnapshot?.contractId, canRead]
  );
  const { data: contract } = useDoc<Contract>(contractRef, "payroll.calculation-contract");

  const ccnlRef = useMemo(
    () =>
      db && entityId && calculation?.rateSnapshot?.ccnlId && canRead
        ? (doc(
            db,
            `entities/${entityId}/ccnls`,
            calculation.rateSnapshot.ccnlId
          ) as DocumentReference<CCNL>)
        : null,
    [db, entityId, calculation?.rateSnapshot?.ccnlId, canRead]
  );
  const { data: ccnl } = useDoc<CCNL>(ccnlRef, "payroll.calculation-ccnl");

  const levelRef = useMemo(
    () =>
      db &&
      entityId &&
      calculation?.rateSnapshot?.ccnlId &&
      calculation?.rateSnapshot?.ccnlLevelId &&
      canRead
        ? (doc(
            db,
            `entities/${entityId}/ccnls/${calculation.rateSnapshot.ccnlId}/levels`,
            calculation.rateSnapshot.ccnlLevelId
          ) as DocumentReference<CCNLLevel>)
        : null,
    [
      db,
      entityId,
      calculation?.rateSnapshot?.ccnlId,
      calculation?.rateSnapshot?.ccnlLevelId,
      canRead,
    ]
  );
  const { data: level } = useDoc<CCNLLevel>(levelRef, "payroll.calculation-level");

  const period = useMemo(() => {
    if (!calculation) return null;
    const month = String(calculation.month).padStart(2, "0");
    const lastDay = String(new Date(calculation.year, calculation.month, 0).getDate()).padStart(
      2,
      "0"
    );
    return {
      start: `${calculation.year}-${month}-01`,
      end: `${calculation.year}-${month}-${lastDay}`,
    };
  }, [calculation]);

  const holidaysQuery = useMemo(
    () =>
      db && entityId && period && canRead
        ? (query(
            collection(db, `entities/${entityId}/holidays`),
            where("date", ">=", period.start),
            where("date", "<=", period.end)
          ) as Query<Holiday>)
        : null,
    [db, entityId, period, canRead]
  );
  const { data: monthlyHolidays } = useCollection<Holiday>(
    holidaysQuery,
    "payroll.calculation-holidays"
  );

  const attendanceQuery = useMemo(
    () =>
      db && entityId && calculation?.employeeId && period && canRead
        ? (query(
            collection(db, `entities/${entityId}/attendances`),
            where("employeeId", "==", calculation.employeeId),
            where("attendanceDate", ">=", period.start),
            where("attendanceDate", "<=", period.end)
          ) as Query<AttendanceRecord>)
        : null,
    [db, entityId, calculation?.employeeId, period, canRead]
  );
  const { data: monthlyAttendance } = useCollection<AttendanceRecord>(
    attendanceQuery,
    "payroll.calculation-attendance"
  );

  const mealTicketSummaryRef = useMemo(
    () =>
      db && entityId && calculation?.employeeId && canReadMealTickets
        ? (doc(
            db,
            `entities/${entityId}/mealTicketMonthlySummaries`,
            getMealTicketMonthlySummaryId(
              calculation.employeeId,
              calculation.year,
              calculation.month
            )
          ) as DocumentReference<MealTicketMonthlySummary>)
        : null,
    [
      db,
      entityId,
      calculation?.employeeId,
      calculation?.year,
      calculation?.month,
      canReadMealTickets,
    ]
  );
  const { data: mealTicketSummary } = useDoc<MealTicketMonthlySummary>(
    mealTicketSummaryRef,
    "payroll.meal-ticket-summary"
  );

  if (membershipLoading || calculationLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-bold text-muted-foreground">
          <Clock3 className="h-5 w-5 animate-pulse" />
          Chargement de la synthèse enregistrée…
        </div>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="rounded-3xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>
            Vous n’avez pas la permission de consulter cette synthèse économique.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error || !calculation) {
    return (
      <div className="space-y-6 p-8">
        <Button asChild variant="ghost" className="gap-2">
          <Link href={`/entity/${entityId}/payroll`}>
            <ArrowLeft className="h-4 w-4" />
            Retour à la synthèse économique
          </Link>
        </Button>
        <Alert variant="destructive" className="rounded-3xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Synthèse introuvable</AlertTitle>
          <AlertDescription>
            Le calcul demandé n’existe pas ou n’est pas accessible dans cette entité.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const aggregation = calculation.attendanceAggregation;
  const rate = calculation.rateSnapshot;
  const mode: PayrollPayCalculationMode = rate.payCalculationMode || "monthly";
  const isActualWorkedHours = mode === "actual_worked_hours";
  const isMonthly = mode === "monthly";
  const warnings: PayrollReconciliationWarning[] = Array.isArray(
    calculation.reconciliationWarnings
  )
    ? calculation.reconciliationWarnings.filter(
        (warning): warning is PayrollReconciliationWarning =>
          warning !== null && typeof warning === "object"
      )
    : [];
  const persistedWeeklyBreakdown = Array.isArray(calculation.weeklyBreakdown)
    ? calculation.weeklyBreakdown
    : Array.isArray(aggregation.weeklyBreakdown)
      ? aggregation.weeklyBreakdown
      : [];
  const weeklyBreakdown: PayrollWeeklyBreakdown[] = persistedWeeklyBreakdown.filter(
    (week): week is PayrollWeeklyBreakdown => week !== null && typeof week === "object"
  );
  const extras =
    (calculation.mileageValue ?? 0) +
    (calculation.bonusValue ?? 0);
  const activeHolidays = monthlyHolidays.filter((holiday) => holiday.status === "active");
  const holidaysByDate = new Map(activeHolidays.map((holiday) => [holiday.date, holiday]));
  const reliableAttendanceStatuses = new Set(["validated", "corrected", "locked"]);
  const inferredHolidayRows = monthlyAttendance
    .filter((attendance) => {
      const isHoliday =
        attendance.holidayFlag === true || holidaysByDate.has(attendance.attendanceDate);
      const workedHours = attendance.holidayWorkedHours ?? attendance.validatedHours ?? 0;
      return (
        reliableAttendanceStatuses.has(attendance.status) &&
        isHoliday &&
        workedHours > 0
      );
    })
    .map((attendance) => {
      const holiday = holidaysByDate.get(attendance.attendanceDate);
      return {
        date: attendance.attendanceDate,
        name: attendance.holidayName || holiday?.name || "Jour férié",
        workedHours: attendance.holidayWorkedHours ?? attendance.validatedHours ?? 0,
      };
    });
  const holidayRows =
    inferredHolidayRows.length > 0
      ? inferredHolidayRows
      : aggregation.holidayWorkedHours > 0 && activeHolidays.length === 1
        ? [
            {
              date: activeHolidays[0].date,
              name: activeHolidays[0].name,
              workedHours: aggregation.holidayWorkedHours,
            },
          ]
        : [];
  const contractSummary = contract
    ? [
        contract.contractType,
        CONTRACT_STATUS_LABELS[contract.status] || contract.status,
        contract.startDate ? `depuis le ${formatIsoDate(contract.startDate)}` : null,
      ]
        .filter(Boolean)
        .join(" • ")
    : "Non renseigné";
  const ccnlLabel = ccnl?.name || contract?.ccnlName || "Non renseigné";
  const livelloLabel =
    [level?.levelCode || contract?.levelCode || rate.levelCode, level?.label || contract?.levelLabel]
      .filter(Boolean)
      .join(" — ") || "Non renseigné";

  return (
    <div className="mx-auto max-w-[1500px] space-y-8 p-8 pb-24">
      <header className="space-y-5">
        <Button asChild variant="ghost" className="-ml-3 gap-2">
          <Link href={`/entity/${entityId}/payroll`}>
            <ArrowLeft className="h-4 w-4" />
            Retour à la synthèse économique
          </Link>
        </Button>

        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary p-3 text-white shadow-xl shadow-primary/20">
              <Banknote className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                Synthèse économique / Pré-paie brute
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-primary">
                {employee
                  ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
                    employee.displayName
                  : contract?.employeeDisplayName || "Collaborateur non renseigné"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(employee?.employeeCode || contract?.employeeCode) && (
                  <Badge variant="outline" className="rounded-lg">
                    Matricule {employee?.employeeCode || contract?.employeeCode}
                  </Badge>
                )}
                {(employee?.taxCode || contract?.taxCode) && (
                  <Badge variant="outline" className="rounded-lg">
                    Codice fiscale {employee?.taxCode || contract?.taxCode}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1.5 rounded-lg">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {String(calculation.month).padStart(2, "0")}/{calculation.year}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("rounded-lg", STATUS_STYLES[calculation.status])}
                >
                  {STATUS_LABELS[calculation.status] || calculation.status}
                </Badge>
                <Badge variant="outline" className="rounded-lg">
                  {warnings.length} alerte{warnings.length === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>
          </div>

          <Card className="min-w-[280px] rounded-3xl border-none bg-primary text-white shadow-xl shadow-primary/15">
            <CardContent className="p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
                Total brut économique enregistré
              </p>
              <p className="mt-2 text-3xl font-black">{euro(calculation.grossEconomicTotal)}</p>
              <p className="mt-2 text-xs text-white/60">
                Valeur de pré-paie persistée, sans recalcul sur cette page.
              </p>
            </CardContent>
          </Card>
        </div>
      </header>

      <Alert className="rounded-3xl border-blue-200 bg-blue-50">
        <ShieldCheck className="h-4 w-4 text-blue-700" />
        <AlertTitle className="text-blue-900">Consultation en lecture seule</AlertTitle>
        <AlertDescription className="text-blue-800">
          Cette page affiche exclusivement les données enregistrées avec le calcul. Il ne
          s’agit pas d’une fiche de paie officielle et aucun calcul n’est relancé.
        </AlertDescription>
      </Alert>

      <Alert className="rounded-3xl border-primary/10 bg-white shadow-sm">
        <Banknote className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">Mode de calcul : {MODE_LABELS[mode]}</AlertTitle>
        <AlertDescription className="text-slate-700">
          {MODE_HELP_TEXT[mode]}
        </AlertDescription>
      </Alert>

      <Card className="rounded-3xl border-primary/10 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <FileText className="h-5 w-5" />
            Contrat / CCNL / Livello — instantané enregistré
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SnapshotValue label="Source du taux" value={SOURCE_LABELS[rate.source] || "Non renseigné"} />
          <SnapshotValue
            label="Mode de calcul"
            value={
              <Badge variant="outline" className={cn("rounded-lg border px-2 py-0.5 font-black", MODE_BADGE_STYLES[mode])}>
                {MODE_LABELS[mode]}
              </Badge>
            }
          />
          <SnapshotValue label="Taux horaire ordinaire" value={euro(rate.ordinaryHourlyRate)} />
          <SnapshotValue label="Brut mensuel" value={rate.grossMonthly == null ? "Non renseigné" : euro(rate.grossMonthly)} />
          <SnapshotValue label="Contrat" value={contractSummary} />
          <SnapshotValue label="CCNL" value={ccnlLabel} />
          <SnapshotValue label="Livello" value={livelloLabel} />
          <SnapshotValue
            label="Paramètre salarié"
            value={rate.payrollParameterId ? "Dérogation individuelle appliquée" : "Aucune dérogation"}
          />
          <SnapshotValue label="Seuil hebdomadaire" value={rate.expectedWeeklyHours == null ? "Non renseigné" : hours(rate.expectedWeeklyHours)} />
          <SnapshotValue label="Majoration nuit" value={rate.nightPremiumPercent == null ? "Non renseignée" : `${rate.nightPremiumPercent} %`} />
          <SnapshotValue label="Majoration supplémentaire" value={rate.overtimePremiumPercent == null ? "Non renseignée" : `${rate.overtimePremiumPercent} %`} />
          <SnapshotValue label="Majoration sup. nuit" value={rate.overtimeNightPremiumPercent == null ? "Non renseignée" : `${rate.overtimeNightPremiumPercent} %`} />
          <SnapshotValue label="Majoration dimanche" value={rate.sundayPremiumPercent == null ? "Non renseignée" : `${rate.sundayPremiumPercent} %`} />
          <SnapshotValue label="Majoration jour férié" value={rate.holidayPremiumPercent == null ? "Non renseignée" : `${rate.holidayPremiumPercent} %`} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-emerald-200 bg-emerald-50/40 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-white/70">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-black text-emerald-900">
                <Landmark className="h-5 w-5" />
                Jour férié travaillé
              </CardTitle>
              <p className="mt-1 text-sm text-emerald-800/70">
                Lecture des présences et du registre des jours fériés du mois.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-900 px-5 py-3 text-white">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60">
                Montant enregistré
              </p>
              <p className="text-xl font-black">{euro(calculation.holidayWorkedValue)}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {holidayRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/70 p-6">
              <p className="font-bold text-emerald-950">
                Aucun détail nominatif de jour férié disponible.
              </p>
              <p className="mt-1 text-sm text-emerald-800/70">
                Le calcul enregistré conserve {hours(aggregation.holidayWorkedHours)} de
                travail férié pour un montant de {euro(calculation.holidayWorkedValue)}.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {holidayRows.map((holiday, index) => (
                <div
                  key={`${holiday.date}-${index}`}
                  className="grid gap-4 rounded-2xl border border-emerald-100 bg-white p-5 sm:grid-cols-2 lg:grid-cols-5"
                >
                  <SnapshotValue label="Jour férié" value={holiday.name} />
                  <SnapshotValue label="Date" value={formatIsoDate(holiday.date)} />
                  <SnapshotValue label="Heures travaillées" value={hours(holiday.workedHours)} />
                  <SnapshotValue label="Taux horaire" value={euro(rate.ordinaryHourlyRate)} />
                  <SnapshotValue
                    label="Majoration férié"
                    value={
                      rate.holidayPremiumPercent == null
                        ? "Non renseignée"
                        : `${rate.holidayPremiumPercent} %`
                    }
                  />
                </div>
              ))}
              {holidayRows.length > 1 && (
                <p className="text-xs text-emerald-800/70">
                  Le montant affiché est le total enregistré pour l’ensemble des jours fériés
                  travaillés. Il n’est pas réparti à nouveau par date.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-primary/10 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <Clock3 className="h-5 w-5" />
            Synthèse des présences enregistrées
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SnapshotValue label="Heures validées" value={hours(aggregation.totalValidatedHours)} />
          <SnapshotValue label="Heures ordinaires jour" value={hours(aggregation.ordinaryDayHours)} />
          <SnapshotValue label="Heures ordinaires nuit" value={hours(aggregation.ordinaryNightHours)} />
          <SnapshotValue label="Heures supplémentaires" value={hours(aggregation.overtimeHours)} />
          <SnapshotValue label="Heures jours fériés" value={hours(aggregation.holidayWorkedHours)} />
          <SnapshotValue label="Jours travaillés" value={aggregation.workedDays} />
          <SnapshotValue label="Sup. jour" value={hours(aggregation.overtimeDayHours)} />
          <SnapshotValue label="Sup. nuit" value={hours(aggregation.overtimeNightHours)} />
          <SnapshotValue label="Sup. dimanche" value={hours(aggregation.overtimeSundayHours)} />
          <SnapshotValue label="Sup. férié" value={hours(aggregation.overtimeHolidayHours)} />
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-primary/10 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <Banknote className="h-5 w-5" />
            Décomposition financière enregistrée
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SnapshotValue label={BASE_LABELS[mode]} value={euro(calculation.baseGrossValue)} />
            {isActualWorkedHours && (
              <>
                <SnapshotValue label="Base heures validées" value={optionalEuro(calculation.baseWorkedValue)} />
                <SnapshotValue label="Heures validées" value={hours(aggregation.totalValidatedHours)} />
                <SnapshotValue label="Taux horaire" value={euro(rate.ordinaryHourlyRate)} />
                <SnapshotValue label="Heures fériées rémunérées" value={optionalHours(calculation.paidHolidayHours)} />
                <SnapshotValue label="Jours fériés rémunérés" value={optionalEuro(calculation.paidHolidayValue)} />
              </>
            )}
            <SnapshotValue label="Majoration nuit" value={euro(calculation.nightValue)} />
            <SnapshotValue label="Heures supplémentaires" value={euro(calculation.overtimeValue)} />
            <SnapshotValue
              label={isActualWorkedHours ? "Majoration férié travaillé" : "Jour férié travaillé"}
              value={euro(calculation.holidayWorkedValue)}
            />
            <SnapshotValue label="Retenues" value={euro(calculation.deductionValue)} />
            <SnapshotValue label="Total extras" value={euro(extras)} />
          </div>
          <Separator />
          <div className="flex items-center justify-between rounded-2xl bg-primary p-5 text-white">
            <span className="text-sm font-black uppercase tracking-widest">
              Total brut économique
            </span>
            <span className="text-2xl font-black">{euro(calculation.grossEconomicTotal)}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-emerald-200 bg-emerald-50/30 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-white/70">
          <CardTitle className="flex items-center gap-2 text-xl font-black text-emerald-900">
            <Utensils className="h-5 w-5" />
            Avantages / Remboursements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SnapshotValue
              label="Buoni pasto"
              value={
                mealTicketSummary?.status === "confirmed"
                  ? euro(mealTicketSummary.totalValue)
                  : "Non intégré à cette synthèse"
              }
            />
            <SnapshotValue
              label="Jours éligibles"
              value={
                mealTicketSummary?.status === "confirmed"
                  ? mealTicketSummary.eligibleDays
                  : "Non intégré à cette synthèse"
              }
            />
            <SnapshotValue
              label="Valeur par ticket"
              value={
                mealTicketSummary?.status === "confirmed"
                  ? euro(mealTicketSummary.valuePerTicket)
                  : "Non intégré à cette synthèse"
              }
            />
            <SnapshotValue
              label="Statut buoni pasto"
              value={
                mealTicketSummary?.status === "confirmed" ? (
                  <Badge className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Confirmé
                  </Badge>
                ) : (
                  "Non confirmé"
                )
              }
            />
            <SnapshotValue
              label="Confirmation"
              value={
                mealTicketSummary?.status === "confirmed"
                  ? formatStoredDate(mealTicketSummary.generatedAt)
                  : "Confirmez le mois depuis le module Buoni pasto pour l’afficher ici."
              }
            />
          </div>
          <Alert className="rounded-2xl border-emerald-200 bg-white text-emerald-900">
            <Info className="h-4 w-4 text-emerald-700" />
            <AlertTitle>Avantage économique séparé</AlertTitle>
            <AlertDescription>
              Les buoni pasto sont affichés comme avantage économique séparé. Ils ne modifient pas le brut mensuel ni le total brut économique.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-primary/10 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black text-primary">
            Réconciliation hebdomadaire enregistrée
          </CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyBreakdown.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-6 text-sm text-muted-foreground">
              Aucun détail hebdomadaire n’a été enregistré pour cette synthèse.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semaine</TableHead>
                    <TableHead>Période</TableHead>
                    <TableHead className="text-right">Seuil</TableHead>
                    <TableHead className="text-right">Travaillées</TableHead>
                    <TableHead className="text-right">Sup.</TableHead>
                    <TableHead className="text-right">Jour</TableHead>
                    <TableHead className="text-right">Nuit</TableHead>
                    <TableHead className="text-right">Dimanche</TableHead>
                    <TableHead className="text-right">Sup. férié</TableHead>
                    <TableHead>Classement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyBreakdown.map((week) => (
                    <TableRow key={`${week.weekKey}-${week.weekStart}`}>
                      <TableCell className="font-bold">{week.weekKey}</TableCell>
                      <TableCell>{week.weekStart} → {week.weekEnd}</TableCell>
                      <TableCell className="text-right">{week.expectedWeeklyHours == null ? "—" : hours(week.expectedWeeklyHours)}</TableCell>
                      <TableCell className="text-right">{hours(week.workedHoursInWeek)}</TableCell>
                      <TableCell className="text-right">{hours(week.weeklyOvertimeHours)}</TableCell>
                      <TableCell className="text-right">{hours(week.overtimeDayHours)}</TableCell>
                      <TableCell className="text-right">{hours(week.overtimeNightHours)}</TableCell>
                      <TableCell className="text-right">{hours(week.overtimeSundayHours)}</TableCell>
                      <TableCell className="text-right">{hours(week.overtimeHolidayHours)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {CLASSIFICATION_LABELS[week.classificationStatus] || "Non renseigné"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-8 xl:grid-cols-2">
        <Card className="rounded-3xl border-primary/10 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black text-primary">
              Lecture de la formule enregistrée
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            {isActualWorkedHours ? (
              <>
                <p>
                  Base heures travaillées persistée :{" "}
                  <strong>{optionalEuro(calculation.baseWorkedValue)}</strong>
                  {" "}pour <strong>{hours(aggregation.totalValidatedHours)}</strong> à{" "}
                  <strong>{euro(rate.ordinaryHourlyRate)}</strong>.
                </p>
                <p>
                  Jours fériés rémunérés persistés :{" "}
                  <strong>{optionalHours(calculation.paidHolidayHours)}</strong> pour{" "}
                  <strong>{optionalEuro(calculation.paidHolidayValue)}</strong>.
                </p>
                <p>
                  Majorations uniquement : nuit <strong>{euro(calculation.nightValue)}</strong>,
                  heures supplémentaires <strong>{euro(calculation.overtimeValue)}</strong> et
                  férié travaillé <strong>{euro(calculation.holidayWorkedValue)}</strong>.
                </p>
                <p>
                  Extras persistés : <strong>{euro(extras)}</strong>. Retenues persistées :{" "}
                  <strong>{euro(calculation.deductionValue)}</strong>.
                </p>
              </>
            ) : (
              <>
                <p>
                  {isMonthly ? "Base mensuelle" : "Base horaire"} persistée :{" "}
                  <strong>{euro(calculation.baseGrossValue)}</strong>.
                </p>
                <p>
                  Variables persistées : nuit <strong>{euro(calculation.nightValue)}</strong>,
                  heures supplémentaires <strong>{euro(calculation.overtimeValue)}</strong> et
                  jours fériés <strong>{euro(calculation.holidayWorkedValue)}</strong>.
                </p>
                <p>
                  Extras persistés : <strong>{euro(extras)}</strong>. Retenues persistées :{" "}
                  <strong>{euro(calculation.deductionValue)}</strong>.
                </p>
              </>
            )}
            <Separator />
            <p className="font-bold text-primary">
              Total enregistré : {euro(calculation.grossEconomicTotal)}.
            </p>
            <p className="text-xs text-muted-foreground">
              Cette explication décrit les valeurs sauvegardées ; elle ne recalcule ni ne
              valide les montants.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-primary/10 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black text-primary">
              Alertes enregistrées
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {warnings.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-800">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-bold">Aucune alerte enregistrée.</p>
              </div>
            ) : (
              warnings.map((warning, index) => (
                <WarningCard
                  key={`${warning.code}-${warning.date || "global"}-${index}`}
                  warning={warning}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-primary/10 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <User className="h-5 w-5" />
            Métadonnées d’audit enregistrées
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SnapshotValue label="Calculé le" value={formatStoredDate(calculation.calculatedAt)} />
          <SnapshotValue label="Calculé par" value={persistedAuditActorLabel(calculation, "calculatedBy")} />
          <SnapshotValue label="Mis à jour le" value={formatStoredDate(calculation.updatedAt)} />
          <SnapshotValue label="Mis à jour par" value={persistedAuditActorLabel(calculation, "updatedBy")} />
          <SnapshotValue label="Approuvé le" value={formatStoredDate(calculation.approvedAt)} />
          <SnapshotValue label="Approuvé par" value={persistedAuditActorLabel(calculation, "approvedBy")} />
          <SnapshotValue label="Exporté le" value={formatStoredDate(calculation.exportedAt)} />
          <SnapshotValue label="Exporté par" value={persistedAuditActorLabel(calculation, "exportedBy")} />
          <SnapshotValue label="Verrouillé le" value={formatStoredDate(calculation.lockedAt)} />
          <SnapshotValue label="Verrouillé par" value={persistedAuditActorLabel(calculation, "lockedBy")} />
        </CardContent>
      </Card>
    </div>
  );
}
