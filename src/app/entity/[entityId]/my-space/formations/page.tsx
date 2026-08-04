"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar, CheckCircle2, Clock, Download, Eye, FileCheck, GraduationCap, Loader2, MapPin, ShieldCheck, User } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  deriveTrainingParticipantValidityState,
  formatTrainingValidityExpiryLabel,
  formatTrainingValidityStateLabel,
  type TrainingValidityState,
} from "@/services/training-validity.service";
import type { TrainingAttendanceResponseStatus, TrainingParticipantStatus, TrainingResultStatus, TrainingSessionStatus } from "@/types/training";
import { getMyTrainingCertificateUrlAction, getMyTrainingHistoryAction, respondToTrainingInvitationAction, type MyTrainingHistoryItem } from "./actions";

const TRAINING_SESSION_STATUS_LABELS: Record<TrainingSessionStatus, string> = {
  draft: "Brouillon",
  scheduled: "Planifiée",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
  archived: "Archivée",
};

const TRAINING_PARTICIPANT_STATUS_LABELS: Record<TrainingParticipantStatus, string> = {
  planned: "Planifiée",
  attended: "Présent",
  absent: "Absent",
  completed: "Terminée",
  not_completed: "Non terminée",
  cancelled: "Annulée",
};

const TRAINING_RESULT_STATUS_LABELS: Record<TrainingResultStatus, string> = {
  passed: "Réussi",
  failed: "Échoué",
  attended: "Participation validée",
  not_attended: "Non présenté",
  not_required: "Non requis",
};

const DELIVERY_MODE_LABELS: Record<string, string> = {
  classroom: "Présentiel",
  online: "En ligne",
  blended: "Mixte",
  on_the_job: "Sur poste",
};

export default function MyTrainingPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();
  const [history, setHistory] = useState<MyTrainingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certificateLoadingId, setCertificateLoadingId] = useState<string | null>(null);
  const [responseLoadingId, setResponseLoadingId] = useState<string | null>(null);
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [declineDialogItem, setDeclineDialogItem] = useState<MyTrainingHistoryItem | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!entityId || !user) {
        if (!user) setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const idToken = await auth.currentUser?.getIdToken(true);
        if (!idToken) throw new Error("Session utilisateur indisponible. Veuillez vous reconnecter.");
        const result = await getMyTrainingHistoryAction({ entityId, idToken });
        if (!result.success) throw new Error(result.error);
        if (!cancelled) setHistory(result.history);
      } catch (err: any) {
        if (!cancelled) {
          setHistory([]);
          setError(err.message || "Impossible de charger vos formations.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [auth, entityId, user]);

  const groupedHistory = useMemo(() => ({
    upcoming: history.filter((item) => item.status === "scheduled"),
    active: history.filter((item) => item.status === "in_progress"),
    completed: history.filter((item) => item.status === "completed" || item.status === "archived"),
  }), [history]);

  const handleOpenCertificate = async (item: MyTrainingHistoryItem, download: boolean) => {
    if (!item.certificateDocumentId) return;
    setCertificateLoadingId(`${item.id}:${download ? "download" : "view"}`);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible. Veuillez vous reconnecter.");
      const result = await getMyTrainingCertificateUrlAction({
        idToken,
        entityId,
        sessionId: item.sessionId,
        download,
      });
      if (!result.success) throw new Error(result.error);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Document indisponible", description: err.message || "Impossible d'ouvrir l'attestation." });
    } finally {
      setCertificateLoadingId(null);
    }
  };

  const handleRespondToInvitation = async (
    item: MyTrainingHistoryItem,
    response: Exclude<TrainingAttendanceResponseStatus, "pending">,
    reason?: string
  ) => {
    if (responseLoadingId) return;
    setResponseLoadingId(item.id);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session utilisateur indisponible. Veuillez vous reconnecter.");
      const result = await respondToTrainingInvitationAction({
        idToken,
        entityId,
        sessionId: item.sessionId,
        response,
        declineReason: reason,
      });
      if (!result.success) throw new Error(result.error);

      setHistory((current) => current.map((historyItem) => (
        historyItem.id === item.id
          ? {
              ...historyItem,
              attendanceResponseStatus: result.attendanceResponseStatus,
              attendanceDeclineReason: result.attendanceDeclineReason ?? null,
            }
          : historyItem
      )));
      setEditingResponseId(null);
      setDeclineDialogItem(null);
      setDeclineReason("");
      toast({
        title: "Réponse enregistrée",
        description: response === "confirmed" ? "Votre présence est confirmée." : "Votre indisponibilité est enregistrée.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Réponse impossible", description: err.message || "Impossible d'enregistrer votre réponse." });
    } finally {
      setResponseLoadingId(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary p-3 rounded-2xl">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Mes formations</h1>
            <p className="text-muted-foreground text-sm font-medium">
              Consultez vos formations planifiées, vos résultats, vos attestations et vos échéances de renouvellement.
            </p>
          </div>
        </div>
      </header>

      {loading ? (
        <Card className="rounded-[2rem] border-primary/10">
          <CardContent className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary/30" />
            <p className="text-xs font-bold uppercase tracking-widest">Chargement de vos formations...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="rounded-[2rem] border-red-100 bg-red-50/60">
          <CardContent className="py-8 text-sm font-semibold text-red-700">{error}</CardContent>
        </Card>
      ) : history.length === 0 ? (
        <EmptyState message="Aucune formation ne vous est actuellement affectée." />
      ) : (
        <div className="space-y-6">
          <TrainingSection
            title="À venir"
            icon={Calendar}
            items={groupedHistory.upcoming}
            emptyMessage="Aucune formation à venir."
            certificateLoadingId={certificateLoadingId}
            onOpenCertificate={handleOpenCertificate}
            showAttendanceResponse
            responseLoadingId={responseLoadingId}
            editingResponseId={editingResponseId}
            onEditResponse={setEditingResponseId}
            onConfirmAttendance={(item) => handleRespondToInvitation(item, "confirmed")}
            onDeclineAttendance={(item) => {
              setDeclineDialogItem(item);
              setDeclineReason(item.attendanceDeclineReason || "");
            }}
          />
          <TrainingSection
            title="En cours"
            icon={Clock}
            items={groupedHistory.active}
            emptyMessage="Aucune formation en cours."
            certificateLoadingId={certificateLoadingId}
            onOpenCertificate={handleOpenCertificate}
          />
          <TrainingSection
            title="Terminées"
            icon={CheckCircle2}
            items={groupedHistory.completed}
            emptyMessage="Aucune formation terminée."
            certificateLoadingId={certificateLoadingId}
            onOpenCertificate={handleOpenCertificate}
          />
        </div>
      )}

      <Dialog open={!!declineDialogItem} onOpenChange={(open) => {
        if (!open && !responseLoadingId) {
          setDeclineDialogItem(null);
          setDeclineReason("");
        }
      }}>
        <DialogContent className="sm:max-w-[460px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Je ne pourrai pas participer</DialogTitle>
            <DialogDescription>
              Vous pouvez indiquer un motif d'indisponibilité. Ce motif reste informatif pour RH.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="decline-reason">Motif de l'indisponibilité</Label>
            <Textarea
              id="decline-reason"
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder="Ex. absence prévue, conflit d'agenda, contrainte opérationnelle..."
              className="min-h-[110px] rounded-2xl"
              disabled={!!responseLoadingId}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDeclineDialogItem(null);
                setDeclineReason("");
              }}
              disabled={!!responseLoadingId}
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => declineDialogItem && handleRespondToInvitation(declineDialogItem, "declined", declineReason)}
              disabled={!declineDialogItem || !!responseLoadingId}
              className="rounded-xl font-black"
            >
              {responseLoadingId ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmer mon indisponibilité
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrainingSection({
  title,
  icon: Icon,
  items,
  emptyMessage,
  certificateLoadingId,
  onOpenCertificate,
  showAttendanceResponse = false,
  responseLoadingId = null,
  editingResponseId = null,
  onEditResponse,
  onConfirmAttendance,
  onDeclineAttendance,
}: {
  title: string;
  icon: any;
  items: MyTrainingHistoryItem[];
  emptyMessage: string;
  certificateLoadingId: string | null;
  onOpenCertificate: (item: MyTrainingHistoryItem, download: boolean) => void;
  showAttendanceResponse?: boolean;
  responseLoadingId?: string | null;
  editingResponseId?: string | null;
  onEditResponse?: (itemId: string | null) => void;
  onConfirmAttendance?: (item: MyTrainingHistoryItem) => void;
  onDeclineAttendance?: (item: MyTrainingHistoryItem) => void;
}) {
  return (
    <Card className="rounded-[2rem] border-primary/10 shadow-sm overflow-hidden">
      <CardHeader className="bg-primary/[0.03] border-b">
        <CardTitle className="text-lg font-black text-primary flex items-center gap-2">
          <Icon className="w-5 h-5 text-accent" /> {title}
          <Badge variant="outline" className="ml-2 text-[10px] font-black">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="p-8 text-center text-xs font-bold text-muted-foreground">{emptyMessage}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className={showAttendanceResponse ? "min-w-[1320px]" : undefined}>
              <TableHeader>
                <TableRow className="bg-slate-50/70">
                  <TableHead>Formation</TableHead>
                  <TableHead>Date / période</TableHead>
                  <TableHead>Jours</TableHead>
                  <TableHead>Horaire</TableHead>
                  <TableHead>Durée</TableHead>
                  <TableHead>Lieu / mode</TableHead>
                  <TableHead>Formateur</TableHead>
                  <TableHead>Statut session</TableHead>
                  <TableHead>Participation</TableHead>
                  <TableHead>Résultat</TableHead>
                  <TableHead>Validité</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Attestation</TableHead>
                  {showAttendanceResponse && <TableHead>Votre réponse</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-[180px]">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-primary">{item.title}</span>
                        {item.providerName && <span className="text-[10px] font-semibold text-muted-foreground">{item.providerName}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{formatTrainingDateRange(item)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{formatTrainingDayCount(item)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{formatTrainingTimeRange(item)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{item.durationHours ? `${item.durationHours} h` : "—"}</TableCell>
                    <TableCell className="min-w-[140px] text-xs font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                        {item.location || getDeliveryModeLabel(item.deliveryMode)}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[130px] text-xs font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        {item.trainerName || "Formateur non renseigné"}
                      </span>
                    </TableCell>
                    <TableCell>{renderSimpleBadge(getTrainingSessionStatusLabel(item.status))}</TableCell>
                    <TableCell>{renderSimpleBadge(getTrainingParticipantStatusLabel(item.participantStatus))}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{getTrainingResultStatusLabel(item.resultStatus)}</TableCell>
                    <TableCell>{getTrainingValidityBadge(item)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold">{getTrainingValidityExpiryLabel(item)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.certificateDocumentId ? (
                        <div className="flex flex-col gap-2">
                          <span className="inline-flex items-center gap-1.5 text-green-700 font-bold text-[10px] uppercase">
                            <FileCheck className="w-3.5 h-3.5" /> Jointe
                          </span>
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label="Visualiser l’attestation"
                              title="Visualiser l’attestation"
                              disabled={certificateLoadingId === `${item.id}:view`}
                              onClick={() => onOpenCertificate(item, false)}
                              className="h-7 w-7 rounded-lg p-0"
                            >
                              {certificateLoadingId === `${item.id}:view` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label="Télécharger l’attestation"
                              title="Télécharger l’attestation"
                              disabled={certificateLoadingId === `${item.id}:download`}
                              onClick={() => onOpenCertificate(item, true)}
                              className="h-7 w-7 rounded-lg p-0"
                            >
                              {certificateLoadingId === `${item.id}:download` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">Non jointe</span>
                      )}
                    </TableCell>
                    {showAttendanceResponse && (
                      <TableCell className="min-w-[220px]">
                        <AttendanceResponseCell
                          item={item}
                          loading={responseLoadingId === item.id}
                          editing={editingResponseId === item.id}
                          onEdit={() => onEditResponse?.(item.id)}
                          onCancelEdit={() => onEditResponse?.(null)}
                          onConfirm={() => onConfirmAttendance?.(item)}
                          onDecline={() => onDeclineAttendance?.(item)}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceResponseCell({
  item,
  loading,
  editing,
  onEdit,
  onCancelEdit,
  onConfirm,
  onDecline,
}: {
  item: MyTrainingHistoryItem;
  loading: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const status = item.attendanceResponseStatus || "pending";
  const canRespond = item.status === "scheduled" && !hasTrainingSessionStarted(item);
  const showActions = canRespond && (status === "pending" || editing);

  if (showActions) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-xl text-[11px] font-black"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Je participerai
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-xl text-[11px] font-bold"
            disabled={loading}
            onClick={onDecline}
          >
            Je ne pourrai pas participer
          </Button>
        </div>
        {editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 self-start rounded-xl text-[10px] font-bold"
            disabled={loading}
            onClick={onCancelEdit}
          >
            Annuler
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {getAttendanceResponseBadge(status)}
      {status === "declined" && item.attendanceDeclineReason && (
        <span className="max-w-[220px] text-[10px] font-semibold text-muted-foreground">
          {item.attendanceDeclineReason}
        </span>
      )}
      {canRespond && status !== "pending" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-xl text-[10px] font-bold"
          disabled={loading}
          onClick={onEdit}
        >
          Modifier ma réponse
        </Button>
      )}
    </div>
  );
}

function getAttendanceResponseBadge(status: TrainingAttendanceResponseStatus | "pending" | null | undefined) {
  const normalized = status || "pending";
  const labels: Record<TrainingAttendanceResponseStatus, string> = {
    pending: "En attente de réponse",
    confirmed: "Présence confirmée",
    declined: "Indisponible",
  };
  const classes: Record<TrainingAttendanceResponseStatus, string> = {
    pending: "bg-slate-50 text-slate-600 border-slate-200",
    confirmed: "bg-green-50 text-green-700 border-green-200",
    declined: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={cn("text-[10px] font-black whitespace-nowrap", classes[normalized])}>
      {labels[normalized]}
    </Badge>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="rounded-[2rem] border-dashed border-slate-200 bg-slate-50/40">
      <CardContent className="py-16 flex flex-col items-center justify-center gap-3 text-center">
        <GraduationCap className="w-8 h-8 text-slate-300" />
        <p className="text-sm font-bold text-slate-500">{message}</p>
      </CardContent>
    </Card>
  );
}

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLocalDateTime(dateValue?: string | null, timeValue?: string | null) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasTrainingSessionStarted(item: MyTrainingHistoryItem) {
  const start = parseLocalDateTime(item.startDate, item.startTime);
  return start ? Date.now() >= start.getTime() : false;
}

function formatDateOnly(value?: string | null) {
  const date = parseDateOnly(value);
  if (!date) return "—";
  return format(date, "dd/MM/yyyy", { locale: fr });
}

function formatTrainingDateRange(item: MyTrainingHistoryItem) {
  const startLabel = formatDateOnly(item.startDate);
  if (!item.endDate || item.endDate === item.startDate) return startLabel;
  return `${startLabel} – ${formatDateOnly(item.endDate)}`;
}

function calculateInclusiveDayCount(startDate?: string | null, endDate?: string | null) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate || startDate);
  if (!start || !end) return null;
  const count = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Number.isFinite(count) && count > 0 ? count : null;
}

function formatTrainingDayCount(item: MyTrainingHistoryItem) {
  const count = calculateInclusiveDayCount(item.startDate, item.endDate || item.startDate);
  if (!count) return "—";
  return `${count} ${count === 1 ? "jour" : "jours"}`;
}

function formatTrainingTimeRange(item: MyTrainingHistoryItem) {
  if (item.startTime && item.endTime) return `${item.startTime}–${item.endTime}`;
  if (item.startTime) return `Début ${item.startTime}`;
  if (item.endTime) return `Fin ${item.endTime}`;
  return "—";
}

function getDeliveryModeLabel(value?: string | null) {
  if (!value) return "Non renseigné";
  return DELIVERY_MODE_LABELS[value] || "Non renseigné";
}

function getTrainingSessionStatusLabel(status: MyTrainingHistoryItem["status"]) {
  if (status in TRAINING_SESSION_STATUS_LABELS) {
    return TRAINING_SESSION_STATUS_LABELS[status as TrainingSessionStatus];
  }
  return "—";
}

function getTrainingParticipantStatusLabel(status?: TrainingParticipantStatus | null) {
  return status ? TRAINING_PARTICIPANT_STATUS_LABELS[status] : "—";
}

function getTrainingResultStatusLabel(status?: TrainingResultStatus | null) {
  return status ? TRAINING_RESULT_STATUS_LABELS[status] : "À renseigner";
}

function getTrainingValidityState(item: MyTrainingHistoryItem) {
  return deriveTrainingParticipantValidityState({
    participantStatus: item.participantStatus || "planned",
    resultStatus: item.resultStatus ?? null,
    validityRequired: item.validityRequired ?? null,
    validityStartDate: item.validityStartDate ?? null,
    validityEndDate: item.validityEndDate ?? null,
    renewalModeSnapshot: item.renewalModeSnapshot ?? null,
    validityWarningDaysSnapshot: item.validityWarningDaysSnapshot ?? null,
    renewedBySessionId: item.renewedBySessionId ?? null,
  }, {
    renewalMode: item.renewalMode ?? null,
    renewalRequired: item.renewalRequired ?? null,
  });
}

function getTrainingValidityBadge(item: MyTrainingHistoryItem) {
  const state = getTrainingValidityState(item);
  const classes: Record<TrainingValidityState, string> = {
    non_applicable: "bg-slate-50 text-slate-500 border-slate-200",
    pending_result: "bg-blue-50 text-blue-700 border-blue-200",
    awaiting_final_validation: "bg-indigo-50 text-indigo-700 border-indigo-200",
    not_acquired: "bg-red-50 text-red-700 border-red-200",
    policy_missing: "bg-amber-50 text-amber-700 border-amber-200",
    not_recorded: "bg-amber-50 text-amber-700 border-amber-200",
    valid: "bg-green-50 text-green-700 border-green-200",
    renewal_due: "bg-orange-50 text-orange-700 border-orange-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    renewed: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return <Badge variant="outline" className={cn("text-[10px] font-black whitespace-nowrap", classes[state])}>{formatTrainingValidityStateLabel(state)}</Badge>;
}

function getTrainingValidityExpiryLabel(item: MyTrainingHistoryItem) {
  const state = getTrainingValidityState(item);
  return formatTrainingValidityExpiryLabel({
    participant: item,
    state,
    sessionPolicy: item,
    formatDate: formatDateOnly,
  });
}

function renderSimpleBadge(label: string) {
  return <Badge variant="outline" className="text-[10px] font-black whitespace-nowrap">{label}</Badge>;
}
