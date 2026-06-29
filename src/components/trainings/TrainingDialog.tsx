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
import { createTraining, updateTraining } from "@/services/training.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, GraduationCap, Save, Info, Calendar, FileSignature, AlertCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { parseISO, differenceInCalendarDays } from "date-fns";
import { Badge } from "@/components/ui/badge";

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
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

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
          }
        } catch (err) {
          toast({ variant: "destructive", title: "Erreur de chargement" });
        } finally {
          setFetching(false);
        }
      } else {
        setFormData(initialForm);
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
      return diff >= 0 ? diff + 1 : -1; // -1 indicates error (end before start)
    } catch (e) {
      return 0;
    }
  }, [formData.startDate, formData.endDate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Employé requis" });
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

    if (formData.status === 'completed' && !formData.completionDate) {
      toast({ variant: "destructive", title: "Date manquante", description: "Veuillez renseigner la date de complétion pour clôturer la formation." });
      return;
    }

    setLoading(true);
    try {
      const finalPayload = { 
        ...formData,
        daysCount: daysCount > 0 ? daysCount : 1,
        // Sync result status if completed but not set
        resultStatus: (formData.status === 'completed' && formData.resultStatus === 'not_required') ? 'passed' : formData.resultStatus
      };

      if (trainingId) {
        await updateTraining(entityId, trainingId, finalPayload, user.uid);
        toast({ title: "Formation mise à jour" });
      } else {
        await createTraining(entityId, finalPayload, user.uid);
        toast({ title: "Formation enregistrée" });
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
            {resultMode ? "Saisir le résultat de la formation" : (trainingId ? "Modifier la formation" : "Planifier une formation")}
          </DialogTitle>
          <DialogDescription>
            {resultMode 
              ? "Enregistrez les détails de complétion et le résultat obtenu par le collaborateur."
              : "Gérez la formation obligatoire ou continue du collaborateur."}
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6 py-4">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Collaborateur</Label>
                  <Select 
                    value={formData.employeeId} 
                    onValueChange={(v) => {
                      const emp = employees.find(e => e.employeeId === v);
                      setFormData(p => ({
                        ...p, 
                        employeeId: v,
                        personId: emp?.personId || null
                      }));
                    }}
                    disabled={!!trainingId || resultMode}
                  >
                    <SelectTrigger className={cn("rounded-xl h-11", resultMode && "bg-secondary/20")}>
                       <SelectValue placeholder="Sélectionner..." />
                    </SelectTrigger>
                    <SelectContent>
                       {employees.length === 0 ? (
                         <div className="p-4 text-center text-xs text-muted-foreground">Aucun collaborateur disponible</div>
                       ) : (
                         employees.map(e => (
                           <SelectItem key={e.employeeId} value={e.employeeId}>
                              {e.displayName} ({e.employeeCode})
                           </SelectItem>
                         ))
                       )}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de formation</Label>
                  <Select value={formData.trainingType} onValueChange={(v: any) => setFormData(p => ({...p, trainingType: v}))} disabled={resultMode}>
                    <SelectTrigger className={cn("rounded-xl h-11", resultMode && "bg-secondary/20")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2 col-span-full">
                  <Label className="text-[10px] uppercase font-black">Intitulé exact du cours</Label>
                  <Input value={formData.title} onChange={(e) => setFormData(p => ({...p, title: e.target.value}))} required placeholder="Ex: SST - Maintien des acquis" className="rounded-xl h-11" disabled={resultMode} />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Organisme (Ente formatore)</Label>
                  <Input value={formData.provider} onChange={(e) => setFormData(p => ({...p, provider: e.target.value}))} placeholder="Nom du centre" className="rounded-xl h-11" disabled={resultMode} />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Mode de formation</Label>
                  <Select value={formData.deliveryMode} onValueChange={(v: any) => setFormData(p => ({...p, deliveryMode: v}))} disabled={resultMode}>
                    <SelectTrigger className={cn("rounded-xl h-11", resultMode && "bg-secondary/20")}><SelectValue /></SelectTrigger>
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
                      <Badge variant="secondary" className="h-4 text-[8px] uppercase font-bold bg-primary/5 text-primary border-none">
                        {daysCount} {daysCount > 1 ? 'jours' : 'jour'}
                      </Badge>
                    )}
                  </div>
                  <Input type="date" value={formData.endDate} onChange={(e) => setFormData(p => ({...p, endDate: e.target.value}))} className={cn("rounded-xl h-11", daysCount < 0 && "border-red-500")} disabled={resultMode} />
                  {daysCount < 0 && <p className="text-[9px] text-red-500 font-bold mt-1">La date de fin est antérieure au début.</p>}
               </div>
            </div>

            <Separator className="opacity-50" />

            <div className={cn("p-6 rounded-[1.5rem] border space-y-6", resultMode ? "bg-accent/5 border-accent/20 ring-4 ring-accent/5 animate-in zoom-in-95" : "bg-slate-50 border-slate-100")}>
               <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-widest border-b pb-2">
                  <FileSignature className="w-3.5 h-3.5" /> Résultat & Validation
               </div>

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
                    <Label className="text-[10px] uppercase font-black">Date de validation (Complétion)</Label>
                    <Input type="date" value={formData.completionDate} onChange={(e) => setFormData(p => ({...p, completionDate: e.target.value}))} className="bg-white rounded-xl h-11" required={formData.status === 'completed'} />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black text-accent-foreground">Prochain recyclage / Échéance</Label>
                    <Input type="date" value={formData.expiryDate} onChange={(e) => setFormData(p => ({...p, expiryDate: e.target.value}))} className="bg-white rounded-xl h-11 border-accent/20" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Volume horaire validé (Heures)</Label>
                    <Input type="number" step="0.5" value={formData.durationHours || ""} onChange={(e) => setFormData(p => ({...p, durationHours: e.target.value ? parseFloat(e.target.value) : undefined}))} placeholder="Ex: 4" className="bg-white rounded-xl h-11" />
                  </div>
               </div>
            </div>

            <div className="space-y-2 pt-2">
               <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes internes RH</Label>
               <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-xl min-h-[80px]" placeholder="Observations complémentaires..." />
            </div>

            <DialogFooter className="pt-4 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || daysCount < 0} className="rounded-xl px-8 font-black shadow-lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                {resultMode ? "Enregistrer le résultat" : (trainingId ? "Mettre à jour" : "Planifier la formation")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
