"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Loader2, ShieldCheck, ArrowLeft, Building2, Briefcase, 
  MapPin, Calendar, FileText, Info, UserCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy, doc, getDoc } from "firebase/firestore";
import { createRecruitmentNeed, updateRecruitmentNeed } from "@/services/recruitment-need.service";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { JobProfile } from "@/types/job-profile";
import { AppUser } from "@/types/user";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface RecruitmentNeedFormProps {
  entityId: string;
  entityName: string;
  userId: string;
  initialData?: RecruitmentNeed;
  isEditing?: boolean;
}

const initialForm = {
  requesterUid: "",
  requesterName: "",
  requesterSourceJobProfileId: "",
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
  jobOfferText: "",
  jobOfferLocation: "",
  jobOfferPlanning: "",
  jobOfferBenefits: "",
  jobOfferApplicationInstructions: "",
  // Snapshots
  jobOfferMissions: [] as string[],
  jobOfferSkills: [] as string[],
  jobOfferExperience: [] as string[],
  jobOfferTraining: [] as string[]
};

export function RecruitmentNeedForm({ entityId, entityName, userId, initialData, isEditing = false }: RecruitmentNeedFormProps) {
  const router = useRouter();
  const { db } = useFirebase();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [loadingRequester, setLoadingRequester] = useState(false);

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
        requesterUid: initialData.requesterUid,
        requesterName: initialData.requesterName,
        requesterSourceJobProfileId: initialData.requesterSourceJobProfileId,
        requestedHeadcount: initialData.requestedHeadcount,
        worksiteId: initialData.worksiteId,
        worksiteName: initialData.worksiteId ? "Autre site" : initialData.worksiteName,
        customWorksiteName: !initialData.worksiteId && !["Site principal", "À définir"].includes(initialData.worksiteName) ? initialData.worksiteName : "",
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
        jobOfferText: initialData.jobOfferText || "",
        jobOfferLocation: initialData.jobOfferLocation || "",
        jobOfferPlanning: initialData.jobOfferPlanning || "",
        jobOfferBenefits: initialData.jobOfferBenefits || "",
        jobOfferApplicationInstructions: initialData.jobOfferApplicationInstructions || "",
        jobOfferMissions: initialData.jobOfferMissions || [],
        jobOfferSkills: initialData.jobOfferSkills || [],
        jobOfferExperience: initialData.jobOfferExperience || [],
        jobOfferTraining: initialData.jobOfferTraining || []
      });
    }
  }, [initialData]);

  const handleProfileChange = async (profileId: string) => {
    const profile = activeProfiles.find(p => p.jobProfileId === profileId);
    if (!profile || !db) return;

    setLoadingRequester(true);
    let requesterName = profile.createdBy; // Fallback

    try {
      const userSnap = await getDoc(doc(db, "users", profile.createdBy));
      if (userSnap.exists()) {
        requesterName = userSnap.data().displayName || userSnap.data().email;
      }
    } catch (e) {
      console.warn("Failed to fetch requester name", e);
    } finally {
      setLoadingRequester(false);
    }

    setFormData(prev => ({
      ...prev,
      jobProfileId: profileId,
      requesterUid: profile.createdBy,
      requesterName: requesterName,
      requesterSourceJobProfileId: profile.jobProfileId,
      // Snapshots
      jobOfferMissions: profile.missionsAndResponsibilities || [],
      jobOfferSkills: profile.softSkills || [],
      jobOfferExperience: profile.professionalExperience || [],
      jobOfferTraining: profile.initialAndProfessionalTraining || [],
      // Base offer text hint
      jobOfferText: prev.jobOfferText || `Poste de ${profile.jobTitleName} au sein du département ${profile.departmentName}.`
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
        {/* Left Column */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border-primary/10">
            <CardHeader className="bg-primary/5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" /> Informations Demande
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
               <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Fiche de Poste de Référence</Label>
                <Select value={formData.jobProfileId} onValueChange={handleProfileChange}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner une fiche active" /></SelectTrigger>
                  <SelectContent>
                    {activeProfiles.map(p => (
                      <SelectItem key={p.jobProfileId} value={p.jobProfileId}>
                        {p.jobTitleName} ({p.versionLabel})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
                  <UserCircle className="w-3 h-3" /> Demandeur (Origine FDP)
                </Label>
                <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-secondary/20 text-sm font-medium">
                  {loadingRequester ? <Loader2 className="w-3 h-3 animate-spin" /> : formData.requesterName || "Sél. une fiche"}
                </div>
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
                  placeholder="Ex: Remplacement..."
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
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Date limite (Optionnel)</Label>
                <Input type="date" value={formData.applicationDeadline} onChange={(e) => setFormData(p => ({...p, applicationDeadline: e.target.value}))} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Contrat</Label>
                  <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["CDI", "CDD", "Intérim", "Stage", "Apprentissage", "Freelance", "Autre"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Emploi</Label>
                  <Select value={formData.employmentType} onValueChange={(v) => setFormData(p => ({...p, employmentType: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Nouveau poste", "Remplacement", "Renfort temporaire", "Mobilité interne", "Autre"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Temps</Label>
                  <Select value={formData.workingTime} onValueChange={(v) => setFormData(p => ({...p, workingTime: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Temps plein", "Temps partiel", "Horaire flexible", "Travail posté", "Autre"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-secondary/10 border border-dashed border-primary/20">
                 <p className="text-[10px] uppercase font-bold text-primary mb-3">Snapshots de la fiche de poste</p>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SnapshotList label="Missions" items={formData.jobOfferMissions} />
                    <SnapshotList label="Savoir-être" items={formData.jobOfferSkills} />
                    <SnapshotList label="Expérience" items={formData.jobOfferExperience} />
                    <SnapshotList label="Formation" items={formData.jobOfferTraining} />
                 </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-accent/20 overflow-hidden shadow-md">
            <CardHeader className="bg-accent/10 border-b">
              <CardTitle className="text-md font-black flex items-center gap-2 text-accent-foreground">
                <FileText className="w-5 h-5" /> Offre d’emploi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6 bg-accent/5">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Texte de l'annonce</Label>
                <Textarea 
                  value={formData.jobOfferText} 
                  onChange={(e) => setFormData(p => ({...p, jobOfferText: e.target.value}))} 
                  placeholder="Décrivez l'offre, le contexte, l'équipe..."
                  className="min-h-[150px]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1"><MapPin className="w-3 h-3" /> Localisation précise</Label>
                    <Input value={formData.jobOfferLocation} onChange={(e) => setFormData(p => ({...p, jobOfferLocation: e.target.value}))} placeholder="Ex: 2ème étage..." />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold">Planning / Horaires</Label>
                    <Input value={formData.jobOfferPlanning} onChange={(e) => setFormData(p => ({...p, jobOfferPlanning: e.target.value}))} placeholder="Ex: Lundi-Vendredi 09:00-17:00" />
                 </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Avantages</Label>
                <Input value={formData.jobOfferBenefits} onChange={(e) => setFormData(p => ({...p, jobOfferBenefits: e.target.value}))} placeholder="Mutuelle, Tickets resto..." />
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
            <CardHeader><CardTitle className="text-sm font-bold">Notes Internes</CardTitle></CardHeader>
            <CardContent>
              <Textarea 
                value={formData.notes} 
                onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                className="min-h-[100px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

function SnapshotList({ label, items }: { label: string, items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <span className="text-[9px] uppercase font-bold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <Badge key={i} variant="outline" className="text-[8px] py-0 h-4 bg-white/50">{it}</Badge>
        ))}
      </div>
    </div>
  );
}
