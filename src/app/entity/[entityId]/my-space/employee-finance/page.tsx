"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  Edit,
  HandCoins,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth, useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS,
  EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS,
  EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS,
  type EmployeeFinancialRequestDto,
  type EmployeeFinancialRequestStatus,
} from "@/types/employee-finance";
import {
  createMyEmployeeFinancialRequestAction,
  getMyEmployeeFinancialRequestsAction,
  submitMyEmployeeFinancialRequestAction,
  updateMyEmployeeFinancialRequestDraftAction,
} from "./actions";
import {
  EmployeeFinancialRequestDialog,
  type EmployeeFinancialRequestDialogPayload,
} from "@/components/employee-finance/EmployeeFinancialRequestDialog";

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

function getActiveContractLabel(request: EmployeeFinancialRequestDto) {
  if (request.activeContractSummary?.displayLabel) return request.activeContractSummary.displayLabel;
  if (request.activeContractId) return "Contrat actif introuvable";
  return "Aucun contrat actif";
}

export default function MyEmployeeFinancePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const auth = useAuth();
  const { user, loading: userLoading } = useUser();
  const { toast } = useToast();
  const [requests, setRequests] = useState<EmployeeFinancialRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"employee_create" | "employee_edit" | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<EmployeeFinancialRequestDto | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (userLoading) return;
    if (!user || !entityId) {
      setLoading(false);
      setError("Session utilisateur indisponible.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible.");
      const result = await getMyEmployeeFinancialRequestsAction({ entityId, idToken });
      if (!result.success) throw new Error(result.error);
      setRequests(result.requests);
    } catch (err: any) {
      setRequests([]);
      setError(err.message || "Impossible de charger vos demandes financières.");
    } finally {
      setLoading(false);
    }
  }, [auth, entityId, user, userLoading]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const summary = useMemo(() => ({
    total: requests.length,
    drafts: requests.filter((request) => request.status === "draft").length,
    submitted: requests.filter((request) => request.status === "submitted").length,
    hrCreated: requests.filter((request) => request.requestOrigin === "hr_on_behalf").length,
  }), [requests]);

  const sortedRequests = useMemo(() => [...requests].sort((a, b) => {
    const statusWeight = (status: string) => status === "draft" ? 1 : status === "submitted" ? 2 : 3;
    const weightDiff = statusWeight(a.status) - statusWeight(b.status);
    if (weightDiff !== 0) return weightDiff;
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  }), [requests]);

  async function handleSave(payload: EmployeeFinancialRequestDialogPayload) {
    const idToken = await auth.currentUser?.getIdToken(true);
    if (!idToken) return { success: false as const, error: "Session utilisateur indisponible." };
    const result = dialogMode === "employee_edit" && selectedRequest
      ? await updateMyEmployeeFinancialRequestDraftAction({ entityId, idToken, requestId: selectedRequest.id, ...payload })
      : await createMyEmployeeFinancialRequestAction({ entityId, idToken, ...payload });
    if (!result.success) return { success: false as const, error: result.error };
    toast({ title: dialogMode === "employee_edit" ? "Brouillon mis à jour" : "Demande créée" });
    await loadRequests();
    setExpandedId(result.requestId);
    return { success: true as const };
  }

  async function handleSubmit(request: EmployeeFinancialRequestDto) {
    if (submittingId) return;
    setSubmittingId(request.id);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible.");
      const result = await submitMyEmployeeFinancialRequestAction({ entityId, idToken, requestId: request.id });
      if (!result.success) throw new Error(result.error);
      toast({ title: result.alreadySubmitted ? "Demande déjà soumise" : "Demande soumise" });
      await loadRequests();
      setExpandedId(request.id);
    } catch (err: any) {
      toast({ title: "Soumission impossible", description: err.message || "Veuillez réessayer.", variant: "destructive" });
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading || userLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6 text-red-800">{error}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-widest text-blue-700">
            <HandCoins className="mr-2 h-4 w-4" />
            Espace employé
          </div>
          <h1 className="text-3xl font-black tracking-tight text-primary">Mes demandes et remboursements</h1>
          <p className="text-muted-foreground">
            Consultez vos demandes d’avances, de prêts internes ou de dettes employé.
          </p>
        </div>
        <Button onClick={() => { setSelectedRequest(null); setDialogMode("employee_create"); }}>
          <Plus className="mr-2 h-4 w-4" />
          Nouvelle demande
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-blue-100 bg-blue-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-blue-700">Total</p><p className="text-2xl font-black">{summary.total}</p></CardContent></Card>
        <Card className="border-slate-100 bg-slate-50"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-slate-600">Brouillons</p><p className="text-2xl font-black">{summary.drafts}</p></CardContent></Card>
        <Card className="border-indigo-100 bg-indigo-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-indigo-700">Soumises</p><p className="text-2xl font-black">{summary.submitted}</p></CardContent></Card>
        <Card className="border-amber-100 bg-amber-50/60"><CardContent className="p-4"><p className="text-xs font-bold uppercase text-amber-700">Créées par RH</p><p className="text-2xl font-black">{summary.hrCreated}</p></CardContent></Card>
      </div>

      <div className="space-y-3">
        {sortedRequests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Aucune demande financière pour le moment.
            </CardContent>
          </Card>
        ) : sortedRequests.map((request) => {
          const expanded = expandedId === request.id;
          const editable = request.requestOrigin === "employee_self_service" && request.status === "draft";
          return (
            <Card key={request.id} className="overflow-hidden border-slate-200 shadow-sm">
              <button
                type="button"
                className="flex w-full flex-col gap-3 border-l-4 border-l-blue-300 bg-slate-50/80 p-4 text-left transition hover:bg-slate-100 md:flex-row md:items-center md:justify-between"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : request.id)}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("font-bold", getStatusClass(request.status))}>{EMPLOYEE_FINANCIAL_REQUEST_STATUS_LABELS[request.status]}</Badge>
                    <Badge variant="outline">{EMPLOYEE_FINANCIAL_REQUEST_ORIGIN_LABELS[request.requestOrigin]}</Badge>
                    {request.activeContractWarning && <Badge className="bg-amber-100 text-amber-800">Contrat actif à vérifier</Badge>}
                  </div>
                  <p className="text-lg font-black text-slate-950">{EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS[request.requestType]}</p>
                  <p className="text-sm font-medium text-muted-foreground">
                    {formatMoney(request.requestedAmountCents, request.currency)} · Demande du {formatDate(request.requestDate)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-primary">{editable ? "Brouillon modifiable" : "Lecture seule"}</span>
                  <ChevronDown className={cn("h-5 w-5 transition-transform", expanded && "rotate-180")} />
                </div>
              </button>

              {expanded && (
                <CardContent className="space-y-5 p-4 md:p-6">
                  {request.activeContractWarning && (
                    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      Aucun contrat actif n’a été détecté. Votre demande reste enregistrée avec un avertissement RH.
                    </div>
                  )}
                  {request.requestOrigin === "hr_on_behalf" && (
                    <div className="flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      Cette demande a été créée par RH. Elle est visible ici en lecture seule dans ce batch.
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Montant</p><p className="text-xl font-black">{formatMoney(request.requestedAmountCents, request.currency)}</p></div>
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Remboursement proposé</p><p className="font-bold">{request.requestedMonthlyAmountCents ? formatMoney(request.requestedMonthlyAmountCents, request.currency) : "Non défini"}{request.requestedRepaymentMonths ? ` · ${request.requestedRepaymentMonths} mois` : ""}</p></div>
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Première période</p><p className="font-bold">{request.requestedFirstInstallmentPeriod || "Non définie"}</p></div>
                    <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Contrat actif</p><p className="font-bold">{getActiveContractLabel(request)}</p></div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Motif</p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{request.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editable && (
                      <>
                        <Button variant="outline" onClick={(event) => { event.stopPropagation(); setSelectedRequest(request); setDialogMode("employee_edit"); }}>
                          <Edit className="mr-2 h-4 w-4" /> Modifier
                        </Button>
                        <Button onClick={(event) => { event.stopPropagation(); handleSubmit(request); }} disabled={submittingId === request.id}>
                          {submittingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                          Soumettre
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <EmployeeFinancialRequestDialog
        open={!!dialogMode}
        mode={dialogMode || "employee_create"}
        request={selectedRequest}
        onOpenChange={(open) => { if (!open) { setDialogMode(null); setSelectedRequest(null); } }}
        onSubmit={handleSave}
      />
    </div>
  );
}
