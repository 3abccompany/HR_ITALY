"use client";

import { useMemo, useState } from "react";
import { 
  Loader2, User, Mail, ClipboardList, CheckCircle2, FileX,
  AlertTriangle, Briefcase, Building2, MapPin, 
  ArrowRight, XCircle, UserCheck, Clock, MessageSquare, AlertCircle,
  Calendar, Phone, Fingerprint, Info, ChevronDown, Globe, Home, FileText, Download, Eye,
  GraduationCap, ListTodo, FileSignature
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDoc, useUser, useAuth } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { ApplicationSubmission, AttachmentMetadata } from "@/types/application-submission";
import { Candidate, CandidateStatus, CANDIDATE_STATUS_LABELS } from "@/types/candidate";
import { useFirestore } from "@/firebase/provider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { updateCandidateStatus } from "@/services/candidate.service";
import { createEmploymentOfferDraft, getActiveOfferForCandidate } from "@/services/employment-offer.service";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
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

interface CandidateApplicationPanelProps {
  entityId: string;
  candidate: Candidate | null;
  onStatusUpdate?: (updated: Candidate) => void;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "Prénom",
  lastName: "Nom",
  email: "Email",
  phone: "Téléphone",
  nationalId: "Identifiant national",
  birthDate: "Date de naissance",
  address: "Adresse",
  city: "Ville",
  province: "Province",
  country: "Pays",
  postalCode: "Code Postal",
  experienceYears: "Années d'expérience",
  currentPosition: "Poste actuel / dernier poste",
  educationLevel: "Niveau d'étude",
  availability: "Disponibilité",
  availableFrom: "Disponible à partir du",
  motivationMessage: "Message de motivation",
  consent: "Consentement RGPD",
  expectedSalary: "Prétentions salariales",
};

export function CandidateApplicationPanel({ entityId, candidate, onStatusUpdate }: CandidateApplicationPanelProps) {
  const db = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [loadingAction, setLoadingAction] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const submissionRef = useMemo(() => {
    if (!db || !entityId || !candidate?.applicationSubmissionId) return null;
    return doc(db, `entities/${entityId}/applicationSubmissions`, candidate.applicationSubmissionId) as DocumentReference<ApplicationSubmission>;
  }, [db, entityId, candidate]);

  const { data: submission, loading: loadingSubmission } = useDoc<ApplicationSubmission>(submissionRef);

  const handleStatusChange = async (nextStatus: CandidateStatus, reason?: string) => {
    if (!user) return;
    setLoadingAction(true);
    try {
      await updateCandidateStatus({
        entityId,
        candidateId: candidate!.candidateId,
        personId: candidate!.personId,
        nextStatus,
        rejectionReason: reason,
        actorUid: user.uid
      });
      
      toast({ title: "Statut mis à jour", description: `Le candidat est maintenant : ${CANDIDATE_STATUS_LABELS[nextStatus]}` });
      setRejectDialogOpen(false);
      setRejectionReason("");
      
      if (onStatusUpdate) {
        onStatusUpdate({ ...candidate!, status: nextStatus, rejectionReason: reason });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoadingAction(false);
    }
  };

  const handlePrepareOffer = async () => {
    if (!user || !candidate || !entityId) return;
    setLoadingAction(true);
    try {
      // 1. Check if an active offer already exists
      const existingOffer = await getActiveOfferForCandidate(entityId, candidate.candidateId);
      if (existingOffer) {
        toast({ title: "Proposition déjà existante", description: "Ouverture de la proposition existante." });
        router.push(`/entity/${entityId}/employment-offers/${existingOffer.offerId}`);
        return;
      }

      // 2. Fetch context for pre-filling (Need & Profile)
      let need = null;
      let profile = null;

      if (candidate.recruitmentNeedId) {
         const needSnap = await doc(db!, `entities/${entityId}/recruitmentNeeds`, candidate.recruitmentNeedId);
         const n = await (await import("firebase/firestore")).getDoc(needSnap);
         if (n.exists()) need = n.data() as any;
      }

      if (candidate.jobProfileId || need?.jobProfileId) {
         const profileSnap = await doc(db!, `entities/${entityId}/jobProfiles`, candidate.jobProfileId || need?.jobProfileId);
         const p = await (await import("firebase/firestore")).getDoc(profileSnap);
         if (p.exists()) profile = p.data() as any;
      }

      // 3. Create Draft
      const offerId = await createEmploymentOfferDraft({
        entityId,
        candidate,
        need,
        profile,
        actorUid: user.uid
      });

      toast({ title: "Brouillon initialisé", description: "La proposition d'embauche est prête à être éditée." });
      router.push(`/entity/${entityId}/employment-offers/${offerId}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoadingAction(false);
    }
  };

  const handleViewAttachment = async (attachmentId: string) => {
    if (!candidate?.applicationSubmissionId) return;
    setLoadingFileId(attachmentId);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/entities/${entityId}/submissions/${candidate.applicationSubmissionId}/attachments/${attachmentId}/url`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      if (!response.ok) throw new Error("Impossible de générer le lien d'accès.");
      
      const { url } = await response.json();
      window.open(url, '_blank');
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoadingFileId(null);
    }
  };

  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-secondary/5 rounded-3xl border-dashed border-2">
        <User className="w-12 h-12 text-muted-foreground/20 mb-4" />
        <h3 className="font-bold text-primary">Aucun candidat sélectionné</h3>
        <p className="text-sm text-muted-foreground max-w-[200px] mt-1">Sélectionnez un profil pour consulter le détail de sa candidature.</p>
      </div>
    );
  }

  // Prioritized fallback for submission date
  const bestReceivedDate = submission?.submittedAt || submission?.createdAt || candidate.createdAt || candidate.updatedAt || submission?.attachments?.[0]?.uploadedAt;

  // Define keys that are rendered in dedicated sections to avoid duplicates in "Autres réponses"
  const mappedKeys = [
    'firstName', 'lastName', 'email', 'phone', 'nationalId', 'birthDate', 
    'address', 'city', 'province', 'country', 'availability', 'availableFrom', 
    'experienceYears', 'educationLevel', 'currentPosition', 'motivationMessage', 
    'cv', 'coverLetter', 'consent', 'postalCode'
  ];

  const customAnswers = submission?.answers ? Object.entries(submission.answers).filter(([key]) => {
    return !mappedKeys.includes(key) && !key.startsWith('_');
  }) : [];

  return (
    <Card className="h-full flex flex-col bg-white rounded-3xl border shadow-2xl shadow-primary/5 overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-6 md:p-8 space-y-8 pb-32">
          
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
                <p className="text-xs font-bold text-primary">{formatDateTime(bestReceivedDate)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SummaryMiniItem icon={Briefcase} label="Poste" value={candidate.positionApplied} />
              <SummaryMiniItem icon={Building2} label="Département" value={candidate.department} />
              <SummaryMiniItem icon={MapPin} label="Site" value={submission?.worksiteName || "N/A"} />
            </div>
          </div>

          <Separator className="bg-slate-100" />

          <div className="space-y-3">
             <div className="flex items-center gap-2 px-1">
               <Info className="w-3 h-3 text-muted-foreground" />
               <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Actions de décision RH</p>
             </div>
             <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
               {renderDecisionActions(candidate, loadingAction, handleStatusChange, () => setRejectDialogOpen(true), handlePrepareOffer)}
             </div>
          </div>

          <Section icon={FileText} title="Pièces jointes">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderAttachmentCard(
                  "Curriculum Vitae (CV)", 
                  submission?.attachments?.find(a => a.type === "cv"),
                  loadingFileId,
                  handleViewAttachment
                )}
                {renderAttachmentCard(
                  "Lettre de motivation", 
                  submission?.attachments?.find(a => a.type === "cover_letter"),
                  loadingFileId,
                  handleViewAttachment
                )}
             </div>
          </Section>

          <Section icon={Fingerprint} title="Identité & Contact">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                <AnswerRow label="Prénom" value={submission?.firstName || candidate.displayName.split(' ')[0]} />
                <AnswerRow label="Nom" value={submission?.lastName || candidate.displayName.split(' ').slice(1).join(' ')} />
                <AnswerRow label="Email" value={submission?.email || candidate.email} />
                <AnswerRow label="Téléphone" value={submission?.phone || candidate.phone} />
             </div>
          </Section>

          <Section icon={GraduationCap} title="Informations professionnelles">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                <AnswerRow label="Années d'expérience" value={submission?.answers?.experienceYears} />
                <AnswerRow label="Niveau d'étude" value={submission?.answers?.educationLevel} />
                <AnswerRow label="Poste actuel / dernier poste" value={submission?.answers?.currentPosition} className="col-span-full" />
             </div>
          </Section>

          <Section icon={Clock} title="Disponibilité">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                <AnswerRow label="Disponibilité" value={submission?.answers?.availability} />
                <AnswerRow label="À partir du" value={submission?.answers?.availableFrom} />
             </div>
          </Section>

          {submission?.answers?.motivationMessage && (
            <Section icon={MessageSquare} title="Motivation">
               <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap italic">
                 "{submission.answers.motivationMessage}"
               </div>
            </Section>
          )}

          {customAnswers.length > 0 && (
            <Section icon={ClipboardList} title="Autres réponses">
               <div className="space-y-4">
                  {customAnswers.map(([key, value]) => (
                     <div key={key} className="flex flex-col gap-1 p-3 bg-accent/5 rounded-xl border border-accent/10">
                        <p className="text-[10px] font-black text-accent uppercase tracking-widest">{FIELD_LABELS[key] || formatKeyToLabel(key)}</p>
                        <p className="text-sm font-bold text-slate-800">{formatValue(value)}</p>
                     </div>
                  ))}
               </div>
            </Section>
          )}

          <Section icon={CheckCircle2} title="Consentement RGPD">
             <div className="flex items-center gap-4 p-4 bg-green-50/50 rounded-2xl border border-green-100">
                <div className="bg-white p-2 rounded-xl shadow-sm text-green-600">
                   <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                   <p className="text-xs font-bold text-green-900">Validé lors de la soumission</p>
                   <p className="text-[10px] text-green-700 font-medium">Usage limité au recrutement</p>
                </div>
             </div>
          </Section>

        </div>
      </ScrollArea>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Rejeter la candidature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label htmlFor="reason" className="text-xs font-bold uppercase">Motif du refus</Label>
               <Textarea 
                 id="reason" 
                 value={rejectionReason}
                 onChange={(e) => setRejectionReason(e.target.value)}
                 className="min-h-[120px] rounded-xl"
               />
             </div>
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={() => setRejectDialogOpen(false)} disabled={loadingAction}>Annuler</Button>
             <Button variant="destructive" onClick={() => handleStatusChange("rejected", rejectionReason)} disabled={loadingAction || !rejectionReason.trim()}>
                Confirmer le rejet
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function renderAttachmentCard(label: string, attachment: AttachmentMetadata | undefined, loadingId: string | null, onView: (id: string) => void) {
  if (!attachment) return (
    <div className="flex items-center gap-3 p-3 border rounded-2xl bg-slate-50/50 border-slate-100 opacity-60">
       <div className="bg-white p-2 rounded-xl border text-slate-300 shadow-sm"><FileX className="w-5 h-5" /></div>
       <div className="min-w-0">
          <p className="text-[9px] font-black truncate text-muted-foreground uppercase">{label}</p>
          <p className="text-[8px] font-black text-slate-400 uppercase italic">Non transmis</p>
       </div>
    </div>
  );

  const isLoading = loadingId === attachment.id;

  return (
    <div className="group flex flex-col p-4 border rounded-2xl bg-white border-slate-100 shadow-sm hover:border-accent/30 transition-all">
       <div className="flex items-start justify-between gap-2 mb-3">
          <div className="bg-accent/10 p-2 rounded-xl text-accent"><FileText className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
             <p className="text-[9px] font-black text-muted-foreground uppercase tracking-tight truncate">{label}</p>
             <p className="text-xs font-bold text-slate-800 truncate" title={attachment.fileName}>{attachment.fileName}</p>
          </div>
       </div>
       <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-7 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider bg-accent/5 text-accent hover:bg-accent hover:text-white transition-all gap-1.5"
            onClick={() => onView(attachment.id)}
            disabled={!!loadingId}
          >
             {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
             Consulter
          </Button>
       </div>
    </div>
  );
}

function renderDecisionActions(
  candidate: Candidate, 
  loading: boolean, 
  onStatus: any, 
  onReject: () => void,
  onPrepareOffer: () => void
) {
  const s = candidate.status || "new";
  
  if (s === "accepted") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-green-700 font-bold text-sm bg-green-50 p-3 rounded-xl border border-green-100">
          <CheckCircle2 className="w-5 h-5" /> Candidat validé pour embauche
        </div>
        <Button className="w-full h-11 rounded-xl font-black gap-2 shadow-lg shadow-accent/20" onClick={onPrepareOffer} disabled={loading}>
           <FileSignature className="w-5 h-5" />
           Préparer une proposition
        </Button>
      </div>
    );
  }

  if (s === "hired") return <div className="flex items-center gap-3 text-green-700 font-bold text-sm"><UserCheck className="w-5 h-5" /> Candidat déjà embauché</div>;
  if (s === "rejected") return <div className="flex items-center gap-3 text-red-700 font-bold text-sm"><XCircle className="w-5 h-5" /> Candidature refusée</div>;

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
           <Button variant="outline" className="text-destructive gap-2 h-10 rounded-xl text-xs font-bold" onClick={onReject} disabled={loading}>
             <XCircle className="w-4 h-4" /> Rejeter
           </Button>
         </>
       )}
       {s === "shortlisted" && (
          <Button className="col-span-full h-11 rounded-xl font-bold gap-2" onClick={() => onStatus("interview_to_schedule")} disabled={loading}>
            <Calendar className="w-4 h-4" /> À planifier entretien
          </Button>
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
         <div className="bg-primary/5 p-1.5 rounded-lg text-primary"><Icon className="w-4 h-4" /></div>
         <h4 className="text-[11px] font-black uppercase text-primary tracking-wider">{title}</h4>
       </div>
       <div className="pl-0 sm:pl-8">{children}</div>
    </div>
  );
}

function AnswerRow({ label, value, className }: { label: string, value: any, className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-tight opacity-70">{label}</p>
      <p className="text-sm font-bold text-slate-800">{formatValue(value)}</p>
    </div>
  );
}

function formatKeyToLabel(key: string): string {
  return key.replace(/^custom_/, '').replace(/_\d+$/, '').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatValue(val: any): string {
  if (val === undefined || val === null || val === "") return "Non renseigné";
  if (Array.isArray(val)) return val.length > 0 ? val.join(", ") : "Non renseigné";
  if (typeof val === 'boolean') return val ? "Oui" : "Non";
  return val.toString();
}

/**
 * Robust date formatter that handles Firestore Timestamps (Client & Admin),
 * regular Date objects, and serialized timestamp maps.
 */
function formatDateTime(val: any): string {
  if (!val) return "Date non disponible";
  
  // Detect invalid map ({}) from corrupted storage
  if (typeof val === 'object' && !val.seconds && !val._seconds && !(val instanceof Date) && typeof val.toDate !== 'function') {
    return "Date non disponible";
  }

  try {
    let date: Date | null = null;

    if (val instanceof Date) {
      date = val;
    } else if (typeof val.toDate === 'function') {
      date = val.toDate();
    } else if (val.seconds !== undefined) {
      date = new Date(val.seconds * 1000);
    } else if (val._seconds !== undefined) {
      date = new Date(val._seconds * 1000);
    } else if (typeof val === 'string') {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) date = parsed;
    }

    if (!date || isNaN(date.getTime())) return "Date non disponible";
    
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  } catch (e) {
    return "Date non disponible";
  }
}
