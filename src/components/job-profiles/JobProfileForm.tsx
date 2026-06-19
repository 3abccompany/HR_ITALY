"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, Loader2, X, ShieldCheck, ArrowLeft, Building2, Briefcase, 
  Scale, Clock, Euro
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy, where, Query } from "firebase/firestore";
import { createJobProfile, updateJobProfile } from "@/services/job-profile.service";
import { JobProfile, CatalogItemType, JobProfileCatalogItem } from "@/types/job-profile";
import { Department, JobTitle } from "@/types/organization";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { useToast } from "@/hooks/use-toast";
import { useActiveMembership } from "@/hooks/use-active-membership";
import Link from "next/link";

interface JobProfileFormProps {
  entityId: string;
  entityName: string;
  userId: string;
  initialData?: JobProfile;
  isEditing?: boolean;
}

const CONTRACT_TYPES = [
  "Tempo indeterminato",
  "Tempo determinato",
  "Apprendistato",
  "Stage / Tirocinio",
  "Altro"
];

const initialForm = {
  issueDate: new Date().toISOString().split('T')[0],
  departmentId: "",
  jobTitleId: "",
  directSupervisorJobTitleId: "",
  collaboratorJobTitleIds: [] as string[],
  missionsAndResponsibilities: [] as string[],
  objectives: [] as string[],
  initialAndProfessionalTraining: [] as string[],
  professionalExperience: [] as string[],
  softSkills: [] as string[],
  notes: "",
  // Recommendations
  defaultCcnlId: "none_clear",
  defaultCcnlName: "",
  defaultLevelId: "none_clear",
  defaultLevelCode: "",
  defaultLevelLabel: "",
  defaultContractType: "",
  defaultWeeklyHours: undefined as number | undefined,
};

export function JobProfileForm({ entityId, entityName, userId, initialData, isEditing = false }: JobProfileFormProps) {
  const router = useRouter();
  const { db } = useFirebase();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);
  
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [newCatalogLabels, setNewCatalogLabels] = useState<Record<CatalogItemType, string>>({
    missionResponsibility: "",
    objective: "",
    trainingRequirement: "",
    professionalExperience: "",
    softSkill: ""
  });

  // Permissions check for queries
  const canReadProfiles = !membershipLoading && !!membership && hasPermission("jobProfiles.read");
  const canModifyProfiles = !membershipLoading && !!membership && (hasPermission("jobProfiles.create") || hasPermission("jobProfiles.update"));

  // Masters
  const deptsQuery = useMemo(() => {
    if (!db || !entityId || !canReadProfiles) return null;
    return query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc")) as Query<Department>;
  }, [db, entityId, canReadProfiles]);

  const jobsQuery = useMemo(() => {
    if (!db || !entityId || !canReadProfiles) return null;
    return query(collection(db, `entities/${entityId}/jobTitles`), orderBy("title", "asc")) as Query<JobTitle>;
  }, [db, entityId, canReadProfiles]);

  const catalogQuery = useMemo(() => {
    if (!db || !entityId || !canReadProfiles) return null;
    return query(collection(db, `entities/${entityId}/jobProfileCatalogItems`), orderBy("label", "asc")) as Query<JobProfileCatalogItem>;
  }, [db, entityId, canReadProfiles]);

  // CCNL / Levels
  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId || (!canReadProfiles && !canModifyProfiles)) return null;
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active")) as Query<CCNL>;
  }, [db, entityId, canReadProfiles, canModifyProfiles]);

  const levelsQuery = useMemo(() => {
    const isReady = !!db && !!entityId && !!formData.defaultCcnlId && formData.defaultCcnlId !== "none_clear" && (canReadProfiles || canModifyProfiles);
    if (!isReady) return null;
    return query(collection(db, `entities/${entityId}/ccnls/${formData.defaultCcnlId}/levels`), where("status", "==", "active")) as Query<CCNLLevel>;
  }, [db, entityId, formData.defaultCcnlId, canReadProfiles, canModifyProfiles]);

  const { data: departments } = useCollection<Department>(deptsQuery);
  const { data: jobTitles } = useCollection<JobTitle>(jobsQuery);
  const { data: catalogItems } = useCollection<JobProfileCatalogItem>(catalogQuery);
  const { data: activeCcnls } = useCollection<CCNL>(ccnlsQuery);
  const { data: activeLevels } = useCollection<CCNLLevel>(levelsQuery);

  const activeDepartments = useMemo(() => departments?.filter(d => d.status === "active") || [], [departments]);
  const activeJobTitles = useMemo(() => jobTitles?.filter(j => j.status === "active") || [], [jobTitles]);
  
  const filteredJobTitlesForDept = useMemo(() => {
    if (!formData.departmentId) return [];
    return activeJobTitles.filter(j => j.departmentId === formData.departmentId);
  }, [activeJobTitles, formData.departmentId]);

  // Handle prefill for weekly hours and snapshot values
  const handleCcnlChange = (ccnlId: string) => {
    if (ccnlId === "none_clear") {
      setFormData(p => ({
        ...p,
        defaultCcnlId: "none_clear",
        defaultCcnlName: "",
        defaultLevelId: "none_clear",
        defaultLevelCode: "",
        defaultLevelLabel: ""
      }));
      return;
    }

    const foundCcnl = activeCcnls?.find(c => c.ccnlId === ccnlId);
    setFormData(p => ({
      ...p,
      defaultCcnlId: ccnlId,
      defaultCcnlName: foundCcnl?.name || "",
      defaultLevelId: "none_clear", 
      defaultLevelCode: "",
      defaultLevelLabel: "",
      defaultWeeklyHours: ccnl?.standardWeeklyHours || p.defaultWeeklyHours
    }));
  };

  const handleLevelChange = (levelId: string) => {
    if (levelId === "none_clear") {
       setFormData(p => ({
         ...p,
         defaultLevelId: "none_clear",
         defaultLevelCode: "",
         defaultLevelLabel: ""
       }));
       return;
    }

    const foundLevel = activeLevels?.find(l => l.levelId === levelId);
    setFormData(p => {
      const monthly = foundLevel?.minimumGrossMonthly || 0;
      const payments = p.monthlyPayments || 13;
      return {
        ...p,
        defaultLevelId: levelId,
        defaultLevelCode: foundLevel?.levelCode || "",
        defaultLevelLabel: foundLevel?.label || "",
        defaultMinimumGrossMonthly: monthly,
        defaultMinimumGrossHourly: foundLevel?.minimumGrossHourly || 0
      };
    });
  };

  const selectedLevel = useMemo(() => {
    if (formData.defaultLevelId === "none_clear") return null;
    return activeLevels?.find(l => l.levelId === formData.defaultLevelId);
  }, [activeLevels, formData.defaultLevelId]);

  // Load initial data for editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        issueDate: initialData.issueDate,
        departmentId: initialData.departmentId,
        jobTitleId: initialData.jobTitleId,
        directSupervisorJobTitleId: initialData.directSupervisorJobTitleId || "",
        collaboratorJobTitleIds: initialData.collaboratorJobTitleIds || [],
        missionsAndResponsibilities: initialData.missionsAndResponsibilities || [],
        objectives: initialData.objectives || [],
        initialAndProfessionalTraining: initialData.initialAndProfessionalTraining || [],
        professionalExperience: initialData.professionalExperience || [],
        softSkills: initialData.softSkills || [],
        notes: initialData.notes || "",
        defaultCcnlId: initialData.defaultCcnlId || "none_clear",
        defaultCcnlName: initialData.defaultCcnlName || "",
        defaultLevelId: initialData.defaultLevelId || "none_clear",
        defaultLevelCode: initialData.defaultLevelCode || "",
        defaultLevelLabel: initialData.defaultLevelLabel || "",
        defaultContractType: initialData.defaultContractType || "",
        defaultWeeklyHours: initialData.defaultWeeklyHours,
      });
    }
  }, [initialData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !entityId) return;

    if (formData.defaultLevelId !== "none_clear" && formData.defaultCcnlId === "none_clear") {
      toast({ variant: "destructive", title: "Configuration invalide", description: "Veuillez sélectionner un CCNL avant de choisir un niveau." });
      return;
    }

    if (formData.defaultWeeklyHours !== undefined && formData.defaultWeeklyHours <= 0) {
      toast({ variant: "destructive", title: "Erreur", description: "Le temps de travail hebdomadaire doit être supérieur à 0." });
      return;
    }

    setLoading(true);
    try {
      const dept = departments?.find(d => d.departmentId === formData.departmentId);
      const title = jobTitles?.find(j => j.jobTitleId === formData.jobTitleId);
      const supervisor = jobTitles?.find(j => j.jobTitleId === formData.directSupervisorJobTitleId);
      const collaborators = jobTitles?.filter(j => formData.collaboratorJobTitleIds.includes(j.jobTitleId));

      const payload = {
        ...formData,
        entityName: entityName,
        departmentName: dept?.name || "N/A",
        jobTitleName: title?.title || "N/A",
        directSupervisorJobTitleName: supervisor?.title || "N/A",
        collaboratorJobTitleNames: collaborators?.map(c => c.title) || []
      };

      if (isEditing && initialData) {
        await updateJobProfile(entityId, initialData.jobProfileId, payload, userId);
        toast({ title: "Mise à jour effectuée", description: "La fiche de poste a été modifiée (nouvelle version créée)." });
      } else {
        await createJobProfile(entityId, payload, userId);
        toast({ title: "Fiche créée", description: "La fiche de poste a été enregistrée." });
      }
      router.push(`/entity/${entityId}/job-profiles`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const toggleArrayItem = (field: keyof typeof initialForm, value: string) => {
    setFormData(prev => {
      const current = prev[field] as string[];
      if (current.includes(value)) {
        return { ...prev, [field]: current.filter(i => i !== value) };
      }
      return { ...prev, [field]: [...current, value] };
    });
  };

  const addCatalogItem = (type: CatalogItemType, field: keyof typeof initialForm) => {
    const label = newCatalogLabels[type].trim();
    if (!label) return;
    
    const current = formData[field] as string[];
    if (!current.includes(label)) {
      setFormData(prev => ({ ...prev, [field]: [...(prev[field] as string[]), label] }));
    }
    
    setNewCatalogLabels(prev => ({ ...prev, [type]: "" }));
  };

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-5xl mx-auto pb-24">
      {/* Header Actions */}
      <div className="flex items-center justify-between sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" type="button" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-primary">
              {isEditing ? "Modifier la fiche de poste" : "Nouvelle fiche de poste"}
            </h1>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
              {isEditing ? `Version actuelle: ${initialData?.versionLabel}` : "Brouillon initial V1"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" type="button" onClick={() => router.back()} disabled={loading}>
            Annuler
          </Button>
          <Button type="submit" disabled={loading || !formData.jobTitleId || !formData.departmentId}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {isEditing ? "Mettre à jour (Nouvelle Version)" : "Créer la fiche de poste"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Info Card */}
        <div className="md:col-span-1 space-y-6">
          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> Détails Administratifs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Entreprise</Label>
                <Input value={entityName} readOnly className="bg-secondary/20" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issueDate" className="text-[10px] uppercase text-muted-foreground font-bold">Date d'émission</Label>
                <Input id="issueDate" type="date" value={formData.issueDate} onChange={(e) => setFormData(p => ({...p, issueDate: e.target.value}))} required />
              </div>
              <div className="space-y-2 pt-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Département</Label>
                <Select 
                  value={formData.departmentId} 
                  onValueChange={(v: string) => {
                    setFormData(p => ({...p, departmentId: v, jobTitleId: ""}));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>
                    {activeDepartments.map(d => <SelectItem key={d.departmentId} value={d.departmentId}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold flex items-center justify-between">
                  Intitulé du poste
                  {formData.departmentId && hasPermission("jobTitles.create") && (
                     <Link href={`/entity/${entityId}/departments`} className="text-accent text-[9px] hover:underline flex items-center gap-0.5">
                       <Plus className="w-2 h-2" /> Créer intitulé
                     </Link>
                  )}
                </Label>
                <Select 
                  value={formData.jobTitleId} 
                  onValueChange={(v: string) => setFormData(p => ({...p, jobTitleId: v}))}
                  disabled={!formData.departmentId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={formData.departmentId ? "Choisir..." : "Sélectionner un département d'abord"} />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.departmentId && filteredJobTitlesForDept.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        Aucun intitulé de poste actif pour ce département.
                      </div>
                    ) : (
                      filteredJobTitlesForDept.map(j => <SelectItem key={j.jobTitleId} value={j.jobTitleId}>{j.title}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Internal Contractual Recommendations Section */}
          <Card className="border-accent/20 bg-accent/5">
            <CardHeader className="bg-accent/10 border-b">
               <CardTitle className="text-sm font-black uppercase text-accent-foreground flex items-center gap-2">
                 <Scale className="w-4 h-4" /> RECOMMANDATIONS RH
               </CardTitle>
               <p className="text-[9px] font-bold text-accent-foreground/70 uppercase">Interne uniquement • Non public</p>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
               <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">CCNL recommandé</Label>
                    {formData.defaultCcnlId && formData.defaultCcnlId !== "none_clear" && !activeCcnls?.some(c => c.ccnlId === formData.defaultCcnlId) && (
                      <Badge variant="destructive" className="h-4 px-1.5 text-[8px] uppercase">CCNL archivé</Badge>
                    )}
                  </div>
                  <Select value={formData.defaultCcnlId} onValueChange={(v: string) => handleCcnlChange(v)}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Sél. CCNL..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeCcnls?.map(c => (
                        <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name} ({c.sector})</SelectItem>
                      ))}
                      {formData.defaultCcnlId && formData.defaultCcnlId !== "none_clear" && !activeCcnls?.some(c => c.ccnlId === formData.defaultCcnlId) && (
                        <SelectItem value={formData.defaultCcnlId} disabled>{formData.defaultCcnlName || "CCNL"} (Archivé)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Niveau recommandé</Label>
                    {formData.defaultLevelId && formData.defaultLevelId !== "none_clear" && !activeLevels?.some(l => l.levelId === formData.defaultLevelId) && (
                      <Badge variant="destructive" className="h-4 px-1.5 text-[8px] uppercase">Niveau archivé</Badge>
                    )}
                  </div>
                  <Select 
                    value={formData.defaultLevelId} 
                    onValueChange={(v: string) => handleLevelChange(v)}
                    disabled={!formData.defaultCcnlId || formData.defaultCcnlId === "none_clear"}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder={formData.defaultCcnlId !== "none_clear" ? "Sél. Niveau..." : "Sél. CCNL d'abord"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                      {activeLevels?.map(l => (
                        <SelectItem key={l.levelId} value={l.levelId}>{l.levelCode} • {l.label}</SelectItem>
                      ))}
                      {formData.defaultLevelId && formData.defaultLevelId !== "none_clear" && !activeLevels?.some(l => l.levelId === formData.defaultLevelId) && (
                        <SelectItem value={formData.defaultLevelId} disabled>{formData.defaultLevelCode || "Niveau"} (Archivé)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Type de contrat</Label>
                  <Select 
                    value={formData.defaultContractType} 
                    onValueChange={(v: string) => setFormData(p => ({...p, defaultContractType: v}))}
                  >
                    <SelectTrigger className="bg-white"><SelectValue placeholder="Indifférent" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none_clear">--- Non renseigné ---</SelectItem>
                      {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Temps de travail (h/sem)
                  </Label>
                  <Input 
                    type="number" 
                    step="0.5" 
                    value={formData.defaultWeeklyHours || ""} 
                    onChange={(e) => setFormData(p => ({...p, defaultWeeklyHours: e.target.value ? parseFloat(e.target.value) : undefined}))}
                    className="bg-white"
                    placeholder="Ex: 40"
                  />
               </div>

               {selectedLevel && (
                  <div className="p-3 bg-white rounded-lg border border-accent/20 space-y-2 animate-in fade-in zoom-in-95">
                     <div className="flex items-center gap-1.5 text-accent-foreground font-black text-[9px] uppercase tracking-widest border-b pb-1">
                        <Euro className="w-3 h-3" /> Aperçu Salaire Minimum
                     </div>
                     <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="space-y-0.5">
                           <p className="text-[8px] font-bold text-muted-foreground uppercase">Brut Mensuel</p>
                           <p className="text-xs font-black text-primary">€ {selectedLevel.minimumGrossMonthly.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="space-y-0.5">
                           <p className="text-[8px] font-bold text-muted-foreground uppercase">Brut Horaire</p>
                           <p className="text-xs font-black text-primary">€ {selectedLevel.minimumGrossHourly.toLocaleString('fr-FR', { minimumFractionDigits: 4 })}</p>
                        </div>
                     </div>
                  </div>
               )}
            </CardContent>
          </Card>
        </div>

        {/* Content Area */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Hiérarchie & Collaborations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Supérieur hiérarchique direct (N+1)</Label>
                <Select value={formData.directSupervisorJobTitleId} onValueChange={(v: string) => setFormData(p => ({...p, directSupervisorJobTitleId: v}))}>
                  <SelectTrigger><SelectValue placeholder="Choisir le poste du N+1" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {activeJobTitles.map(j => <SelectItem key={j.jobTitleId} value={j.jobTitleId}>{j.title} ({j.departmentName})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground font-bold">Collaborateurs directs</Label>
                <div className="border rounded-md p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[200px] overflow-y-auto bg-secondary/5">
                  {activeJobTitles.map(j => (
                    <div key={j.jobTitleId} className="flex items-center gap-2">
                      <Checkbox 
                        id={`collab-${j.jobTitleId}`} 
                        checked={formData.collaboratorJobTitleIds.includes(j.jobTitleId)}
                        onCheckedChange={() => toggleArrayItem('collaboratorJobTitleIds', j.jobTitleId)}
                      />
                      <label htmlFor={`collab-${j.jobTitleId}`} className="text-xs font-medium cursor-pointer truncate">{j.title}</label>
                    </div>
                  ))}
                  {activeJobTitles.length === 0 && <p className="text-xs text-muted-foreground italic col-span-full">Aucun poste disponible.</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          <CatalogSection 
            title="Missions et responsabilités" 
            type="missionResponsibility"
            field="missionsAndResponsibilities"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.missionResponsibility}
            setNewLabel={(v: string) => setNewCatalogLabels(p => ({...p, missionResponsibility: v}))}
            onToggle={(v: string) => toggleArrayItem('missionsAndResponsibilities', v)}
            onAdd={() => addCatalogItem('missionResponsibility', 'missionsAndResponsibilities')}
          />

          <CatalogSection 
            title="Objectifs du poste" 
            type="objective"
            field="objectives"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.objective}
            setNewLabel={(v: string) => setNewCatalogLabels(p => ({...p, objective: v}))}
            onToggle={(v: string) => toggleArrayItem('objectives', v)}
            onAdd={() => addCatalogItem('objective', 'objectives')}
          />

          <CatalogSection 
            title="Formation initiale & professionnelle" 
            type="trainingRequirement"
            field="initialAndProfessionalTraining"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.trainingRequirement}
            setNewLabel={(v: string) => setNewCatalogLabels(p => ({...p, trainingRequirement: v}))}
            onToggle={(v: string) => toggleArrayItem('initialAndProfessionalTraining', v)}
            onAdd={() => addCatalogItem('trainingRequirement', 'initialAndProfessionalTraining')}
          />

          <CatalogSection 
            title="Expérience professionnelle requise" 
            type="professionalExperience"
            field="professionalExperience"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.professionalExperience}
            setNewLabel={(v: string) => setNewCatalogLabels(p => ({...p, professionalExperience: v}))}
            onToggle={(v: string) => toggleArrayItem('professionalExperience', v)}
            onAdd={() => addCatalogItem('professionalExperience', 'professionalExperience')}
          />

          <CatalogSection 
            title="Savoir-être (Soft Skills)" 
            type="softSkill"
            field="softSkills"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.softSkill}
            setNewLabel={(v: string) => setNewCatalogLabels(p => ({...p, softSkill: v}))}
            onToggle={(v: string) => toggleArrayItem('softSkills', v)}
            onAdd={() => addCatalogItem('softSkill', 'softSkills')}
          />

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-bold">Notes Internes / Observations</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={formData.notes} 
                onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                placeholder="Informations complémentaires sur le périmètre ou le contexte du poste..."
                className="min-h-[120px]"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

function CatalogSection({ 
  title, 
  type, 
  field, 
  formData, 
  catalogItems, 
  newLabel, 
  setNewLabel, 
  onToggle, 
  onAdd 
}: any) {
  const filteredCatalog = catalogItems.filter((i: any) => i.type === type && i.status === "active");
  const selectedValues = formData[field] as string[];

  return (
    <Card className="border-primary/10 shadow-sm overflow-hidden">
      <div className="bg-primary/5 px-6 py-4 border-b">
        <Label className="text-sm font-bold text-primary">{title}</Label>
      </div>
      <CardContent className="p-6 space-y-4">
        <div className="flex gap-2">
          <Input 
            placeholder={`Ajouter un nouvel élément...`}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
          />
          <Button type="button" size="sm" onClick={onAdd} disabled={!newLabel.trim()} variant="secondary">
            <Plus className="w-4 h-4 mr-1" /> Ajouter
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 min-h-[50px] p-4 border rounded-xl bg-secondary/5">
          {selectedValues.length === 0 && <span className="text-xs text-muted-foreground italic">Aucun élément sélectionné.</span>}
          {selectedValues.map(v => (
            <Badge key={v} variant="default" className="gap-2 py-1.5 px-3 bg-primary text-white hover:bg-primary/90 transition-all">
              {v}
              <button type="button" onClick={() => onToggle(v)} className="hover:bg-white/20 rounded-full p-0.5">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>

        {filteredCatalog.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest border-b pb-1">Réutiliser du catalogue</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {filteredCatalog.filter((c: any) => !selectedValues.includes(c.label)).map((c: any) => (
                <button
                  key={c.itemId}
                  type="button"
                  onClick={() => onToggle(c.label)}
                  className="text-left text-xs p-2.5 border rounded-lg hover:bg-primary/5 hover:border-primary/30 transition-all flex items-center justify-between group bg-white"
                >
                  <span className="truncate pr-2">{c.label}</span>
                  <Plus className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
