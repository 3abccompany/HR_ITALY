"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Edit,
  FileText,
  Loader2,
  Plus,
  Search,
  Send,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, useUser } from "@/firebase";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS,
  EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS,
  EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS,
  type EmployeeFinancialRequestDto,
  type EmployeeFinancialRequestOrigin,
  type EmployeeFinancialRequestStatus,
  type EmployeeFinancialRequestType,
} from "@/types/employee-finance";
import {
  createEmployeeFinancialRequestAction,
  getEmployeeFinanceEmployeeOptionsAction,
  getEmployeeFinancialRequestsAction,
  submitEmployeeFinancialRequestAction,
  updateEmployeeFinancialRequestDraftAction,
} from "./actions";
import {
  EmployeeFinancialRequestDialog,
  type EmployeeFinanceDialogEmployeeOption,
  type EmployeeFinancialRequestDialogPayload,
} from "@/components/employee-finance/EmployeeFinancialRequestDialog";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const initialFilters = {
  search: "",
  requestType: "all",
  status: "all",
  origin: "all",
  employeeId: "all",
  dateCategory: "all",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format((cents || 0) / 100);
}

function getStatusClass(status: EmployeeFinancialRequestStatus) {
  if (status === "draft") return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === "submitted") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "active") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "settled") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected" || status === "cancelled" || status === "written_off") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function getPageNumbers(currentPage: number, totalPages: number) {
  const pages: Array<number | "..."> = [];
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      pages.push(page);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }
  return pages;
}

function getActiveContractLabel(request: EmployeeFinancialRequestDto) {
  if (request.activeContractSummary?.displayLabel) return request.activeContractSummary.displayLabel;
  if (request.activeContractId) return "Contrat actif introuvable";
  return "Aucun contrat actif";
}

function dateCategoryMatches(request: EmployeeFinancialRequestDto, category: string) {
  if (category === "all") return true;
  const date = request.requestDate ? new Date(request.requestDate) : null;
  if (!date || Number.isNaN(date.getTime())) return category === "no_date";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const requestDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (category === "today") return requestDay === startToday;
  if (category === "last_30") return requestDay >= startToday - 30 * 24 * 60 * 60 * 1000;
  return true;
}

export default function EmployeeFinancePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const auth = useAuth();
  const { user } = useUser();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);
  const { toast } = useToast();

  const [requests, setRequests] = useState<EmployeeFinancialRequestDto[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeFinanceDialogEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"admin_create" | "admin_edit" | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<EmployeeFinancialRequestDto | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const canRead = hasPermission("employeeFinance.read");
  const canCreate = hasPermission("employeeFinance.create");
  const canUpdate = hasPermission("employeeFinance.update");
  const canSubmit = hasPermission("employeeFinance.submit");

  const loadData = useCallback(async () => {
    if (!user || !entityId || membershipLoading) return;
    if (!canRead) {
      setLoading(false);
      setError("Accès refusé.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible.");
      const [requestResult, employeesResult] = await Promise.all([
        getEmployeeFinancialRequestsAction({ entityId, idToken }),
        getEmployeeFinanceEmployeeOptionsAction({ entityId, idToken }),
      ]);
      if (!requestResult.success) throw new Error(requestResult.error);
      if (!employeesResult.success) throw new Error(employeesResult.error);
      setRequests(requestResult.requests);
      setEmployeeOptions(employeesResult.employees);
    } catch (err: any) {
      setError(err.message || "Impossible de charger la finance employés.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [auth, canRead, entityId, membershipLoading, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const filteredRequests = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return requests
      .filter((request) => {
        const haystack = [
          request.employeeSnapshot.displayName,
          request.employeeSnapshot.matricule,
          request.reason,
          EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS[request.requestType],
          EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS[request.status],
          EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS[request.requestOrigin],
        ].join(" ").toLowerCase();
        if (search && !haystack.includes(search)) return false;
        if (filters.requestType !== "all" && request.requestType !== filters.requestType) return false;
        if (filters.status !== "all" && request.status !== filters.status) return false;
        if (filters.origin !== "all" && request.requestOrigin !== filters.origin) return false;
        if (filters.employeeId !== "all" && request.employeeId !== filters.employeeId) return false;
        if (!dateCategoryMatches(request, filters.dateCategory)) return false;
        return true;
      })
      .sort((a, b) => {
        const statusWeight = (status: string) => status === "draft" ? 1 : status === "submitted" ? 2 : 3;
        const weightDiff = statusWeight(a.status) - statusWeight(b.status);
        if (weightDiff !== 0) return weightDiff;
        return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
      });
  }, [filters, requests]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRequests = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = filteredRequests.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredRequests.length);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const summary = useMemo(() => ({
    total: requests.length,
    drafts: requests.filter((request) => request.status === "draft").length,
    submitted: requests.filter((request) => request.status === "submitted").length,
    warnings: requests.filter((request) => request.activeContractWarning).length,
  }), [requests]);

  async function handleSave(payload: EmployeeFinancialRequestDialogPayload) {
    const idToken = await auth.currentUser?.getIdToken(true);
    if (!idToken) return { success: false as const, error: "Session utilisateur indisponible." };
    const result = dialogMode === "admin_edit" && selectedRequest
      ? await updateEmployeeFinancialRequestDraftAction({ entityId, idToken, requestId: selectedRequest.id, ...payload, employeeId: payload.employeeId || selectedRequest.employeeId })
      : await createEmployeeFinancialRequestAction({ entityId, idToken, ...payload, employeeId: payload.employeeId || "" });
    if (!result.success) return { success: false as const, error: result.error };
    toast({ title: dialogMode === "admin_edit" ? "Brouillon mis à jour" : "Demande créée" });
    await loadData();
    setExpandedId(result.requestId);
    return { success: true as const };
  }

  async function handleSubmitRequest(request: EmployeeFinancialRequestDto) {
    if (submittingId) return;
    setSubmittingId(request.id);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible.");
      const result = await submitEmployeeFinancialRequestAction({ entityId, idToken, requestId: request.id });
      if (!result.success) throw new Error(result.error);
      toast({ title: result.alreadySubmitted ? "Demande déjà soumise" : "Demande soumise" });
      await loadData();
      setExpandedId(request.id);
    } catch (err: any) {
      toast({ title: "Soumission impossible", description: err.message || "Veuillez réessayer.", variant: "destructive" });
    } finally {
      setSubmittingId(null);
    }
  }

  if (membershipLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canRead || error) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6 text-red-800">{error || "Accès refusé."}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-primary">Gestion des avances, prêts et dettes</h1>
          <p className="text-muted-foreground">
            Gérez les demandes, accords, versements, échéanciers et remboursements des collaborateurs.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setSelectedRequest(null); setDialogMode("admin_create"); }}>
            <Plus className="mr-2 h-4 w-4" />
            Nouvelle demande
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-blue-100 bg-blue-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-blue-700">Total</p><p className="text-2xl font-black">{summary.total}</p></CardContent></Card>
        <Card className="border-slate-100 bg-slate-50"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-slate-600">Brouillons</p><p className="text-2xl font-black">{summary.drafts}</p></CardContent></Card>
        <Card className="border-indigo-100 bg-indigo-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-indigo-700">Soumises</p><p className="text-2xl font-black">{summary.submitted}</p></CardContent></Card>
        <Card className="border-amber-100 bg-amber-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-amber-700">Alertes contrat</p><p className="text-2xl font-black">{summary.warnings}</p></CardContent></Card>
      </div>

      <Card className="border-slate-200 bg-white/95 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Recherche employé, matricule ou motif" className="pl-9" />
            </div>
            <Select value={filters.requestType} onValueChange={(value) => setFilters({ ...filters, requestType: value })}>
              <SelectTrigger className="w-full lg:w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {Object.entries(EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => setFilters({ ...filters, status: value })}>
              <SelectTrigger className="w-full lg:w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="draft">Brouillon</SelectItem>
                <SelectItem value="submitted">Soumise</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.origin} onValueChange={(value) => setFilters({ ...filters, origin: value })}>
              <SelectTrigger className="w-full lg:w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes origines</SelectItem>
                {Object.entries(EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.employeeId} onValueChange={(value) => setFilters({ ...filters, employeeId: value })}>
              <SelectTrigger className="w-full lg:w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous employés</SelectItem>
                {employeeOptions.map((employee) => <SelectItem key={employee.employeeId} value={employee.employeeId}>{employee.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.dateCategory} onValueChange={(value) => setFilters({ ...filters, dateCategory: value })}>
              <SelectTrigger className="w-full lg:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes dates</SelectItem>
                <SelectItem value="today">Aujourd’hui</SelectItem>
                <SelectItem value="last_30">30 derniers jours</SelectItem>
                <SelectItem value="no_date">Sans date</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setFilters(initialFilters)}><X className="mr-2 h-4 w-4" />Réinitialiser</Button>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {filteredRequests.length} {filteredRequests.length > 1 ? "demandes trouvées" : "demande trouvée"}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {paginatedRequests.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Aucune demande financière trouvée.</CardContent></Card>
        ) : paginatedRequests.map((request) => {
          const expanded = expandedId === request.id;
          const editableByHr = request.requestOrigin === "hr_on_behalf" && request.status === "draft";
          return (
            <Card key={request.id} className="overflow-hidden border-slate-200 shadow-sm">
              <button
                type="button"
                className="flex w-full flex-col gap-3 border-l-4 border-l-blue-300 bg-slate-50/80 p-4 text-left transition hover:bg-slate-100 md:flex-row md:items-center md:justify-between"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : request.id)}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("font-bold", getStatusClass(request.status))}>{EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS[request.status]}</Badge>
                    <Badge variant="outline">{EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS[request.requestOrigin]}</Badge>
                    {request.activeContractWarning && <Badge className="bg-amber-100 text-amber-800">Contrat actif à vérifier</Badge>}
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-950">{request.employeeSnapshot.displayName}</p>
                    <p className="text-sm text-muted-foreground">
                      {request.employeeSnapshot.matricule} · {EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS[request.requestType]} · {formatMoney(request.requestedAmountCents, request.currency)}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    Date demande : {formatDate(request.requestDate)} · Proposition : {request.requestedRepaymentMonths ? `${request.requestedRepaymentMonths} mois` : "non définie"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-primary">{request.status === "draft" ? "Prochaine action : soumettre" : "Soumise pour traitement futur"}</span>
                  <ChevronDown className={cn("h-5 w-5 transition-transform", expanded && "rotate-180")} />
                </div>
              </button>

              {expanded && (
                <CardContent className="space-y-5 p-4 md:p-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Montant</p><p className="text-xl font-black">{formatMoney(request.requestedAmountCents, request.currency)}</p></div>
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Remboursement proposé</p><p className="font-bold">{request.requestedMonthlyAmountCents ? formatMoney(request.requestedMonthlyAmountCents, request.currency) : "Non défini"}{request.requestedRepaymentMonths ? ` · ${request.requestedRepaymentMonths} mois` : ""}</p></div>
                    <div className="rounded-xl border bg-white p-4">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Contrat actif</p>
                      {request.activeContractSummary?.href ? (
                        <Link
                          href={request.activeContractSummary.href}
                          className="mt-1 inline-flex items-center gap-1 rounded text-sm font-bold text-primary underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {request.activeContractSummary.displayLabel}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : (
                        <p className="font-bold">{getActiveContractLabel(request)}</p>
                      )}
                    </div>
                  </div>
                  {request.activeContractWarning && (
                    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      Aucun contrat actif n’a été détecté côté serveur. La demande reste enregistrée avec un avertissement.
                    </div>
                  )}
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Motif</p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{request.reason}</p>
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-3">
                    <p><span className="font-semibold">Créée par :</span> {request.createdByName || "—"} le {formatDate(request.createdAt)}</p>
                    <p><span className="font-semibold">Mise à jour par :</span> {request.updatedByName || "—"} le {formatDate(request.updatedAt)}</p>
                    <p><span className="font-semibold">Soumise par :</span> {request.submittedByName || "—"} {request.submittedAt ? `le ${formatDate(request.submittedAt)}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editableByHr && canUpdate && (
                      <Button variant="outline" onClick={(event) => { event.stopPropagation(); setSelectedRequest(request); setDialogMode("admin_edit"); }}>
                        <Edit className="mr-2 h-4 w-4" /> Modifier
                      </Button>
                    )}
                    {editableByHr && canSubmit && (
                      <Button onClick={(event) => { event.stopPropagation(); handleSubmitRequest(request); }} disabled={submittingId === request.id}>
                        {submittingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Soumettre
                      </Button>
                    )}
                    {!editableByHr && request.requestOrigin === "employee_self_service" && (
                      <p className="text-sm text-muted-foreground">Brouillon salarié visible en lecture seule pour RH dans ce batch.</p>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="border-slate-200 bg-slate-50/80">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{rangeStart}–{rangeEnd} sur {filteredRequests.length} demandes</span>
            <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
              <SelectTrigger className="h-9 w-[110px] bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={safePage === 1}>Première</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Précédente</Button>
            {getPageNumbers(safePage, totalPages).map((item, index) => item === "..."
              ? <span key={`dots-${index}`} className="px-2 py-1 text-muted-foreground">…</span>
              : <Button key={item} variant={item === safePage ? "default" : "outline"} size="sm" onClick={() => setPage(item)}>{item}</Button>)}
            <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>Suivante</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>Dernière</Button>
          </div>
        </CardContent>
      </Card>

      <EmployeeFinancialRequestDialog
        open={!!dialogMode}
        mode={dialogMode || "admin_create"}
        request={selectedRequest}
        employeeOptions={employeeOptions}
        onOpenChange={(open) => { if (!open) { setDialogMode(null); setSelectedRequest(null); } }}
        onSubmit={handleSave}
      />
    </div>
  );
}
