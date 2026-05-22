"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, ShieldCheck, User, Briefcase, 
  MapPin, Calendar, Info, Scale, Euro, Save, AlertCircle,
  Clock, Hash, Undo2, ArrowRight, Ban, CheckCircle2, XCircle,
  FileSignature, ChevronRight, Building2, UserCircle
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
import { updateEmploymentOffer } from "@/services/employment-offer.service";
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
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);

  // Numeric Input string states to allow empty values while typing
  const [numInputs, setNumericInputs] = useState({
    proposedGrossMonthly: "0",
    proposedGrossHourly: "0",
    monthlyPayments: "13",
    weeklyHours: "40",
    trialPeriodDays: "30"
  });

  // Queries for selectors
  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId) return null;
    // Allow users with contract permissions to read active CCNLs
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active"));
  }, [db, entityId]);

  const levelsQuery = useMemo(() => {
    if (!db || !entityId || !formData.ccnlId || formData.ccnlId === "none_clear") return null;
    return query(collection(db, `entities/${entityId}/ccnls/${formData.ccnlId}/levels`), where("status", "==", "active"));
  }, [db, entityId, formData.ccnlId]);

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
      levelId: "", // Reset level
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

  const validateStatusChange = (targetStatus: EmploymentOfferStatus) => {
    if (targetStatus !== 'ready_to_send') return true;

    if (!formData.jobTitleName?.trim()) {
      toast({ variant: "destructive", title: "Validation échouée", description: "Le poste est obligatoire avant de marquer la proposition comme prête à envoyer." });
      return false;
    }
    if (!formData.contractType || formData.contractType === 'none_clear') {
      toast({ variant: "destructive", title: "Validation échouée", description: "Le type de contrat est obligatoire avant de marquer la proposition comme prête à envoyer." });
      return false;
    }
    if (!formData.proposedStartDate) {
      toast({ variant: "destructive", title: "Validation échouée", description: "La date de début proposée est obligatoire avant de marquer la proposition comme prête à envoyer." });
      return false;
    }

    // Fixed-term validation
    const isFixedTerm = ["Tempo indeterminato", "fixed_term", "determinato"].some(s => formData.contractType?.toLowerCase().includes(s.toLowerCase()));
    if (isFixedTerm && !formData.proposedEndDate) {
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
      // 1. Normalize Numeric Inputs
      const monthly = parseFloat(numInputs.proposedGrossMonthly.replace(',', '.'));
      const hourly = parseFloat(numInputs.proposedGrossHourly.replace(',', '.'));
      const payments = parseInt(numInputs.monthlyPayments);
      const hours = parseFloat(numInputs.weeklyHours.replace(',', '.'));
      const trial = parseInt(numInputs.trialPeriodDays);

      if (isNaN(monthly) || isNaN(payments) || isNaN(hours) || isNaN(trial) || isNaN(hourly)) {
        throw new Error("Veuillez saisir des valeurs numériques valides.");
      }

      if (hours <= 0) throw new Error("Le temps de travail hebdomadaire doit être supérieur à 0.");
      if (monthly < 0 || payments < 0 || trial < 0 || hourly < 0) throw new Error("Les valeurs numériques ne peuvent pas être négatives.");

      const annual = monthly * payments;

      // 2. Perform Update
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
      
      toast({ 
        title: targetStatus !== formData.status ? "Statut mis à jour" : "Proposition enregistrée", 
        description: targetStatus !== formData.status ? `La proposition est maintenant en statut: ${getStatusLabel(targetStatus)}` : "Les informations ont été mises à jour." 
      });
    } catch (err: any) {
      console.error("Save error:", err);
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
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

  const recruitmentNeedLabel = useMemo(() => {
    if (!offer) return "";
    if (offer.recruitmentNeedTitle) return offer.recruitmentNeedTitle;
    if (!offer.recruitmentNeedId) return "Saisie directe";
    
    if (offer.jobTitleName) {
      return `${offer.jobTitleName}${offer.departmentName ? ` — ${offer.departmentName}` : ""}`;
    }
    
    return "Besoin RH lié";
  }, [offer]);

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!offer) return <div className="p-8 text-center">Proposition introuvable.</div>;

  const isCancelled = offer.status === 'cancelled';

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.back()} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-0.5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight truncate max-w-[300px] md:max-w-md">
                {offer.candidateDisplayName || "Candidat"}
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
          {!isCancelled ? (
            <>
              <Button variant="outline" onClick={() => handleSave(formData.status)} disabled={saving} className="gap-2 border-primary/20 bg-white">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </Button>

              {offer.status === 'draft' && (
                <Button variant="secondary" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2 bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200">
                  <ArrowRight className="w-4 h-4" /> Passer en validation
                </Button>
              )}

              {offer.status === 'internal_review' && (
                <Button variant="ghost" onClick={() => handleSave('draft')} disabled={saving} className="gap-2">
                  <Undo2 className="w-4 h-4" /> Retour en brouillon
                </Button>
              )}

              {offer.status !== 'ready_to_send' && (
                <Button onClick={() => handleSave('ready_to_send')} disabled={saving} className="gap-2 bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20 font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Prêt à envoyer
                </Button>
              )}

              {offer.status === 'ready_to_send' && (
                <Button variant="ghost" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2">
                  <Undo2 className="w-4 h-4" /> Revenir en validation
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
                    <AlertDialogDescription>
                      Cette action est définitive pour ce projet. Le candidat ne pourra jamais recevoir cette version de l'offre.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={saving}>Retour</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelOffer} disabled={saving} className="bg-red-600 hover:bg-red-700">
                      Confirmer l'annulation
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <div className="bg-red-50 text-red-700 px-4 py-2 rounded-xl border border-red-200 text-xs font-black uppercase flex items-center gap-2">
               <XCircle className="w-4 h-4" /> Proposition Annulée
            </div>
          )}
        </div>
      </header>

      {isCancelled && (
        <div className="mb-8 p-6 bg-red-50 border border-red-100 rounded-3xl flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
           <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
           <div>
              <h3 className="font-bold text-red-900">Document archivé (Annulé)</h3>
              <p className="text-sm text-red-700 leading-relaxed">
                Cette proposition a été annulée. Elle reste consultable pour l'historique mais ne peut plus être modifiée.
              </p>
           </div>
        </div>
      )}

      <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-8", isCancelled && "opacity-60 pointer-events-none")}>
        <div className="lg:col-span-2 space-y-8">
          
          {/* Candidate & Position Section */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 overflow-hidden rounded-3xl">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <User className="w-4 h-4" /> Candidat & Poste d'affectation
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1 p-3 bg-secondary/20 rounded-2xl border border-secondary">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Candidat</Label>
                  <p className="font-black text-primary flex items-center gap-2">
                    <UserCircle className="w-4 h-4 text-primary/40" />
                    {offer.candidateDisplayName}
                  </p>
                  <p className="text-xs text-muted-foreground pl-6">{offer.candidateEmail}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Intitulé du poste (Cible)</Label>
                  <Input 
                    value={formData.jobTitleName || ""} 
                    onChange={(e) => setFormData(p => ({...p, jobTitleName: e.target.value}))}
                    className="h-10 font-bold text-primary border-primary/20 bg-white rounded-xl"
                    placeholder="Ex: Responsable d'exploitation..."
                  />
                  <p className="text-[10px] text-muted-foreground uppercase font-bold pl-2 pt-1">{offer.departmentName}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                   <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Site d'affectation</Label>
                   <div className="flex items-center gap-2 h-10 px-3 bg-slate-50 border rounded-xl text-sm font-bold text-slate-700">
                     <MapPin className="w-4 h-4 text-primary/40" />
                     {offer.worksiteName || "Non renseigné"}
                   </div>
                </div>
                <div className="space-y-1">
                   <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">Source Recrutement</Label>
                   <div className="flex items-center gap-2 h-10 px-3 bg-slate-50 border rounded-xl text-[11px] font-bold text-primary truncate" title={recruitmentNeedLabel}>
                      <Briefcase className="w-4 h-4 text-primary/40" />
                      {recruitmentNeedLabel}
                   </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contractual Parameters Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 overflow-hidden rounded-3xl">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <Briefcase className="w-4 h-4" /> Paramètres du futur contrat
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Type de contrat</Label>
                  <Select 
                    value={formData.contractType} 
                    onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}
                  >
                    <SelectTrigger className="h-11 rounded-xl border-primary/20 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Date de début (Prévue)</Label>
                  <Input type="date" value={formData.proposedStartDate || ""} onChange={(e) => setFormData(p => ({...p, proposedStartDate: e.target.value}))} required className="h-11 rounded-xl border-primary/20 bg-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Date de fin (Si CDD)</Label>
                  <Input type="date" value={formData.proposedEndDate || ""} onChange={(e) => setFormData(p => ({...p, proposedEndDate: e.target.value}))} className="h-11 rounded-xl border-primary/20 bg-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Temps de travail (H/Sem)</Label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      type="text" 
                      value={numInputs.weeklyHours} 
                      onChange={(e) => setNumericInputs(p => ({...p, weeklyHours: e.target.value}))} 
                      className="h-11 pl-10 rounded-xl border-primary/20 bg-white font-bold"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Période d'essai (Jours)</Label>
                  <Input 
                    type="text" 
                    value={numInputs.trialPeriodDays} 
                    onChange={(e) => setNumericInputs(p => ({...p, trialPeriodDays: e.target.value}))} 
                    className="h-11 rounded-xl border-primary/20 bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Notes sur l'organisation / Horaires</Label>
                <Textarea value={formData.workingScheduleNotes || ""} onChange={(e) => setFormData(p => ({...p, workingScheduleNotes: e.target.value}))} placeholder="Ex: Travail posté, temps partiel 80%..." className="min-h-[100px] rounded-xl border-primary/20 bg-white" />
              </div>
            </CardContent>
          </Card>

          {/* Proposed Remuneration Section */}
          <Card className="border-accent/20 bg-accent/5 shadow-xl shadow-accent/5 overflow-hidden rounded-3xl">
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
                      <Input 
                        type="text" 
                        className="bg-white text-xl font-black text-primary h-14 pl-8 rounded-xl border-accent/20 shadow-sm"
                        value={numInputs.proposedGrossMonthly} 
                        onChange={(e) => setNumericInputs(p => ({...p, proposedGrossMonthly: e.target.value}))} 
                      />
                    </div>
                    {formData.minGrossMonthly ? (
                      <p className="text-[10px] font-bold text-accent-foreground/60 flex items-center gap-1.5 pl-1">
                        <Scale className="w-3 h-3" /> Min. CCNL: {formData.minGrossMonthly}€
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-accent-foreground/70">Nombre de mensualités</Label>
                    <Input 
                      type="text" 
                      className="bg-accent/10 border-accent/20 h-14 text-lg font-black text-primary rounded-xl text-center"
                      value={numInputs.monthlyPayments} 
                      onChange={(e) => setNumericInputs(p => ({...p, monthlyPayments: e.target.value}))} 
                    />
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-accent/30 flex flex-col justify-center shadow-lg shadow-accent/10 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-1 opacity-5"><Euro className="w-12 h-12" /></div>
                     <p className="text-[9px] font-black uppercase text-accent/60 mb-1 tracking-widest">Total Brut Annuel (Est.)</p>
                     <p className="text-2xl font-black text-accent">
                        {annualTotal > 0 ? `€ ${annualTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}` : "Non renseigné"}
                     </p>
                  </div>
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] font-black uppercase text-accent-foreground/70">Primes, bonus et notes sur la paie</Label>
                 <Textarea 
                   className="bg-white rounded-xl border-accent/20 min-h-[100px]"
                   value={formData.salaryNotes || ""} 
                   onChange={(e) => setFormData(p => ({...p, salaryNotes: e.target.value}))} 
                   placeholder="Ex: Prime de performance annuelle de 1500€..." 
                 />
               </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-8">
          
          {/* CCNL Snapshot Selection */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 overflow-hidden rounded-3xl">
            <CardHeader className="bg-secondary/40 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <Scale className="w-4 h-4" /> Référentiel Grille (CCNL)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Contrat Collectif (CCNL)</Label>
                  <Select 
                    value={formData.ccnlId || "none_clear"} 
                    onValueChange={handleCcnlChange}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-primary/20 bg-white">
                       <SelectValue placeholder="Choisir un CCNL..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeCcnls?.map(c => <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Niveau de classification</Label>
                  <Select 
                    value={formData.levelId || "none_clear"} 
                    onValueChange={handleLevelChange}
                    disabled={!formData.ccnlId || formData.ccnlId === "none_clear"}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-primary/20 bg-white">
                       <SelectValue placeholder={formData.ccnlId ? "Sélectionner un niveau..." : "Sél. CCNL d'abord"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeLevels?.map(l => (
                        <SelectItem key={l.levelId} value={l.levelId}>
                          {l.levelCode} • {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {formData.levelCode && (
                  <div className="p-4 bg-primary/5 rounded-2xl border border-dashed border-primary/20 text-xs space-y-2 animate-in fade-in zoom-in-95">
                     <p className="font-black text-primary flex items-center gap-1.5 uppercase tracking-tighter">
                        <ShieldCheck className="w-3.5 h-3.5" /> Classification Snapshot
                     </p>
                     <div className="pl-5 space-y-1">
                        <p className="font-black text-sm text-primary">{formData.levelCode} • {formData.levelLabel}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold">{formData.qualificationLabel}</p>
                     </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Proposition Summary Box */}
          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl shadow-primary/20 rounded-3xl overflow-hidden">
             <CardHeader className="bg-white/10 py-4 border-b border-white/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <ClipboardList className="w-4 h-4" /> Résumé du projet
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <SummaryRow label="Candidat" value={offer.candidateDisplayName} />
                <SummaryRow label="Poste" value={formData.jobTitleName} />
                <SummaryRow label="Site" value={offer.worksiteName} />
                <SummaryRow label="Contrat" value={formData.contractType} />
                <SummaryRow label="Début" value={formData.proposedStartDate ? new Date(formData.proposedStartDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : "-"} />
                <SummaryRow label="Classification" value={formData.levelCode ? `${formData.ccnlName} — ${formData.levelCode}` : "-"} />
                
                <Separator className="bg-white/10" />
                
                <div className="flex justify-between items-end">
                   <p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Brut Mensuel</p>
                   <p className="text-lg font-black">{numInputs.proposedGrossMonthly} €</p>
                </div>
                <div className="flex justify-between items-end">
                   <p className="text-[10px] font-black uppercase text-accent tracking-widest">Brut Annuel (Est.)</p>
                   <p className="text-xl font-black text-accent">{annualTotal > 0 ? `${annualTotal.toLocaleString('fr-FR')} €` : "-"}</p>
                </div>
                
                <Separator className="bg-white/10" />
                
                <div className="flex justify-between items-center">
                   <p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Statut Interne</p>
                   {getStatusBadge(formData.status as any)}
                </div>
             </CardContent>
          </Card>

          {/* HR Internal Notes Card */}
          <Card className="border-primary/10 bg-secondary/5 rounded-3xl overflow-hidden">
             <CardHeader className="py-4 border-b"><CardTitle className="text-[10px] font-black uppercase tracking-widest">Notes Internes RH</CardTitle></CardHeader>
             <CardContent className="pt-4">
                <Textarea 
                   value={formData.notes || ""} 
                   onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                   className="min-h-[140px] text-xs bg-white/50 border-primary/10 rounded-2xl"
                   placeholder="Ajoutez ici des commentaires sur la validation, les bonus négociés ou des clauses spécifiques..."
                />
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function getStatusBadge(status: string | undefined) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200 uppercase text-[9px] font-black px-2 tracking-tighter">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase text-[9px] font-black px-2 tracking-tighter">Validation</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[9px] font-black px-2 tracking-tighter">Prête</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase text-[9px] font-black px-2 tracking-tighter">Annulée</Badge>;
    default: return <Badge variant="outline" className="uppercase text-[9px] font-black px-2">Inconnu</Badge>;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'draft': return "Brouillon";
    case 'internal_review': return "Validation interne";
    case 'ready_to_send': return "Prêt à envoyer";
    case 'cancelled': return "Annulé";
    default: return status;
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

function ClipboardList(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  )
}
