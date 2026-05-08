
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  FileBadge, Plus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Calendar, Building2, Eye,
  AlertCircle, ShieldCheck, MoreVertical, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  createJobProfile, 
  updateJobProfile, 
  disableJobProfile, 
  reactivateJobProfile 
} from "@/services/job-profile.service";
import { JobProfile, CatalogItemType, JobProfileCatalogItem } from "@/types/job-profile";
import { Department, JobTitle } from "@/types/organization";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

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

export default function JobProfilesManagementPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { entity, loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  // State
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusChange, setStatusChange] = useState<{ id: string, action: 'disable' | 'reactivate' } | null>(null);

  // Search local for catalog inputs
  const [newCatalogLabels, setNewCatalogLabels] = useState<Record<CatalogItemType, string>>({
    missionResponsibility: "",
    objective: "",
    trainingRequirement: "",
    professionalExperience: "",
    softSkill: ""
  });

  // Permissions
  const canRead = hasPermission("jobProfiles.read");
  const canCreate = hasPermission("jobProfiles.create");
  const canUpdate = hasPermission("jobProfiles.update");

  // Queries
  const profilesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("updatedAt", "desc"));
  }, [db, entityId, canRead]);

  const deptsQuery = useMemo(() => {
    if (!db || !entityId || !isFormVisible) return null;
    return query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc"));
  }, [db, entityId, isFormVisible]);

  const jobsQuery = useMemo(() => {
    if (!db || !entityId || !isFormVisible) return null;
    return query(collection(db, `entities/${entityId}/jobTitles`), orderBy("title", "asc"));
  }, [db, entityId, isFormVisible]);

  const catalogQuery = useMemo(() => {
    if (!db || !entityId || !isFormVisible) return null;
    return query(collection(db, `entities/${entityId}/jobProfileCatalogItems`), orderBy("label", "asc"));
  }, [db, entityId, isFormVisible]);

  const { data: profiles, loading: loadingProfiles } = useCollection<JobProfile>(profilesQuery);
  const { data: departments } = useCollection<Department>(deptsQuery);
  const { data: jobTitles } = useCollection<JobTitle>(jobsQuery);
  const { data: catalogItems } = useCollection<JobProfileCatalogItem>(catalogQuery);

  const activeDepartments = useMemo(() => departments?.filter(d => d.status === "active") || [], [departments]);
  const activeJobTitles = useMemo(() => jobTitles?.filter(j => j.status === "active") || [], [jobTitles]);
  
  const filteredJobTitlesForDept = useMemo(() => {
    if (!formData.departmentId) return activeJobTitles;
    return activeJobTitles.filter(j => j.departmentId === formData.departmentId);
  }, [activeJobTitles, formData.departmentId]);

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
    setNewCatalogLabels({
      missionResponsibility: "",
      objective: "",
      trainingRequirement: "",
      professionalExperience: "",
      softSkill: ""
    });
  };

  const handleEdit = (p: JobProfile) => {
    setFormData({
      issueDate: p.issueDate,
      departmentId: p.departmentId,
      jobTitleId: p.jobTitleId,
      directSupervisorJobTitleId: p.directSupervisorJobTitleId || "",
      collaboratorJobTitleIds: p.collaboratorJobTitleIds || [],
      missionsAndResponsibilities: p.missionsAndResponsibilities || [],
      objectives: p.objectives || [],
      initialAndProfessionalTraining: p.initialAndProfessionalTraining || [],
      professionalExperience: p.professionalExperience || [],
      softSkills: p.softSkills || [],
      notes: p.notes || ""
    });
    setEditingId(p.jobProfileId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entity || !entityId) return;

    setLoading(true);
    try {
      const dept = departments?.find(d => d.departmentId === formData.departmentId);
      const title = jobTitles?.find(j => j.jobTitleId === formData.jobTitleId);
      const supervisor = jobTitles?.find(j => j.jobTitleId === formData.directSupervisorJobTitleId);
      const collaborators = jobTitles?.filter(j => formData.collaboratorJobTitleIds.includes(j.jobTitleId));

      const payload = {
        ...formData,
        entityName: entity.nomEntreprise,
        departmentName: dept?.name || "N/A",
        jobTitleName: title?.title || "N/A",
        directSupervisorJobTitleName: supervisor?.title || "N/A",
        collaboratorJobTitleNames: collaborators?.map(c => c.title) || []
      };

      if (editingId) {
        await updateJobProfile(entityId, editingId, payload, user.uid);
        toast({ title: "Mise à jour", description: "La fiche de poste a été modifiée (nouvelle version créée)." });
      } else {
        await createJobProfile(entityId, payload, user.uid);
        toast({ title: "Créée", description: "La fiche de poste a été enregistrée." });
      }
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const executeStatusChange = async () => {
    if (!statusChange || !user) return;
    setLoading(true);
    try {
      if (statusChange.action === 'disable') {
        await disableJobProfile(entityId, statusChange.id, user.uid);
      } else {
        await reactivateJobProfile(entityId, statusChange.id, user.uid);
      }
      toast({ title: "Statut mis à jour" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
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

  const filteredProfiles = useMemo(() => {
    const term = search.toLowerCase();
    return profiles?.filter(p => 
      p.jobTitleName.toLowerCase().includes(term) || 
      p.departmentName.toLowerCase().includes(term)
    ) || [];
  }, [profiles, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (val: any) => {
    if (!val) return "N/A";
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter les fiches de postes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des fiches de postes</h1>
          <p className="text-muted-foreground text-sm">Référentiel documentaire des métiers et responsabilités.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvelle fiche
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par intitulé ou département..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Intitulé de poste</TableHead>
                <TableHead>Département</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Dernière modification</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingProfiles ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredProfiles.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucune fiche de poste trouvée.</TableCell></TableRow>
              ) : (
                filteredProfiles.map((p) => (
                  <TableRow key={p.jobProfileId}>
                    <TableCell>
                      <div className="font-bold text-primary">{p.jobTitleName}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono mt-1">ID: {p.jobProfileId}</div>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-sm">
                         <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> {p.departmentName}
                       </div>
                    </TableCell>
                    <TableCell>
                       <Badge variant="outline" className="font-bold">{p.versionLabel || "V1"}</Badge>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <Calendar className="w-3.5 h-3.5" /> {formatDate(p.lastModifiedAt || p.updatedAt)}
                       </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(p.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => router.push(`/entity/${entityId}/job-profiles/${p.jobProfileId}/preview`)}
                            className="gap-2 text-primary font-semibold"
                          >
                            <Eye className="w-4 h-4" /> Consulter / Imprimer
                          </DropdownMenuItem>
                          {canUpdate && (
                            <>
                              <DropdownMenuItem onClick={() => handleEdit(p)} className="gap-2">
                                <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                              {p.status === 'active' ? (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'disable' })} className="gap-2 text-destructive">
                                  <PowerOff className="w-4 h-4" /> Désactiver
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'reactivate' })} className="gap-2 text-green-600">
                                  <RefreshCcw className="w-4 h-4" /> Réactiver
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Form Dialog */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 pb-2 border-b shrink-0">
            <DialogTitle>{editingId ? "Modifier la fiche de poste" : "Nouvelle fiche de poste"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Une nouvelle version (snapshot) sera automatiquement générée après sauvegarde." : "Définissez le périmètre et les exigences du poste."}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 min-h-0">
            <form id="job-profile-form" onSubmit={handleSave} className="p-6 space-y-8 pb-12">
              {/* Main Fields Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Entreprise</Label>
                  <Input value={entity?.nomEntreprise || ""} readOnly className="bg-secondary/20" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="issueDate">Date d'émission initiale</Label>
                  <Input id="issueDate" type="date" value={formData.issueDate} onChange={(e) => setFormData(p => ({...p, issueDate: e.target.value}))} required />
                </div>
                <div className="space-y-2">
                  <Label>État du document</Label>
                  <div className="pt-2">
                    {editingId ? (
                      <div className="flex items-center gap-2">
                        {getStatusBadge(profiles?.find(p => p.jobProfileId === editingId)?.status || 'active')}
                        <Badge variant="outline" className="bg-primary/5">Future {`V${(profiles?.find(p => p.jobProfileId === editingId)?.version || 1) + 1}`}</Badge>
                      </div>
                    ) : <Badge className="bg-green-500">Nouveau (V1)</Badge>}
                  </div>
                </div>
              </div>

              {/* Organization Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                <div className="space-y-2">
                  <Label>Département</Label>
                  <Select value={formData.departmentId} onValueChange={(v) => setFormData(p => ({...p, departmentId: v, jobTitleId: ""}))}>
                    <SelectTrigger><SelectValue placeholder="Choisir un département" /></SelectTrigger>
                    <SelectContent>
                      {activeDepartments.map(d => <SelectItem key={d.departmentId} value={d.departmentId}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Intitulé du poste</Label>
                  <Select value={formData.jobTitleId} onValueChange={(v) => setFormData(p => ({...p, jobTitleId: v}))}>
                    <SelectTrigger><SelectValue placeholder={formData.departmentId ? "Choisir le poste" : "Sélectionnez d'abord un département"} /></SelectTrigger>
                    <SelectContent>
                      {filteredJobTitlesForDept.map(j => <SelectItem key={j.jobTitleId} value={j.jobTitleId}>{j.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Hierarchy Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                <div className="space-y-2">
                  <Label>Supérieur hiérarchique direct</Label>
                  <Select value={formData.directSupervisorJobTitleId} onValueChange={(v) => setFormData(p => ({...p, directSupervisorJobTitleId: v}))}>
                    <SelectTrigger><SelectValue placeholder="Choisir le poste du N+1" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun</SelectItem>
                      {activeJobTitles.map(j => <SelectItem key={j.jobTitleId} value={j.jobTitleId}>{j.title} ({j.departmentName})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Collaborateurs directs (Multi-sélection)</Label>
                  <div className="border rounded-md p-3 h-[120px] overflow-y-auto space-y-2 bg-background">
                    {activeJobTitles.map(j => (
                      <div key={j.jobTitleId} className="flex items-center gap-2">
                        <Checkbox 
                          id={`collab-${j.jobTitleId}`} 
                          checked={formData.collaboratorJobTitleIds.includes(j.jobTitleId)}
                          onCheckedChange={() => toggleArrayItem('collaboratorJobTitleIds', j.jobTitleId)}
                        />
                        <label htmlFor={`collab-${j.jobTitleId}`} className="text-xs cursor-pointer">{j.title}</label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Catalog Sections */}
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
                title="Objectifs" 
                type="objective"
                field="objectives"
                formData={formData}
                catalogItems={catalogItems || []}
                newLabel={newCatalogLabels.objective}
                setNewLabel={(v) => setNewCatalogLabels(p => ({...p, objective: v}))}
                onToggle={(v) => toggleArrayItem('objectives', v)}
                onAdd={() => addCatalogItem('objective', 'objectives')}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
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
                  title="Expérience professionnelle" 
                  type="professionalExperience"
                  field="professionalExperience"
                  formData={formData}
                  catalogItems={catalogItems || []}
                  newLabel={newCatalogLabels.professionalExperience}
                  setNewLabel={(v) => setNewCatalogLabels(p => ({...p, professionalExperience: v}))}
                  onToggle={(v) => toggleArrayItem('professionalExperience', v)}
                  onAdd={() => addCatalogItem('professionalExperience', 'professionalExperience')}
                />
              </div>

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

              {/* Notes Section */}
              <div className="space-y-2 pt-4 border-t">
                <Label htmlFor="notes" className="text-primary font-bold">Notes Internes / Observations complémentaires</Label>
                <Textarea 
                  id="notes" 
                  value={formData.notes} 
                  onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} 
                  placeholder="Observations libres sur le poste..."
                  className="min-h-[100px]"
                />
              </div>
            </form>
          </ScrollArea>

          <DialogFooter className="p-6 pt-4 border-t bg-secondary/10 shrink-0">
            <Button variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
            <Button 
              form="job-profile-form"
              type="submit"
              disabled={loading || !formData.jobTitleId || !formData.departmentId}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {editingId ? "Mettre à jour (Nouvelle Version)" : "Créer la fiche de poste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status AlertDialog */}
      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'disable' 
                ? "Souhaitez-vous désactiver cette fiche de poste ? Elle ne sera plus proposée pour les recrutements."
                : "Souhaitez-vous réactiver cette fiche de poste ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); executeStatusChange(); }}
              className={statusChange?.action === 'disable' ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
              disabled={loading}
            >
              {loading ? "Traitement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
    <div className="space-y-3 pt-4 border-t">
      <Label className="text-primary font-bold">{title}</Label>
      
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

      <div className="flex flex-wrap gap-2 min-h-[40px] p-3 border rounded-md bg-secondary/5">
        {selectedValues.length === 0 && <span className="text-[10px] text-muted-foreground italic">Aucun élément sélectionné.</span>}
        {selectedValues.map(v => (
          <Badge key={v} variant="default" className="gap-1.5 py-1 px-2 pr-1 bg-primary/90">
            {v}
            <button type="button" onClick={() => onToggle(v)} className="hover:bg-primary rounded-full p-0.5">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>

      {filteredCatalog.length > 0 && (
        <div className="space-y-2 mt-2">
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Réutiliser du catalogue</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredCatalog.filter((c: any) => !selectedValues.includes(c.label)).map((c: any) => (
              <button
                key={c.itemId}
                type="button"
                onClick={() => onToggle(c.label)}
                className="text-left text-xs p-2 border rounded hover:bg-secondary/30 transition-colors flex items-center justify-between group"
              >
                <span className="truncate">{c.label}</span>
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
