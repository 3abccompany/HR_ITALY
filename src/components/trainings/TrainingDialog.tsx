"use client";

import { useState, useEffect, useMemo } from "react";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { 
  Training, 
  TrainingType, 
  TrainingStatus,
  TrainingResultStatus,
  TRAINING_TYPE_LABELS,
  TRAINING_STATUS_LABELS,
  TRAINING_RESULT_LABELS
} from "@/types/training";
import { Employee } from "@/types/employee";
import { createTraining, updateTraining, createTrainingBatch } from "@/services/training.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, GraduationCap, Save, Info, FileSignature, Search, X, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { parseISO, differenceInCalendarDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  trainingId: string | null;
  resultMode?: boolean;
  employees: Employee[];
}

const initialForm = {
  employeeId: "",
  personId: "" as string | null,
  trainingType: "worker_general" as TrainingType,
  title: "",
  provider: "",
  deliveryMode: "classroom" as any,
  startDate: new Date().toISOString().split('T')[0],
  endDate: "",
  completionDate: "",
  expiryDate: "",
  durationHours: undefined as number | undefined,
  status: "planned" as TrainingStatus,
  resultStatus: "not_required" as TrainingResultStatus,
  notes: ""
};

export function TrainingDialog({ open, onOpenChange, entityId, trainingId, resultMode = false, employees }: TrainingDialogProps) {
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const isEditing = !!trainingId;

  useEffect(() => {
    // Prevent infinite loop by returning early if the dialog is closed
    if (!open) return;

    async function load() {
      if (trainingId && db) {
        setFetching(true);
        try {
          const snap = await getDoc(doc(db, `entities/${entityId}/trainings`, trainingId));
          if (snap.exists()) {
            const data = snap.data() as Training;
            setFormData({
              employeeId: data.employeeId,
              personId: data.personId || null,
              trainingType: data.trainingType,
              title: data.title || "",
              provider: data.provider || "",
              deliveryMode: data.deliveryMode || "classroom",
              startDate: data.startDate || data.courseDate,
              endDate: data.endDate || "",
              completionDate: data.completionDate || "",
              expiryDate: data.expiryDate || "",
              durationHours: data.durationHours || undefined,
              status: data.status,
              resultStatus: data.resultStatus || "not_required",
              notes: data.notes || ""
            });
            setSelectedEmployeeIds([data.employeeId]);
          }
        } catch (err) {
          toast({ variant: "destructive", title: "Erreur de chargement" });
        } finally {
          setFetching(false);
        }
      } else {
        // Reset for NEW training session - only if not already in initial state
        setFormData(initialForm);
        setSelectedEmployeeIds(prev => prev.length === 0 ? prev : []);
        setEmployeeSearch(prev => prev === "" ? prev : "");
      }
    }
    load();
  }, [trainingId, db, entityId, open]); // Removed toast to stabilize dependencies

  const daysCount = useMemo(() => {
    if (!formData.startDate) return 0;
    if (!formData.endDate) return 1;
    try {
      const start = parseISO(formData.startDate);
      const end = parseISO(formData.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
      const diff = differenceInCalendarDays(end, start);
      return diff >= 0 ? diff + 1 : -1;
    } catch (e) {
      return 0;
    }
  }, [formData.startDate, formData.endDate]);

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.toLowerCase().trim();
    if (!term) return employees;
    return employees.filter(e => 
      e.displayName.toLowerCase().includes(term) || 
      e.employeeCode?.toLowerCase().includes(term) ||
      e.email?.toLowerCase().includes(term)
    );
  }, [employees, employeeSearch]);

  const handleToggleEmployee = (id: string) => {
    if (isEditing) return;
    setSelectedEmployeeIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (selectedEmployeeIds.length === 0) {
      toast({ variant: "destructive", title: "Collaborateur requis", description: "Veuillez sélectionner au moins un collaborateur." });
      return;
    }

    if (!formData.title.trim()) {
      toast({ variant: "destructive", title: "Intitulé requis" });
      return;
    }

    if (daysCount < 0) {
      toast({ variant: "destructive", title: "Dates invalides", description: "La date de fin ne peut pas être antérieure à la date de début." });
      return;
    }

    setLoading(true);
    try {
      const commonPayload = { 
        ...formData,
        daysCount: daysCount > 0 ? daysCount : 1,
        resultStatus: (formData.status === 'completed' && formData.resultStatus === 'not_required') ? 'passed' : formData.resultStatus
      };

      if (isEditing) {
        await updateTraining(entityId, trainingId, commonPayload, user.uid);
        toast({ title: "Formation mise à jour" });
      } else {
        if (selectedEmployeeIds.length === 1) {
          const emp = employees.find(x => x.employeeId === selectedEmployeeIds[0]);
          await createTraining(entityId, { ...commonPayload, employeeId: emp!.employeeId, personId: emp?.personId || null }, user.uid);
          toast({ title: "Formation enregistrée" });
        } else {
          const targets = selectedEmployeeIds.map(id => {
            const emp = employees.find(x => x.employeeId === id);
            return { employeeId: id, personId: emp?.personId || null };
          });
          await createTrainingBatch(entityId, commonPayload, targets, user.uid);
          toast({ title: "Formations enregistrées", description: `${targets.length} dossiers ont été créés.` });
        }
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-hidden flex flex-col p-0 rounded-[2rem]">
        <DialogHeader className="p-8 pb-4 shrink-0">
          <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
            {resultMode ? <FileSignature className="w-6 h-6 text-accent" /> : <GraduationCap className="w-6 h-6 text-accent" />}
            {resultMode ? "Saisir le résultat" : (isEditing ? "Modifier la formation" : "Planifier une formation")}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Modification du dossier individuel." : "Sélectionnez un ou plusieurs collaborateurs pour cette session."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-8 py-4">
          {fetching ? (
            <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <form id="training-form" onSubmit={handleSave} className="space-y-8 pb-8">
              
              {/* Collaborators Selection Area */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Collaborateur(s)</Label>
                  {!isEditing && selectedEmployeeIds.length > 0 && (
                    <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px] font-black border-none">
                      {selectedEmployeeIds.length} sélectionné{selectedEmployeeIds.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>

                {isEditing ? (
                  <div className="p-4 bg-secondary/20 rounded-2xl border flex items-center gap-3">
                     <User className="w-5 h-5 text-primary/40" />
                     <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {employees.find(e => e.employeeId === formData.employeeId)?.displayName || "Collaborateur inconnu"}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase">
                          {employees.find(e => e.employeeId === formData.employeeId)?.employeeCode || "N/A"}
                        </p>
                     </div>
                  </div>
                ) : (
                  <div className="space-y-4 bg-slate-50/50 p-4 rounded-[1.5rem] border border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        placeholder="Rechercher un collaborateur..." 
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        className="pl-10 h-10 rounded-xl bg-white border-primary/5 focus:border-primary/20"
                      />
                    </div>

                    <ScrollArea className="h-[220px] rounded-xl border bg-white shadow-inner">
                      <div className="p-2 space-y-1">
                        {filteredEmployees.map(e => {
                          const isSelected = selectedEmployeeIds.includes(e.employeeId);
                          return (
                            <div
                              key={e.employeeId} 
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group outline-none",
                                isSelected ? "bg-primary/5 ring-1 ring-primary/10" : "hover:bg-slate-50"
                              )}
                              onClick={() => handleToggleEmployee(e.employeeId)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  handleToggleEmployee(e.employeeId);
                                }
                              }}
                            >
                              <Checkbox 
                                checked={isSelected} 
                                onCheckedChange={() => {}} // parent div handles it
                                className="pointer-events-none"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate group-hover:text-primary transition-colors">{e.displayName}</p>
                                <p className="text-[10px] text-muted-foreground uppercase font-mono">{e.employeeCode || "Sans matricule"}</p>
                              </div>
                              {isSelected && <Badge variant="secondary" className="bg-primary/10 text-primary p-0 h-4 w-4 rounded-full flex items-center justify-center"><Check className="h-2.5 w-2.5" /></Badge>}
                            </div>
                          );
                        })}
                        {filteredEmployees.length === 0 && (
                          <div className="py-12 text-center space-y-2">
                             <Search className="w-8 h-8 text-muted-foreground/20 mx-auto" />
                             <p className="text-xs text-muted-foreground italic">Aucun collaborateur trouvé.</p>
                          </div>
                        )}
                        {employees.length === 0 && (
                          <div className="py-12 text-center text-xs text-muted-foreground italic">Aucun collaborateur disponible.</div>
                        )}
                      </div>
                    </ScrollArea>
                    <p className="text-[9px] text-muted-foreground pl-1 leading-relaxed">
                       <Info className="w-3 h-3 inline mr-1 align-text-top" />
                       Chaque collaborateur sélectionné recevra son propre dossier de formation indépendant.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de formation</Label>
                    <Select value={formData.trainingType} onValueChange={(v: any) => setFormData(p => ({...p, trainingType: v}))} disabled={resultMode}>
                      <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                         {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>

                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Intitulé du cours</Label>
                    <Input value={formData.title} onChange={(e) => setFormData(p => ({...p, title: e.target.value}))} required placeholder="Ex: SST - Maintien des acquis" className="rounded-xl h-11" disabled={resultMode} />
                 </div>

                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Organisme (Ente formatore)</Label>
                    <Input value={formData.provider} onChange={(e) => setFormData(p => ({...p, provider: e.target.value}))} placeholder="Nom du centre" className="rounded-xl h-11" disabled={resultMode} />
                 </div>

                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Mode de formation</Label>
                    <Select value={formData.deliveryMode} onValueChange={(v: any) => setFormData(p => ({...p, deliveryMode: v}))} disabled={resultMode}>
                      <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                         <SelectItem value="classroom">Présentiel</SelectItem>
                         <SelectItem value="online">E-learning</SelectItem>
                         <SelectItem value="blended">Mixte</SelectItem>
                         <SelectItem value="on_the_job">Au poste</SelectItem>
                      </SelectContent>
                    </Select>
                 </div>

                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Date de début</Label>
                    <Input type="date" value={formData.startDate} onChange={(e) => setFormData(p => ({...p, startDate: e.target.value}))} required className="rounded-xl h-11" disabled={resultMode} />
                 </div>

                 <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-black">Date de fin (Optionnel)</Label>
                      {daysCount > 0 && (
                        <Badge variant="secondary" className="h-4 text-[8px] uppercase font-black bg-primary/5 text-primary border-none">
                          {daysCount} {daysCount > 1 ? 'jours' : 'jour'}
                        </Badge>
                      )}
                    </div>
                    <Input type="date" value={formData.endDate} onChange={(e) => setFormData(p => ({...p, endDate: e.target.value}))} className={cn("rounded-xl h-11", daysCount < 0 && "border-red-500")} disabled={resultMode} />
                 </div>
              </div>

              <Separator className="opacity-50" />

              {/* Status and Results Block */}
              <div className={cn("p-6 rounded-[2rem] border space-y-6", resultMode ? "bg-accent/5 border-accent/20 ring-4 ring-accent/5" : "bg-slate-50 border-slate-100")}>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Statut actuel</Label>
                      <Select value={formData.status} onValueChange={(v: any) => setFormData(p => ({...p, status: v}))}>
                        <SelectTrigger className="bg-white rounded-xl h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRAINING_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Score / Évaluation</Label>
                      <Select value={formData.resultStatus} onValueChange={(v: any) => setFormData(p => ({...p, resultStatus: v}))}>
                        <SelectTrigger className="bg-white rounded-xl h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRAINING_RESULT_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Date de validation</Label>
                      <Input type="date" value={formData.completionDate} onChange={(e) => setFormData(p => ({...p, completionDate: e.target.value}))} className="bg-white rounded-xl h-11" required={formData.status === 'completed'} />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black text-accent-foreground">Prochain recyclage</Label>
                      <Input type="date" value={formData.expiryDate} onChange={(e) => setFormData(p => ({...p, expiryDate: e.target.value}))} className="bg-white rounded-xl h-11" />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Volume horaire (h)</Label>
                      <Input type="number" step="0.5" value={formData.durationHours || ""} onChange={(e) => setFormData(p => ({...p, durationHours: e.target.value ? parseFloat(e.target.value) : undefined}))} placeholder="Ex: 4" className="bg-white rounded-xl h-11" />
                    </div>
                 </div>
              </div>

              <div className="space-y-2">
                 <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes internes RH</Label>
                 <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-2xl min-h-[80px]" placeholder="..." />
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-xl font-bold">Annuler</Button>
          <Button type="submit" form="training-form" disabled={loading || daysCount < 0 || selectedEmployeeIds.length === 0} className="rounded-xl px-10 font-black shadow-lg shadow-primary/20">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {isEditing ? "Enregistrer" : (selectedEmployeeIds.length > 1 ? `Créer ${selectedEmployeeIds.length} dossiers` : "Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
