"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, ShieldCheck, User, Briefcase, 
  MapPin, Calendar, Info, Scale, Euro, Save, AlertCircle,
  Clock, Hash
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useDoc, useCollection, useUser } from "@/firebase";
import { doc, DocumentReference, collection, query, where, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { updateEmploymentOffer } from "@/services/employment-offer.service";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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

  // Queries for selectors
  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active"));
  }, [db, entityId]);

  const levelsQuery = useMemo(() => {
    if (!db || !entityId || !formData.ccnlId) return null;
    return query(collection(db, `entities/${entityId}/ccnls/${formData.ccnlId}/levels`), where("status", "==", "active"));
  }, [db, entityId, formData.ccnlId]);

  const { data: activeCcnls } = useCollection<CCNL>(ccnlsQuery);
  const { data: activeLevels } = useCollection<CCNLLevel>(levelsQuery);

  useEffect(() => {
    if (offer) setFormData(offer);
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
      monthlyPayments: ccnl?.monthlyPayments || 13,
      minGrossMonthly: 0,
      minGrossHourly: 0,
      weeklyHours: ccnl?.standardWeeklyHours || prev.weeklyHours || 40
    }));
  };

  const handleLevelChange = (id: string) => {
    const level = activeLevels?.find(l => l.levelId === id);
    setFormData(prev => ({
      ...prev,
      levelId: id,
      levelCode: level?.levelCode || "",
      levelLabel: level?.label || "",
      qualificationLabel: level?.qualificationLabel || "",
      minGrossMonthly: level?.minimumGrossMonthly || 0,
      minGrossHourly: level?.minimumGrossHourly || 0,
      proposedGrossMonthly: level?.minimumGrossMonthly || prev.proposedGrossMonthly
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId || !offerId) return;
    setSaving(true);
    
    try {
      // Calculate annual if possible
      const payments = formData.monthlyPayments || 13;
      const monthly = formData.proposedGrossMonthly || 0;
      const annual = monthly * payments;

      await updateEmploymentOffer(entityId, offerId, {
        ...formData,
        proposedGrossAnnual: annual
      }, user.uid);
      
      toast({ title: "Proposition enregistrée", description: "Le brouillon a été mis à jour." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!offer) return <div className="p-8 text-center">Proposition introuvable.</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <header className="flex items-center justify-between mb-8 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-primary truncate max-w-md">Proposition : {offer.candidateDisplayName}</h1>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Édition du projet de contrat</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select 
            value={formData.status} 
            onValueChange={(v) => setFormData(p => ({...p, status: v as EmploymentOfferStatus}))}
          >
            <SelectTrigger className="w-44 h-10 font-bold bg-secondary/50">
               <SelectValue />
            </SelectTrigger>
            <SelectContent>
               <SelectItem value="draft">Brouillon</SelectItem>
               <SelectItem value="internal_review">En revue interne</SelectItem>
               <SelectItem value="ready_to_send">Prêt à envoyer</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving} className="gap-2 px-8">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </Button>
        </div>
      </header>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                <p className="font-bold text-primary">{offer.jobTitleName}</p>
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
                 <p className="text-xs font-mono text-muted-foreground truncate">{offer.recruitmentNeedId || "Saisie directe"}</p>
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
                  <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date de début prévue</Label>
                  <Input type="date" value={formData.proposedStartDate} onChange={(e) => setFormData(p => ({...p, proposedStartDate: e.target.value}))} required />
                </div>
                <div className="space-y-2">
                  <Label>Temps de travail (h/sem)</Label>
                  <Input type="number" step="0.5" value={formData.weeklyHours} onChange={(e) => setFormData(p => ({...p, weeklyHours: parseFloat(e.target.value)}))} />
                </div>
                <div className="space-y-2">
                  <Label>Période d'essai (jours)</Label>
                  <Input type="number" value={formData.trialPeriodDays} onChange={(e) => setFormData(p => ({...p, trialPeriodDays: parseInt(e.target.value)}))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes sur les horaires / Organisation</Label>
                <Textarea value={formData.workingScheduleNotes} onChange={(e) => setFormData(p => ({...p, workingScheduleNotes: e.target.value}))} placeholder="Ex: Travail posté 2x8..." />
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
                      type="number" 
                      step="0.01" 
                      className="bg-white text-lg font-black text-primary h-12"
                      value={formData.proposedGrossMonthly} 
                      onChange={(e) => setFormData(p => ({...p, proposedGrossMonthly: parseFloat(e.target.value)}))} 
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
                      type="number" 
                      className="bg-secondary/30 h-12"
                      value={formData.monthlyPayments} 
                      onChange={(e) => setFormData(p => ({...p, monthlyPayments: parseInt(e.target.value)}))} 
                    />
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-accent/20 flex flex-col justify-center">
                     <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Total Brut Annuel (est.)</p>
                     <p className="text-2xl font-black text-accent-foreground">
                        € {((formData.proposedGrossMonthly || 0) * (formData.monthlyPayments || 13)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
                     </p>
                  </div>
               </div>
               <div className="space-y-2">
                 <Label>Primes / Notes sur le salaire</Label>
                 <Textarea 
                   className="bg-white"
                   value={formData.salaryNotes} 
                   onChange={(e) => setFormData(p => ({...p, salaryNotes: e.target.value}))} 
                   placeholder="Ex: Prime de performance de 10%..." 
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
                  <Select value={formData.ccnlId} onValueChange={handleCcnlChange}>
                    <SelectTrigger className="h-11">
                       <SelectValue placeholder="Sélectionner..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeCcnls?.map(c => <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {offer.ccnlName && !activeCcnls?.some(c => c.ccnlId === formData.ccnlId) && (
                    <div className="flex items-center gap-1 text-[10px] text-orange-600 font-bold bg-orange-50 p-1.5 rounded">
                       <AlertCircle className="w-3 h-3" /> CCNL archivé ou introuvable
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Niveau de classification</Label>
                  <Select 
                    value={formData.levelId} 
                    onValueChange={handleLevelChange}
                    disabled={!formData.ccnlId || formData.ccnlId === "none_clear"}
                  >
                    <SelectTrigger className="h-11">
                       <SelectValue placeholder={formData.ccnlId ? "Sélectionner..." : "Sél. CCNL d'abord"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeLevels?.map(l => <SelectItem key={l.levelId} value={l.levelId}>{l.levelCode} — {l.label}</SelectItem>)}
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
                   value={formData.notes} 
                   onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                   className="min-h-[150px] text-xs"
                   placeholder="Commentaires sur la validation de cette proposition..."
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
  );
}
