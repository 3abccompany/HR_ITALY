"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, ShieldCheck, User, Briefcase, 
  MapPin, Calendar, Info, Scale, Euro, Save, AlertCircle,
  Clock, Hash, Undo2, ArrowRight, Ban, CheckCircle2, XCircle,
  FileSignature, ChevronRight, Building2, UserCircle, Send, Eye, MousePointer2,
  FileText, ExternalLink, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useDoc, useCollection, useUser } from "@/firebase";
import { doc, DocumentReference, collection, query, where } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { updateEmploymentOffer, initiateOfferSend } from "@/services/employment-offer.service";
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

const CONTRACT_TYPES = [
  "Tempo indeterminato",
  "Tempo determinato",
  "Apprendistato",
  "Stage / Tirocinio",
  "Co.co.co",
  "Altro"
];

export default function EditEmploymentOfferPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const offerId = params.offerId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const offerRef = useMemo(() => 
    db && entityId && offerId ? (doc(db, `entities/${entityId}/employmentOffers`, offerId) as DocumentReference<EmploymentOffer>) : null,
  [db, entityId, offerId]);

  const { data: offer, loading: loadingOffer } = useDoc<EmploymentOffer>(offerRef);

  // States
  const [formData, setFormData] = useState<Partial<EmploymentOffer>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);

  // Numeric Input string states
  const [numInputs, setNumericInputs] = useState({
    proposedGrossMonthly: "0",
    proposedGrossHourly: "0",
    monthlyPayments: "13",
    weeklyHours: "40",
    trialPeriodDays: "30"
  });

  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId || !hasPermission("contracts.read")) return null;
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active"));
  }, [db, entityId, hasPermission]);

  const levelsQuery = useMemo(() => {
    if (!db || !entityId || !formData.ccnlId || !hasPermission("contracts.read")) return null;
    return query(collection(db, `entities/${entityId}/ccnls/${formData.ccnlId}/levels`), where("status", "==", "active"));
  }, [db, entityId, formData.ccnlId, hasPermission]);

  const { data: activeCcnls } = useCollection<CCNL>(ccnlsQuery);
  const { data: activeLevels } = useCollection<CCNLLevel>(levelsQuery);

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

  const handleCcnlChange = (id: string) => {
    const ccnl = activeCcnls?.find(c => c.ccnlId === id);
    setFormData(prev => ({
      ...prev,
      ccnlId: id,
      ccnlName: ccnl?.name || "",
      levelId: "",
      levelCode: "",
      levelLabel: "",
      qualificationLabel: "",
      minGrossMonthly: 0,
      minGrossHourly: 0,
      monthlyPayments: ccnl?.monthlyPayments || 13,
      hourlyDivisor: ccnl?.hourlyDivisor || 173,
    }));
    setNumericInputs(prev => ({
      ...prev,
      monthlyPayments: (ccnl?.monthlyPayments ?? 13).toString(),
      weeklyHours: (ccnl?.standardWeeklyHours ?? prev.weeklyHours ?? 40).toString()
    }));
  };

  const handleLevelChange = (id: string) => {
    const level = activeLevels?.find(l => l.levelId === id);
    if (!level) return;

    setFormData(prev => ({
      ...prev,
      levelId: id,
      levelCode: level.levelCode,
      levelLabel: level.label,
      qualificationLabel: level.qualificationLabel,
      minGrossMonthly: level.minimumGrossMonthly,
      minGrossHourly: level.minimumGrossHourly,
    }));
    
    setNumericInputs(prev => ({
      ...prev,
      proposedGrossMonthly: level.minimumGrossMonthly.toString(),
      proposedGrossHourly: level.minimumGrossHourly.toString()
    }));
  };

  const isFixedTermContract = (type?: string): boolean => {
    const value = (type ?? "").trim().toLowerCase();
    return ["tempo determinato", "cdd", "fixed_term", "fixed term", "determinato"].includes(value);
  };

  const validateStatusChange = (targetStatus: EmploymentOfferStatus) => {
    if (targetStatus !== 'ready_to_send' && targetStatus !== 'sent') return true;

    if (!formData.jobTitleName?.trim()) {
      toast({ variant: "destructive", title: "Validation échouée", description: "Le poste est obligatoire avant de finaliser la proposition." });
      return false;
    }
    if (!formData.contractType || formData.contractType === 'none_clear') {
      toast({ variant: "destructive", title: "Validation échouée", description: "Le type de contrat est obligatoire." });
      return false;
    }
    if (!formData.proposedStartDate) {
      toast({ variant: "destructive", title: "Validation échouée", description: "La date de début proposée est obligatoire." });
      return false;
    }
    if (isFixedTermContract(formData.contractType) && !formData.proposedEndDate) {
      toast({ variant: "destructive", title: "Validation échouée", description: "Une date de fin est obligatoire pour un contrat à durée déterminée." });
      return false;
    }
    return true;
  };

  const handleSave = async (nextStatus?: EmploymentOfferStatus) => {
    if (!user || !entityId || !offerId) return;

    const targetStatus = nextStatus || formData.status || 'draft';
    if (!validateStatusChange(targetStatus)) return;

    setSaving(true);
    try {
      const monthly = parseFloat(numInputs.proposedGrossMonthly.replace(',', '.'));
      const hourly = parseFloat(numInputs.proposedGrossHourly.replace(',', '.'));
      const payments = parseInt(numInputs.monthlyPayments);
      const hours = parseFloat(numInputs.weeklyHours.replace(',', '.'));
      const trial = parseInt(numInputs.trialPeriodDays);

      if (isNaN(monthly) || isNaN(payments) || isNaN(hours) || isNaN(trial) || isNaN(hourly)) throw new Error("Veuillez saisir des valeurs numériques valides.");
      const annual = monthly * payments;

      await updateEmploymentOffer(entityId, offerId, {
        ...formData,
        status: targetStatus,
        proposedGrossMonthly: monthly,
        proposedGrossHourly: hourly,
        monthlyPayments: payments,
        weeklyHours: hours,
        trialPeriodDays: trial,
        proposedGrossAnnual: annual
      }, user.uid);
      
      toast({ title: targetStatus !== formData.status ? "Statut mis à jour" : "Proposition enregistrée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!user || !entityId || !offerId) return;
    setSending(true);
    try {
      const result = await initiateOfferSend(entityId, offerId, user.uid);
      if (result.success) {
        toast({ title: "Proposition envoyée", description: "Le candidat va recevoir le lien sécurisé par email." });
      } else {
        toast({ variant: "destructive", title: "Erreur d'envoi", description: result.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSending(false);
    }
  };

  const handleCancelOffer = async () => {
    if (!user || !entityId || !offerId) return;
    setSaving(true);
    try {
      await updateEmploymentOffer(entityId, offerId, { status: 'cancelled' }, user.uid);
      toast({ title: "Proposition annulée" });
      setIsCancelDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const annualTotal = useMemo(() => {
    const monthly = parseFloat(numInputs.proposedGrossMonthly.replace(',', '.'));
    const payments = parseInt(numInputs.monthlyPayments);
    if (isNaN(monthly) || isNaN(payments) || monthly === 0) return 0;
    return monthly * payments;
  }, [numInputs.proposedGrossMonthly, numInputs.monthlyPayments]);

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!offer) return <div className="p-8 text-center">Proposition introuvable.</div>;

  const isCancelled = offer.status === 'cancelled';
  const isAccepted = offer.status === 'accepted';
  const isDeclined = offer.status === 'declined';
  const isSentOrViewed = ["sent", "viewed"].includes(offer.status);

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      {isAccepted && (
        <div className="mb-8 p-4 bg-green-50 border-2 border-green-200 rounded-3xl flex items-center justify-between shadow-lg shadow-green-100 animate-in fade-in slide-in-from-top-2">
           <div className="flex items-center gap-3 text-green-800 font-bold">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div>
                <p>Proposition acceptée par le candidat !</p>
                <p className="text-[10px] uppercase font-black tracking-widest text-green-600">Prochaine étape : création employé et contrat.</p>
              </div>
           </div>
        </div>
      )}

      {isDeclined && (
        <div className="mb-8 p-4 bg-red-50 border-2 border-red-200 rounded-3xl flex items-center justify-between shadow-lg shadow-red-100">
           <div className="flex items-center gap-3 text-red-800 font-bold">
              <XCircle className="w-6 h-6 text-red-600" />
              <div>
                <p>Proposition déclinée.</p>
                {offer.declinedReason && <p className="text-xs font-medium text-red-600 mt-1 italic">"{offer.declinedReason}"</p>}
              </div>
           </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.back()} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-0.5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight truncate max-w-[300px] md:max-w-md">
                Proposition : {offer.candidateDisplayName}
              </h1>
              {getStatusBadge(offer.status)}
            </div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-[0.2em] flex items-center gap-2">
               <FileSignature className="w-3 h-3" />
               Gestion du projet de contrat
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isCancelled && !isAccepted && !isDeclined ? (
            <>
              <Button variant="outline" onClick={() => handleSave(formData.status)} disabled={saving} className="gap-2 border-primary/20 bg-white shadow-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </Button>

              {offer.status === 'draft' && (
                <Button variant="secondary" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2 bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200">
                  <ArrowRight className="w-4 h-4" /> Passer en validation
                </Button>
              )}

              {(offer.status === 'draft' || offer.status === 'internal_review') && (
                <Button onClick={() => handleSave('ready_to_send')} disabled={saving} className="gap-2 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20 font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Prête à envoyer
                </Button>
              )}

              {offer.status === 'ready_to_send' && (
                 <Button onClick={handleSend} disabled={sending} className="gap-2 bg-primary text-white shadow-lg shadow-primary/20 font-black px-6">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Envoyer au candidat
                 </Button>
              )}

              {isSentOrViewed && (
                <Button variant="outline" onClick={handleSend} disabled={sending} className="gap-2 border-primary text-primary hover:bg-primary/5">
                   {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                   Renvoyer le lien
                </Button>
              )}

              <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive hover:bg-destructive/10 gap-2 h-10 px-3">
                    <Ban className="w-4 h-4" /> Annuler
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-[2rem]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Annuler la proposition ?</AlertDialogTitle>
                    <AlertDialogDescription>Cette action est définitive pour ce projet d'offre.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={saving}>Retour</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelOffer} disabled={saving} className="bg-red-600 hover:bg-red-700">Confirmer</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
        </div>
      </header>

      <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-8", (isCancelled || isAccepted || isDeclined) && "opacity-60")}>
        <div className="lg:col-span-2 space-y-8">
          {/* Tracking Card */}
          {isSentOrViewed && (
            <Card className="border-accent/20 bg-accent/5 rounded-3xl overflow-hidden shadow-sm">
               <CardContent className="p-6 flex flex-wrap items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                     <div className="bg-accent/20 p-2.5 rounded-xl text-accent-foreground"><Send className="w-5 h-5" /></div>
                     <div>
                        <p className="text-[10px] font-black uppercase text-accent-foreground/60 tracking-widest">Dernier envoi</p>
                        <p className="text-sm font-bold text-primary">{formatDateTime(offer.sentAt)}</p>
                     </div>
                  </div>
                  {offer.viewedAt ? (
                    <div className="flex items-center gap-4">
                       <div className="bg-green-100 p-2.5 rounded-xl text-green-700"><Eye className="w-5 h-5" /></div>
                       <div>
                          <p className="text-[10px] font-black uppercase text-green-700/60 tracking-widest">Première lecture</p>
                          <p className="text-sm font-bold text-primary">{formatDateTime(offer.viewedAt)}</p>
                       </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-slate-400 font-bold italic text-xs">
                       <Clock className="w-4 h-4" /> En attente de lecture...
                    </div>
                  )}
                  {offer.resendCount && offer.resendCount > 0 && (
                    <Badge variant="secondary" className="bg-white/50 text-[10px] h-6 px-2">Renvoyée {offer.resendCount} fois</Badge>
                  )}
               </CardContent>
            </Card>
          )}

          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center justify-between gap-2 text-primary/70">
                <div className="flex items-center gap-2">
                   <User className="w-4 h-4" /> Candidat & Poste
                </div>
                <div className="flex items-center gap-2">
                   <Button variant="ghost" size="sm" asChild className="h-7 text-[9px] font-black uppercase gap-1 hover:bg-white">
                      <Link href={`/entity/${entityId}/candidates`}><Search className="w-3 h-3" /> Voir candidat</Link>
                   </Button>
                   {offer.interviewId && (
                     <Button variant="ghost" size="sm" asChild className="h-7 text-[9px] font-black uppercase gap-1 hover:bg-white">
                        <Link href={`/entity/${entityId}/interviews`}><Calendar className="w-3 h-3" /> Voir entretien</Link>
                     </Button>
                   )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1 p-3 bg-secondary/20 rounded-2xl border border-secondary">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Candidat</Label>
                  <p className="font-black text-primary flex items-center gap-2"><UserCircle className="w-4 h-4 text-primary/40" />{offer.candidateDisplayName}</p>
                  <p className="text-xs text-muted-foreground pl-6">{offer.candidateEmail}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Intitulé du poste</Label>
                  <Input value={formData.jobTitleName || ""} onChange={(e) => setFormData(p => ({...p, jobTitleName: e.target.value}))} className="h-10 font-bold text-primary border-primary/20 rounded-xl" />
                  <p className="text-[10px] text-muted-foreground uppercase font-bold pl-2 pt-1">{offer.departmentName}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                   <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Site d'affectation</Label>
                   <div className="flex items-center gap-2 h-10 px-3 bg-slate-50 border rounded-xl text-sm font-bold text-slate-700">
                     <MapPin className="w-4 h-4 text-primary/40" />{offer.worksiteName || "Non renseigné"}
                   </div>
                </div>
                <div className="space-y-1">
                   <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center justify-between">
                     Besoin RH source
                     {offer.recruitmentNeedId && (
                        <Link href={`/entity/${entityId}/recruitment-needs/${offer.recruitmentNeedId}/preview`} className="text-accent text-[8px] hover:underline flex items-center gap-0.5">
                           Consulter <ExternalLink className="w-2 h-2" />
                        </Link>
                     )}
                   </Label>
                   <div className="flex items-center gap-2 h-10 px-3 bg-slate-50 border rounded-xl text-[11px] font-bold text-primary truncate">
                      <Briefcase className="w-4 h-4 text-primary/40" />{offer.recruitmentNeedTitle || offer.recruitmentNeedId || "Saisie directe"}
                   </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <Briefcase className="w-4 h-4" /> Paramètres contractuels
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Type de contrat</Label>
                  <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}>
                    <SelectTrigger className="h-11 rounded-xl border-primary/20 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Date de début</Label>
                  <Input type="date" value={formData.proposedStartDate || ""} onChange={(e) => setFormData(p => ({...p, proposedStartDate: e.target.value}))} className="h-11 rounded-xl border-primary/20 bg-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Date de fin (CDD)</Label>
                  <Input type="date" value={formData.proposedEndDate || ""} onChange={(e) => setFormData(p => ({...p, proposedEndDate: e.target.value}))} className="h-11 rounded-xl border-primary/20 bg-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Temps de travail (H/Sem)</Label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input type="text" value={numInputs.weeklyHours} onChange={(e) => setNumericInputs(p => ({...p, weeklyHours: e.target.value}))} className="h-11 pl-10 rounded-xl border-primary/20 bg-white font-bold" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-accent/20 bg-accent/5 shadow-xl shadow-accent/5 rounded-3xl overflow-hidden">
            <CardHeader className="bg-accent/10 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-accent-foreground flex items-center gap-2">
                <Euro className="w-4 h-4" /> Rémunération proposée
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-8 space-y-6">
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-accent-foreground/70">Salaire Brut Mensuel (€)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/40 font-bold">€</span>
                      <Input type="text" className="bg-white text-xl font-black text-primary h-14 pl-8 rounded-xl border-accent/20 shadow-sm" value={numInputs.proposedGrossMonthly} onChange={(e) => setNumericInputs(p => ({...p, proposedGrossMonthly: e.target.value}))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-accent-foreground/70">Mensualités</Label>
                    <Input type="text" className="bg-accent/10 border-accent/20 h-14 text-lg font-black text-primary rounded-xl text-center" value={numInputs.monthlyPayments} onChange={(e) => setNumericInputs(p => ({...p, monthlyPayments: e.target.value}))} />
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-accent/30 flex flex-col justify-center shadow-lg shadow-accent/10">
                     <p className="text-[9px] font-black uppercase text-accent/60 mb-1 tracking-widest">Total Brut Annuel (Est.)</p>
                     <p className="text-2xl font-black text-accent">{annualTotal > 0 ? `€ ${annualTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}` : "Non renseigné"}</p>
                  </div>
               </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
            <CardHeader className="bg-secondary/40 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <Scale className="w-4 h-4" /> Grille Salariale (CCNL)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">CCNL</Label>
                  <Select value={formData.ccnlId || "none_clear"} onValueChange={handleCcnlChange}>
                    <SelectTrigger className="h-12 rounded-xl border-primary/20 bg-white"><SelectValue placeholder="Choisir un CCNL..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeCcnls?.map(c => <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Niveau</Label>
                  <Select value={formData.levelId || "none_clear"} onValueChange={handleLevelChange} disabled={!formData.ccnlId || formData.ccnlId === "none_clear"}>
                    <SelectTrigger className="h-12 rounded-xl border-primary/20 bg-white"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeLevels?.map(l => <SelectItem key={l.levelId} value={l.levelId}>{l.levelCode} • {l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl shadow-primary/20 rounded-3xl overflow-hidden">
             <CardHeader className="bg-white/10 py-4 border-b border-white/10"><CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2"><FileText className="w-4 h-4" /> Résumé</CardTitle></CardHeader>
             <CardContent className="p-6 space-y-4">
                <SummaryRow label="Candidat" value={offer.candidateDisplayName} />
                <SummaryRow label="Poste" value={formData.jobTitleName} />
                <SummaryRow label="Contrat" value={formData.contractType} />
                <SummaryRow label="Brut Mensuel" value={`${numInputs.proposedGrossMonthly} €`} />
                <SummaryRow label="Brut Annuel" value={annualTotal > 0 ? `${annualTotal.toLocaleString('fr-FR')} €` : "-"} />
                <Separator className="bg-white/10" />
                <div className="flex justify-between items-center"><p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Statut</p>{getStatusBadge(offer.status)}</div>
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function getStatusBadge(status: EmploymentOfferStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200 uppercase text-[9px] font-black px-2 tracking-tighter">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase text-[9px] font-black px-2 tracking-tighter">Validation</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[9px] font-black px-2 tracking-tighter">Prête</Badge>;
    case 'sent': return <Badge variant="secondary" className="bg-primary text-white border-none uppercase text-[9px] font-black px-2 tracking-tighter">Envoyée</Badge>;
    case 'viewed': return <Badge variant="secondary" className="bg-cyan-500 text-white border-none uppercase text-[9px] font-black px-2 tracking-tighter">Consultée</Badge>;
    case 'accepted': return <Badge variant="secondary" className="bg-green-500 text-white border-none uppercase text-[9px] font-black px-2 tracking-tighter">Acceptée</Badge>;
    case 'declined': return <Badge variant="destructive" className="bg-red-50 text-red-500 text-white border-none uppercase text-[9px] font-black px-2 tracking-tighter">Refusée</Badge>;
    case 'expired': return <Badge variant="outline" className="bg-slate-50 text-slate-400 border-slate-200 uppercase text-[9px] font-black px-2 tracking-tighter">Expirée</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase text-[9px] font-black px-2 tracking-tighter">Annulée</Badge>;
    default: return <Badge variant="outline" className="uppercase text-[9px] font-black px-2">Inconnu</Badge>;
  }
}

function SummaryRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-start gap-4">
       <span className="text-[9px] font-black uppercase text-white/50 tracking-widest shrink-0 pt-0.5">{label}</span>
       <span className="text-xs font-bold text-right truncate">{value || "-"}</span>
    </div>
  );
}

function formatDateTime(val: any): string {
  if (!val) return "N/A";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
