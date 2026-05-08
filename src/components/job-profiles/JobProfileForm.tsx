
"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, Loader2, X, ShieldCheck, ArrowLeft, Building2, Briefcase
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
import { collection, query, orderBy } from "firebase/firestore";
import { createJobProfile, updateJobProfile } from "@/services/job-profile.service";
import { JobProfile, CatalogItemType, JobProfileCatalogItem } from "@/types/job-profile";
import { Department, JobTitle } from "@/types/organization";
import { useToast } from "@/hooks/use-toast";

interface JobProfileFormProps {
  entityId: string;
  entityName: string;
  userId: string;
  initialData?: JobProfile;
  isEditing?: boolean;
}

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
  notes: ""
};

export function JobProfileForm({ entityId, entityName, userId, initialData, isEditing = false }: JobProfileFormProps) {
  const router = useRouter();
  const { db } = useFirebase();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [newCatalogLabels, setNewCatalogLabels] = useState<Record<CatalogItemType, string>>({
    missionResponsibility: "",
    objective: "",
    trainingRequirement: "",
    professionalExperience: "",
    softSkill: ""
  });

  // Queries
  const deptsQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc"));
  }, [db, entityId]);

  const jobsQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/jobTitles`), orderBy("title", "asc"));
  }, [db, entityId]);

  const catalogQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/jobProfileCatalogItems`), orderBy("label", "asc"));
  }, [db, entityId]);

  const { data: departments } = useCollection<Department>(deptsQuery);
  const { data: jobTitles } = useCollection<JobTitle>(jobsQuery);
  const { data: catalogItems } = useCollection<JobProfileCatalogItem>(catalogQuery);

  const activeDepartments = useMemo(() => departments?.filter(d => d.status === "active") || [], [departments]);
  const activeJobTitles = useMemo(() => jobTitles?.filter(j => j.status === "active") || [], [jobTitles]);
  
  const filteredJobTitlesForDept = useMemo(() => {
    if (!formData.departmentId) return activeJobTitles;
    return activeJobTitles.filter(j => j.departmentId === formData.departmentId);
  }, [activeJobTitles, formData.departmentId]);

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
        notes: initialData.notes || ""
      });
    }
  }, [initialData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !entityId) return;

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
        <Card className="md:col-span-1 border-primary/10">
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
              <Select value={formData.departmentId} onValueChange={(v) => setFormData(p => ({...p, departmentId: v, jobTitleId: ""}))}>
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>
                  {activeDepartments.map(d => <SelectItem key={d.departmentId} value={d.departmentId}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase text-muted-foreground font-bold">Intitulé du poste</Label>
              <Select value={formData.jobTitleId} onValueChange={(v) => setFormData(p => ({...p, jobTitleId: v}))}>
                <SelectTrigger><SelectValue placeholder={formData.departmentId ? "Choisir..." : "Sél. département"} /></SelectTrigger>
                <SelectContent>
                  {filteredJobTitlesForDept.map(j => <SelectItem key={j.jobTitleId} value={j.jobTitleId}>{j.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

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
                <Select value={formData.directSupervisorJobTitleId} onValueChange={(v) => setFormData(p => ({...p, directSupervisorJobTitleId: v}))}>
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
            setNewLabel={(v) => setNewCatalogLabels(p => ({...p, missionResponsibility: v}))}
            onToggle={(v) => toggleArrayItem('missionsAndResponsibilities', v)}
            onAdd={() => addCatalogItem('missionResponsibility', 'missionsAndResponsibilities')}
          />

          <CatalogSection 
            title="Objectifs du poste" 
            type="objective"
            field="objectives"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.objective}
            setNewLabel={(v) => setNewCatalogLabels(p => ({...p, objective: v}))}
            onToggle={(v) => toggleArrayItem('objectives', v)}
            onAdd={() => addCatalogItem('objective', 'objectives')}
          />

          <CatalogSection 
            title="Formation initiale & professionnelle" 
            type="trainingRequirement"
            field="initialAndProfessionalTraining"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.trainingRequirement}
            setNewLabel={(v) => setNewCatalogLabels(p => ({...p, trainingRequirement: v}))}
            onToggle={(v) => toggleArrayItem('initialAndProfessionalTraining', v)}
            onAdd={() => addCatalogItem('trainingRequirement', 'initialAndProfessionalTraining')}
          />

          <CatalogSection 
            title="Expérience professionnelle requise" 
            type="professionalExperience"
            field="professionalExperience"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.professionalExperience}
            setNewLabel={(v) => setNewCatalogLabels(p => ({...p, professionalExperience: v}))}
            onToggle={(v) => toggleArrayItem('professionalExperience', v)}
            onAdd={() => addCatalogItem('professionalExperience', 'professionalExperience')}
          />

          <CatalogSection 
            title="Savoir-être (Soft Skills)" 
            type="softSkill"
            field="softSkills"
            formData={formData}
            catalogItems={catalogItems || []}
            newLabel={newCatalogLabels.softSkill}
            setNewLabel={(v) => setNewCatalogLabels(p => ({...p, softSkill: v}))}
            onToggle={(v) => toggleArrayItem('softSkills', v)}
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
