"use client";

import { useMemo, useState } from "react";
import { 
  Loader2, User, Mail, ClipboardList, CheckCircle2, FileX,
  AlertTriangle, Briefcase, Building2, MapPin, 
  ArrowRight, XCircle, UserCheck, Clock, MessageSquare, AlertCircle,
  Calendar, Phone, Fingerprint, Info, ChevronDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDoc, useUser } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { ApplicationSubmission } from "@/types/application-submission";
import { Candidate, CandidateStatus, CANDIDATE_STATUS_LABELS } from "@/types/candidate";
import { useFirestore } from "@/firebase/provider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { updateCandidateStatus } from "@/services/candidate.service";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface CandidateApplicationPanelProps {
  entityId: string;
  candidate: Candidate | null;
  onStatusUpdate?: (updated: Candidate) => void;
}

export function CandidateApplicationPanel({ entityId, candidate, onStatusUpdate }: CandidateApplicationPanelProps) {
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [loadingAction, setLoadingAction] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isOtherOpen, setIsOtherOpen] = useState(false);

  const submissionRef = useMemo(() => {
    if (!db || !entityId || !candidate?.applicationSubmissionId) return null;
    return doc(db, `entities/${entityId}/applicationSubmissions`, candidate.applicationSubmissionId) as DocumentReference<ApplicationSubmission>;
  }, [db, entityId, candidate]);

  const { data: submission, loading: loadingSubmission } = useDoc<ApplicationSubmission>(submissionRef);

  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-secondary/5 rounded-3xl border-dashed border-2">
        <User className="w-12 h-12 text-muted-foreground/20 mb-4" />
        <h3 className="font-bold text-primary">Aucun candidat sélectionné</h3>
        <p className="text-sm text-muted-foreground max-w-[200px] mt-1">Sélectionnez un profil pour consulter le détail de sa candidature.</p>
      </div>
    );
  }

  const handleStatusChange = async (nextStatus: CandidateStatus, reason?: string) => {
    if (!user) return;
    setLoadingAction(true);
    try {
      await updateCandidateStatus({
        entityId,
        candidateId: candidate.candidateId,
        personId: candidate.personId,
        nextStatus,
        rejectionReason: reason,
        actorUid: user.uid
      });
      
      toast({ title: "Statut mis à jour", description: `Le candidat est maintenant : ${CANDIDATE_STATUS_LABELS[nextStatus]}` });
      setRejectDialogOpen(false);
      setRejectionReason("");
      
      if (onStatusUpdate) {
        onStatusUpdate({ ...candidate, status: nextStatus, rejectionReason: reason });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoadingAction(false);
    }
  };

  // Logic to find custom questions (fields not explicitly mapped to UI sections)
  const mappedKeys = [
    'firstName', 'lastName', 'email', 'phone', 'nationalId', 'birthDate', 
    'address', 'city', 'province', 'country', 'availability', 'availableFrom', 
    'experienceYears', 'educationLevel', 'currentPosition', 'motivationMessage', 
    'cv', 'coverLetter', 'consent'
  ];

  const customAnswers = submission?.answers ? Object.entries(submission.answers).filter(([key]) => {
    return !mappedKeys.includes(key) && !key.startsWith('_');
  }) : [];

  return (
    <div className="h-full flex flex-col bg-white rounded-[2rem] border shadow-2xl shadow-primary/5 overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-6 md:p-8 space-y-8 pb-32">
          
          {/* A. Header & Summary */}
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-primary leading-tight">{candidate.displayName}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">
                    {CANDIDATE_STATUS_LABELS[candidate.status] || candidate.status}
                  </Badge>
                  {candidate.source === 'public_application_form' ? (
                    <Badge className="bg-accent text-white text-[9px] uppercase font-black border-none px-2 h-5 leading-none">Formulaire Public</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] uppercase font-bold h-5 leading-none">Saisie Manuelle</Badge>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Candidature reçue</p>
                <p className="text-xs font-bold text-primary">{formatDateTime(submission?.submittedAt || candidate.createdAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SummaryMiniItem icon={Briefcase} label="Poste" value={candidate.positionApplied} />
              <SummaryMiniItem icon={Building2} label="Département" value={candidate.department} />
              <SummaryMiniItem icon={MapPin} label="Site" value={submission?.worksiteName || "N/A"} />
            </div>
          </div>

          <Separator className="bg-slate-100" />

          {/* B. Actions de décision */}
          <div className="space-y-3">
             <div className="flex items-center gap-2 px-1">
               <Info className="w-3 h-3 text-muted-foreground" />
               <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Actions de décision RH</p>
             </div>
             <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
               {renderDecisionActions(candidate, loadingAction, handleStatusChange, () => setRejectDialogOpen(true))}
             </div>
          </div>

          {/* Warnings */}
          {submission?.possibleDuplicate && (
            <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-2xl flex items-start gap-3 animate-pulse">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-bold uppercase">Doublon potentiel détecté</p>
                <p className="text-[10px] opacity-90 font-medium">Un autre dossier avec le même identifiant national ou email existe pour ce recrutement.</p>
              </div>
            </div>
          )}

          {/* C. Identity */}
          <Section icon={Fingerprint} title="Informations d'identité">
             <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <AnswerItem label="Prénom" value={submission?.firstName || candidate.displayName.split(' ')[0]} />
                <AnswerItem label="Nom" value={submission?.lastName || candidate.displayName.split(' ').slice(1).join(' ')} />
                <AnswerItem label="Email" value={submission?.email || candidate.email} copyable />
                <AnswerItem label="Téléphone" value={submission?.phone || candidate.phone} />
                <AnswerItem label="Identifiant National" value={submission?.nationalId} code />
                <AnswerItem label="Date de naissance" value={formatValue(submission?.answers?.birthDate)} />
             </div>
          </Section>

          {/* D. Location */}
          <Section icon={MapPin} title="Localisation">
             <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <AnswerItem label="Ville" value={submission?.answers?.city} />
                <AnswerItem label="Province" value={submission?.answers?.province} />
                <AnswerItem label="Adresse" value={submission?.answers?.address} className="col-span-full" />
                <AnswerItem label="Pays" value={submission?.answers?.country} />
             </div>
          </Section>

          {/* E. Expérience / Formation */}
          <Section icon={Briefcase} title="Expérience & Formation">
             <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <AnswerItem label="Disponibilité" value={submission?.answers?.availability} />
                <AnswerItem label="Date disponible" value={formatValue(submission?.answers?.availableFrom)} />
                <AnswerItem label="Expérience" value={submission?.answers?.experienceYears ? `${submission.answers.experienceYears} ans` : undefined} />
                <AnswerItem label="Niveau d'étude" value={submission?.answers?.educationLevel} />
                <AnswerItem label="Poste actuel / Dernier poste" value={submission?.answers?.currentPosition} className="col-span-full" />
             </div>
          </Section>

          {/* F. Motivation */}
          <Section icon={MessageSquare} title="Message de motivation">
             <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap italic">
                {submission?.answers?.motivationMessage || "Aucun message de motivation saisi."}
             </div>
          </Section>

          {/* G. Questions personnalisées */}
          {customAnswers.length > 0 && (
            <Section icon={ClipboardList} title="Questions spécifiques au formulaire">
               <div className="space-y-6">
                  {customAnswers.map(([key, value]) => (
                     <div key={key} className="space-y-1.5 p-4 bg-accent/5 rounded-2xl border border-accent/10">
                        <p className="text-[10px] font-black text-accent uppercase tracking-widest">Q: {formatKeyToLabel(key)}</p>
                        <p className="text-sm font-bold text-slate-800">{formatValue(value) || "Non renseigné"}</p>
                     </div>
                  ))}
               </div>
            </Section>
          )}

          {/* H. Fichiers */}
          <Section icon={FileX} title="Documents joints">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FilePlaceholder label="Curriculum Vitae (CV)" />
                <FilePlaceholder label="Lettre de motivation" />
             </div>
          </Section>

          {/* I. Consentement */}
          <Section icon={CheckCircle2} title="Consentement & RGPD">
             <div className="flex items-center gap-4 p-4 bg-green-50/50 rounded-2xl border border-green-100">
                <div className="bg-white p-2 rounded-xl shadow-sm text-green-600">
                   <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                   <p className="text-xs font-bold text-green-900">Données personnelles acceptées</p>
                   <p className="text-[10px] text-green-700 font-medium">Validé le {formatDateTime(submission?.consentAcceptedAt || submission?.submittedAt)}</p>
                </div>
             </div>
          </Section>

          {/* J. Catch-all / Raw Data */}
          <Collapsible open={isOtherOpen} onOpenChange={setIsOtherOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full flex items-center justify-between text-muted-foreground hover:text-primary p-0 h-8">
                 <span className="text-[10px] font-black uppercase tracking-widest">Données brutes de soumission</span>
                 <ChevronDown className={cn("w-4 h-4 transition-transform", isOtherOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-2">
               <div className="bg-slate-50 p-4 rounded-xl border border-dashed font-mono text-[9px] overflow-x-auto whitespace-pre">
                  {JSON.stringify(submission?.answers || {}, null, 2)}
               </div>
            </CollapsibleContent>
          </Collapsible>

        </div>
      </ScrollArea>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Rejeter la candidature</DialogTitle>
            <DialogDescription className="text-sm">
              Indiquez le motif du refus pour clore le dossier de {candidate.displayName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label htmlFor="reason" className="text-xs font-bold uppercase">Motif du refus</Label>
               <Textarea 
                 id="reason" 
                 placeholder="Ex: Expérience insuffisante sur la technologie X..." 
                 value={rejectionReason}
                 onChange={(e) => setRejectionReason(e.target.value)}
                 className="min-h-[120px] rounded-xl"
               />
             </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
             <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={loadingAction} className="rounded-xl">Annuler</Button>
             <Button variant="destructive" onClick={() => handleStatusChange("rejected", rejectionReason)} disabled={loadingAction || !rejectionReason.trim()} className="rounded-xl font-bold">
                {loadingAction ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                Confirmer le rejet
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderDecisionActions(candidate: Candidate, loading: boolean, onStatus: any, onReject: () => void) {
  const s = candidate.status || "new";

  if (s === "hired") {
    return (
      <div className="flex items-center gap-3 text-green-700 font-bold text-sm">
        <UserCheck className="w-5 h-5" /> Candidat déjà embauché
      </div>
    );
  }

  if (s === "rejected") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-red-700 font-bold text-sm">
          <XCircle className="w-5 h-5" /> Candidature refusée
        </div>
        {candidate.rejectionReason && (
          <p className="text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-100 italic">"{candidate.rejectionReason}"</p>
        )}
        <Button variant="outline" size="sm" onClick={() => onStatus("under_review")} disabled={loading} className="w-full text-[10px] uppercase font-black tracking-widest h-8 rounded-xl">
           Ré-ouvrir le dossier
        </Button>
      </div>
    );
  }

  if (s === "accepted") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-accent font-bold text-sm">
          <CheckCircle2 className="w-5 h-5" /> Candidat Validé
        </div>
        <p className="text-[10px] text-muted-foreground font-medium">Le candidat est prêt pour l'embauche. Utilisez le bouton d'action dans la liste pour finaliser.</p>
        <Button variant="outline" size="sm" onClick={onReject} disabled={loading} className="w-full text-[10px] h-8 rounded-xl">
           Annuler l'acceptation
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
       {s === "new" && (
         <Button className="col-span-full h-11 rounded-xl font-bold gap-2" onClick={() => onStatus("under_review")} disabled={loading}>
            <Clock className="w-4 h-4" /> Mettre en revue
         </Button>
       )}

       {s === "under_review" && (
         <>
           <Button variant="secondary" className="gap-2 h-10 rounded-xl text-xs font-bold" onClick={() => onStatus("shortlisted")} disabled={loading}>
             <ArrowRight className="w-4 h-4" /> Présélectionner
           </Button>
           <Button variant="outline" className="text-destructive hover:text-destructive gap-2 h-10 rounded-xl text-xs font-bold" onClick={onReject} disabled={loading}>
             <XCircle className="w-4 h-4" /> Rejeter
           </Button>
         </>
       )}

       {s === "shortlisted" && (
          <Button className="col-span-full h-11 rounded-xl font-bold gap-2" onClick={() => onStatus("interview_to_schedule")} disabled={loading}>
            <Calendar className="w-4 h-4" /> À planifier entretien
          </Button>
       )}

       {s === "interview_to_schedule" && (
          <div className="col-span-full text-center p-2 text-[10px] font-black uppercase text-muted-foreground tracking-widest border border-dashed rounded-xl">
             En attente de planification
          </div>
       )}

       {s === "interview_completed" && (
         <>
           <Button variant="secondary" className="bg-green-600 hover:bg-green-700 text-white gap-2 h-11 rounded-xl text-xs font-black uppercase tracking-wider" onClick={() => onStatus("accepted")} disabled={loading}>
             <UserCheck className="w-4 h-4" /> Accepter
           </Button>
           <Button variant="outline" className="text-destructive gap-2 h-11 rounded-xl text-xs font-black uppercase tracking-wider" onClick={onReject} disabled={loading}>
             <XCircle className="w-4 h-4" /> Rejeter
           </Button>
         </>
       )}
    </div>
  );
}

function SummaryMiniItem({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 shadow-sm space-y-1">
       <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-muted-foreground">
          <Icon className="w-3 h-3 text-primary/60" />
          {label}
       </div>
       <p className="text-xs font-bold text-primary truncate">{value || "N/A"}</p>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any, title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-4">
       <div className="flex items-center gap-2">
         <div className="bg-primary/5 p-1.5 rounded-lg text-primary">
            <Icon className="w-4 h-4" />
         </div>
         <h4 className="text-[11px] font-black uppercase text-primary tracking-wider">{title}</h4>
       </div>
       <div className="pl-0 sm:pl-8">{children}</div>
    </div>
  );
}

function AnswerItem({ label, value, code = false, className, copyable = false }: { label: string, value: any, code?: boolean, className?: string, copyable?: boolean }) {
  const formatted = formatValue(value);
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-tight opacity-70">{label}</p>
      <p className={cn(
        "text-sm font-bold", 
        code ? 'font-mono text-xs uppercase' : '', 
        !value ? 'italic text-muted-foreground/30 font-medium' : 'text-slate-800'
      )}>
        {formatted || "Non renseigné"}
      </p>
    </div>
  );
}

function FilePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 border rounded-2xl bg-slate-50/50 border-slate-100">
       <div className="bg-white p-2 rounded-xl border text-slate-300 shadow-sm"><FileX className="w-5 h-5" /></div>
       <div className="min-w-0">
          <p className="text-[9px] font-black truncate text-muted-foreground uppercase tracking-tighter">{label}</p>
          <p className="text-[8px] font-black text-orange-600 uppercase">Fichier non disponible</p>
       </div>
    </div>
  );
}

function formatKeyToLabel(key: string): string {
  return key
    .replace(/^custom_/, '')
    .replace(/_\d+$/, '')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatValue(val: any): string {
  if (val === undefined || val === null || val === "") return "";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === 'boolean') return val ? "Oui" : "Non";
  return val.toString();
}

function formatDateTime(val: any) {
  if (!val) return "N/A";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

