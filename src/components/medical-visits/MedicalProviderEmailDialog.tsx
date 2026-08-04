"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import {
  getMedicalProviderEmailPreviewAction,
  sendMedicalProviderAvailabilityRequestAction,
} from "@/app/entity/[entityId]/medical-visits/actions";

interface MedicalProviderEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  requestId: string | null;
  onSent: () => void;
}

export function MedicalProviderEmailDialog({
  open,
  onOpenChange,
  entityId,
  requestId,
  onSent,
}: MedicalProviderEmailDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    async function loadPreview() {
      if (!open) {
        setRecipient("");
        setSubject("");
        setMessage("");
        setSummary([]);
        return;
      }
      if (!user || !requestId) return;

      setLoading(true);
      try {
        const idToken = await user.getIdToken(true);
        const result = await getMedicalProviderEmailPreviewAction({ idToken, entityId, requestId });
        if (!result.success) throw new Error(result.error);
        setRecipient(result.preview.recipient);
        setSubject(result.preview.subject);
        setMessage(result.preview.message);
        setSummary(result.preview.summary);
      } catch (error: any) {
        toast({ variant: "destructive", title: "Erreur", description: error.message || "Prévisualisation indisponible." });
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    }
    loadPreview();
  }, [entityId, onOpenChange, open, requestId, toast, user]);

  const handleSend = async () => {
    if (!user || !requestId || sending) return;
    setSending(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await sendMedicalProviderAvailabilityRequestAction({
        idToken,
        entityId,
        requestId,
        subject,
        message,
      });
      if (!result.success) throw new Error(result.error);
      toast({
        title: result.alreadySent ? "E-mail déjà envoyé" : "E-mail envoyé",
        description: result.alreadySent
          ? "Un envoi identique avait déjà été enregistré."
          : "La demande de disponibilités a été transmise au médecin ou centre.",
      });
      onSent();
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Échec de l'envoi", description: error.message || "Impossible d'envoyer l'e-mail." });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-primary">
            <Mail className="h-6 w-6 text-accent" />
            Préparer l'e-mail au médecin
          </DialogTitle>
          <DialogDescription>
            Le destinataire est celui enregistré dans la demande. Aucun créneau ni visite individuelle n'est créé.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Destinataire</Label>
                <Input value={recipient} readOnly className="rounded-xl bg-muted/40 font-bold" />
              </div>
              <div className="space-y-2">
                <Label>Objet</Label>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} className="rounded-xl" maxLength={180} />
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Résumé de la demande</p>
              <ul className="space-y-1 text-sm">
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="min-h-[260px] rounded-xl font-mono text-sm"
                maxLength={8000}
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-2xl border bg-white p-4">
              <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Aperçu</p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{message}</div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Annuler</Button>
              <Button type="button" onClick={handleSend} disabled={sending || !subject.trim() || !message.trim()} className="rounded-xl font-black">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Envoyer la demande
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
