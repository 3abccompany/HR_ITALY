"use client";

import { useMemo, useState } from "react";
import { 
  Loader2, User, Mail, ClipboardList, CheckCircle2, FileX,
  AlertTriangle, Briefcase, Building2, MapPin, 
  ArrowRight, XCircle, UserCheck, Clock, MessageSquare, AlertCircle
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

  const submissionRef = useMemo(() => {
    if (!db || !entityId || !candidate?.applicationSubmissionId) return null;
    return doc(db, `entities/${entityId}/applicationSubmissions`, candidate.applicationSubmissionId) as DocumentReference<ApplicationSubmission>;
  }, [db, entityId, candidate]);

  const { data: submission, loading, error } = useDoc<ApplicationSubmission>(submissionRef);

  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-secondary/5 rounded-xl border-dashed border-2">
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

  const renderDecisionActions = () => {
    const s = candidate.status || "new";

    if (s === "hired") {
      return (
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-center gap-3">
          <UserCheck className="w-5 h-5 text-green-600" />
          <p className="text-xs font-bold text-green-800 uppercase tracking-tight">Candidat déjà embauché</p>
        </div>
      );
    }

    if (s === "rejected") {
      return (
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-red-800">
            <XCircle className="w-4 h-4" />
            <p className="text-xs font-bold uppercase">Candidature refusée</p>
          </div>
          {candidate.rejectionReason && (
            <p className="text-xs text-red-700 italic border-l-2 border-red-200 pl-3 py-1">
              "{candidate.rejectionReason}"
            </p>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full text-[10px] h-7 mt-2" 
            onClick={() => handleStatusChange("under_review")}
            disabled={loadingAction}
          >
            Ré-ouvrir le dossier
          </Button>
        </div>
      );
    }

    if (s === "accepted") {
      return (
        <div className="bg-accent/10 border border-accent/20 p-4 rounded-xl space-y-3">
           <div className="flex items-center gap-2 text-accent">
             <CheckCircle2 className="w-5 h-5" />
             <p className="text-xs font-black uppercase tracking-tight">Candidat Accepté</p>
           </div>
           <p className="text-[10px] text-muted-foreground leading-relaxed">
             La validation finale a été prononcée. La conversion en employé se fera dans une étape ultérieure du processus Studio.
           </p>
           <Button variant="outline" size="sm" className="w-full h-8 text-[10px]" onClick={() => setRejectDialogOpen(true)}>
             Annuler l'acceptation / Rejeter
           </Button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">Actions de décision</p>
        <div className="grid grid-cols-2 gap-2">
           {s === "new" && (
             <Button className="col-span-full h-10 gap-2" onClick={() => handleStatusChange("under_review")} disabled={loadingAction}>
                <Clock className="w-4 h-4" /> Mettre en revue
             </Button>
           )}

           {s === "under_review" && (
             <>
               <Button variant="secondary" className="gap-2 h-9 text-xs" onClick={() => handleStatusChange("shortlisted")} disabled={loadingAction}>
                 <ArrowRight className="w-3.5 h-3.5" /> Présélectionner
               </Button>
               <Button variant="outline" className="text-destructive hover:text-destructive gap-2 h-9 text-xs" onClick={() => setRejectDialogOpen(true)} disabled={loadingAction}>
                 <XCircle className="w-3.5 h-3.5" /> Rejeter
               </Button>
             </>
           )}

           {s === "shortlisted" && (
              <Button className="col-span-full h-10 gap-2" onClick={() => handleStatusChange("interview_to_schedule")} disabled={loadingAction}>
                <MessageSquare className="w-4 h-4" /> À planifier entretien
              </Button>
           )}

           {s === "interview_to_schedule" && (
             <div className="col-span-full p-4 border border-dashed rounded-xl bg-secondary/10 text-center">
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Phase : Entretien</p>
                <p className="text-xs mt-1 text-primary">Utilisez le module "Entretiens" pour planifier.</p>
             </div>
           )}

           {s === "interview_completed" && (
             <>
               <Button variant="secondary" className="bg-green-600 hover:bg-green-700 text-white gap-2 h-10 text-xs" onClick={() => handleStatusChange("accepted")} disabled={loadingAction}>
                 <UserCheck className="w-4 h-4" /> Accepter
               </Button>
               <Button variant="outline" className="text-destructive gap-2 h-10 text-xs" onClick={() => setRejectDialogOpen(true)} disabled={loadingAction}>
                 <XCircle className="w-4 h-4" /> Rejeter
               </Button>
             </>
           )}
        </div>
      </div>
    );
  };

  return (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-right-4 duration-300">
        <CandidateSummary candidate={candidate} submission={submission} />

        {/* Workflow Actions Section */}
        <div className="px-1">{renderDecisionActions()}</div>

        {submission?.possibleDuplicate && (
          <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-xs font-bold uppercase">Doublon potentiel détecté</p>
              <p className="text-xs opacity-90">Un autre dossier avec le même identifiant ou email existe pour ce recrutement.</p>
            </div>
          </div>
        )}

        <Card className="border-primary/10 shadow-sm">
          <CardHeader className="bg-primary/5 py-4 border-b">
            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" /> Détails de la réponse
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-8">
            {candidate.applicationSubmissionId ? (
              <div className="grid grid-cols-1 gap-6">
                <Section title="Informations d'identité">
                  <div className="grid grid-cols-2 gap-4">
                      <AnswerItem label="National ID / Code Fiscal" value={submission?.nationalId} code />
                      <AnswerItem label="Date de naissance" value={formatValue(submission?.answers?.birthDate)} />
                      <AnswerItem label="Email de contact" value={submission?.email} />
                      <AnswerItem label="Téléphone" value={submission?.phone} />
                  </div>
                </Section>

                <Section title="Localisation">
                  <div className="grid grid-cols-2 gap-4">
                      <AnswerItem label="Ville" value={submission?.answers?.city} />
                      <AnswerItem label="Province" value={submission?.answers?.province} />
                      <AnswerItem label="Adresse" value={submission?.answers?.address} className="col-span-full" />
                  </div>
                </Section>

                <Section title="Profil Professionnel">
                  <div className="grid grid-cols-2 gap-4">
                      <AnswerItem label="Disponibilité" value={submission?.answers?.availability} />
                      <AnswerItem label="Date dispo." value={formatValue(submission?.answers?.availableFrom)} />
                      <AnswerItem label="Expérience" value={submission?.answers?.experienceYears ? `${submission.answers.experienceYears} ans` : undefined} />
                      <AnswerItem label="Niveau d'étude" value={submission?.answers?.educationLevel} />
                      <AnswerItem label="Poste actuel" value={submission?.answers?.currentPosition} className="col-span-full" />
                  </div>
                </Section>

                {renderCustomQuestions(submission)}

                <Section title="Documents & Consentement">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-secondary/20 rounded-lg border border-dashed">
                        <div className="bg-white p-2 rounded shadow-sm"><CheckCircle2 className="w-4 h-4 text-green-600" /></div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">RGPD / Consentement</p>
                          <p className="text-[10px] font-medium">Accepté le {formatDateTime(submission?.consentAcceptedAt)}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <FilePlaceholder label="Curriculum Vitae (CV)" />
                        <FilePlaceholder label="Lettre de motivation" />
                    </div>
                  </div>
                </Section>
              </div>
            ) : (
              <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                <AlertCircle className="w-10 h-10 opacity-20 mb-3" />
                <p className="text-sm font-medium">Aucune soumission de formulaire liée.</p>
                <p className="text-[10px] uppercase font-bold tracking-tighter mt-1 opacity-60">Saisie manuelle RH uniquement</p>
              </div>
            )}
          </CardContent>
        </Card>

        {submission?.answers?.motivationMessage && (
           <Card className="border-accent/20 bg-accent/5">
             <CardHeader className="py-3 border-b border-accent/10">
               <CardTitle className="text-[10px] font-black uppercase text-accent tracking-widest">Message de motivation</CardTitle>
             </CardHeader>
             <CardContent className="p-4">
               <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{submission.answers.motivationMessage}</p>
             </CardContent>
           </Card>
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Rejeter la candidature</DialogTitle>
            <DialogDescription>
              Veuillez indiquer le motif du refus. Cette information sera conservée dans le dossier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label htmlFor="reason">Motif du refus</Label>
               <Textarea 
                 id="reason" 
                 placeholder="Ex: Profil ne correspondant pas aux pré-requis techniques..." 
                 value={rejectionReason}
                 onChange={(e) => setRejectionReason(e.target.value)}
                 className="min-h-[100px]"
               />
             </div>
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={loadingAction}>Annuler</Button>
             <Button variant="destructive" onClick={() => handleStatusChange("rejected", rejectionReason)} disabled={loadingAction || !rejectionReason.trim()}>
                {loadingAction ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                Confirmer le rejet
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}

function CandidateSummary({ candidate, submission }: { candidate: Candidate, submission?: ApplicationSubmission }) {
  const s = (candidate.status || "new") as CandidateStatus;
  
  return (
    <div className="space-y-4">
       <div className="flex items-start justify-between">
          <div className="space-y-1">
             <h2 className="text-2xl font-black text-primary leading-none">{candidate.displayName}</h2>
             <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">
                  {CANDIDATE_STATUS_LABELS[s]}
                </Badge>
                {candidate.source === 'public_application_form' ? (
                  <Badge className="bg-accent text-white text-[9px] uppercase font-black border-none px-1.5 h-4 leading-none">Formulaire Public</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[9px] uppercase font-bold h-4 leading-none">Saisie Manuelle</Badge>
                )}
             </div>
          </div>
          <div className="text-right">
             <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Candidature reçue le</p>
             <p className="text-sm font-bold text-primary">{formatDateTime(submission?.submittedAt || candidate.createdAt)}</p>
          </div>
       </div>

       <div className="grid grid-cols-3 gap-2">
          <SummaryMiniItem icon={Briefcase} label="Poste" value={candidate.positionApplied} />
          <SummaryMiniItem icon={Building2} label="Département" value={candidate.department} />
          <SummaryMiniItem icon={MapPin} label="Site" value={submission?.worksiteName || "N/A"} />
       </div>
       <Separator />
    </div>
  );
}

function SummaryMiniItem({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="bg-white p-3 rounded-xl border shadow-sm space-y-1">
       <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-muted-foreground">
          <Icon className="w-3 h-3 text-primary/60" />
          {label}
       </div>
       <p className="text-xs font-bold text-primary truncate">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-3">
       <h4 className="text-[11px] font-black uppercase text-primary border-l-2 border-primary pl-2 tracking-wider">{title}</h4>
       <div className="pl-2">{children}</div>
    </div>
  );
}

function AnswerItem({ label, value, code = false, className }: { label: string, value: any, code?: boolean, className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${code ? 'font-mono text-xs uppercase' : ''} ${!value ? 'italic text-muted-foreground/50 font-normal' : 'text-slate-800'}`}>
        {formatValue(value) || "Non renseigné"}
      </p>
    </div>
  );
}

function FilePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-2 border rounded-lg bg-slate-50">
       <div className="bg-white p-1.5 rounded border text-muted-foreground"><FileX className="w-4 h-4" /></div>
       <div className="min-w-0">
          <p className="text-[9px] font-bold truncate text-muted-foreground uppercase">{label}</p>
          <p className="text-[8px] font-bold text-orange-600 uppercase">Fichier non disponible</p>
       </div>
    </div>
  );
}

function renderCustomQuestions(submission: ApplicationSubmission | undefined) {
  if (!submission?.answers) return null;
  
  // Identify custom questions (keys starting with 'custom_')
  const customEntries = Object.entries(submission.answers).filter(([key]) => key.startsWith('custom_'));
  
  if (customEntries.length === 0) return null;

  return (
    <Section title="Questions spécifiques">
       <div className="grid grid-cols-1 gap-4">
          {customEntries.map(([key, value]) => (
             <div key={key} className="space-y-1">
                <p className="text-xs font-bold text-slate-600 italic">Q: {formatKeyToLabel(key)}</p>
                <div className="bg-secondary/10 p-2 rounded-lg border-l-2 border-primary/20">
                   <p className="text-sm font-medium text-slate-800">{formatValue(value)}</p>
                </div>
             </div>
          ))}
       </div>
    </Section>
  );
}

function formatKeyToLabel(key: string): string {
  // Remove 'custom_' and trailing timestamp suffix
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
