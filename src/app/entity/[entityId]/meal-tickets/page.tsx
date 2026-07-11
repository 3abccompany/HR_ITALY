"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Eye,
  Gift,
  History,
  Info,
  Loader2,
  Save,
  Ticket,
  Utensils,
  XCircle,
} from "lucide-react";
import { collection, orderBy, query, where, Query } from "firebase/firestore";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useCollection, useFirebase, useUser } from "@/firebase";
import { cn } from "@/lib/utils";
import {
  calculateMealTicketMonthlySummary,
  confirmMealTicketMonthlySummaries,
  getMealTicketMonthRange,
  resolveMealTicketPolicyFromList,
  saveEntityMealTicketPolicy,
} from "@/services/meal-ticket.service";
import { AttendanceRecord } from "@/types/attendance";
import { Employee } from "@/types/employee";
import { Holiday } from "@/types/holiday";
import { MealTicketMonthlySummary, MealTicketPolicy } from "@/types/meal-ticket";
import { TimeOffRequest } from "@/types/time-off";

const formatEuro = (value?: number | null) =>
  `€ ${(value ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: format(new Date(2026, index, 1), "MMMM", { locale: fr }),
}));

const initialPolicyForm = {
  effectiveFrom: `${new Date().getFullYear()}-01-01`,
  effectiveTo: "",
  valuePerTicket: 0,
  minimumWorkedHoursForEligibility: 4,
  includeHolidayWorkedDays: true,
  excludeLeaveDays: true,
  excludeAbsenceDays: true,
  status: "active" as MealTicketPolicy["status"],
};

const reasonLabels: Record<string, string> = {
  absence: "Absence",
  leave: "Congé / absence approuvée",
  holiday_not_worked: "Jour férié non travaillé",
  holiday_worked_not_included: "Jour férié travaillé exclu par la politique",
  non_worked_day: "Journée non éligible",
  invalid_or_draft_attendance: "Présence brouillon ou non valide",
};

export default function MealTicketsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [policyForm, setPolicyForm] = useState(initialPolicyForm);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [confirmingMonth, setConfirmingMonth] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<MealTicketMonthlySummary | null>(null);

  const canRead = hasPermission("mealTickets.read") || hasPermission("mealTickets.manage");
  const canManage = hasPermission("mealTickets.manage");
  const canConfirm = hasPermission("mealTickets.calculate") || hasPermission("mealTickets.manage");
  const { startDate, endDate } = useMemo(
    () => getMealTicketMonthRange(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, index) => current - 2 + index);
  }, []);

  const policiesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/mealTicketPolicies`)) as Query<MealTicketPolicy>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const attendanceQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(
      collection(db, `entities/${entityId}/attendances`),
      where("attendanceDate", ">=", startDate),
      where("attendanceDate", "<=", endDate),
      orderBy("attendanceDate", "asc")
    ) as Query<AttendanceRecord>;
  }, [db, entityId, canRead, startDate, endDate]);

  const timeOffQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/timeOffRequests`), where("status", "==", "approved")) as Query<TimeOffRequest>;
  }, [db, entityId, canRead]);

  const holidaysQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(
      collection(db, `entities/${entityId}/holidays`),
      where("date", ">=", startDate),
      where("date", "<=", endDate),
      orderBy("date", "asc")
    ) as Query<Holiday>;
  }, [db, entityId, canRead, startDate, endDate]);

  const confirmedSummariesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(
      collection(db, `entities/${entityId}/mealTicketMonthlySummaries`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth),
      where("status", "==", "confirmed")
    ) as Query<MealTicketMonthlySummary>;
  }, [db, entityId, canRead, selectedMonth, selectedYear]);

  const { data: policies, loading: loadingPolicies } = useCollection<MealTicketPolicy>(policiesQuery, "meal-tickets.policies");
  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery, "meal-tickets.employees");
  const { data: attendanceRecords, loading: loadingAttendance } = useCollection<AttendanceRecord>(attendanceQuery, "meal-tickets.attendance");
  const { data: timeOffRequests } = useCollection<TimeOffRequest>(timeOffQuery, "meal-tickets.time-off");
  const { data: holidays } = useCollection<Holiday>(holidaysQuery, "meal-tickets.holidays");
  const { data: confirmedSummaries, loading: loadingConfirmedSummaries } = useCollection<MealTicketMonthlySummary>(
    confirmedSummariesQuery,
    "meal-tickets.confirmed-summaries"
  );

  const entityPolicy = useMemo(() => {
    return (policies || [])
      .filter((policy) => policy.scope === "entity")
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""))[0] || null;
  }, [policies]);

  const entityPolicyForSelectedMonth = useMemo(() => {
    return (policies || [])
      .filter((policy) => policy.scope === "entity" && policy.status === "active")
      .filter((policy) => policy.effectiveFrom <= endDate && (!policy.effectiveTo || policy.effectiveTo >= startDate))
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""))[0] || null;
  }, [endDate, policies, startDate]);

  const policyHistory = useMemo(() => {
    return (policies || [])
      .filter((policy) => policy.scope === "entity")
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
  }, [policies]);

  useEffect(() => {
    if (!entityPolicy) return;
    setPolicyForm({
      effectiveFrom: entityPolicy.effectiveFrom || initialPolicyForm.effectiveFrom,
      effectiveTo: entityPolicy.effectiveTo || "",
      valuePerTicket: entityPolicy.valuePerTicket || 0,
      minimumWorkedHoursForEligibility: entityPolicy.minimumWorkedHoursForEligibility || 0,
      includeHolidayWorkedDays: entityPolicy.includeHolidayWorkedDays ?? true,
      excludeLeaveDays: entityPolicy.excludeLeaveDays ?? true,
      excludeAbsenceDays: entityPolicy.excludeAbsenceDays ?? true,
      status: entityPolicy.status || "active",
    });
  }, [entityPolicy]);

  const activeEmployees = useMemo(() => {
    return (employees || [])
      .filter((employee) => employee.status === "active")
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [employees]);

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    (employees || []).forEach((employee) => map.set(employee.employeeId, employee));
    return map;
  }, [employees]);

  const summaries = useMemo(() => {
    return activeEmployees.map((employee) => {
      const policy = resolveMealTicketPolicyFromList(policies || [], employee.employeeId, employee.activeContractId, {
        year: selectedYear,
        month: selectedMonth,
        startDate,
        endDate,
      });

      return calculateMealTicketMonthlySummary({
        entityId,
        employee,
        year: selectedYear,
        month: selectedMonth,
        policy,
        attendanceRecords: attendanceRecords || [],
        timeOffRequests: timeOffRequests || [],
        holidays: holidays || [],
        generatedBy: user?.uid,
      });
    });
  }, [activeEmployees, attendanceRecords, endDate, entityId, holidays, policies, selectedMonth, selectedYear, startDate, timeOffRequests, user?.uid]);

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, summary) => ({
        eligibleDays: acc.eligibleDays + summary.eligibleDays,
        totalValue: acc.totalValue + summary.totalValue,
        warnings: acc.warnings + (summary.warnings?.length || 0),
      }),
      { eligibleDays: 0, totalValue: 0, warnings: 0 }
    );
  }, [summaries]);

  const confirmedTotals = useMemo(() => {
    return (confirmedSummaries || []).reduce(
      (acc, summary) => ({
        employees: acc.employees + 1,
        totalValue: acc.totalValue + (summary.totalValue || 0),
        latestGeneratedAt: getLatestStoredDate(acc.latestGeneratedAt, summary.generatedAt),
      }),
      { employees: 0, totalValue: 0, latestGeneratedAt: null as any }
    );
  }, [confirmedSummaries]);

  const handleSavePolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!entityId || !user) return;

    if (!policyForm.effectiveFrom) {
      toast({ variant: "destructive", title: "Date requise", description: "La date d'effet est obligatoire." });
      return;
    }

    if (policyForm.effectiveTo && policyForm.effectiveTo < policyForm.effectiveFrom) {
      toast({ variant: "destructive", title: "Période invalide", description: "La date de fin doit être postérieure à la date d'effet." });
      return;
    }

    setSavingPolicy(true);
    try {
      await saveEntityMealTicketPolicy(
        entityId,
        {
          effectiveFrom: policyForm.effectiveFrom,
          effectiveTo: policyForm.effectiveTo || null,
          valuePerTicket: Number(policyForm.valuePerTicket) || 0,
          minimumWorkedHoursForEligibility: Number(policyForm.minimumWorkedHoursForEligibility) || 0,
          includeHolidayWorkedDays: policyForm.includeHolidayWorkedDays,
          excludeLeaveDays: policyForm.excludeLeaveDays,
          excludeAbsenceDays: policyForm.excludeAbsenceDays,
          status: policyForm.status,
        },
        user.uid
      );
      toast({ title: "Nouvelle période buoni pasto enregistrée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Impossible d'enregistrer la politique." });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleConfirmMonth = async () => {
    if (!entityId || !user || summaries.length === 0) return;

    setConfirmingMonth(true);
    try {
      const result = await confirmMealTicketMonthlySummaries(entityId, summaries, user.uid);
      toast({
        title: "Mois confirmé",
        description: `${result.confirmed} synthèse(s) buoni pasto confirmée(s).`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erreur de confirmation",
        description: err.message || "Impossible de confirmer le mois.",
      });
    } finally {
      setConfirmingMonth(false);
    }
  };

  if (membershipLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!canRead) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="rounded-3xl">
          <AlertCircle className="w-4 h-4" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>Vous n'avez pas la permission de consulter les buoni pasto.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const loadingPreview = loadingPolicies || loadingEmployees || loadingAttendance || loadingConfirmedSummaries;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 text-white rounded-2xl p-3 shadow-lg shadow-emerald-600/20">
              <Utensils className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-primary tracking-tight">Buoni pasto / Meal tickets</h1>
              <p className="text-sm text-muted-foreground font-medium max-w-3xl">
                Les buoni pasto sont calculés à partir des présences validées. Ils sont affichés comme avantage économique et ne modifient pas le salaire brut.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(Number(value))}>
            <SelectTrigger className="w-[170px] rounded-xl bg-white font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month.value} value={String(month.value)} className="capitalize">
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(selectedYear)} onValueChange={(value) => setSelectedYear(Number(value))}>
            <SelectTrigger className="w-[120px] rounded-xl bg-white font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canConfirm && (
            <Button
              onClick={handleConfirmMonth}
              disabled={confirmingMonth || loadingPreview || summaries.length === 0}
              className="rounded-xl font-black gap-2 shadow-lg shadow-primary/10"
            >
              {confirmingMonth ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirmer le mois
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <SummaryCard title="Jours éligibles" value={totals.eligibleDays.toLocaleString("fr-FR")} icon={CheckCircle2} color="emerald" />
        <SummaryCard title="Valeur prévisionnelle" value={formatEuro(totals.totalValue)} icon={Ticket} color="blue" />
        <SummaryCard title="Alertes preview" value={totals.warnings.toLocaleString("fr-FR")} icon={Info} color="amber" />
      </div>

      <Alert className={cn(
        "rounded-3xl",
        confirmedTotals.employees > 0 ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"
      )}>
        <CheckCircle2 className={cn("h-4 w-4", confirmedTotals.employees > 0 ? "text-emerald-700" : "text-blue-700")} />
        <AlertTitle className={confirmedTotals.employees > 0 ? "text-emerald-900" : "text-blue-900"}>
          {confirmedTotals.employees > 0 ? "Mois confirmé" : "Mois non confirmé"}
        </AlertTitle>
        <AlertDescription className={confirmedTotals.employees > 0 ? "text-emerald-800" : "text-blue-800"}>
          {confirmedTotals.employees > 0 ? (
            <>
              {confirmedTotals.employees} synthèse(s) confirmée(s), total buoni pasto {formatEuro(confirmedTotals.totalValue)}
              {confirmedTotals.latestGeneratedAt ? ` — confirmé le ${formatStoredDate(confirmedTotals.latestGeneratedAt)}` : ""}.
            </>
          ) : (
            "La confirmation fige les valeurs du mois pour affichage dans la synthèse économique. Elle ne modifie pas le brut."
          )}
        </AlertDescription>
      </Alert>

      <Card className="rounded-[2rem] border-primary/5 shadow-xl shadow-primary/5 overflow-hidden">
        <CardHeader className="bg-slate-50 border-b px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Gift className="w-5 h-5 text-emerald-600" />
                Politique entité
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Chaque changement de tarif crée une nouvelle période. Les anciens tarifs restent conservés pour l’historique et les calculs passés.
              </p>
            </div>
            <Badge className={cn("rounded-full border", policyForm.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200")}>
              {policyForm.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSavePolicy} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            <Field label="Valeur par ticket">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={policyForm.valuePerTicket}
                onChange={(event) => setPolicyForm((prev) => ({ ...prev, valuePerTicket: Number(event.target.value) }))}
                disabled={!canManage}
                className="rounded-xl"
              />
            </Field>

            <Field label="Heures minimum travaillées">
              <Input
                type="number"
                step="0.25"
                min="0"
                value={policyForm.minimumWorkedHoursForEligibility}
                onChange={(event) => setPolicyForm((prev) => ({ ...prev, minimumWorkedHoursForEligibility: Number(event.target.value) }))}
                disabled={!canManage}
                className="rounded-xl"
              />
            </Field>

            <Field label="Date d'effet">
              <Input
                type="date"
                value={policyForm.effectiveFrom}
                onChange={(event) => setPolicyForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))}
                disabled={!canManage}
                className="rounded-xl"
              />
            </Field>

            <Field label="Date de fin">
              <Input
                type="date"
                value={policyForm.effectiveTo}
                onChange={(event) => setPolicyForm((prev) => ({ ...prev, effectiveTo: event.target.value }))}
                disabled={!canManage}
                className="rounded-xl"
              />
            </Field>

            <ToggleRow
              label="Inclure les jours fériés travaillés"
              checked={policyForm.includeHolidayWorkedDays}
              disabled={!canManage}
              onCheckedChange={(checked) => setPolicyForm((prev) => ({ ...prev, includeHolidayWorkedDays: checked }))}
            />
            <ToggleRow
              label="Exclure les congés"
              checked={policyForm.excludeLeaveDays}
              disabled={!canManage}
              onCheckedChange={(checked) => setPolicyForm((prev) => ({ ...prev, excludeLeaveDays: checked }))}
            />
            <ToggleRow
              label="Exclure les absences"
              checked={policyForm.excludeAbsenceDays}
              disabled={!canManage}
              onCheckedChange={(checked) => setPolicyForm((prev) => ({ ...prev, excludeAbsenceDays: checked }))}
            />

            <Field label="Statut">
              <Select
                value={policyForm.status}
                onValueChange={(value: MealTicketPolicy["status"]) => setPolicyForm((prev) => ({ ...prev, status: value }))}
                disabled={!canManage}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {canManage && (
              <div className="md:col-span-2 xl:col-span-4 flex justify-end">
                <Button type="submit" disabled={savingPolicy} className="rounded-xl font-black gap-2 shadow-lg shadow-primary/10">
                  {savingPolicy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Enregistrer une nouvelle politique
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-primary/5 shadow-xl shadow-primary/5 overflow-hidden">
        <CardHeader className="bg-white border-b px-6 py-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-primary">
                <History className="w-5 h-5 text-slate-600" />
                Historique des politiques
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Les versions sont conservées par période d’effet. La preview mensuelle utilise automatiquement la version applicable au mois sélectionné.
              </p>
            </div>
            {entityPolicyForSelectedMonth && (
              <Badge className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Version utilisée : {formatEuro(entityPolicyForSelectedMonth.valuePerTicket)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {policyHistory.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground font-medium">
              Aucune politique enregistrée pour le moment.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70">
                  <TableHead>Valeur</TableHead>
                  <TableHead>Début</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Portée</TableHead>
                  <TableHead className="text-right">Période sélectionnée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policyHistory.map((policy) => {
                  const isCurrentForSelectedMonth = policy.id === entityPolicyForSelectedMonth?.id;
                  return (
                    <TableRow key={policy.id || `${policy.scope}-${policy.effectiveFrom}`} className={cn(isCurrentForSelectedMonth && "bg-emerald-50/40")}>
                      <TableCell className="font-black text-primary">{formatEuro(policy.valuePerTicket)}</TableCell>
                      <TableCell>{formatPolicyDate(policy.effectiveFrom)}</TableCell>
                      <TableCell>{policy.effectiveTo ? formatPolicyDate(policy.effectiveTo) : "Ouverte"}</TableCell>
                      <TableCell>
                        <Badge className={cn("rounded-full border", policy.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200")}>
                          {policy.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full capitalize">
                          {policy.scope}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isCurrentForSelectedMonth ? (
                          <Badge className="rounded-full bg-blue-50 text-blue-700 border border-blue-200">Utilisée</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-primary/5 shadow-xl shadow-primary/5 overflow-hidden">
        <CardHeader className="bg-white border-b px-6 py-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Calendar className="w-5 h-5 text-blue-600" />
                Preview mensuelle
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Prévisualisation uniquement : aucune synthèse économique n'est recalculée et aucune valeur n'est ajoutée au total brut.
              </p>
            </div>
            <Badge variant="outline" className="rounded-full bg-slate-50 text-slate-600 border-slate-200 capitalize">
              {format(parseISO(startDate), "MMMM yyyy", { locale: fr })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPreview ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-bold">Préparation de la preview...</p>
            </div>
          ) : summaries.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <XCircle className="w-8 h-8" />
              <p className="text-sm font-bold">Aucun employé actif trouvé pour cette période.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70">
                  <TableHead>Employé</TableHead>
                  <TableHead className="text-right">Jours éligibles</TableHead>
                  <TableHead className="text-right">Exclus</TableHead>
                  <TableHead className="text-right">Valeur ticket</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Alertes</TableHead>
                  <TableHead className="text-right">Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((summary) => {
                  const employee = employeesMap.get(summary.employeeId);
                  return (
                  <TableRow key={summary.id} className="hover:bg-slate-50/60">
                    <TableCell>
                      <div className="font-black text-primary">{summary.employeeName || "Employé"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Matricule: <span className="font-mono uppercase">{employee?.employeeCode || "Non renseigné"}</span>
                        {" · "}
                        Codice fiscale: <span className="font-mono uppercase">{employee?.taxCode || "Non renseigné"}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">Preview buoni pasto</div>
                    </TableCell>
                    <TableCell className="text-right font-black text-emerald-700">{summary.eligibleDays}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{summary.excludedDays}</TableCell>
                    <TableCell className="text-right">{formatEuro(summary.valuePerTicket)}</TableCell>
                    <TableCell className="text-right font-black text-primary">{formatEuro(summary.totalValue)}</TableCell>
                    <TableCell>
                      {summary.warnings?.length ? (
                        <Badge className="rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {summary.warnings.length} alerte{summary.warnings.length > 1 ? "s" : ""}
                        </Badge>
                      ) : (
                        <Badge className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          OK
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={() => setSelectedSummary(summary)}>
                        <Eye className="w-4 h-4" />
                        Voir
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedSummary} onOpenChange={(open) => !open && setSelectedSummary(null)}>
        <DialogContent className="max-w-3xl rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>Détail buoni pasto</DialogTitle>
            <DialogDescription>
              {selectedSummary?.employeeName} — {selectedSummary ? format(parseISO(`${selectedSummary.year}-${String(selectedSummary.month).padStart(2, "0")}-01`), "MMMM yyyy", { locale: fr }) : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedSummary && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <MiniMetric label="Jours éligibles" value={selectedSummary.eligibleDays} />
                <MiniMetric label="Jours exclus" value={selectedSummary.excludedDays} />
                <MiniMetric label="Total avantage" value={formatEuro(selectedSummary.totalValue)} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {Object.entries(selectedSummary.excludedBreakdown).map(([key, value]) => (
                  <div key={key} className="rounded-2xl border bg-slate-50 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">{breakdownLabel(key)}</p>
                    <p className="text-lg font-black text-primary">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border p-4">
                  <h3 className="text-sm font-black text-primary mb-3">Dates éligibles</h3>
                  {selectedSummary.eligibleDates?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedSummary.eligibleDates.map((date) => (
                        <Badge key={date} className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {format(parseISO(date), "dd/MM/yyyy")}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucune date éligible.</p>
                  )}
                </div>

                <div className="rounded-2xl border p-4">
                  <h3 className="text-sm font-black text-primary mb-3">Dates exclues</h3>
                  {selectedSummary.excludedDates?.length ? (
                    <div className="space-y-2 max-h-64 overflow-auto pr-1">
                      {selectedSummary.excludedDates.map((item, index) => (
                        <div key={`${item.date}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-bold text-primary">{format(parseISO(item.date), "dd/MM/yyyy")}</span>
                          <span className="text-muted-foreground text-right">{reasonLabels[item.reason] || item.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucune exclusion.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
                <strong>Traçabilité :</strong> {selectedSummary.sourceAttendanceIds.length} présence(s) source utilisées. Cette preview ne crée pas de synthèse économique et ne modifie pas le salaire brut.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border bg-slate-50/70 px-4 py-3 flex items-center justify-between gap-3">
      <Label className="text-xs font-bold text-primary leading-snug">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: string;
  icon: typeof Ticket;
  color: "emerald" | "blue" | "amber";
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
  };

  return (
    <Card className="rounded-[2rem] border-primary/5 shadow-lg shadow-primary/5">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("rounded-2xl p-3 border", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">{title}</p>
          <p className="text-2xl font-black text-primary">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-50 border p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">{label}</p>
      <p className="text-xl font-black text-primary">{value}</p>
    </div>
  );
}

function breakdownLabel(key: string) {
  const labels: Record<string, string> = {
    absences: "Absences",
    leave: "Congés",
    holidaysNotWorked: "Fériés non travaillés",
    nonWorkedDays: "Non travaillés",
    invalidOrDraftAttendance: "Présences ignorées",
  };
  return labels[key] || key;
}

function formatPolicyDate(date?: string | null) {
  if (!date) return "Non renseigné";
  try {
    return format(parseISO(date), "dd/MM/yyyy");
  } catch {
    return date;
  }
}

function storedDateToMillis(value: any) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLatestStoredDate(current: any, next: any) {
  return storedDateToMillis(next) > storedDateToMillis(current) ? next : current;
}

function formatStoredDate(value: any) {
  const millis = storedDateToMillis(value);
  if (!millis) return "Non renseigné";
  return new Date(millis).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
