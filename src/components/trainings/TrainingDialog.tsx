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
import { Loader2, ShieldCheck, GraduationCap, Save, Info, Calendar, FileSignature, AlertCircle, Search, X, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { parseISO, differenceInCalendarDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    async function load() {
      if (trainingId && db && open) {
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
        setFormData(initialForm);
        setSelectedEmployeeIds([]);
        setEmployeeSearch("");
      }
    }
    load();
  }, [trainingId, db, entityId, open, toast]);

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
      e.employeeCode?.toLowerCase().includes(term)
    );
  }, [employees, employeeSearch]);

  const handleToggleEmployee = (id: string) => {
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
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
            {resultMode ? <FileSignature className="w-6 h-6 text-accent" /> : <GraduationCap className="w-6 h-6 text-accent" />}
            {resultMode ? "Saisir le résultat" : (isEditing ? "Modifier la formation" : "Planifier une formation")}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Modification du dossier individuel." : "Sélectionnez un ou plusieurs collaborateurs pour cette session."}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <form id="training-form" onSubmit={handleSave} className="space-y-6 py-4">
            
            <div className="space-y-2">
               <Label className="text-[10px] font-black uppercase text-muted-foreground">Collaborateur(s)</Label>
               {isEditing ? (
                 <div className="h-11 px-4 bg-secondary/20 rounded-xl border flex items-center text-sm font-bold text-slate-700">
                    {employees.find(e => e.employeeId === formData.employeeId)?.displayName || "Collaborateur inconnu"}
                 </div>
               ) : (
                 <div className="space-y-3">
                    <Popover>
                      <PopoverTrigger asChild>
                         <Button variant="outline" type="button" className="w-full h-11 justify-between rounded-xl font-medium px-4">
                            <span className="truncate">
                               {selectedEmployeeIds.length === 0 
                                 ? "Choisir les collaborateurs..." 
                                 : `${selectedEmployeeIds.length} collaborateur${selectedEmployeeIds.length > 1 ? 's' : ''} sélectionné${selectedEmployeeIds.length > 1 ? 's' : ''}`
                               }
                            </span>
                            <Search className="ml-2 h-4 w-4 opacity-50" />
                         </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0 rounded-2xl shadow-2xl z-[100]" align="start">
                         <div className="p-3 border-b flex items-center gap-2 bg-slate-50">
                            <Search className="w-4 h-4 text-muted-foreground" />
                            <input 
                              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                              placeholder="Rechercher..."
                              value={employeeSearch}
                              onChange={(e) => setEmployeeSearch(e.target.value)}
                            />
                            {employeeSearch && <button type="button" onClick={() => setEmployeeSearch("")}><X className="w-3 h-3" /></button>}
                         </div>
                         <ScrollArea className="h-[250px]">
                            <div className="p-2 space-y-1">
                               {filteredEmployees.map(e => {
                                 const isSelected = selectedEmployeeIds.includes(e.employeeId);
                                 return (
                                   <div
                                     key={e.employeeId} 
                                     role="button"
                                     tabIndex={0}
                                     className={cn(
                                       "w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left cursor-pointer outline-none",
                                       isSelected ? "bg-primary/5" : "hover:bg-slate-50"
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
                                         <p className="text-sm font-bold text-slate-800 truncate">{e.displayName}</p>
                                         <p className="text-[10px] text-muted-foreground uppercase font-mono">{e.employeeCode}</p>
                                      </div>
                                      {isSelected && <Check className="w-4 h-4 text-primary" />}
                                   </div>
                                 );
                               })}
                               {filteredEmployees.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">Aucun résultat.</p>}
                            </div>
                         </ScrollArea>
                      </PopoverContent>
                    </Popover>

                    {selectedEmployeeIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                         {selectedEmployeeIds.map(id => {
                           const emp = employees.find(e => e.employeeId === id);
                           return (
                             <Badge key={id} variant="secondary" className="gap-1.5 pl-2 pr-1 h-6 bg-white border-primary/10 text-primary font-bold">
                                {emp?.displayName}
                                <button type="button" onClick={() => handleToggleEmployee(id)} className="hover:bg-slate-100 rounded-full p-0.5"><X className="w-3 h-3" /></button>
                             </Badge>
                           );
                         })}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground pl-1 italic">
                       <Info className="w-3 h-3 inline mr-1" />
                       Une ligne de formation sera créée pour chaque collaborateur sélectionné.
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

            <div className={cn("p-6 rounded-[1.5rem] border space-y-6", resultMode ? "bg-accent/5 border-accent/20 ring-4 ring-accent/5" : "bg-slate-50 border-slate-100")}>
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
               <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-xl min-h-[80px]" placeholder="..." />
            </div>

            <DialogFooter className="pt-4 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" form="training-form" disabled={loading || daysCount < 0} className="rounded-xl px-8 font-black shadow-lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                {isEditing ? "Enregistrer" : "Enregistrer la session"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
