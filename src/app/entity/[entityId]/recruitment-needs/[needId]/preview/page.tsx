
"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Edit, FileText, Calendar, Building2, 
  MapPin, Users, Loader2, Briefcase, Info, 
  CheckCircle2, AlertCircle, Clock, LayoutDashboard,
  FileCode
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Separator } from "@/components/ui/separator";

export default function RecruitmentNeedPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const needId = params.needId as string;
  const { db } = useFirebase();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  const needRef = useMemo(() => {
    if (!db || !entityId || !needId) return null;
    return doc(db, `entities/${entityId}/recruitmentNeeds`, needId) as DocumentReference<RecruitmentNeed>;
  }, [db, entityId, needId]);

  const { data: need, loading } = useDoc<RecruitmentNeed>(needRef);

  const canUpdate = hasPermission("recruitmentNeeds.update");
  const canCreateForm = hasPermission("applicationForms.create");

  if (loading || membershipLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!need) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-20">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Besoin introuvable</h2>
        <p className="text-muted-foreground mb-6">Le document demandé n'existe pas ou vous n'avez pas les droits d'accès.</p>
        <Button onClick={() => router.back()}>Retour à la liste</Button>
      </div>
    );
  }

  const progress = need.requestedHeadcount > 0 ? (need.fulfilledHeadcount / need.requestedHeadcount) * 100 : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Ouvert</Badge>;
      case 'partially_fulfilled': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">Partiellement pourvu</Badge>;
      case 'fulfilled': return <Badge className="bg-green-500 hover:bg-green-600 border-none">Pourvu</Badge>;
      case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulé</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent': return <Badge className="bg-red-600 text-white border-none uppercase text-[10px]">Urgent</Badge>;
      case 'high': return <Badge className="bg-orange-500 text-white border-none uppercase text-[10px]">Haute</Badge>;
      case 'medium': return <Badge variant="outline" className="text-blue-600 border-blue-200 uppercase text-[10px]">Moyenne</Badge>;
      default: return <Badge variant="outline" className="uppercase text-[10px]">Basse</Badge>;
    }
  };

  const formatDate = (val: any) => {
    if (!val) return "N/A";
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-secondary/5 pb-24">
      {/* Header Bar */}
      <header className="sticky top-0 z-50 h-16 bg-white/80 backdrop-blur border-b px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-primary" />
            <span className="font-bold text-primary truncate max-w-[300px]">
              Consulter Besoin : {need.jobTitleName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canCreateForm && ["open", "partially_fulfilled"].includes(need.status) && (
             <Button 
               variant="outline" 
               size="sm" 
               className="gap-2 text-accent border-accent/20 hover:bg-accent/10"
               onClick={() => router.push(`/entity/${entityId}/application-forms/new?recruitmentNeedId=${needId}`)}
             >
               <FileCode className="w-4 h-4" /> Créer formulaire de candidature
             </Button>
          )}
          {canUpdate && (need.status === 'open' || need.status === 'partially_fulfilled') && (
            <Button size="sm" onClick={() => router.push(`/entity/${entityId}/recruitment-needs/${needId}/edit`)} className="gap-2">
              <Edit className="w-4 h-4" /> Modifier le besoin
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-12 px-4 space-y-8">
        
        {/* Progress & Quick Stats Card */}
        <Card className="border-primary/10 shadow-sm overflow-hidden">
          <div className="bg-primary/5 px-6 py-4 border-b flex items-center justify-between">
             <div className="flex items-center gap-4">
               {getStatusBadge(need.status)}
               {getPriorityBadge(need.priority)}
             </div>
             <div className="flex items-center gap-6 text-xs text-muted-foreground font-medium">
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Émis le: {formatDate(need.issueDate)}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Mis à jour: {formatDate(need.updatedAt)}</span>
             </div>
          </div>
          <CardContent className="p-8">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="flex-1 space-y-2">
                   <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Progression du recrutement</h3>
                      <span className="text-2xl font-black text-primary">{need.fulfilledHeadcount} / {need.requestedHeadcount} <span className="text-sm font-normal text-muted-foreground">pourvus</span></span>
                   </div>
                   <Progress value={progress} className="h-3" />
                   <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground pt-1">
                      <span>Début : 0</span>
                      <span>Restant : {need.remainingHeadcount}</span>
                      <span>Objectif : {need.requestedHeadcount}</span>
                   </div>
                </div>
                <Separator orientation="vertical" className="hidden md:block h-16" />
                <div className="grid grid-cols-2 gap-8 min-w-[250px]">
                   <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Demandeur</p>
                      <p className="font-bold text-sm truncate">{need.requesterName}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Site / Localisation</p>
                      <p className="font-bold text-sm truncate">{need.worksiteName}</p>
                   </div>
                </div>
             </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Info Column */}
          <div className="lg:col-span-2 space-y-8">
             
             {/* General Details */}
             <Card className="border-primary/10">
                <CardHeader className="border-b bg-secondary/10">
                   <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                      <Info className="w-4 h-4 text-primary" /> Détails de la demande
                   </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <InfoItem label="Entreprise" value={need.companyName} />
                      <InfoItem label="Département" value={need.departmentName} />
                      <InfoItem label="Poste source" value={need.jobTitleName} />
                      <InfoItem label="Fiche de poste" value={`${need.jobProfileTitle} (${need.jobProfileVersion || 'V1'})`} />
                      <InfoItem label="Type de contrat" value={need.contractType} />
                      <InfoItem label="Type d'emploi" value={need.employmentType} />
                      <InfoItem label="Temps de travail" value={need.workingTime} />
                      <InfoItem label="Disponibilité souhaitée" value={formatDate(need.desiredAvailabilityDate)} />
                      {need.applicationDeadline && (
                         <InfoItem label="Date limite de candidature" value={formatDate(need.applicationDeadline)} />
                      )}
                   </div>
                   
                   {(need.reason || need.notes) && (
                     <div className="mt-8 pt-6 border-t space-y-4">
                        {need.reason && (
                           <div className="space-y-1">
                              <p className="text-[10px] uppercase font-bold text-muted-foreground">Motif du recrutement</p>
                              <p className="text-sm italic text-foreground/80">{need.reason}</p>
                           </div>
                        )}
                        {need.notes && (
                           <div className="space-y-1">
                              <p className="text-[10px] uppercase font-bold text-muted-foreground">Notes internes</p>
                              <p className="text-sm bg-secondary/20 p-3 rounded-lg border border-dashed">{need.notes}</p>
                           </div>
                        )}
                     </div>
                   )}
                </CardContent>
             </Card>

             {/* Job Offer Section */}
             <Card className="border-accent/20 overflow-hidden">
                <CardHeader className="bg-accent/10 border-b">
                   <CardTitle className="text-md font-black uppercase tracking-widest text-accent-foreground flex items-center gap-2">
                      <FileText className="w-5 h-5" /> Offre d'emploi publique
                   </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-8">
                   <div className="space-y-2">
                      <h4 className="text-sm font-bold text-primary">Texte de l'annonce</h4>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 p-4 bg-accent/5 rounded-xl border border-accent/10">
                         {need.jobOfferText || "Aucun texte rédigé."}
                      </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                         <InfoItem label="Localisation précise" value={need.jobOfferLocation} icon={MapPin} />
                         <InfoItem label="Planning / Horaires" value={need.jobOfferPlanning} icon={Clock} />
                      </div>
                      <div className="space-y-4">
                         <InfoItem label="Avantages" value={need.jobOfferBenefits} />
                      </div>
                   </div>

                   <div className="pt-6 border-t">
                      <h4 className="text-sm font-bold text-primary mb-2">Instructions de candidature</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                         {need.jobOfferApplicationInstructions || "Candidature standard via plateforme."}
                      </p>
                   </div>
                </CardContent>
             </Card>
          </div>

          {/* Right Column: Snapshots */}
          <div className="space-y-8">
             <Card className="border-primary/10 shadow-sm sticky top-24">
                <CardHeader className="border-b bg-secondary/5">
                   <CardTitle className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
                      <LayoutDashboard className="w-3.5 h-3.5" /> Snapshot Fiche de poste
                   </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-8">
                   
                   <SnapshotSection title="Missions" items={need.jobOfferMissions} />
                   <SnapshotSection title="Savoir-être" items={need.jobOfferSkills} />
                   <SnapshotSection title="Expérience" items={need.jobOfferExperience} />
                   <SnapshotSection title="Formation" items={need.jobOfferTraining} />

                   <div className="pt-4 mt-4 border-t text-[10px] text-muted-foreground leading-tight italic">
                      Ces informations ont été figées lors de l'ouverture du besoin à partir de la fiche de poste source.
                   </div>
                </CardContent>
             </Card>
          </div>

        </div>
      </main>
    </div>
  );
}

function InfoItem({ label, value, icon: Icon }: { label: string; value: string | number | undefined; icon?: any }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">{label}</p>
      <div className="flex items-center gap-2">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/60" />}
         <p className="text-sm font-semibold">{value || "Non renseigné"}</p>
      </div>
    </div>
  );
}

function SnapshotSection({ title, items }: { title: string; items: string[] | undefined }) {
   if (!items || items.length === 0) return null;
   return (
      <div className="space-y-3">
         <h4 className="text-[10px] font-black uppercase text-primary border-l-2 border-primary pl-2">{title}</h4>
         <ul className="space-y-1.5">
            {items.map((item, i) => (
               <li key={i} className="text-xs flex items-start gap-2 text-foreground/80">
                  <span className="text-primary mt-1">•</span>
                  <span>{item}</span>
               </li>
            ))}
         </ul>
      </div>
   );
}
