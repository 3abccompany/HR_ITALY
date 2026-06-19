"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Printer, Download, FileBadge, 
  Calendar, Building2, UserCircle, Users, Loader2,
  Scale, Clock, Info, ShieldCheck, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { JobProfile } from "@/types/job-profile";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Job Profile High-Fidelity Preview & Print Page.
 * Restores the "Fiche de Poste" document layout.
 */
export default function JobProfilePreviewPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const jobProfileId = params.jobProfileId as string;
  const { db } = useFirebase();

  const profileRef = useMemo(() => {
    if (!db || !entityId || !jobProfileId) return null;
    return doc(db, `entities/${entityId}/jobProfiles`, jobProfileId) as DocumentReference<JobProfile>;
  }, [db, entityId, jobProfileId]);

  const { data: profile, loading } = useDoc<JobProfile>(profileRef);

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (val: any) => {
    if (!val) return "N/A";
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  const formatDateTime = (val: any) => {
    if (!val) return "N/A";
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center mt-20">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-bold">Document introuvable.</h2>
        <Button variant="link" onClick={() => router.back()}>Retour</Button>
      </div>
    );
  }

  // Strictly check if a real CCNL recommendation exists to show the block
  const hasCcnlRecommendation = !!(profile.defaultCcnlId && profile.defaultCcnlId !== "none_clear");

  return (
    <div className="min-h-screen bg-secondary/5 pb-20 print:bg-white print:pb-0">
      {/* Action Bar - Hidden on print */}
      <header className="sticky top-0 z-50 h-16 bg-white/80 backdrop-blur border-b px-8 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 rounded-xl font-bold">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <FileBadge className="w-5 h-5 text-primary" />
            <span className="font-bold text-primary truncate max-w-[250px]">
              {profile.jobTitleName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2 rounded-xl font-bold bg-white">
            <Printer className="w-4 h-4" /> Imprimer
          </Button>
          <Button size="sm" onClick={handlePrint} className="gap-2 bg-primary rounded-xl font-bold shadow-lg shadow-primary/20">
            <Download className="w-4 h-4" /> Télécharger / PDF
          </Button>
        </div>
      </header>

      <main className="max-w-[850px] mx-auto py-12 px-4 print:py-0 print:px-0">
        <Card className="shadow-2xl border-none rounded-[2.5rem] overflow-hidden print:shadow-none print:border-none print:rounded-none">
          <CardContent className="p-12 md:p-16 print:p-8">
            
            {/* Header Document Section */}
            <div className="flex justify-between items-start border-b-4 border-primary pb-10 mb-10">
              <div className="space-y-6">
                <div className="flex items-center gap-3 text-primary">
                  <div className="bg-primary text-white p-2 rounded-xl">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <span className="text-2xl font-black tracking-tight uppercase">
                    {profile.entityName}
                  </span>
                </div>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight">FICHE DE POSTE</h1>
              </div>
              <div className="text-right space-y-2">
                <div className="flex justify-end gap-2">
                   <Badge variant="default" className="rounded-lg bg-primary text-white px-4 py-1 font-black text-sm">
                     {profile.versionLabel || "V1"}
                   </Badge>
                   <Badge variant="outline" className="rounded-lg uppercase font-bold border-2 h-7 px-3 bg-green-50 text-green-700 border-green-100">
                     {profile.status === 'active' ? 'Officiel' : 'Inactif'}
                   </Badge>
                </div>
                <div className="pt-4 space-y-1">
                  <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Émis le</p>
                  <p className="text-sm font-bold text-slate-800">{formatDate(profile.issueDate)}</p>
                  <p className="text-[9px] text-muted-foreground italic pt-1">
                    Dernière modif : {formatDateTime(profile.lastModifiedAt || profile.updatedAt)}
                  </p>
                </div>
              </div>
            </div>

            {/* Block: RECOMMANDATIONS CONTRACTUELLES INTERNES (RH Only) */}
            {hasCcnlRecommendation && (
               <div className="mb-12 p-8 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 print:bg-white print:border-slate-300">
                  <div className="flex items-center gap-2 text-primary font-black text-xs uppercase tracking-widest mb-6">
                     <Scale className="w-4 h-4" /> Recommandations Contractuelles Internes
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                     <PreviewInfo label="CCNL" value={profile.defaultCcnlName} />
                     <PreviewInfo label="Niveau" value={profile.defaultLevelCode ? `${profile.defaultLevelCode} (${profile.defaultLevelLabel})` : undefined} />
                     <PreviewInfo label="Contrat" value={profile.defaultContractType} />
                     <PreviewInfo label="Temps" value={profile.defaultWeeklyHours ? `${profile.defaultWeeklyHours}h / semaine` : undefined} />
                  </div>
               </div>
            )}

            {/* Core Job Identity Section */}
            <div className="grid grid-cols-2 gap-12 mb-12">
               <SectionBox icon={Building2} title="Département">
                  <p className="font-black text-xl text-slate-800 leading-tight">{profile.departmentName}</p>
               </SectionBox>
               <SectionBox icon={FileBadge} title="Intitulé du poste">
                  <p className="font-black text-xl text-primary leading-tight">{profile.jobTitleName}</p>
               </SectionBox>
            </div>

            {/* Hierarchical Context */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 pt-8 border-t border-slate-100">
              <SectionBox icon={UserCircle} title="Supérieur Hiérarchique (N+1)">
                  <p className="font-bold text-slate-700">{profile.directSupervisorJobTitleName || "Non spécifié"}</p>
              </SectionBox>
              <SectionBox icon={Users} title="Collaborateurs / Équipes">
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.collaboratorJobTitleNames?.length > 0 ? (
                      profile.collaboratorJobTitleNames.map((name, i) => (
                        <span key={i} className="text-sm font-medium text-slate-600">
                          {name}{i < profile.collaboratorJobTitleNames.length - 1 ? ", " : ""}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm italic text-muted-foreground">Aucun collaborateur direct</span>
                    )}
                  </div>
              </SectionBox>
            </div>

            {/* Responsibility & Objectives Sections */}
            <div className="grid grid-cols-1 gap-12 mt-12">
              
              <DocumentSection title="Missions & Responsabilités">
                <ul className="space-y-3">
                  {profile.missionsAndResponsibilities?.map((item, i) => (
                    <li key={i} className="text-sm text-slate-700 flex items-start gap-3">
                      <span className="bg-primary/10 text-primary p-1 rounded-md mt-0.5"><CheckCircle2 className="w-3 h-3" /></span>
                      <span className="flex-1 leading-relaxed">{item}</span>
                    </li>
                  ))}
                  {(!profile.missionsAndResponsibilities || profile.missionsAndResponsibilities.length === 0) && (
                    <li className="text-sm italic text-muted-foreground">Aucune mission définie pour cette version.</li>
                  )}
                </ul>
              </DocumentSection>

              <DocumentSection title="Objectifs du poste">
                <ul className="space-y-3">
                  {profile.objectives?.map((item, i) => (
                    <li key={i} className="text-sm text-slate-700 flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
                      <span className="flex-1 leading-relaxed">{item}</span>
                    </li>
                  ))}
                  {(!profile.objectives || profile.objectives.length === 0) && (
                    <li className="text-sm italic text-muted-foreground">Aucun objectif spécifique défini.</li>
                  )}
                </ul>
              </DocumentSection>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-6">
                <DocumentSection title="Formation requise">
                  <div className="space-y-3">
                    {profile.initialAndProfessionalTraining?.map((item, i) => (
                      <div key={i} className="text-sm text-slate-700 border-l-2 border-primary/20 pl-4 py-1">
                        {item}
                      </div>
                    ))}
                    {(!profile.initialAndProfessionalTraining || profile.initialAndProfessionalTraining.length === 0) && (
                      <p className="text-sm italic text-muted-foreground">Non renseigné</p>
                    )}
                  </div>
                </DocumentSection>

                <DocumentSection title="Expérience professionnelle">
                  <div className="space-y-3">
                    {profile.professionalExperience?.map((item, i) => (
                      <div key={i} className="text-sm text-slate-700 border-l-2 border-accent/30 pl-4 py-1">
                        {item}
                      </div>
                    ))}
                    {(!profile.professionalExperience || profile.professionalExperience.length === 0) && (
                      <p className="text-sm italic text-muted-foreground">Non renseigné</p>
                    )}
                  </div>
                </DocumentSection>
              </div>

              <DocumentSection title="Savoir-être (Soft Skills)">
                <div className="flex flex-wrap gap-2 mt-2">
                   {profile.softSkills?.map((item, i) => (
                     <Badge key={i} variant="secondary" className="rounded-xl bg-secondary/50 text-primary border-none px-4 py-1.5 font-bold print:border print:bg-white print:rounded-md">
                       {item}
                     </Badge>
                   ))}
                   {(!profile.softSkills || profile.softSkills.length === 0) && (
                     <span className="text-sm italic text-muted-foreground">Non spécifié</span>
                   )}
                </div>
              </DocumentSection>

              {profile.notes && (
                <DocumentSection title="Notes complémentaires">
                  <div className="text-sm text-slate-600 bg-secondary/20 p-6 rounded-3xl border border-dashed border-primary/10 italic leading-relaxed print:bg-white print:border-slate-300 print:rounded-xl">
                    {profile.notes}
                  </div>
                </DocumentSection>
              )}

            </div>

            {/* Footer Signatures - Only visible on print or bottom of page */}
            <div className="mt-24 pt-12 border-t grid grid-cols-2 gap-20">
               <div className="space-y-20">
                 <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Le Responsable Hiérarchique</p>
                 <div className="border-b-2 border-slate-200 w-full" />
               </div>
               <div className="space-y-20">
                 <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Le Salarié (Lu et approuvé)</p>
                 <div className="border-b-2 border-slate-200 w-full" />
               </div>
            </div>

            <footer className="mt-16 text-center text-[9px] font-bold text-muted-foreground/60 border-t pt-6 uppercase tracking-widest">
               Fiche de poste générée par HR Nexus Studio — Document ID: {profile.jobProfileId.substring(0, 12)} — Page 1/1
            </footer>

          </CardContent>
        </Card>
      </main>

      {/* Global CSS for Print Optimization */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 20mm;
            size: A4;
          }
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact;
          }
          header, footer.sticky, button, .no-print {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
          }
          .shadow-2xl {
            box-shadow: none !important;
          }
          .border {
            border-color: #e2e8f0 !important;
          }
          .bg-slate-50 {
            background-color: #f8fafc !important;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Visual section for key job attributes.
 */
function SectionBox({ icon: Icon, title, children }: any) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground uppercase text-[10px] font-black tracking-[0.2em]">
        <Icon className="w-3.5 h-3.5 opacity-50" />
        {title}
      </div>
      <div className="pl-0">
        {children}
      </div>
    </div>
  );
}

/**
 * Styled document segment with side accent.
 */
function DocumentSection({ title, children }: any) {
  return (
    <div className="space-y-4 pt-6">
      <h3 className="text-[11px] font-black uppercase text-primary tracking-[0.2em] border-l-4 border-primary pl-4 bg-primary/5 py-2">
        {title}
      </h3>
      <div className="pl-4">
        {children}
      </div>
    </div>
  );
}

/**
 * Minimal data entry for the recommendation grid.
 */
function PreviewInfo({ label, value }: { label: string, value?: string | number }) {
  return (
    <div className="space-y-1">
       <p className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-tight">{label}</p>
       <p className="text-sm font-bold text-slate-800 leading-tight">
         {value || <span className="text-muted-foreground/30 italic font-normal">N/A</span>}
       </p>
    </div>
  );
}
