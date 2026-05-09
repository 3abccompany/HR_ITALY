
"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Printer, Download, FileBadge, 
  Calendar, Building2, UserCircle, Users, Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { JobProfile } from "@/types/job-profile";
import { Badge } from "@/components/ui/badge";

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
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Document introuvable.</h2>
        <Button variant="link" onClick={() => router.back()}>Retour</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/5 pb-20 print:bg-white print:pb-0">
      {/* Action Bar - Hidden on print */}
      <header className="sticky top-0 z-50 h-16 bg-white/80 backdrop-blur border-b px-8 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <FileBadge className="w-5 h-5 text-primary" />
            <span className="font-bold text-primary truncate max-w-[200px]">
              Aperçu : {profile.jobTitleName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer className="w-4 h-4" /> Imprimer
          </Button>
          <Button size="sm" onClick={handlePrint} className="gap-2 bg-primary">
            <Download className="w-4 h-4" /> Télécharger / PDF
          </Button>
        </div>
      </header>

      <main className="max-w-[850px] mx-auto py-12 px-4 print:py-0 print:px-0">
        <Card className="shadow-xl border-none print:shadow-none print:border-none">
          <CardContent className="p-12 print:p-8">
            
            {/* Header Document */}
            <div className="flex justify-between items-start border-b-2 border-primary pb-8 mb-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Building2 className="w-6 h-6" />
                  <span className="text-2xl font-bold tracking-tight uppercase">
                    {profile.entityName}
                  </span>
                </div>
                <h1 className="text-3xl font-black text-foreground">FICHE DE POSTE</h1>
              </div>
              <div className="text-right space-y-1">
                <div className="flex justify-end gap-2">
                   <Badge variant="default" className="rounded-sm bg-primary text-white px-3 font-bold">
                     {profile.versionLabel || "V1"}
                   </Badge>
                   <Badge variant="outline" className="rounded-sm uppercase">
                     {profile.status === 'active' ? 'Officiel' : 'Inactif'}
                   </Badge>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  Émis le : <span className="font-bold text-foreground">{formatDate(profile.issueDate)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Dernière modif : <span className="font-bold text-foreground">{formatDateTime(profile.lastModifiedAt || profile.updatedAt)}</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12 mb-12">
               <SectionBox icon={Building2} title="Département">
                  <p className="font-bold text-lg">{profile.departmentName}</p>
               </SectionBox>
               <SectionBox icon={FileBadge} title="Intitulé du poste">
                  <p className="font-bold text-lg text-primary">{profile.jobTitleName}</p>
               </SectionBox>
            </div>

            <div className="grid grid-cols-1 gap-8">
              
              <div className="grid grid-cols-2 gap-12 pt-8 border-t border-dashed">
                <SectionBox icon={UserCircle} title="Supérieur Hiérarchique (N+1)">
                   <p className="font-medium">{profile.directSupervisorJobTitleName}</p>
                </SectionBox>
                <SectionBox icon={Users} title="Collaborateurs / Équipes">
                   <div className="flex flex-wrap gap-1 mt-1">
                     {profile.collaboratorJobTitleNames?.length > 0 ? (
                       profile.collaboratorJobTitleNames.map((name, i) => (
                         <span key={i} className="text-sm">
                           {name}{i < profile.collaboratorJobTitleNames.length - 1 ? ", " : ""}
                         </span>
                       ))
                     ) : "Néant"}
                   </div>
                </SectionBox>
              </div>

              <DocumentSection title="Missions & Responsabilités">
                <ul className="list-disc pl-5 space-y-2">
                  {profile.missionsAndResponsibilities?.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/90">{item}</li>
                  ))}
                  {(!profile.missionsAndResponsibilities || profile.missionsAndResponsibilities.length === 0) && (
                    <li className="text-sm italic text-muted-foreground">Non défini</li>
                  )}
                </ul>
              </DocumentSection>

              <DocumentSection title="Objectifs du poste">
                <ul className="list-disc pl-5 space-y-2">
                  {profile.objectives?.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/90">{item}</li>
                  ))}
                  {(!profile.objectives || profile.objectives.length === 0) && (
                    <li className="text-sm italic text-muted-foreground">Non défini</li>
                  )}
                </ul>
              </DocumentSection>

              <div className="grid grid-cols-2 gap-12">
                <DocumentSection title="Formation requise">
                  <ul className="space-y-1">
                    {profile.initialAndProfessionalTraining?.map((item, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-primary mt-1">•</span> {item}
                      </li>
                    ))}
                    {(!profile.initialAndProfessionalTraining || profile.initialAndProfessionalTraining.length === 0) && (
                      <li className="text-sm italic text-muted-foreground">Non défini</li>
                    )}
                  </ul>
                </DocumentSection>
                <DocumentSection title="Expérience professionnelle">
                  <ul className="space-y-1">
                    {profile.professionalExperience?.map((item, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-primary mt-1">•</span> {item}
                      </li>
                    ))}
                    {(!profile.professionalExperience || profile.professionalExperience.length === 0) && (
                      <li className="text-sm italic text-muted-foreground">Non défini</li>
                    )}
                  </ul>
                </DocumentSection>
              </div>

              <DocumentSection title="Savoir-être (Soft Skills)">
                <div className="flex flex-wrap gap-2 mt-2">
                   {profile.softSkills?.map((item, i) => (
                     <Badge key={i} variant="secondary" className="rounded-sm bg-secondary/30 text-foreground px-3 py-1 font-medium print:border print:bg-white">
                       {item}
                     </Badge>
                   ))}
                   {(!profile.softSkills || profile.softSkills.length === 0) && (
                     <span className="text-sm italic text-muted-foreground">Non défini</span>
                   )}
                </div>
              </DocumentSection>

              {profile.notes && (
                <DocumentSection title="Notes complémentaires">
                  <p className="text-sm italic text-muted-foreground bg-secondary/10 p-4 rounded-md print:bg-white print:border print:p-2">
                    {profile.notes}
                  </p>
                </DocumentSection>
              )}

            </div>

            {/* Footer Signatures */}
            <div className="mt-20 pt-12 border-t grid grid-cols-2 gap-20">
               <div className="space-y-16">
                 <p className="text-xs font-bold uppercase text-muted-foreground">Signature Responsable Hiérarchique</p>
                 <div className="border-b border-muted-foreground w-full" />
               </div>
               <div className="space-y-16">
                 <p className="text-xs font-bold uppercase text-muted-foreground">Signature Salarié (Lu et approuvé)</p>
                 <div className="border-b border-muted-foreground w-full" />
               </div>
            </div>

            <footer className="mt-12 text-center text-[10px] text-muted-foreground border-t pt-4">
               Document généré par HR Nexus Studio - Réf: {profile.jobProfileId} - Page 1/1
            </footer>

          </CardContent>
        </Card>
      </main>

      <style jsx global>{`
        @media print {
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
          .shadow-xl {
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function SectionBox({ icon: Icon, title, children }: any) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground uppercase text-[10px] font-bold tracking-widest">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      <div className="pl-5">
        {children}
      </div>
    </div>
  );
}

function DocumentSection({ title, children }: any) {
  return (
    <div className="space-y-3 pt-6">
      <h3 className="text-sm font-black uppercase text-primary tracking-wider border-l-4 border-primary pl-3 bg-primary/5 py-1">
        {title}
      </h3>
      <div className="pl-4">
        {children}
      </div>
    </div>
  );
}
