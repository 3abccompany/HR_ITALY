"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar, CheckCircle2, Clock, Loader2, MapPin, Stethoscope } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, useUser } from "@/firebase";
import { cn } from "@/lib/utils";
import {
  MEDICAL_VISIT_TYPE_LABELS,
  type MedicalVisitStatus,
} from "@/types/medical-visit";
import { getMyMedicalVisitsAction, type MyMedicalVisitItem } from "./actions";

const MEDICAL_VISIT_STATUS_LABELS: Record<MedicalVisitStatus, string> = {
  scheduled: "Planifiée",
  completed: "Terminée",
  pending_result: "Résultat en attente",
  cancelled: "Annulée",
  archived: "Archivée",
};

function formatDate(value?: string | null) {
  if (!value) return "Non renseignée";
  try {
    return format(parseISO(value), "dd/MM/yyyy");
  } catch {
    return value;
  }
}

function formatDateTime(item: MyMedicalVisitItem) {
  const date = formatDate(item.visitDate);
  const time = item.visitStartTime && item.visitEndTime
    ? `${item.visitStartTime}–${item.visitEndTime}`
    : "Horaire à confirmer";
  return `${date} · ${time}`;
}

function statusVariant(status: MedicalVisitStatus) {
  if (status === "scheduled") return "default";
  if (status === "completed") return "secondary";
  if (status === "cancelled" || status === "archived") return "outline";
  return "secondary";
}

function statusBadgeClass(status: MedicalVisitStatus) {
  if (status === "scheduled") return "bg-blue-600 text-white hover:bg-blue-600";
  if (status === "completed") return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
  if (status === "pending_result") return "bg-amber-100 text-amber-800 hover:bg-amber-100";
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (status === "archived") return "border-slate-200 bg-slate-50 text-slate-600";
  return "";
}

function visitDateTimeValue(item: MyMedicalVisitItem) {
  return Date.parse(`${item.visitDate || ""}T${item.visitStartTime || "00:00"}`) || 0;
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="rounded-[2rem] border-dashed border-primary/20 bg-muted/20">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Stethoscope className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-bold text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function MedicalVisitCard({
  item,
  compact = false,
  tone = "upcoming",
}: {
  item: MyMedicalVisitItem;
  compact?: boolean;
  tone?: "next" | "upcoming" | "history";
}) {
  const toneClass = {
    next: "border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 shadow-lg shadow-blue-100/40",
    upcoming: "border-blue-100 bg-white shadow-sm",
    history: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50/50 shadow-sm",
  }[tone];
  const iconClass = {
    next: "bg-blue-600 text-white",
    upcoming: "bg-blue-100 text-blue-700",
    history: "bg-emerald-100 text-emerald-700",
  }[tone];

  return (
    <Card className={cn("rounded-[2rem] border", toneClass)}>
      <CardContent className={cn("space-y-4", compact ? "p-4" : "p-5 sm:p-6")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className={cn("mt-0.5 h-fit rounded-2xl p-2.5", iconClass)}>
              <Stethoscope className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={cn("font-black text-primary", tone === "next" ? "text-xl" : "text-base")}>
                {MEDICAL_VISIT_TYPE_LABELS[item.visitType] || "Visite médicale"}
              </p>
              <p className={cn("font-black", tone === "next" ? "text-lg text-blue-900" : "text-sm text-slate-700")}>
                {formatDateTime(item)}
              </p>
            </div>
          </div>
          <Badge variant={statusVariant(item.status)} className={cn("w-fit rounded-full px-3 py-1 font-black", statusBadgeClass(item.status))}>
            {MEDICAL_VISIT_STATUS_LABELS[item.status] || "Statut à confirmer"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm">
            <p className="text-xs font-black uppercase text-muted-foreground">Médecin / centre</p>
            <p className="font-bold text-slate-800">{item.providerName || "Non renseigné"}</p>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm">
            <p className="text-xs font-black uppercase text-muted-foreground">Lieu</p>
            <p className="break-words font-bold text-slate-800">{item.location || "Non renseigné"}</p>
          </div>
        </div>

        {item.instructions && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="text-xs font-black uppercase">Instructions</p>
            <p className="break-words">{item.instructions}</p>
          </div>
        )}

        {item.status === "completed" && (
          <p className="text-xs font-bold text-muted-foreground">
            Prochaine échéance médicale : {item.nextVisitDate ? formatDate(item.nextVisitDate) : "Non renseignée"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyMedicalVisitsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const auth = useAuth();
  const { user } = useUser();
  const [visits, setVisits] = useState<MyMedicalVisitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVisits() {
      if (!entityId || !user) {
        if (!user) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const idToken = await auth.currentUser?.getIdToken(true);
        if (!idToken) throw new Error("Session utilisateur indisponible. Veuillez vous reconnecter.");
        const result = await getMyMedicalVisitsAction({ entityId, idToken });
        if (!result.success) throw new Error(result.error);
        if (!cancelled) setVisits(result.visits);
      } catch (err: any) {
        if (!cancelled) {
          setVisits([]);
          setError(err.message || "Impossible de charger vos visites médicales.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVisits();

    return () => {
      cancelled = true;
    };
  }, [auth, entityId, user]);

  const now = Date.now();
  const upcoming = useMemo(() => visits
    .filter((item) => item.status === "scheduled" && visitDateTimeValue(item) >= now)
    .sort((a, b) => visitDateTimeValue(a) - visitDateTimeValue(b)), [now, visits]);
  const history = useMemo(() => visits
    .filter((item) => ["completed", "cancelled", "archived", "pending_result"].includes(item.status))
    .sort((a, b) => visitDateTimeValue(b) - visitDateTimeValue(a)), [visits]);
  const nextAppointment = upcoming[0] || null;
  const completedVisits = visits.filter((item) => item.status === "completed");
  const nextExpiry = visits
    .filter((item) => item.nextVisitDate && Date.parse(item.nextVisitDate) >= now)
    .sort((a, b) => Date.parse(a.nextVisitDate || "") - Date.parse(b.nextVisitDate || ""))[0]?.nextVisitDate || null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 pb-24 sm:p-6 lg:p-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Stethoscope className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-primary">Mes visites médicales</h1>
            <p className="max-w-3xl text-sm font-medium text-muted-foreground">
              Consultez vos rendez-vous médicaux, votre historique et vos prochaines échéances.
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <Card className="rounded-[2rem] border-primary/10">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
            <p className="text-xs font-bold uppercase tracking-widest">Chargement de vos visites médicales...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="rounded-[2rem] border-red-100 bg-red-50/60">
          <CardContent className="py-8 text-sm font-semibold text-red-700">{error}</CardContent>
        </Card>
      ) : visits.length === 0 ? (
        <EmptyState message="Aucune visite médicale ne vous est actuellement affectée." />
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              tone="next"
              title="Prochaine visite"
              value={nextAppointment ? formatDate(nextAppointment.visitDate) : "Aucune"}
              detail={nextAppointment ? `${nextAppointment.visitStartTime || ""}–${nextAppointment.visitEndTime || ""}` : "Aucune visite planifiée"}
              icon={Calendar}
            />
            <SummaryCard
              tone="upcoming"
              title="Visites planifiées"
              value={String(upcoming.length)}
              detail={upcoming.length === 1 ? "rendez-vous à venir" : "rendez-vous à venir"}
              icon={Clock}
            />
            <SummaryCard
              tone="history"
              title="Visites terminées"
              value={String(completedVisits.length)}
              detail="historique disponible"
              icon={CheckCircle2}
            />
            <SummaryCard
              tone="expiry"
              title="Prochaine échéance médicale"
              value={nextExpiry ? formatDate(nextExpiry) : "À définir"}
              detail={nextExpiry ? "date communiquée après résultat" : "À définir après résultat"}
              icon={MapPin}
            />
          </div>

          <section className="space-y-4">
            <Card className="overflow-hidden rounded-[2rem] border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 shadow-xl shadow-blue-100/40">
              <CardHeader className="border-b border-blue-100/70 bg-white/60">
                <CardTitle className="flex flex-col gap-2 text-primary sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 text-xl font-black">
                    <Calendar className="h-5 w-5 text-blue-700" />
                    Prochain rendez-vous médical
                  </span>
                  <span className="text-xs font-bold uppercase tracking-widest text-blue-700">Prioritaire</span>
                </CardTitle>
                <p className="text-sm font-medium text-muted-foreground">
                  Le prochain rendez-vous planifié à partir des informations communiquées par le médecin ou le centre.
                </p>
              </CardHeader>
              <CardContent>
                {nextAppointment ? (
                  <MedicalVisitCard item={nextAppointment} tone="next" />
                ) : (
                  <EmptyState message="Aucune visite médicale planifiée." />
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4 rounded-[2rem] border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-xl font-black text-blue-900">
                <Clock className="h-5 w-5 text-blue-700" />
                Visites planifiées
              </h2>
              <p className="text-sm font-medium text-blue-900/70">Tous vos rendez-vous médicaux à venir.</p>
            </div>
            {upcoming.length === 0 ? (
              <EmptyState message="Aucune visite médicale planifiée." />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {upcoming.map((item) => <MedicalVisitCard key={item.id} item={item} compact tone="upcoming" />)}
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-[2rem] border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-xl font-black text-emerald-900">
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                Historique
              </h2>
              <p className="text-sm font-medium text-emerald-900/70">Visites terminées, annulées ou archivées.</p>
            </div>
            {history.length === 0 ? (
              <EmptyState message="Aucune visite médicale terminée." />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {history.map((item) => <MedicalVisitCard key={item.id} item={item} compact tone="history" />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  tone,
  title,
  value,
  detail,
  icon: Icon,
}: {
  tone: "next" | "upcoming" | "history" | "expiry";
  title: string;
  value: string;
  detail: string;
  icon: typeof Calendar;
}) {
  const toneClass = {
    next: "border-blue-200 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-200",
    upcoming: "border-blue-100 bg-blue-50 text-blue-950 shadow-sm",
    history: "border-emerald-100 bg-emerald-50 text-emerald-950 shadow-sm",
    expiry: "border-amber-100 bg-amber-50 text-amber-950 shadow-sm",
  }[tone];
  const iconClass = {
    next: "bg-white/15 text-white",
    upcoming: "bg-blue-100 text-blue-700",
    history: "bg-emerald-100 text-emerald-700",
    expiry: "bg-amber-100 text-amber-700",
  }[tone];
  const mutedClass = tone === "next" ? "text-white/75" : "text-muted-foreground";
  const valueClass = tone === "next" ? "text-white" : "text-primary";

  return (
    <Card className={cn("rounded-[2rem] border", toneClass)}>
      <CardContent className="flex min-w-0 items-center gap-4 p-5">
        <div className={cn("rounded-2xl p-3", iconClass)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className={cn("text-xs font-black uppercase tracking-widest", mutedClass)}>{title}</p>
          <p className={cn("truncate text-2xl font-black", valueClass)}>{value}</p>
          <p className={cn("text-xs font-bold", mutedClass)}>{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
