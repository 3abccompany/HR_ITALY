"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Send, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import {
  getMedicalEmployeeInvitationsPreviewAction,
  sendMedicalEmployeeInvitationsAction,
} from "@/app/entity/[entityId]/medical-visits/actions";

type InvitationPreviewRow = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  medicalVisitId: string;
  visitDateLabel: string;
  visitStartTime: string;
  visitEndTime: string;
  providerName: string;
  location: string;
  instructions: string | null;
  hasActiveAccount: boolean;
  hasValidEmail: boolean;
  emailRecipient: string | null;
  classification: "notification_and_email" | "notification_only" | "email_only" | "manual_contact_required";
  classificationLabel: string;
  eligibilityStatus: string;
  eligibilityLabel: string;
  eligible: boolean;
  notificationStatus: string;
  emailStatus: string;
  sampleMessage: string;
  deliveryResultStatus?: string;
  notificationDeliveryStatus?: string;
  emailDeliveryStatus?: string;
  error?: string | null;
};

interface MedicalEmployeeInvitationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  requestId: string | null;
  onSent: () => void;
}

const channelLabel: Record<string, string> = {
  planned: "Prévu",
  sent: "Envoyé",
  already_sent: "Déjà envoyé",
  failed: "Échec",
  skipped: "Ignoré",
  not_applicable: "Non applicable",
  not_sent: "Non envoyé",
};

export function MedicalEmployeeInvitationsDialog({
  open,
  onOpenChange,
  entityId,
  requestId,
  onSent,
}: MedicalEmployeeInvitationsDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<InvitationPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    async function loadPreview() {
      if (!open) {
        setRows([]);
        setSent(false);
        return;
      }
      if (!user || !requestId) return;
      setLoading(true);
      try {
        const idToken = await user.getIdToken(true);
        const result = await getMedicalEmployeeInvitationsPreviewAction({ idToken, entityId, requestId });
        if (!result.success) throw new Error(result.error);
        setRows(result.rows as InvitationPreviewRow[]);
      } catch (error: any) {
        toast({ variant: "destructive", title: "Erreur", description: error.message || "Prévisualisation indisponible." });
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    }
    loadPreview();
  }, [entityId, onOpenChange, open, requestId, toast, user]);

  const summary = useMemo(() => ({
    eligible: rows.filter((row) => row.eligible).length,
    skipped: rows.filter((row) => !row.eligible).length,
    notificationAndEmail: rows.filter((row) => row.eligible && row.classification === "notification_and_email").length,
    notificationOnly: rows.filter((row) => row.eligible && row.classification === "notification_only").length,
    emailOnly: rows.filter((row) => row.eligible && row.classification === "email_only").length,
    manualContact: rows.filter((row) => row.eligible && row.classification === "manual_contact_required").length,
    failures: rows.filter((row) => row.eligible && (row.notificationDeliveryStatus === "failed" || row.emailDeliveryStatus === "failed")).length,
  }), [rows]);

  const handleSend = async () => {
    if (!user || !requestId || sending) return;
    setSending(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await sendMedicalEmployeeInvitationsAction({
        idToken,
        entityId,
        requestId,
        resendMode: "retry_failed_or_unsent",
      });
      if (!result.success) throw new Error(result.error);
      setRows(result.rows as InvitationPreviewRow[]);
      setSent(true);
      toast({
        title: "Convocations traitées",
        description: `${result.summary.eligibleCount} éligible(s), ${result.summary.skippedCount} ignorée(s), ${result.summary.emailSentCount} e-mail(s), ${result.summary.notificationSentCount} notification(s).`,
      });
      onSent();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Échec de l'envoi", description: error.message || "Impossible d'envoyer les convocations." });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-primary">
            <UserCheck className="h-6 w-6 text-accent" />
            Notifier les collaborateurs
          </DialogTitle>
          <DialogDescription>
            Chaque collaborateur reçoit uniquement son propre rendez-vous. Aucun résultat médical ni certificat n'est inclus.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-6">
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.eligible}</p>
                <p className="font-bold text-muted-foreground">éligibles</p>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.skipped}</p>
                <p className="font-bold text-muted-foreground">ignorées</p>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.notificationAndEmail}</p>
                <p className="font-bold text-muted-foreground">notification + e-mail</p>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.notificationOnly}</p>
                <p className="font-bold text-muted-foreground">notification seule</p>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.emailOnly}</p>
                <p className="font-bold text-muted-foreground">e-mail seul</p>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="font-black text-primary">{summary.manualContact}</p>
                <p className="font-bold text-muted-foreground">contact manuel</p>
              </div>
            </div>

            {rows[0]?.sampleMessage && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="mb-1 text-xs font-black uppercase">Exemple de message salarié</p>
                <p>{rows[0].sampleMessage}</p>
              </div>
            )}

            <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
              {rows.map((row) => (
                <div key={row.employeeId} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="font-black text-primary">{row.employeeDisplayNameSnapshot}</p>
                      <p className="text-xs font-bold text-muted-foreground">{row.employeeCodeSnapshot}</p>
                      <p className="mt-2 text-sm font-bold">
                        {row.visitDateLabel} · {row.visitStartTime}–{row.visitEndTime}
                      </p>
                      <p className="text-sm text-muted-foreground">{row.providerName} · {row.location}</p>
                      {row.instructions && <p className="mt-1 text-xs text-muted-foreground">{row.instructions}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <Badge variant={row.classification === "manual_contact_required" ? "destructive" : "secondary"} className="rounded-full">
                        {row.eligible ? row.classificationLabel : row.eligibilityLabel}
                      </Badge>
                      {row.eligible && (
                        <Badge variant="outline" className="rounded-full">
                          {row.eligibilityLabel}
                        </Badge>
                      )}
                      <Badge variant="outline" className="rounded-full">
                        Compte : {row.hasActiveAccount ? "actif" : "absent"}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        E-mail : {row.hasValidEmail ? row.emailRecipient : "absent"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/30 p-2">
                      <span className="font-black">Notification : </span>
                      {row.eligible ? (channelLabel[row.notificationDeliveryStatus || row.notificationStatus] || row.notificationStatus) : "Ignorée"}
                    </div>
                    <div className="rounded-xl bg-muted/30 p-2">
                      <span className="font-black">E-mail : </span>
                      {row.eligible ? (channelLabel[row.emailDeliveryStatus || row.emailStatus] || row.emailStatus) : "Ignoré"}
                    </div>
                  </div>
                  {row.error && <p className="mt-2 text-xs font-bold text-destructive">{row.error}</p>}
                </div>
              ))}
            </div>

            {sent && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-black">Résultat de l'envoi</p>
                <p>{summary.eligible} convocation(s) éligible(s), {summary.skipped} ignorée(s), {summary.failures} échec(s) retryable(s).</p>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
                {sent ? "Fermer" : "Annuler"}
              </Button>
              <Button type="button" onClick={handleSend} disabled={sending || rows.length === 0} className="rounded-xl font-black">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Envoyer les convocations
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
