
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Building2, Plus, Edit, PowerOff, RefreshCcw, 
  Loader2, Briefcase, Info, MoreVertical,
  AlertCircle, ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  createDepartment, 
  updateDepartment, 
  disableDepartment, 
  reactivateDepartment 
} from "@/services/department.service";
import { 
  createJobTitle, 
  updateJobTitle, 
  disableJobTitle, 
  reactivateJobTitle 
} from "@/services/job-title.service";
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
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";

const initialDeptForm = {
  name: "",
  code: "",
  description: "",
  responsibleName: "",
  notes: ""
};

const initialJobForm = {
  title: "",
  description: "",
  notes: ""
};

export default function DepartmentsManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // UI State
  const [isDeptFormVisible, setIsDeptFormVisible] = useState(false);
  const [isJobFormVisible, setIsJobFormVisible] = useState(false);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  
  const [deptFormData, setDeptFormData] = useState(initialDeptForm);
  const [jobFormData, setJobFormData] = useState(initialJobForm);
  const [loading, setLoading] = useState(false);

  const [statusChange, setStatusChange] = useState<{ id: string, type: 'dept' | 'job', action: 'disable' | 'reactivate' } | null>(null);

  // Permissions
  const canReadDepts = hasPermission("departments.read");
  const canCreateDepts = hasPermission("departments.create");
  const canUpdateDepts = hasPermission("departments.update");
  const canReadJobs = hasPermission("jobTitles.read");
  const canCreateJobs = hasPermission("jobTitles.create");
  const canUpdateJobs = hasPermission("jobTitles.update");

  // Queries
  const deptsQuery = useMemo(() => {
    if (!db || !entityId || !canReadDepts) return null;
    return query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc"));
  }, [db, entityId, canReadDepts]);

  const jobsQuery = useMemo(() => {
    if (!db || !entityId || !canReadJobs) return null;
    return query(collection(db, `entities/${entityId}/jobTitles`), orderBy("title", "asc"));
  }, [db, entityId, canReadJobs]);

  const { data: departments, loading: loadingDepts } = useCollection<Department>(deptsQuery);
  const { data: jobTitles, loading: loadingJobs } = useCollection<JobTitle>(jobsQuery);

  const handleDeptInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setDeptFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleJobInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setJobFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleDeptReset = () => {
    setDeptFormData(initialDeptForm);
    setEditingDeptId(null);
    setIsDeptFormVisible(false);
  };

  const handleJobReset = () => {
    setJobFormData(initialJobForm);
    setEditingJobId(null);
    setActiveDeptId(null);
    setIsJobFormVisible(false);
  };

  const handleEditDept = (d: Department) => {
    setDeptFormData({
      name: d.name,
      code: d.code,
      description: d.description || "",
      responsibleName: d.responsibleName || "",
      notes: d.notes || ""
    });
    setEditingDeptId(d.departmentId);
    setIsDeptFormVisible(true);
  };

  const handleEditJob = (j: JobTitle) => {
    setJobFormData({
      title: j.title,
      description: j.description || "",
      notes: j.notes || ""
    });
    setEditingJobId(j.jobTitleId);
    setActiveDeptId(j.departmentId);
    setIsJobFormVisible(true);
  };

  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;
    setLoading(true);
    try {
      if (editingDeptId) {
        await updateDepartment(entityId, editingDeptId, deptFormData, user.uid);
        toast({ title: "Mis à jour", description: "Le département a été modifié." });
      } else {
        await createDepartment(entityId, deptFormData, user.uid);
        toast({ title: "Créé", description: "Le département a été enregistré." });
      }
      handleDeptReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId || !activeDeptId) return;
    setLoading(true);
    try {
      const dept = departments?.find(d => d.departmentId === activeDeptId);
      if (!dept) throw new Error("Département parent introuvable.");

      if (editingJobId) {
        await updateJobTitle(entityId, editingJobId, jobFormData, user.uid);
        toast({ title: "Mis à jour", description: "L'intitulé de poste a été modifié." });
      } else {
        await createJobTitle(entityId, { 
          ...jobFormData, 
          departmentId: activeDeptId,
          departmentName: dept.name 
        }, user.uid);
        toast({ title: "Ajouté", description: "L'intitulé de poste a été enregistré." });
      }
      handleJobReset();
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
      const { id, type, action } = statusChange;
      if (type === 'dept') {
        if (action === 'disable') await disableDepartment(entityId, id, user.uid);
        else await reactivateDepartment(entityId, id, user.uid);
      } else {
        if (action === 'disable') await disableJobTitle(entityId, id, user.uid);
        else await reactivateJobTitle(entityId, id, user.uid);
      }
      toast({ title: "Statut mis à jour", description: "L'action a été effectuée avec succès." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Inactif</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canReadDepts) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter la structure organisationnelle.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Départements & Postes</h1>
          <p className="text-muted-foreground text-sm">Gestion de l'organigramme et du catalogue des métiers.</p>
        </div>
        {canCreateDepts && (
          <Button onClick={() => setIsDeptFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau département
          </Button>
        )}
      </div>

      {loadingDepts ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : departments?.length === 0 ? (
        <Card className="border-dashed border-2 py-12">
          <CardContent className="text-center">
             <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
             <p className="text-muted-foreground">Aucun département configuré pour cette entité.</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {departments?.map((dept) => {
            const deptJobs = jobTitles?.filter(jt => jt.departmentId === dept.departmentId) || [];
            
            return (
              <AccordionItem key={dept.departmentId} value={dept.departmentId} className="border rounded-xl bg-card px-4 overflow-hidden">
                <div className="flex items-center justify-between py-2">
                  <AccordionTrigger className="hover:no-underline py-4 flex-1">
                    <div className="flex items-center gap-4 text-left">
                       <div className="bg-primary/5 p-2 rounded-lg">
                          <Building2 className="w-5 h-5 text-primary" />
                       </div>
                       <div>
                         <div className="flex items-center gap-2">
                           <span className="font-bold text-primary text-lg">{dept.name}</span>
                           <Badge variant="outline" className="font-mono text-[10px]">{dept.code}</Badge>
                           {getStatusBadge(dept.status)}
                         </div>
                         <p className="text-xs text-muted-foreground mt-0.5">
                           {dept.responsibleName ? `Responsable: ${dept.responsibleName}` : "Aucun responsable assigné"}
                         </p>
                       </div>
                    </div>
                  </AccordionTrigger>
                  
                  <div className="flex items-center gap-2 pr-2">
                     <span className="text-xs font-semibold px-2 py-0.5 bg-secondary rounded-full text-secondary-foreground">
                        {deptJobs.length} postes
                     </span>
                     
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                           <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                           {canUpdateDepts && (
                             <DropdownMenuItem 
                               onSelect={() => {
                                 setTimeout(() => {
                                   handleEditDept(dept);
                                 }, 0);
                               }} 
                               className="gap-2"
                             >
                               <Edit className="w-4 h-4" /> Modifier le département
                             </DropdownMenuItem>
                           )}
                           {canCreateJobs && dept.status === 'active' && (
                             <DropdownMenuItem 
                               onSelect={() => { 
                                 setTimeout(() => {
                                   setActiveDeptId(dept.departmentId); 
                                   setIsJobFormVisible(true);
                                 }, 0);
                               }} 
                               className="gap-2 font-semibold text-primary"
                             >
                               <Plus className="w-4 h-4" /> Ajouter un intitulé de poste
                             </DropdownMenuItem>
                           )}
                           {canUpdateDepts && (
                             dept.status === 'active' ? (
                               <DropdownMenuItem 
                                 onSelect={() => {
                                   setTimeout(() => {
                                     setStatusChange({ id: dept.departmentId, type: 'dept', action: 'disable' });
                                   }, 0);
                                 }} 
                                 className="gap-2 text-destructive"
                               >
                                 <PowerOff className="w-4 h-4" /> Désactiver
                               </DropdownMenuItem>
                             ) : (
                               <DropdownMenuItem 
                                 onSelect={() => {
                                   setTimeout(() => {
                                     setStatusChange({ id: dept.departmentId, type: 'dept', action: 'reactivate' });
                                   }, 0);
                                 }} 
                                 className="gap-2 text-green-600"
                               >
                                 <RefreshCcw className="w-4 h-4" /> Réactiver
                               </DropdownMenuItem>
                             )
                           )}
                        </DropdownMenuContent>
                     </DropdownMenu>
                  </div>
                </div>

                <AccordionContent className="pb-6 pt-2 border-t">
                  <div className="space-y-3">
                    {dept.description && (
                      <p className="text-sm text-muted-foreground bg-secondary/20 p-3 rounded-lg mb-4">
                        <Info className="w-4 h-4 inline mr-2 opacity-50" />
                        {dept.description}
                      </p>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                       {loadingJobs ? (
                         <div className="col-span-full py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" /></div>
                       ) : deptJobs.length === 0 ? (
                         <div className="col-span-full py-6 text-center text-xs text-muted-foreground border-dashed border rounded-lg bg-background/50">
                            Aucun intitulé de poste dans ce département.
                         </div>
                       ) : (
                         deptJobs.map(job => (
                           <div key={job.jobTitleId} className="group p-4 border rounded-lg bg-background hover:border-primary/30 transition-all">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-sm text-primary">{job.title}</h4>
                                    {getStatusBadge(job.status)}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-2">{job.description || "Pas de description"}</p>
                                </div>

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"><MoreVertical className="w-3 h-3" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {canUpdateJobs && (
                                      <DropdownMenuItem 
                                        onSelect={() => {
                                          setTimeout(() => {
                                            handleEditJob(job);
                                          }, 0);
                                        }} 
                                        className="gap-2 text-xs"
                                      >
                                        <Edit className="w-3 h-3" /> Modifier
                                      </DropdownMenuItem>
                                    )}
                                    {canUpdateJobs && (
                                      job.status === 'active' ? (
                                        <DropdownMenuItem 
                                          onSelect={() => {
                                            setTimeout(() => {
                                              setStatusChange({ id: job.jobTitleId, type: 'job', action: 'disable' });
                                            }, 0);
                                          }} 
                                          className="gap-2 text-xs text-destructive"
                                        >
                                          <PowerOff className="w-3 h-3" /> Désactiver
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem 
                                          onSelect={() => {
                                            setTimeout(() => {
                                              setStatusChange({ id: job.jobTitleId, type: 'job', action: 'reactivate' });
                                            }, 0);
                                          }} 
                                          className="gap-2 text-xs text-green-600"
                                        >
                                          <RefreshCcw className="w-3 h-3" /> Réactiver
                                        </DropdownMenuItem>
                                      )
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Dept Dialog */}
      <Dialog open={isDeptFormVisible} onOpenChange={setIsDeptFormVisible}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingDeptId ? "Modifier le département" : "Nouveau département"}</DialogTitle>
            <DialogDescription>Définissez une unité organisationnelle de l'entité.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveDept} className="space-y-4 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3 space-y-2">
                <Label htmlFor="name">Nom du département</Label>
                <Input id="name" value={deptFormData.name} onChange={handleDeptInputChange} required placeholder="Ex: Ressources Humaines" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={deptFormData.code} onChange={handleDeptInputChange} required placeholder="Ex: RH" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="responsibleName">Nom du Responsable (Optionnel)</Label>
              <Input id="responsibleName" value={deptFormData.responsibleName} onChange={handleDeptInputChange} placeholder="Ex: Jean Dupont" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={deptFormData.description} onChange={handleDeptInputChange} placeholder="Missions du département..." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Internes</Label>
              <Input id="notes" value={deptFormData.notes} onChange={handleDeptInputChange} placeholder="Observations privées..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleDeptReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {editingDeptId ? "Enregistrer les modifications" : "Créer le département"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Job Dialog */}
      <Dialog open={isJobFormVisible} onOpenChange={setIsJobFormVisible}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{editingJobId ? "Modifier l'intitulé" : "Nouvel intitulé de poste"}</DialogTitle>
            <DialogDescription>
              Ajouter un métier au département {departments?.find(d => d.departmentId === activeDeptId)?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveJob} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Titre du poste</Label>
              <Input id="title" value={jobFormData.title} onChange={handleJobInputChange} required placeholder="Ex: Développeur Senior" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description du rôle</Label>
              <Textarea id="description" value={jobFormData.description} onChange={handleJobInputChange} placeholder="Activités principales..." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jobNotes">Notes</Label>
              <Input id="jobNotes" value={jobFormData.notes} onChange={handleJobInputChange} placeholder="..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleJobReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Briefcase className="w-4 h-4 mr-2" />}
                {editingJobId ? "Enregistrer" : "Ajouter le poste"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Status Confirmation */}
      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation du changement de statut</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'disable' 
                ? "Souhaitez-vous désactiver cet élément ? Il ne pourra plus être sélectionné pour de futurs processus."
                : "Souhaitez-vous réactiver cet élément ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Accordion type="single" collapsible>
               <AccordionItem value="item-1" className="border-none">
                  <AccordionTrigger className="hover:no-underline py-0" />
                  <AccordionContent className="pb-0" />
               </AccordionItem>
            </Accordion>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeStatusChange(); }} className={statusChange?.action === 'disable' ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} disabled={loading}>
              {loading ? "Chargement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterDropdown({ label, value, onValueChange, options, icon: Icon }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[], icon?: any }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("h-10 w-auto min-w-[150px] text-xs font-medium bg-background border-primary/10", value !== 'all' && "border-primary ring-1 ring-primary/10")}>
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-muted-foreground">{label}:</span>
          <SelectValue placeholder="Tous" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous ({label})</SelectItem>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
