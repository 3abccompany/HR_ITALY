
"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, ShieldCheck, User, Briefcase, 
  MapPin, Calendar, Info, Scale, Euro, Save, AlertCircle,
  Clock, Undo2, ArrowRight, Ban, CheckCircle2, XCircle,
  FileSignature, Building2, UserCircle, Send, Eye,
  FileText, ExternalLink, Search, History, UserPlus,
  ClipboardList, CheckCircle, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useDoc, useCollection, useUser } from "@/firebase";
import { doc, DocumentReference, collection, query, where, getDocs } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { updateEmploymentOffer, initiateOfferSend } from "@/services/employment-offer.service";
import { convertOfferToEmployeeAction } from "@/services/employee-conversion.service";
import { ensurePreHireDossier, sendDocumentRequestEmail, updateDocumentStatus } from "@/services/pre-hire-dossier.service";
import { PreHireDossier, PreHireDocument } from "@/types/pre-hire-dossier";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import Link from "next/link";

const CONTRACT_TYPES = ["Tempo indeterminato", "Tempo determinato", "Apprendistato", "Stage / Tirocinio", "Altro"];

export default function EditEmploymentOfferPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const offerId = params.offerId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const offerRef = useMemo(() => db ? (doc(db, `entities/${entityId}/employmentOffers`, offerId) as DocumentReference<EmploymentOffer>) : null, [db, entityId, offerId]);
  const { data: offer, loading: loadingOffer } = useDoc<EmploymentOffer>(offerRef);

  // Pre-Hire Dossier Query
  const dossierQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/preHireDossiers`), where("employmentOfferId", "==", offerId)) : null, [db, entityId, offerId]);
  const { data: dossiers, loading: loadingDossiers } = useCollection<PreHireDossier>(dossierQuery);
  const dossier = dossiers?.[0];

  // Dossier Checklist Query
  const checklistQuery = useMemo(() => dossier ? collection(db!, `entities/${entityId}/preHireDossiers/${dossier.dossierId}/checklist`) : null, [db, entityId, dossier]);
  const { data: checklist, loading: loadingChecklist } = useCollection<PreHireDocument>(checklistQuery);

  const [formData, setFormData] = useState<Partial<EmploymentOffer>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
  const [rejectItem, setRejectItem] = useState<{ id: string, reason: string } | null>(null);

  const [numInputs, setNumericInputs] = useState({ proposedGrossMonthly: "0", proposedGrossHourly: "0", monthlyPayments: "13", weeklyHours: "40", trialPeriodDays: "30" });

  useEffect(() => {
    if (offer) {
      setFormData(offer);
      setNumericInputs({
        proposedGrossMonthly: (offer.proposedGrossMonthly ?? 0).toString(),
        proposedGrossHourly: (offer.proposedGrossHourly ?? 0).toString(),
        monthlyPayments: (offer.monthlyPayments ?? 13).toString(),
        weeklyHours: (offer.weeklyHours ?? 40).toString(),
        trialPeriodDays: (offer.trialPeriodDays ?? 30).toString()
      });
    }
  }, [offer]);

  const handleSave = async (nextStatus?: EmploymentOfferStatus) => {
    if (!user || !entityId || !offerId) return;
    setSaving(true);
    try {
      await updateEmploymentOffer(entityId, offerId, { ...formData, status: nextStatus || offer?.status || 'draft' }, user.uid);
      toast({ title: "Enregistré" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleSend = async () => {
    if (!user || !entityId || !offerId) return;
    setSending(true);
    try {
      await initiateOfferSend(entityId, offerId, user.uid);
      toast({ title: "Envoyée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSending(false); }
  };

  const handleConvert = async () => {
    if (!user || !entityId || !offerId) return;
    setConverting(true);
    try {
      const result = await convertOfferToEmployeeAction({ entityId, offerId, actorUid: user.uid });
      if (result.success) {
        toast({ title: "Embauche réussie !" });
        setIsConvertDialogOpen(false);
      } else {
        toast({ variant: "destructive", title: "Conversion bloquée", description: result.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setConverting(false); }
  };

  const handleInitDossier = async () => {
    if (!user || !offer) return;
    setSaving(true);
    try {
      await ensurePreHireDossier(entityId, offer, user.uid);
      toast({ title: "Dossier initialisé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleSendDocRequest = async () => {
    if (!user || !dossier) return;
    setSaving(true);
    try {
      await sendDocumentRequestEmail(entityId, dossier.dossierId, user.uid);
      toast({ title: "Demande envoyée au candidat" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleUpdateDoc = async (itemId: string, status: any, reason?: string) => {
    if (!user || !dossier) return;
    try {
      await updateDocumentStatus(entityId, dossier.dossierId, itemId, status, user.uid, reason);
      toast({ title: "Document mis à jour" });
      setRejectItem(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!offer) return <div className="p-8 text-center">Proposition introuvable.</div>;

  const isAccepted = offer.status === 'accepted';
  const isConverted = offer.conversionStatus === 'converted';

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="space-y-0.5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Proposition : {offer.candidateDisplayName}</h1>
              {getStatusBadge(offer.status)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isConverted && (
            <>
              <Button variant="outline" onClick={() => handleSave()} disabled={saving} className="gap-2 bg-white"><Save className="w-4 h-4" /> Enregistrer</Button>
              {offer.status === 'ready_to_send' && <Button onClick={handleSend} disabled={sending} className="gap-2 bg-primary text-white font-black"><Send className="w-4 h-4" /> Envoyer</Button>}
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* 7K-F-A Compliance Dossier Card */}
          {isAccepted && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl", dossier?.readyForConversion ? "border-green-100 bg-green-50/10" : "border-primary/10")}>
               <CardHeader className="bg-primary/5 border-b py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                    <ClipboardList className="w-4 h-4" /> Dossier d’embauche & Compliance
                  </CardTitle>
                  {dossier && <Badge variant="secondary" className="bg-white text-[9px] uppercase font-black">{dossier.status.replace(/_/g, ' ')}</Badge>}
               </CardHeader>
               <CardContent className="p-8 space-y-6">
                  {!dossier ? (
                    <div className="flex flex-col items-center py-6 text-center space-y-4">
                       <AlertTriangle className="w-10 h-10 text-orange-400" />
                       <p className="text-sm font-medium text-slate-600">Le dossier de collecte n'est pas encore initialisé.</p>
                       <Button onClick={handleInitDossier} disabled={saving} className="gap-2"><Plus className="w-4 h-4" /> Initialiser le dossier</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                         <div className="space-y-1">
                            <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">État du dossier</p>
                            <div className="flex items-center gap-2">
                               {dossier.readyForConversion ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5 text-orange-500" />}
                               <span className="font-bold text-slate-800">{dossier.readyForConversion ? "Prêt pour l'embauche" : "Documents en attente"}</span>
                            </div>
                         </div>
                         <Button variant="outline" size="sm" onClick={handleSendDocRequest} disabled={saving} className="gap-2">
                            <Send className="w-3.5 h-3.5" /> Envoyer demande docs
                         </Button>
                      </div>

                      <div className="space-y-3">
                         <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-1">Checklist documents obligatoires (Italie)</p>
                         <div className="grid gap-3">
                            {loadingChecklist ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : checklist?.map(item => (
                              <div key={item.itemId} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm group">
                                 <div className="flex items-center gap-3">
                                    <div className={cn("p-2 rounded-xl", 
                                       item.status === 'approved' ? "bg-green-100 text-green-600" : 
                                       item.status === 'rejected' ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400")}>
                                       <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                       <p className="text-xs font-bold text-slate-700">{item.label}</p>
                                       <p className="text-[10px] text-muted-foreground uppercase">{item.status}</p>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdateDoc(item.itemId, 'approved')}><CheckCircle className="w-4 h-4" /></Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setRejectItem({ id: item.itemId, reason: "" })}><XCircle className="w-4 h-4" /></Button>
                                 </div>
                              </div>
                            ))}
                         </div>
                      </div>

                      {dossier.readyForConversion && !isConverted && (
                        <div className="bg-green-50 p-4 rounded-2xl border border-green-200 flex items-center justify-between animate-in fade-in slide-in-from-bottom-2">
                           <div className="flex items-center gap-3 text-green-800 text-sm font-bold">
                              <ShieldCheck className="w-6 h-6 text-green-600" /> Compliance validée. Vous pouvez finaliser le recrutement.
                           </div>
                           <Button onClick={() => setIsConvertDialogOpen(true)} className="bg-green-600 hover:bg-green-700 text-white font-black rounded-xl">
                              <UserPlus className="w-4 h-4 mr-2" /> Convertir maintenant
                           </Button>
                        </div>
                      )}
                    </>
                  )}
               </CardContent>
            </Card>
          )}

          {isConverted && (
            <div className="mb-8 p-6 bg-primary/5 border-2 border-primary/20 rounded-3xl flex items-center justify-between gap-6 shadow-xl">
               <div className="flex items-center gap-4 text-primary font-black">
                  <div className="bg-primary text-white p-3 rounded-2xl"><CheckCircle2 className="w-6 h-6" /></div>
                  <div><p className="text-lg">Recrutement Finalisé</p><p className="text-[10px] uppercase font-black opacity-60">Dossier converti en employé.</p></div>
               </div>
               <Button asChild className="rounded-xl font-bold bg-primary text-white shadow-lg shadow-primary/20">
                  <Link href={`/entity/${entityId}/employees/${offer.employeeId}`}>Voir fiche employé</Link>
               </Button>
            </div>
          )}

          <Card className="border-primary/10 shadow-xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <User className="w-4 h-4" /> Candidat & Poste
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1 p-3 bg-secondary/20 rounded-2xl border">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Candidat</Label>
                  <p className="font-black text-primary">{offer.candidateDisplayName}</p>
                  <p className="text-xs text-muted-foreground">{offer.candidateEmail}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Poste</Label>
                  <Input value={formData.jobTitleName || ""} onChange={(e) => setFormData(p => ({...p, jobTitleName: e.target.value}))} disabled={isConverted} className="h-10 font-bold text-primary border-primary/20 rounded-xl" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl rounded-3xl overflow-hidden">
             <CardHeader className="bg-white/10 py-4 border-b border-white/10"><CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2"><FileText className="w-4 h-4" /> Résumé</CardTitle></CardHeader>
             <CardContent className="p-6 space-y-4">
                <SummaryRow label="Statut" value={getStatusBadge(offer.status)} />
                <SummaryRow label="Compliance" value={isConverted ? "Converti" : dossier?.readyForConversion ? "Validé" : "En attente"} />
             </CardContent>
          </Card>
        </div>
      </div>

      {/* Reject Modal */}
      <Dialog open={!!rejectItem} onOpenChange={() => setRejectItem(null)}>
        <DialogContent className="rounded-[2rem]">
          <DialogHeader><DialogTitle>Rejeter le document</DialogTitle><DialogDescription>Précisez la raison pour informer le candidat.</DialogDescription></DialogHeader>
          <div className="py-4 space-y-3">
             <Label className="text-xs uppercase font-black">Motif du rejet</Label>
             <Textarea value={rejectItem?.reason || ""} onChange={(e) => setRejectItem(p => p ? ({...p, reason: e.target.value}) : null)} placeholder="Ex: Illisible, périmé..." className="rounded-xl min-h-[100px]" />
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setRejectItem(null)}>Annuler</Button>
             <Button variant="destructive" disabled={!rejectItem?.reason} onClick={() => rejectItem && handleUpdateDoc(rejectItem.id, 'rejected', rejectItem.reason)}>Confirmer le rejet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirmation */}
      <AlertDialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-black text-primary">Finaliser l'embauche</AlertDialogTitle>
            <AlertDialogDescription>Validation des documents terminée. Le dossier est prêt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={converting} className="bg-primary text-white font-black rounded-xl">
               {converting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
               Confirmer la création
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getStatusBadge(status: EmploymentOfferStatus) {
  switch (status) {
    case 'accepted': return <Badge variant="secondary" className="bg-green-500 text-white font-black px-2 uppercase text-[9px]">Acceptée</Badge>;
    case 'sent': return <Badge className="bg-primary text-white px-2 uppercase text-[9px]">Envoyée</Badge>;
    default: return <Badge variant="outline" className="px-2 uppercase text-[9px]">{status}</Badge>;
  }
}

function SummaryRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-start gap-4">
       <span className="text-[9px] font-black uppercase text-white/50 tracking-widest pt-0.5">{label}</span>
       <div className="text-xs font-bold text-right truncate">{value || "-"}</div>
    </div>
  );
}
