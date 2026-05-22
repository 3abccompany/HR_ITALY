"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, ShieldCheck, User, Briefcase, 
  MapPin, Calendar, Info, Scale, Euro, Save, AlertCircle,
  Clock, Hash, Undo2, ArrowRight, Ban, CheckCircle2, XCircle
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
    if (isNaN(monthly) || isNaN(payments)) return 0;
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
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <header className="flex items-center justify-between mb-8 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary truncate max-w-md">Proposition : {offer.candidateDisplayName || "Candidat"}</h1>
              {getStatusBadge(offer.status)}
            </div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Gestion du projet de contrat</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Contextual Action Buttons */}
          {!isCancelled ? (
            <>
              {offer.status === 'draft' && (
                <>
                  <Button variant="outline" onClick={() => handleSave('draft')} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Enregistrer le brouillon
                  </Button>
                  <Button variant="secondary" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2 bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200">
                    <ArrowRight className="w-4 h-4" /> Passer en validation
                  </Button>
                  <Button onClick={() => handleSave('ready_to_send')} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200">
                    <CheckCircle2 className="w-4 h-4" /> Prêt à envoyer
                  </Button>
                </>
              )}

              {offer.status === 'internal_review' && (
                <>
                  <Button variant="outline" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Enregistrer les corrections
                  </Button>
                  <Button variant="ghost" onClick={() => handleSave('draft')} disabled={saving} className="gap-2">
                    <Undo2 className="w-4 h-4" /> Revenir en brouillon
                  </Button>
                  <Button onClick={() => handleSave('ready_to_send')} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200">
                    <CheckCircle2 className="w-4 h-4" /> Valider et Prêt
                  </Button>
                </>
              )}

              {offer.status === 'ready_to_send' && (
                <>
                  <Button variant="ghost" onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2">
                    <Undo2 className="w-4 h-4" /> Revenir en validation
                  </Button>
                  <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-md border border-blue-200 text-xs font-bold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> Validé en interne
                  </div>
                </>
              )}

              <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive hover:bg-destructive/10 gap-2">
                    <Ban className="w-4 h-4" /> Annuler
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
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
            <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md border border-red-200 text-xs font-black uppercase flex items-center gap-2">
               <XCircle className="w-4 h-4" /> Proposition Annulée
            </div>
          )}
        </div>
      </header>

      {isCancelled && (
        <div className="mb-8 p-6 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-4">
           <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
           <div>
              <h3 className="font-bold text-red-900">Document archivé (Annulé)</h3>
              <p className="text-sm text-red-700 leading-relaxed">
                Cette proposition a été annulée. Elle reste consultable pour l'historique mais ne peut plus être modifiée ou activée.
              </p>
           </div>
        </div>
      )}

      <div className={isCancelled ? "opacity-60 pointer-events-none" : ""}>
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            
            {/* Identity & Role Info */}
            <Card className="border-primary/10">
              <CardHeader className="bg-primary/5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" /> Candidat & Poste
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Identité</p>
                  <p className="font-bold text-primary">{offer.candidateDisplayName}</p>
                  <p className="text-xs text-muted-foreground">{offer.candidateEmail}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Poste visé</p>
                  <Input 
                    value={formData.jobTitleName || ""} 
                    onChange={(e) => setFormData(p => ({...p, jobTitleName: e.target.value}))}
                    className="h-8 font-bold text-primary"
                    placeholder="Intitulé du poste..."
                    disabled={isCancelled}
                  />
                  <p className="text-xs text-muted-foreground uppercase">{offer.departmentName}</p>
                </div>
                <div className="space-y-1">
                   <p className="text-[10px] font-black uppercase text-muted-foreground">Site d'affectation</p>
                   <div className="flex items-center gap-1.5 text-sm font-medium">
                     <MapPin className="w-3 h-3 text-muted-foreground" /> {offer.worksiteName || "Non renseigné"}
                   </div>
                </div>
                <div className="space-y-1">
                   <p className="text-[10px] font-black uppercase text-muted-foreground">Besoin RH Source</p>
                   <p className="text-xs font-bold text-primary truncate" title={recruitmentNeedLabel}>{recruitmentNeedLabel}</p>
                </div>
              </CardContent>
            </Card>

            {/* Contractual Parameters */}
            <Card className="border-primary/10">
              <CardHeader className="bg-primary/5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" /> Paramètres Contractuels
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type de contrat</Label>
                    <Select 
                      value={formData.contractType} 
                      onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}
                      disabled={isCancelled}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date de début prévue</Label>
                    <Input type="date" value={formData.proposedStartDate || ""} onChange={(e) => setFormData(p => ({...p, proposedStartDate: e.target.value}))} required disabled={isCancelled} />
                  </div>
                  <div className="space-y-2">
                    <Label>Date de fin (si CDD)</Label>
                    <Input type="date" value={formData.proposedEndDate || ""} onChange={(e) => setFormData(p => ({...p, proposedEndDate: e.target.value}))} disabled={isCancelled} />
                  </div>
                  <div className="space-y-2">
                    <Label>Temps de travail (h/sem)</Label>
                    <Input 
                      type="text" 
                      value={numInputs.weeklyHours} 
                      onChange={(e) => setNumericInputs(p => ({...p, weeklyHours: e.target.value}))} 
                      disabled={isCancelled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Période d'essai (jours)</Label>
                    <Input 
                      type="text" 
                      value={numInputs.trialPeriodDays} 
                      onChange={(e) => setNumericInputs(p => ({...p, trialPeriodDays: e.target.value}))} 
                      disabled={isCancelled}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes sur les horaires / Organisation</Label>
                  <Textarea value={formData.workingScheduleNotes || ""} onChange={(e) => setFormData(p => ({...p, workingScheduleNotes: e.target.value}))} placeholder="Ex: Travail posté 2x8..." disabled={isCancelled} />
                </div>
              </CardContent>
            </Card>

            {/* Remuneration Section */}
            <Card className="border-accent/20 bg-accent/5">
              <CardHeader className="bg-accent/10 border-b">
                <CardTitle className="text-sm font-black uppercase text-accent-foreground flex items-center gap-2">
                  <Euro className="w-4 h-4" /> Rémunération proposée
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label className="font-bold">Brut Mensuel (€)</Label>
                      <Input 
                        type="text" 
                        className="bg-white text-lg font-black text-primary h-12"
                        value={numInputs.proposedGrossMonthly} 
                        onChange={(e) => setNumericInputs(p => ({...p, proposedGrossMonthly: e.target.value}))} 
                        disabled={isCancelled}
                      />
                      {formData.minGrossMonthly ? (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Info className="w-2.5 h-2.5" /> Minimum CCNL: {formData.minGrossMonthly}€
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Mensualités</Label>
                      <Input 
                        type="text" 
                        className="bg-secondary/30 h-12"
                        value={numInputs.monthlyPayments} 
                        onChange={(e) => setNumericInputs(p => ({...p, monthlyPayments: e.target.value}))} 
                        disabled={isCancelled}
                      />
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-accent/20 flex flex-col justify-center">
                       <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Total Brut Annuel (est.)</p>
                       <p className="text-2xl font-black text-accent">
                          {annualTotal > 0 ? `€ ${annualTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}` : "Non renseigné"}
                       </p>
                    </div>
                 </div>
                 <div className="space-y-2">
                   <Label>Primes / Notes sur le salaire</Label>
                   <Textarea 
                     className="bg-white"
                     value={formData.salaryNotes || ""} 
                     onChange={(e) => setFormData(p => ({...p, salaryNotes: e.target.value}))} 
                     placeholder="Ex: Prime de performance de 10%..." 
                     disabled={isCancelled}
                   />
                 </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {/* CCNL Snapshot & Registry */}
            <Card className="border-primary/10">
              <CardHeader className="bg-secondary/20">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Scale className="w-4 h-4 text-primary" /> Grille Salariale (CCNL)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Contrat Collectif</Label>
                    <Select 
                      value={formData.ccnlId || "none_clear"} 
                      onValueChange={handleCcnlChange}
                      disabled={isCancelled}
                    >
                      <SelectTrigger className="h-11">
                         <SelectValue placeholder="Sélectionner..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                        {activeCcnls?.map(c => <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Niveau de classification</Label>
                    <Select 
                      value={formData.levelId || "none_clear"} 
                      onValueChange={handleLevelChange}
                      disabled={!formData.ccnlId || formData.ccnlId === "none_clear" || isCancelled}
                    >
                      <SelectTrigger className="h-11">
                         <SelectValue placeholder={formData.ccnlId ? "Sélectionner..." : "Sél. CCNL d'abord"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                        {activeLevels?.map(l => (
                          <SelectItem key={l.levelId} value={l.levelId}>
                            {l.levelCode} — {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.levelCode && (
                    <div className="p-3 bg-secondary/10 rounded-lg border border-dashed text-xs space-y-2">
                       <p className="font-bold text-primary flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Classification retenue</p>
                       <p className="font-medium">{formData.levelCode} • {formData.levelLabel}</p>
                       <p className="text-[10px] text-muted-foreground italic">{formData.qualificationLabel}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/10 bg-secondary/5">
               <CardHeader><CardTitle className="text-xs font-bold uppercase">Notes Internes RH</CardTitle></CardHeader>
               <CardContent>
                  <Textarea 
                     value={formData.notes || ""} 
                     onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                     className="min-h-[150px] text-xs"
                     placeholder="Commentaires sur la validation de cette proposition..."
                     disabled={isCancelled}
                  />
               </CardContent>
            </Card>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-[11px] text-blue-800 space-y-2">
               <div className="flex items-center gap-2 font-black uppercase tracking-widest"><Info className="w-3.5 h-3.5" /> Rappel Studio</div>
               <p className="leading-relaxed">
                  Cette étape est purement interne. Une fois validée, le statut pourra être passé à <b>"Prêt à envoyer"</b>. 
                  L'envoi effectif et la signature électronique seront gérés dans un prochain module.
               </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function getStatusBadge(status: string | undefined) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">Validation interne</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Prêt à envoyer</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulé</Badge>;
    default: return <Badge variant="outline">Inconnu</Badge>;
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
