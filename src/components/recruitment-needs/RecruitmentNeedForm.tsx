
"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, Loader2, ShieldCheck, ArrowLeft, Building2, Briefcase, 
  MapPin, Calendar, Clock, FileText, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { createRecruitmentNeed, updateRecruitmentNeed } from "@/services/recruitment-need.service";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { JobProfile } from "@/types/job-profile";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

interface RecruitmentNeedFormProps {
  entityId: string;
  entityName: string;
  requesterName: string;
  userId: string;
  initialData?: RecruitmentNeed;
  isEditing?: boolean;
}

const initialForm = {
  requesterName: "",
  requestedHeadcount: 1,
  worksiteId: null as string | null,
  worksiteName: "Site principal",
  customWorksiteName: "",
  contractType: "CDI",
  employmentType: "Nouveau poste",
  workingTime: "Temps plein",
  jobProfileId: "",
  issueDate: new Date().toISOString().split('T')[0],
  desiredAvailabilityDate: "",
  applicationDeadline: "",
  priority: "medium" as "low" | "medium" | "high" | "urgent",
  reason: "",
  notes: "",
  // Offer fields
  jobOfferTitle: "",
  jobOfferSummary: "",
  jobOfferDescription: "",
  jobOfferMissions: "",
  jobOfferSkills: "",
  jobOfferExperience: "",
  jobOfferTraining: "",
  jobOfferLocation: "",
  jobOfferSalaryRange: "",
  jobOfferBenefits: "",
  jobOfferWorkingHours: "",
  jobOfferApplicationInstructions: ""
};

export function RecruitmentNeedForm({ entityId, entityName, requesterName, userId, initialData, isEditing = false }: RecruitmentNeedFormProps) {
  const router = useRouter();
  const { db } = useFirebase();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({ ...initialForm, requesterName });
  const [loading, setLoading] = useState(false);

  // Queries
  const profilesQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("updatedAt", "desc"));
  }, [db, entityId]);

  const { data: jobProfiles } = useCollection<JobProfile>(profilesQuery);
  const activeProfiles = useMemo(() => jobProfiles?.filter(p => p.status === "active") || [], [jobProfiles]);

  // Load initial data for editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        requesterName: initialData.requesterName,
        requestedHeadcount: initialData.requestedHeadcount,
        worksiteId: initialData.worksiteId,
        worksiteName: initialData.worksiteName,
        customWorksiteName: initialData.worksiteId ? "" : (["Site principal", "À définir"].includes(initialData.worksiteName) ? "" : initialData.worksiteName),
        contractType: initialData.contractType,
        employmentType: initialData.employmentType,
        workingTime: initialData.workingTime,
        jobProfileId: initialData.jobProfileId,
        issueDate: initialData.issueDate,
        desiredAvailabilityDate: initialData.desiredAvailabilityDate,
        applicationDeadline: initialData.applicationDeadline || "",
        priority: initialData.priority,
        reason: initialData.reason || "",
        notes: initialData.notes || "",
        jobOfferTitle: initialData.jobOfferTitle || "",
        jobOfferSummary: initialData.jobOfferSummary || "",
        jobOfferDescription: initialData.jobOfferDescription || "",
        jobOfferMissions: initialData.jobOfferMissions || "",
        jobOfferSkills: initialData.jobOfferSkills || "",
        jobOfferExperience: initialData.jobOfferExperience || "",
        jobOfferTraining: initialData.jobOfferTraining || "",
        jobOfferLocation: initialData.jobOfferLocation || "",
        jobOfferSalaryRange: initialData.jobOfferSalaryRange || "",
        jobOfferBenefits: initialData.jobOfferBenefits || "",
        jobOfferWorkingHours: initialData.jobOfferWorkingHours || "",
        jobOfferApplicationInstructions: initialData.jobOfferApplicationInstructions || ""
      });
    }
  }, [initialData]);

  const handleProfileChange = (profileId: string) => {
    const profile = activeProfiles.find(p => p.jobProfileId === profileId);
    if (!profile) return;

    setFormData(prev => ({
      ...prev,
      jobProfileId: profileId,
      jobOfferTitle: profile.jobTitleName,
      jobOfferMissions: profile.missionsAndResponsibilities?.join("\n• ") || "",
      jobOfferSkills: profile.softSkills?.join(", ") || "",
      jobOfferExperience: profile.professionalExperience?.join("\n") || "",
      jobOfferTraining: profile.initialAndProfessionalTraining?.join("\n") || "",
      jobOfferLocation: prev.worksiteName === "Autre site" ? prev.customWorksiteName : prev.worksiteName
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !entityId) return;

    if (formData.requestedHeadcount < 1) {
      toast({ variant: "destructive", title: "Erreur", description: "Le nombre de personnes doit être supérieur à 0." });
      return;
    }

    setLoading(true);
    try {
      const profile = activeProfiles.find(p => p.jobProfileId === formData.jobProfileId);
      if (!profile) throw new Error("Veuillez sélectionner une fiche de poste valide.");

      const finalWorksiteName = formData.worksiteName === "Autre site" ? formData.customWorksiteName : formData.worksiteName;

      const payload = {
        ...formData,
        entityName,
        companyName: entityName,
        requesterUid: userId,
        worksiteName: finalWorksiteName,
        jobProfileTitle: profile.jobTitleName,
        jobProfileVersion: profile.versionLabel,
        departmentId: profile.departmentId,
        departmentName: profile.departmentName,
        jobTitleId: profile.jobTitleId,
        jobTitleName: profile.jobTitleName,
      };

      if (isEditing && initialData) {
        await updateRecruitmentNeed(entityId, initialData.needId, payload, userId);
        toast({ title: "Besoin mis à jour", description: "La demande a été modifiée avec succès." });
      } else {
        await createRecruitmentNeed(entityId, payload, userId);
        toast({ title: "Besoin créé", description: "La demande de recrutement a été ouverte." });
      }
      router.push(`/entity/${entityId}/recruitment-needs`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-primary">
              {isEditing ? "Modifier le besoin RH" : "Nouvelle demande de recrutement"}
            </h1>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
              {isEditing ? `Besoin ID: ${initialData?.needId}` : "Ouverture d'un nouveau poste"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" type="button" onClick={() => router.back()} disabled={loading}>
            Annuler
          </Button>
          <Button type="submit" disabled={loading || !formData.jobProfileId}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {isEditing ? "Enregistrer les modifications" : "Ouvrir le besoin RH"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Demande */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border-primary/10">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" /> Informations Demande
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Demandeur</Label>
                <Input value={formData.requesterName} readOnly className="bg-secondary/20" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Nombre de personnes</Label>
                <Input 
                  type="number" 
                  min="1" 
                  value={formData.requestedHeadcount} 
                  onChange={(e) => setFormData(p => ({...p, requestedHeadcount: parseInt(e.target.value)}))} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Priorité</Label>
                <Select value={formData.priority} onValueChange={(v) => setFormData(p => ({...p, priority: v as any}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Basse</SelectItem>
                    <SelectItem value="medium">Moyenne</SelectItem>
                    <SelectItem value="high">Haute</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Motif / Raison</Label>
                <Textarea 
                  value={formData.reason} 
                  onChange={(e) => setFormData(p => ({...p, reason: e.target.value}))} 
                  placeholder="Ex: Remplacement de M. Dupont..."
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" /> Planning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Date d'émission</Label>
                <Input type="date" value={formData.issueDate} onChange={(e) => setFormData(p => ({...p, issueDate: e.target.value}))} required />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Disponibilité souhaitée</Label>
                <Input type="date" value={formData.desiredAvailabilityDate} onChange={(e) => setFormData(p => ({...p, desiredAvailabilityDate: e.target.value}))} required />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Date limite candidature (Optionnel)</Label>
                <Input type="date" value={formData.applicationDeadline} onChange={(e) => setFormData(p => ({...p, applicationDeadline: e.target.value}))} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Poste & Offre */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-primary/10">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Définition du Poste
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Entreprise</Label>
                  <Input value={entityName} readOnly className="bg-secondary/20" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Site</Label>
                  <Select value={formData.worksiteName} onValueChange={(v) => setFormData(p => ({...p, worksiteName: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Site principal">Site principal</SelectItem>
                      <SelectItem value="À définir">À définir</SelectItem>
                      <SelectItem value="Autre site">Autre site...</SelectItem>
                    </SelectContent>
                  </Select>
                  {formData.worksiteName === "Autre site" && (
                    <Input 
                      placeholder="Nom du site personnalisé" 
                      className="mt-2" 
                      value={formData.customWorksiteName} 
                      onChange={(e) => setFormData(p => ({...p, customWorksiteName: e.target.value}))} 
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Fiche de Poste de Référence</Label>
                <Select value={formData.jobProfileId} onValueChange={handleProfileChange}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner une fiche de poste active" /></SelectTrigger>
                  <SelectContent>
                    {activeProfiles.map(p => (
                      <SelectItem key={p.jobProfileId} value={p.jobProfileId}>
                        {p.jobTitleName} — {p.departmentName} ({p.versionLabel})
                      </SelectItem>
                    ))}
                    {activeProfiles.length === 0 && <div className="p-2 text-xs text-muted-foreground">Aucune fiche de poste active trouvée.</div>}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Type de contrat</Label>
                  <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CDI">CDI</SelectItem>
                      <SelectItem value="CDD">CDD</SelectItem>
                      <SelectItem value="Intérim">Intérim</SelectItem>
                      <SelectItem value="Stage">Stage</SelectItem>
                      <SelectItem value="Apprentissage">Apprentissage</SelectItem>
                      <SelectItem value="Freelance">Freelance</SelectItem>
                      <SelectItem value="Autre">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Type d'emploi</Label>
                  <Select value={formData.employmentType} onValueChange={(v) => setFormData(p => ({...p, employmentType: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Nouveau poste">Nouveau poste</SelectItem>
                      <SelectItem value="Remplacement">Remplacement</SelectItem>
                      <SelectItem value="Renfort temporaire">Renfort temporaire</SelectItem>
                      <SelectItem value="Mobilité interne">Mobilité interne</SelectItem>
                      <SelectItem value="Autre">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Temps de travail</Label>
                  <Select value={formData.workingTime} onValueChange={(v) => setFormData(p => ({...p, workingTime: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Temps plein">Temps plein</SelectItem>
                      <SelectItem value="Temps partiel">Temps partiel</SelectItem>
                      <SelectItem value="Horaire flexible">Horaire flexible</SelectItem>
                      <SelectItem value="Travail posté">Travail posté</SelectItem>
                      <SelectItem value="Autre">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-accent/20 overflow-hidden shadow-md">
            <CardHeader className="bg-accent/10 border-b">
              <CardTitle className="text-md font-black flex items-center gap-2 text-accent-foreground">
                <FileText className="w-5 h-5" /> Contenu de l'Offre d'Emploi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6 bg-accent/5">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Titre de l'annonce</Label>
                <Input value={formData.jobOfferTitle} onChange={(e) => setFormData(p => ({...p, jobOfferTitle: e.target.value}))} placeholder="Ex: Développeur Senior (H/F)..." />
              </div>
              
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Résumé court</Label>
                <Textarea 
                  value={formData.jobOfferSummary} 
                  onChange={(e) => setFormData(p => ({...p, jobOfferSummary: e.target.value}))} 
                  placeholder="Une phrase d'accroche pour la liste des offres..."
                  className="min-h-[60px]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Description de l'entreprise</Label>
                  <Textarea 
                    value={formData.jobOfferDescription} 
                    onChange={(e) => setFormData(p => ({...p, jobOfferDescription: e.target.value}))} 
                    placeholder="Présentez l'entité et le contexte..."
                    className="min-h-[120px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Missions détaillées</Label>
                  <Textarea 
                    value={formData.jobOfferMissions} 
                    onChange={(e) => setFormData(p => ({...p, jobOfferMissions: e.target.value}))} 
                    placeholder="Quelles seront les activités quotidiennes ?"
                    className="min-h-[120px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Compétences / Soft Skills</Label>
                  <Textarea 
                    value={formData.jobOfferSkills} 
                    onChange={(e) => setFormData(p => ({...p, jobOfferSkills: e.target.value}))} 
                    placeholder="Profil recherché..."
                    className="min-h-[100px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Expérience & Formation</Label>
                  <Textarea 
                    value={formData.jobOfferExperience} 
                    onChange={(e) => setFormData(p => ({...p, jobOfferExperience: e.target.value}))} 
                    placeholder="Pré-requis techniques et diplômes..."
                    className="min-h-[100px]"
                  />
                </div>
              </div>

              <Separator className="bg-accent/20" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1"><MapPin className="w-3 h-3" /> Localisation précise</Label>
                    <Input value={formData.jobOfferLocation} onChange={(e) => setFormData(p => ({...p, jobOfferLocation: e.target.value}))} placeholder="Ex: Paris 8e ou Télétravail..." />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1"><Info className="w-3 h-3" /> Fourchette salariale</Label>
                    <Input value={formData.jobOfferSalaryRange} onChange={(e) => setFormData(p => ({...p, jobOfferSalaryRange: e.target.value}))} placeholder="Ex: 45k - 55k €" />
                 </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Avantages (Benefits)</Label>
                <Input value={formData.jobOfferBenefits} onChange={(e) => setFormData(p => ({...p, jobOfferBenefits: e.target.value}))} placeholder="Mutuelle, Tickets resto, Prime..." />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Instructions de candidature</Label>
                <Textarea 
                  value={formData.jobOfferApplicationInstructions} 
                  onChange={(e) => setFormData(p => ({...p, jobOfferApplicationInstructions: e.target.value}))} 
                  placeholder="Comment postuler ?"
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-bold">Notes Internes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={formData.notes} 
                onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                placeholder="Informations confidentielles sur ce recrutement..."
                className="min-h-[100px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
