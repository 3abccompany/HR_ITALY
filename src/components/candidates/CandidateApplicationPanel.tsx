"use client";

import { useMemo } from "react";
import { 
  Loader2, User, Mail, Phone, Fingerprint, Calendar, 
  Briefcase, MapPin, Building2, AlertCircle, AlertTriangle,
  ClipboardList, CheckCircle2, FileX
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { ApplicationSubmission } from "@/types/application-submission";
import { Candidate } from "@/types/candidate";
import { useFirestore } from "@/firebase/provider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CandidateApplicationPanelProps {
  entityId: string;
  candidate: Candidate | null;
}

export function CandidateApplicationPanel({ entityId, candidate }: CandidateApplicationPanelProps) {
  const db = useFirestore();

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

  if (!candidate.applicationSubmissionId) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
        <CandidateSummary candidate={candidate} />
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ClipboardList className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
            <p className="text-muted-foreground text-sm">Aucune soumission de formulaire liée.</p>
            <p className="text-[10px] text-muted-foreground/60 uppercase mt-2 font-bold tracking-widest">Saisie manuelle RH</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Chargement de la candidature...</p>
    </div>
  );

  if (error || (candidate.applicationSubmissionId && !loading && !submission)) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 text-destructive p-6 rounded-xl border border-destructive/20 text-center">
          <FileX className="w-10 h-10 mx-auto mb-4" />
          <h3 className="font-bold">Soumission introuvable</h3>
          <p className="text-sm mt-1">Le document a pu être supprimé ou une erreur de permission est survenue.</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-right-4 duration-300">
        <CandidateSummary candidate={candidate} submission={submission} />

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
    </ScrollArea>
  );
}

function CandidateSummary({ candidate, submission }: { candidate: Candidate, submission?: ApplicationSubmission }) {
  return (
    <div className="space-y-4">
       <div className="flex items-start justify-between">
          <div className="space-y-1">
             <h2 className="text-2xl font-black text-primary leading-none">{candidate.displayName}</h2>
             <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">{candidate.status}</Badge>
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