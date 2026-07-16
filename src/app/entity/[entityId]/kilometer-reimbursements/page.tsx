"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  Car,
  CheckCircle2,
  History,
  Info,
  Loader2,
  Pencil,
  Route,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { collection, query, where, type Query } from "firebase/firestore";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCollection, useFirebase, useUser } from "@/firebase";
import { useActiveMembership } from "@/hooks/use-active-membership";
import {
  calculateKilometerReimbursementMonthlyPreview,
  calculateReimbursementItemTotal,
  confirmKilometerReimbursementMonth,
  deleteDraftKilometerReimbursementItem,
  getKilometerReimbursementMonthRange,
  resolveKilometerReimbursementPolicyFromList,
  saveEntityKilometerReimbursementPolicy,
  saveKilometerReimbursementItem,
  updateKilometerReimbursementStatus,
} from "@/services/kilometer-reimbursement.service";
import { Employee } from "@/types/employee";
import {
  KilometerReimbursement,
  KilometerReimbursementMonthlySummary,
  KilometerReimbursementPolicy,
  KilometerReimbursementRateSource,
} from "@/types/kilometer-reimbursement";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const formatEuro = (value?: number | null) =>
  `€ ${(value ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatKm = (value?: number | null) =>
  `${(value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: format(new Date(2026, index, 1), "MMMM", { locale: fr }),
}));

const getMonthDateDefaults = (year: number, month: number) => {
  const paddedMonth = String(month).padStart(2, "0");
  const firstDay = `${year}-${paddedMonth}-01`;
  const lastDay = new Date(year, month, 0).toISOString().slice(0, 10);
  return { firstDay, lastDay };
};

const initialPolicyForm = {
  effectiveFrom: `${new Date().getFullYear()}-01-01`,
  effectiveTo: "",
  ratePerKm: 0,
  rateSource: "manual" as KilometerReimbursementRateSource,
  aciReferenceLabel: "",
  notes: "",
  status: "active" as KilometerReimbursementPolicy["status"],
};

const initialItemForm = {
  id: "",
  employeeId: "",
  tripDate: new Date().toISOString().slice(0, 10),
  origin: "",
  destination: "",
  reason: "",
  kilometers: 0,
  ratePerKm: 0,
  policyId: "",
  vehicleInfo: "",
  notes: "",
  status: "draft" as KilometerReimbursement["status"],
};

const statusLabels: Record<KilometerReimbursement["status"], string> = {
  draft: "Brouillon",
  submitted: "Soumis",
  approved: "Approuvé",
  rejected: "Rejeté",
  confirmed: "Confirmé",
  exported: "Exporté",
};

const statusStyles: Record<KilometerReimbursement["status"], string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  submitted: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  confirmed: "bg-primary/10 text-primary border-primary/20",
  exported: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

function formatStoredDate(value: any) {
  if (!value) return "Non renseigné";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Non renseigné";
  return format(date, "dd/MM/yyyy HH:mm", { locale: fr });
}

export default function KilometerReimbursementsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [policyForm, setPolicyForm] = useState(initialPolicyForm);
  const [itemForm, setItemForm] = useState(initialItemForm);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [confirmingMonth, setConfirmingMonth] = useState(false);

  const permissionsReady =
    !membershipLoading &&
    !!membership &&
    membership.entityId === entityId;
  const canManageReimbursements = hasPermission("reimbursements.manage");
  const canApproveReimbursements = hasPermission("reimbursements.approve") || hasPermission("reimbursements.manage");
  const canExportReimbursements = hasPermission("reimbursements.export");
  const canReadReimbursements =
    hasPermission("reimbursements.read") ||
    canManageReimbursements ||
    canApproveReimbursements ||
    canExportReimbursements;
  const canReadEmployees = hasPermission("employees.read");
  const canUseKilometerEmployeeSelector = canManageReimbursements && canReadEmployees;
  const canConfirmKilometerMonth = canApproveReimbursements && canReadEmployees;

  const { startDate, endDate } = useMemo(
    () => getKilometerReimbursementMonthRange(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );
  const monthDefaults = useMemo(
    () => getMonthDateDefaults(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, index) => current - 2 + index);
  }, []);

  const policiesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReimbursements) return null;
    return query(collection(db, `entities/${entityId}/kilometerReimbursementPolicies`)) as Query<KilometerReimbursementPolicy>;
  }, [db, entityId, permissionsReady, canReadReimbursements]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReimbursements || !canReadEmployees) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, permissionsReady, canReadReimbursements, canReadEmployees]);

  const itemsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReimbursements) return null;
    return query(
      collection(db, `entities/${entityId}/kilometerReimbursements`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth)
    ) as Query<KilometerReimbursement>;
  }, [db, entityId, permissionsReady, canReadReimbursements, selectedMonth, selectedYear]);

  const confirmedSummariesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReimbursements) return null;
    return query(
      collection(db, `entities/${entityId}/kilometerReimbursementMonthlySummaries`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth),
      where("status", "==", "confirmed")
    ) as Query<KilometerReimbursementMonthlySummary>;
  }, [db, entityId, permissionsReady, canReadReimbursements, selectedMonth, selectedYear]);

  const { data: policies, loading: loadingPolicies } = useCollection<KilometerReimbursementPolicy>(
    policiesQuery,
    "kilometer-reimbursements.policies"
  );
  const { data: employees, loading: loadingEmployees, error: employeesError } = useCollection<Employee>(
    employeesQuery,
    "kilometer-reimbursements.employees"
  );
  const { data: items, loading: loadingItems } = useCollection<KilometerReimbursement>(
    itemsQuery,
    "kilometer-reimbursements.items"
  );
  const { data: confirmedSummaries } = useCollection<KilometerReimbursementMonthlySummary>(
    confirmedSummariesQuery,
    "kilometer-reimbursements.confirmed-summaries"
  );

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

  const employeeDirectorySuccessfullyLoaded =
    canReadEmployees &&
    !!employeesQuery &&
    !loadingEmployees &&
    !employeesError;

  const policyHistory = useMemo(() => {
    return (policies || [])
      .filter((policy) => policy.scope === "entity")
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
  }, [policies]);

  const entityPolicyForSelectedMonth = useMemo(() => {
    return (policies || [])
      .filter((policy) => policy.scope === "entity" && policy.status === "active")
      .filter((policy) => policy.effectiveFrom <= endDate && (!policy.effectiveTo || policy.effectiveTo >= startDate))
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""))[0] || null;
  }, [endDate, policies, startDate]);

  const sortedItems = useMemo(() => {
    return (items || []).sort((a, b) => {
      const dateCompare = (b.tripDate || "").localeCompare(a.tripDate || "");
      if (dateCompare !== 0) return dateCompare;
      return (a.employeeName || "").localeCompare(b.employeeName || "");
    });
  }, [items]);

  const previewSummaries = useMemo(() => {
    if (!canReadEmployees) return [];
    return calculateKilometerReimbursementMonthlyPreview({
      entityId,
      employees: activeEmployees,
      items: items || [],
      year: selectedYear,
      month: selectedMonth,
      generatedBy: user?.uid,
    }).filter((summary) => summary.itemCount > 0);
  }, [activeEmployees, canReadEmployees, entityId, items, selectedMonth, selectedYear, user?.uid]);

  const confirmedTotals = useMemo(() => {
    return (confirmedSummaries || []).reduce(
      (acc, summary) => ({
        employees: acc.employees + 1,
        totalKilometers: acc.totalKilometers + (summary.totalKilometers || 0),
        totalAmount: acc.totalAmount + (summary.totalAmount || 0),
        latestGeneratedAt: acc.latestGeneratedAt || summary.generatedAt,
      }),
      { employees: 0, totalKilometers: 0, totalAmount: 0, latestGeneratedAt: null as any }
    );
  }, [confirmedSummaries]);

  const previewTotals = useMemo(() => {
    return previewSummaries.reduce(
      (acc, summary) => ({
        employees: acc.employees + 1,
        items: acc.items + summary.itemCount,
        totalKilometers: acc.totalKilometers + summary.totalKilometers,
        totalAmount: acc.totalAmount + summary.totalAmount,
      }),
      { employees: 0, items: 0, totalKilometers: 0, totalAmount: 0 }
    );
  }, [previewSummaries]);

  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.employeeId === itemForm.employeeId) || null,
    [activeEmployees, itemForm.employeeId]
  );

  const resolvedPolicyForItem = useMemo(() => {
    if (!itemForm.employeeId || !itemForm.tripDate) return entityPolicyForSelectedMonth;
    const year = Number(itemForm.tripDate.slice(0, 4));
    const month = Number(itemForm.tripDate.slice(5, 7));
    return resolveKilometerReimbursementPolicyFromList(
      policies || [],
      itemForm.employeeId,
      selectedEmployee?.activeContractId,
      { year, month, startDate: itemForm.tripDate, endDate: itemForm.tripDate }
    );
  }, [entityPolicyForSelectedMonth, itemForm.employeeId, itemForm.tripDate, policies, selectedEmployee?.activeContractId]);

  const resolvedRatePerKm = resolvedPolicyForItem?.ratePerKm || 0;
  const resolvedPolicyReference = resolvedPolicyForItem
    ? [
        resolvedPolicyForItem.rateSource === "aci"
          ? "ACI"
          : resolvedPolicyForItem.rateSource === "company_policy"
            ? "Politique entreprise"
            : "Manuel",
        resolvedPolicyForItem.aciReferenceLabel,
      ]
        .filter(Boolean)
        .join(" / ")
    : null;
  const itemTotal = calculateReimbursementItemTotal(itemForm.kilometers, resolvedRatePerKm);
  const isTripDateInSelectedMonth =
    !!itemForm.tripDate && itemForm.tripDate >= startDate && itemForm.tripDate <= endDate;
  const canSaveItem =
    canUseKilometerEmployeeSelector &&
    !savingItem &&
    !!selectedEmployee &&
    !!resolvedPolicyForItem &&
    isTripDateInSelectedMonth &&
    itemForm.kilometers > 0 &&
    !!itemForm.tripDate &&
    !!itemForm.origin &&
    !!itemForm.destination &&
    !!itemForm.reason;
  const isLoading = membershipLoading || loadingPolicies || loadingItems;

  useEffect(() => {
    setPolicyForm((prev) => ({
      ...prev,
      effectiveFrom: monthDefaults.firstDay,
      effectiveTo: monthDefaults.lastDay,
    }));
    setItemForm((prev) => {
      const shouldResetDate = !prev.tripDate || prev.tripDate < startDate || prev.tripDate > endDate;
      return {
        ...prev,
        tripDate: shouldResetDate ? monthDefaults.firstDay : prev.tripDate,
      };
    });
  }, [endDate, monthDefaults.firstDay, monthDefaults.lastDay, startDate]);

  useEffect(() => {
    setItemForm((prev) => ({
      ...prev,
      ratePerKm: resolvedRatePerKm,
      policyId: resolvedPolicyForItem?.id || "",
    }));
  }, [resolvedPolicyForItem?.id, resolvedRatePerKm]);

  function resetItemForm() {
    setItemForm({
      ...initialItemForm,
      tripDate: monthDefaults.firstDay,
      ratePerKm: entityPolicyForSelectedMonth?.ratePerKm || 0,
      policyId: entityPolicyForSelectedMonth?.id || "",
    });
  }

  async function handleSavePolicy() {
    if (!user?.uid) return;
    if (!policyForm.effectiveFrom || policyForm.ratePerKm <= 0) {
      toast({
        title: "Politique incomplète",
        description: "Veuillez renseigner une date d'effet et un tarif €/km positif.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingPolicy(true);
      await saveEntityKilometerReimbursementPolicy(entityId, policyForm, user.uid);
      toast({
        title: "Nouvelle politique enregistrée",
        description: "L'ancien historique est conservé. Les chevauchements actifs sont bloqués.",
      });
      setPolicyForm({
        ...initialPolicyForm,
        effectiveFrom: monthDefaults.firstDay,
        effectiveTo: monthDefaults.lastDay,
      });
    } catch (error: any) {
      toast({
        title: "Impossible d'enregistrer",
        description: error?.message || "Vérifiez la période et les permissions.",
        variant: "destructive",
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleSaveItem() {
    if (!canUseKilometerEmployeeSelector) {
      toast({
        title: "Création indisponible",
        description: "La création d’un remboursement kilométrique nécessite l’autorisation de consulter les employés.",
        variant: "destructive",
      });
      return;
    }
    if (!user?.uid || !selectedEmployee) return;
    if (!isTripDateInSelectedMonth) {
      toast({
        title: "Date hors période",
        description: "La date du trajet doit appartenir au mois sélectionné.",
        variant: "destructive",
      });
      return;
    }
    if (!resolvedPolicyForItem || resolvedRatePerKm <= 0) {
      toast({
        title: "Aucune politique €/km active",
        description: "Créez une politique active couvrant la date du trajet avant d'ajouter un remboursement.",
        variant: "destructive",
      });
      return;
    }
    if (!itemForm.tripDate || !itemForm.origin || !itemForm.destination || !itemForm.reason || itemForm.kilometers <= 0) {
      toast({
        title: "Trajet incomplet",
        description: "Veuillez renseigner le collaborateur, le trajet, le motif et les kilomètres.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingItem(true);
      await saveKilometerReimbursementItem(
        entityId,
        {
          ...itemForm,
          employeeName: selectedEmployee.displayName,
          ratePerKm: resolvedRatePerKm,
          policyId: resolvedPolicyForItem.id || null,
        },
        user.uid,
        itemForm.id || undefined
      );
      toast({ title: "Trajet enregistré", description: "Le montant est calculé séparément du brut." });
      resetItemForm();
    } catch (error: any) {
      toast({
        title: "Enregistrement impossible",
        description: error?.message || "Vérifiez les informations du trajet.",
        variant: "destructive",
      });
    } finally {
      setSavingItem(false);
    }
  }

  async function handleStatus(item: KilometerReimbursement, status: "approved" | "rejected") {
    if (!user?.uid || !item.id) return;
    try {
      await updateKilometerReimbursementStatus(entityId, item.id, status, user.uid);
      toast({
        title: status === "approved" ? "Trajet approuvé" : "Trajet rejeté",
        description: "La preview mensuelle utilisera uniquement les trajets approuvés.",
      });
    } catch (error: any) {
      toast({
        title: "Action impossible",
        description: error?.message || "Vérifiez vos permissions.",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(item: KilometerReimbursement) {
    if (!user?.uid || !item.id) return;
    try {
      await deleteDraftKilometerReimbursementItem(entityId, item.id, user.uid);
      toast({ title: "Brouillon supprimé" });
    } catch (error: any) {
      toast({
        title: "Suppression impossible",
        description: error?.message || "Seuls les brouillons peuvent être supprimés dans ce MVP.",
        variant: "destructive",
      });
    }
  }

  async function handleConfirmMonth() {
    if (!canConfirmKilometerMonth) return;
    if (!user?.uid) return;
    const summariesToConfirm = previewSummaries.filter((summary) => summary.itemCount > 0);
    if (summariesToConfirm.length === 0) {
      toast({
        title: "Aucun remboursement à confirmer",
        description: "Ajoutez et approuvez au moins un trajet pour ce mois.",
        variant: "destructive",
      });
      return;
    }

    try {
      setConfirmingMonth(true);
      await confirmKilometerReimbursementMonth(entityId, summariesToConfirm, user.uid);
      toast({
        title: "Mois confirmé",
        description: "Les remboursements seront visibles séparément dans la synthèse économique.",
      });
    } catch (error: any) {
      toast({
        title: "Confirmation impossible",
        description: error?.message || "Vérifiez les permissions et les données du mois.",
        variant: "destructive",
      });
    } finally {
      setConfirmingMonth(false);
    }
  }

  if (membershipLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canReadReimbursements) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="rounded-3xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>
            Vous n'avez pas la permission de consulter les remboursements kilométriques.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <main className="p-4 md:p-8 space-y-8 bg-slate-50/30 min-h-screen">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="rounded-full bg-white px-3 py-1 text-primary border-primary/20">
            Remboursements séparés du brut
          </Badge>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            Rimborsi chilometrici
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground leading-relaxed">
            Les remboursements kilométriques sont calculés à partir des kilomètres validés et d'un tarif €/km.
            Ils sont affichés comme remboursement séparé et ne modifient pas le salaire brut.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(Number(value))}>
            <SelectTrigger className="w-40 rounded-xl bg-white">
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
            <SelectTrigger className="w-28 rounded-xl bg-white">
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
        </div>
      </header>

      <Alert className="rounded-3xl border-amber-200 bg-amber-50 text-amber-900">
        <Info className="h-4 w-4 text-amber-700" />
        <AlertTitle>Traitement fiscal à valider</AlertTitle>
        <AlertDescription>
          Le tarif peut être saisi manuellement avec une référence ACI ou politique entreprise. Le traitement légal/fiscal doit être validé par le consulente del lavoro.
        </AlertDescription>
      </Alert>

      <div className="grid gap-5 md:grid-cols-3">
        <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Route className="h-5 w-5" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Km approuvés</p>
              <p className="text-2xl font-black text-slate-900">{formatKm(previewTotals.totalKilometers)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-emerald-100 bg-emerald-50/30 shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Preview mois</p>
              <p className="text-2xl font-black text-emerald-900">{formatEuro(previewTotals.totalAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-blue-100 bg-blue-50/30 shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Mois confirmé</p>
              <p className="text-2xl font-black text-blue-900">{formatEuro(confirmedTotals.totalAmount)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
              <Car className="h-5 w-5" />
              Politique €/km
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tarif €/km</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="rounded-xl"
                  value={policyForm.ratePerKm}
                  onChange={(e) => setPolicyForm((prev) => ({ ...prev, ratePerKm: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Source tarif</Label>
                <Select
                  value={policyForm.rateSource}
                  onValueChange={(value) => setPolicyForm((prev) => ({ ...prev, rateSource: value as KilometerReimbursementRateSource }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manuel</SelectItem>
                    <SelectItem value="aci">Référence ACI</SelectItem>
                    <SelectItem value="company_policy">Politique entreprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Début effet</Label>
                <Input
                  type="date"
                  className="rounded-xl"
                  value={policyForm.effectiveFrom}
                  onChange={(e) => setPolicyForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Fin effet</Label>
                <Input
                  type="date"
                  className="rounded-xl"
                  value={policyForm.effectiveTo}
                  onChange={(e) => setPolicyForm((prev) => ({ ...prev, effectiveTo: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Référence ACI / entreprise</Label>
              <Input
                className="rounded-xl"
                placeholder="Ex. ACI 2026 - catégorie véhicule..."
                value={policyForm.aciReferenceLabel}
                onChange={(e) => setPolicyForm((prev) => ({ ...prev, aciReferenceLabel: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                className="min-h-[80px] rounded-xl"
                value={policyForm.notes}
                onChange={(e) => setPolicyForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <Alert className="rounded-2xl bg-slate-50">
              <History className="h-4 w-4" />
              <AlertTitle>Historique préservé</AlertTitle>
              <AlertDescription>
                Chaque nouveau tarif crée une nouvelle période. Les politiques actives qui se chevauchent sont bloquées.
              </AlertDescription>
            </Alert>
            <Button
              className="w-full rounded-xl"
              onClick={handleSavePolicy}
              disabled={!canManageReimbursements || savingPolicy}
            >
              {savingPolicy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Enregistrer une nouvelle politique
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
              <History className="h-5 w-5" />
              Historique des politiques
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Référence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policyHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      Aucune politique kilométrique enregistrée.
                    </TableCell>
                  </TableRow>
                ) : (
                  policyHistory.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell className="font-black">{formatEuro(policy.ratePerKm)} / km</TableCell>
                      <TableCell className="capitalize">{policy.rateSource.replace("_", " ")}</TableCell>
                      <TableCell className="text-sm">
                        {policy.effectiveFrom} → {policy.effectiveTo || "Ouvert"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            policy.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          )}
                        >
                          {policy.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {policy.aciReferenceLabel || policy.notes || "Non renseigné"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <Route className="h-5 w-5" />
            Saisie des trajets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {canManageReimbursements && !canReadEmployees && (
            <Alert className="rounded-2xl border-amber-200 bg-amber-50 text-amber-900">
              <Info className="h-4 w-4 text-amber-700" />
              <AlertTitle>Création indisponible</AlertTitle>
              <AlertDescription>
                La création d’un remboursement kilométrique nécessite l’autorisation de consulter les employés.
              </AlertDescription>
            </Alert>
          )}
          {!isTripDateInSelectedMonth && (
            <Alert className="rounded-2xl border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertTitle>Date hors période</AlertTitle>
              <AlertDescription>
                La date du trajet doit être comprise entre {startDate} et {endDate}.
              </AlertDescription>
            </Alert>
          )}
          {isTripDateInSelectedMonth && !resolvedPolicyForItem && (
            <Alert className="rounded-2xl border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertTitle>Aucune politique €/km active</AlertTitle>
              <AlertDescription>
                Aucune politique €/km active pour cette date. Créez une politique avant d’ajouter un trajet.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-2 xl:col-span-2">
              <Label>Collaborateur</Label>
              <Select
                value={itemForm.employeeId}
                disabled={!canUseKilometerEmployeeSelector}
                onValueChange={(employeeId) => {
                  const employee = activeEmployees.find((item) => item.employeeId === employeeId);
                  const year = Number(itemForm.tripDate.slice(0, 4));
                  const month = Number(itemForm.tripDate.slice(5, 7));
                  const policy = resolveKilometerReimbursementPolicyFromList(
                    policies || [],
                    employeeId,
                    employee?.activeContractId,
                    { year, month, startDate: itemForm.tripDate, endDate: itemForm.tripDate }
                  );
                  setItemForm((prev) => ({
                    ...prev,
                    employeeId,
                    ratePerKm: policy?.ratePerKm || 0,
                    policyId: policy?.id || "",
                  }));
                }}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((employee) => (
                    <SelectItem key={employee.employeeId} value={employee.employeeId}>
                      {employee.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date trajet</Label>
              <Input
                type="date"
                min={startDate}
                max={endDate}
                className="rounded-xl"
                value={itemForm.tripDate}
                onChange={(e) => setItemForm((prev) => ({ ...prev, tripDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Kilomètres</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                className="rounded-xl"
                value={itemForm.kilometers}
                onChange={(e) => setItemForm((prev) => ({ ...prev, kilometers: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Tarif €/km</Label>
              <div className="flex min-h-10 flex-col justify-center rounded-xl border bg-slate-50 px-3 py-2">
                <span className="text-sm font-black text-primary">{formatEuro(resolvedRatePerKm)} / km</span>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {resolvedPolicyReference
                    ? `Tarif appliqué automatiquement depuis la politique active · ${resolvedPolicyReference}`
                    : "Tarif appliqué automatiquement depuis la politique active"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Total</Label>
              <div className="flex h-10 items-center rounded-xl border bg-slate-50 px-3 text-sm font-black text-primary">
                {formatEuro(itemTotal)}
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Départ</Label>
              <Input className="rounded-xl" value={itemForm.origin} onChange={(e) => setItemForm((prev) => ({ ...prev, origin: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Destination</Label>
              <Input className="rounded-xl" value={itemForm.destination} onChange={(e) => setItemForm((prev) => ({ ...prev, destination: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Motif / mission</Label>
              <Input className="rounded-xl" value={itemForm.reason} onChange={(e) => setItemForm((prev) => ({ ...prev, reason: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="space-y-2">
              <Label>Véhicule / notes</Label>
              <Input
                className="rounded-xl"
                placeholder="Optionnel : véhicule, plaque, référence..."
                value={itemForm.vehicleInfo}
                onChange={(e) => setItemForm((prev) => ({ ...prev, vehicleInfo: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button className="flex-1 rounded-xl" onClick={handleSaveItem} disabled={!canSaveItem}>
                {savingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {itemForm.id ? "Mettre à jour" : "Ajouter"}
              </Button>
              {itemForm.id && (
                <Button variant="outline" className="rounded-xl" onClick={resetItemForm}>
                  Annuler
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead>Collaborateur</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Trajet</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Tarif</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/40" />
                    </TableCell>
                  </TableRow>
                ) : sortedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      Aucun trajet saisi pour cette période.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedItems.map((item) => {
                    const employee = employeesMap.get(item.employeeId);
                    const employeeName = item.employeeName || employee?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
                    return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-bold">{employeeName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Matricule: <span className="font-mono uppercase">{employee?.employeeCode || "—"}</span>
                          {" · "}
                          Codice fiscale: <span className="font-mono uppercase">{employee?.taxCode || "—"}</span>
                        </p>
                      </TableCell>
                      <TableCell>{item.tripDate ? format(parseISO(item.tripDate), "dd/MM/yyyy", { locale: fr }) : "—"}</TableCell>
                      <TableCell>
                        <p className="font-medium">{item.origin} → {item.destination}</p>
                        <p className="text-xs text-muted-foreground">{item.reason}</p>
                      </TableCell>
                      <TableCell className="text-right">{formatKm(item.kilometers)}</TableCell>
                      <TableCell className="text-right">{formatEuro(item.ratePerKm)}</TableCell>
                      <TableCell className="text-right font-black text-primary">{formatEuro(item.totalAmount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("rounded-full", statusStyles[item.status])}>
                          {statusLabels[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canManageReimbursements && item.status === "draft" && (
                            <>
                              {canReadEmployees && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setItemForm({
                                    id: item.id || "",
                                    employeeId: item.employeeId,
                                    tripDate: item.tripDate,
                                    origin: item.origin,
                                    destination: item.destination,
                                    reason: item.reason,
                                    kilometers: item.kilometers,
                                    ratePerKm: item.ratePerKm,
                                    policyId: item.policyId || "",
                                    vehicleInfo: item.vehicleInfo || "",
                                    notes: item.notes || "",
                                    status: item.status,
                                  })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDelete(item)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {canApproveReimbursements && item.status !== "approved" && item.status !== "confirmed" && item.status !== "exported" && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-700" onClick={() => handleStatus(item, "approved")}>
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          {canApproveReimbursements && item.status !== "rejected" && item.status !== "confirmed" && item.status !== "exported" && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleStatus(item, "rejected")}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <Calendar className="h-5 w-5" />
            Preview mensuelle
          </CardTitle>
          <Button
            className="rounded-xl"
            onClick={handleConfirmMonth}
            disabled={!canConfirmKilometerMonth || confirmingMonth || previewSummaries.length === 0}
          >
            {confirmingMonth ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Confirmer le mois
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {confirmedTotals.employees > 0 && (
            <Alert className="rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <AlertTitle>Mois confirmé</AlertTitle>
              <AlertDescription>
                {confirmedTotals.employees} collaborateur(s), {formatKm(confirmedTotals.totalKilometers)}, {formatEuro(confirmedTotals.totalAmount)}.
                Confirmation : {formatStoredDate(confirmedTotals.latestGeneratedAt)}.
              </AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead className="text-right">Trajets approuvés</TableHead>
                <TableHead className="text-right">Kilomètres</TableHead>
                <TableHead className="text-right">Total remboursement</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    Aucun trajet approuvé pour cette période.
                  </TableCell>
                </TableRow>
              ) : (
                previewSummaries.map((summary) => {
                  const isConfirmed = (confirmedSummaries || []).some(
                    (confirmed) => confirmed.employeeId === summary.employeeId
                  );
                  const employee = employeesMap.get(summary.employeeId);
                  const employeeName = summary.employeeName || employee?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
                  return (
                    <TableRow key={summary.employeeId}>
                      <TableCell>
                        <p className="font-bold">{employeeName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Matricule: <span className="font-mono uppercase">{employee?.employeeCode || "—"}</span>
                          {" · "}
                          Codice fiscale: <span className="font-mono uppercase">{employee?.taxCode || "—"}</span>
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{summary.itemCount}</TableCell>
                      <TableCell className="text-right">{formatKm(summary.totalKilometers)}</TableCell>
                      <TableCell className="text-right font-black text-primary">{formatEuro(summary.totalAmount)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            isConfirmed
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          )}
                        >
                          {isConfirmed ? "Confirmé" : "Preview"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            La confirmation fige les remboursements kilométriques du mois pour affichage dans la synthèse économique.
            Elle ne modifie pas le brut mensuel ni le total brut économique.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
