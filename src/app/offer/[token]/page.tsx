"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Building2, MapPin, Briefcase, 
  Loader2, AlertCircle, Calendar,
  Clock, Info, Euro, CheckCircle2, XCircle,
  FileSignature, ChevronRight, ShieldCheck,
  Send, User
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { getPublicOfferAction, respondToOfferAction } from "./actions";
import { PublicOfferDTO } from "@/types/employment-offer";

export default function PublicOfferPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [offer, setOffer] = useState<PublicOfferDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [respondedStatus, setRespondedStatus] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    async function load() {
      if (!token) return;
      try {
        const result = await getPublicOfferAction(token);
        if (result.success && result.offer) {
          setOffer(result.offer);
          // Check if already responded
          if (result.offer.status === "accepted") setRespondedStatus("accepted");
          if (result.offer.status === "declined") setRespondedStatus("declined");
        } else {
          setError(result.error || "Une erreur est survenue.");
        }
      } catch (err) {
        setError("Impossible de charger la proposition.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleResponse = async (type: "accepted" | "declined", reason?: string) => {
    setProcessing(true);
    try {
      const result = await respondToOfferAction(token, type, reason);
      if (result.success) {
        setRespondedStatus(type);
        setDeclineDialogOpen(false);
      } else {
        alert("Erreur: " + (result as any).error);
      }
    } catch (err: any) {
      alert("Erreur technique lors de l'envoi de votre réponse.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Chargement de votre proposition...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-xl border-none text-center p-12 rounded-[2.5rem]">
          <div className="mx-auto bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Lien invalide</h1>
          <p className="text-slate-500 mb-8">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="rounded-xl">Réessayer</Button>
        </Card>
      </div>
    );
  }

  if (respondedStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border-none rounded-[2.5rem] overflow-hidden">
          <div className={`h-32 flex items-center justify-center relative ${respondedStatus === 'accepted' ? 'bg-primary' : 'bg-slate-200'}`}>
            <div className="absolute -bottom-10 bg-white p-4 rounded-full shadow-xl">
               {respondedStatus === 'accepted' ? (
                 <CheckCircle2 className="w-12 h-12 text-green-500" />
               ) : (
                 <XCircle className="w-12 h-12 text-slate-400" />
               )}
            </div>
          </div>
          <CardContent className="pt-16 pb-12 px-10 text-center space-y-6">
            <h1 className="text-3xl font-black text-slate-900">
              {respondedStatus === 'accepted' ? "Félicitations !" : "Réponse enregistrée"}
            </h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              {respondedStatus === 'accepted' 
                ? "Vous avez accepté notre proposition d'embauche. Notre équipe RH reviendra vers vous très prochainement pour finaliser votre dossier."
                : "Vous avez décliné notre proposition. Nous vous remercions pour l'intérêt porté à notre entreprise et vous souhaitons une excellente continuation."
              }
            </p>
            <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400 uppercase font-black tracking-widest pt-4">
               <Building2 className="w-3 h-3" /> {offer?.entityName}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-[800px] mx-auto py-12 px-4 space-y-8">
        
        {/* Company Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="bg-primary text-white p-4 rounded-3xl shadow-lg shadow-primary/20">
            <Building2 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase text-primary tracking-[0.2em]">{offer?.entityName}</p>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">Proposition d'embauche</h1>
          </div>
        </div>

        <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
           <CardContent className="p-0">
              {/* Top Banner */}
              <div className="bg-primary/5 p-8 flex items-center justify-between border-b">
                 <div className="flex items-center gap-4">
                   <div className="bg-white p-2.5 rounded-xl shadow-sm"><User className="w-5 h-5 text-primary" /></div>
                   <div>
                     <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Candidat</p>
                     <p className="font-bold text-slate-900">{offer?.candidateDisplayName}</p>
                   </div>
                 </div>
                 <Badge variant="outline" className="bg-white border-primary/20 text-primary font-black uppercase text-[9px] px-3 py-1">
                   Offre Valide
                 </Badge>
              </div>

              {/* Offer Body */}
              <div className="p-8 md:p-12 space-y-12">
                 {/* Job Info */}
                 <div className="space-y-6">
                    <div className="space-y-2">
                       <div className="flex items-center gap-2 text-primary font-black uppercase tracking-[0.1em] text-[10px]">
                          <Briefcase className="w-4 h-4" /> Poste & Missions
                       </div>
                       <h2 className="text-3xl font-black text-slate-900">{offer?.jobTitleName}</h2>
                       <p className="text-slate-500 font-medium">Département : <span className="text-slate-700 font-bold">{offer?.departmentName}</span></p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <DetailCard icon={MapPin} label="Site d'affectation" value={offer?.worksiteName || "Site principal"} />
                       <DetailCard icon={Clock} label="Temps de travail" value={`${offer?.weeklyHours}h / semaine`} />
                       <DetailCard icon={Calendar} label="Prise de poste" value={offer?.proposedStartDate ? new Date(offer.proposedStartDate).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : "À définir"} />
                       <DetailCard icon={FileSignature} label="Type de contrat" value={offer?.contractType || "CDI"} />
                    </div>
                 </div>

                 <Separator className="bg-slate-100" />

                 {/* Remuneration */}
                 <div className="space-y-6">
                    <div className="flex items-center gap-2 text-primary font-black uppercase tracking-[0.1em] text-[10px]">
                       <Euro className="w-4 h-4" /> Conditions financières
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Brut Mensuel</p>
                          <p className="text-2xl font-black text-primary">€ {offer?.proposedGrossMonthly?.toLocaleString('fr-FR')}</p>
                       </div>
                       <div className="md:col-span-2 bg-primary text-white p-6 rounded-3xl shadow-xl shadow-primary/20 relative overflow-hidden">
                          <div className="absolute top-0 right-0 p-2 opacity-10"><Euro className="w-16 h-16" /></div>
                          <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Estimation Brut Annuel</p>
                          <p className="text-3xl font-black">€ {offer?.proposedGrossAnnual?.toLocaleString('fr-FR')}</p>
                       </div>
                    </div>

                    {offer?.salaryNotes && (
                      <div className="p-4 bg-slate-50 border-l-4 border-primary rounded-r-xl text-xs text-slate-600 italic">
                         {offer.salaryNotes}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                       <div className="bg-white p-2 rounded-xl text-blue-600 shadow-sm"><ShieldCheck className="w-4 h-4" /></div>
                       <div className="text-[10px] font-medium text-blue-800 leading-tight">
                         Classification CCNL : <span className="font-black uppercase">{offer?.ccnlName}</span> — Niveau <span className="font-black uppercase">{offer?.levelCode}</span>
                       </div>
                    </div>
                 </div>

                 <Separator className="bg-slate-100" />

                 {/* Actions */}
                 <div className="pt-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <Button 
                        className="h-16 rounded-2xl text-md font-black shadow-xl shadow-primary/20 gap-3"
                        disabled={processing}
                        onClick={() => handleResponse("accepted")}
                       >
                          {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                          Accepter la proposition
                       </Button>
                       <Button 
                        variant="outline" 
                        className="h-16 rounded-2xl text-md font-bold text-slate-500 hover:text-destructive hover:bg-destructive/5 gap-2 border-slate-200"
                        disabled={processing}
                        onClick={() => setDeclineDialogOpen(true)}
                       >
                          <XCircle className="w-5 h-5" />
                          Décliner
                       </Button>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                       <Clock className="w-3 h-3" />
                       <span>Cette offre expire le {offer?.expiresAt ? new Date(offer.expiresAt).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : '...'}</span>
                    </div>
                 </div>
              </div>
           </CardContent>
        </Card>

        <footer className="pt-8 text-center space-y-4">
          <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em]">
            HR Nexus Ecosystem — Propulsé par GenKit AI
          </p>
          <div className="flex justify-center gap-6 text-[9px] font-bold text-slate-300 uppercase">
             <span>Sécurité des données</span>
             <span>Confidentialité</span>
             <span>Support</span>
          </div>
        </footer>
      </main>

      {/* Decline Dialog */}
      <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-slate-900">Décliner l'offre</DialogTitle>
            <DialogDescription className="font-medium text-slate-500">
              Nous sommes désolés de ne pas pouvoir vous accueillir. Si vous le souhaitez, vous pouvez nous indiquer le motif de votre refus.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">Motif du refus (Optionnel)</Label>
              <Textarea 
                placeholder="Ex: Autre opportunité, rémunération, localisation..."
                className="min-h-[120px] rounded-2xl border-slate-200"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between gap-4">
             <Button variant="ghost" onClick={() => setDeclineDialogOpen(false)} disabled={processing} className="font-bold">Annuler</Button>
             <Button variant="destructive" onClick={() => handleResponse("declined", rejectionReason)} disabled={processing} className="rounded-xl px-8 font-black">
                Confirmer le refus
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailCard({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex items-start gap-4 shadow-sm hover:bg-white hover:border-primary/20 transition-all duration-300">
      <div className="bg-white p-2 rounded-xl text-primary shadow-sm border border-slate-50">
        <Icon className="w-5 h-5" />
      </div>
      <div className="space-y-0.5">
        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
        <p className="text-sm font-bold text-slate-700">{value}</p>
      </div>
    </div>
  );
}
