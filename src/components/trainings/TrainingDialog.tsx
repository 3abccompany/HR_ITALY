"use client";

import { useState, useEffect } from "react";
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
  TRAINING_TYPE_LABELS,
  TRAINING_STATUS_LABELS
} from "@/types/training";
import { Employee } from "@/types/employee";
import { createTraining, updateTraining } from "@/services/training.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, GraduationCap, Save, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface TrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  trainingId: string | null;
  employees: Employee[];
}

const initialForm = {
  employeeId: "",
  personId: "" as string | null,
  trainingType: "worker_general" as TrainingType,
  title: "",
  provider: "",
  deliveryMode: "classroom" as any,
  courseDate: new Date().toISOString().split('T')[0],
  completionDate: "",
  expiryDate: "",
  durationHours: undefined as number | undefined,
  status: "planned" as TrainingStatus,
  notes: ""
};

export function TrainingDialog({ open, onOpenChange, entityId, trainingId, employees }: TrainingDialogProps) {
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
              courseDate: data.courseDate,
              completionDate: data.completionDate || "",
              expiryDate: data.expiryDate || "",
              durationHours: data.durationHours || undefined,
              status: data.status,
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

    setLoading(true);
    try {
      if (trainingId) {
        await updateTraining(entityId, trainingId, formData, user.uid);
        toast({ title: "Formation mise à jour" });
      } else {
        await createTraining(entityId, formData, user.uid);
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
            <GraduationCap className="w-6 h-6 text-accent" />
            {trainingId ? "Modifier la formation" : "Ajouter une formation"}
          </DialogTitle>
          <DialogDescription>
            Enregistrez les détails de la formation obligatoire ou interne du collaborateur.
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
                    disabled={!!trainingId}
                  >
                    <SelectTrigger className="rounded-xl h-11">
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
                  <Select value={formData.trainingType} onValueChange={(v: any) => setFormData(p => ({...p, trainingType: v}))}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2 col-span-full">
                  <Label className="text-[10px] uppercase font-black">Intitulé exact du cours</Label>
                  <Input value={formData.title} onChange={(e) => setFormData(p => ({...p, title: e.target.value}))} required placeholder="Ex: SST - Maintien des acquis" className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Organisme (Ente formatore)</Label>
                  <Input value={formData.provider} onChange={(e) => setFormData(p => ({...p, provider: e.target.value}))} placeholder="Nom du centre" className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Mode de formation</Label>
                  <Select value={formData.deliveryMode} onValueChange={(v: any) => setFormData(p => ({...p, deliveryMode: v}))}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="classroom">Présentiel</SelectItem>
                       <SelectItem value="online">E-learning</SelectItem>
                       <SelectItem value="blended">Mixte</SelectItem>
                       <SelectItem value="on_the_job">Au poste</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
            </div>

            <Separator className="opacity-50" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Date de session</Label>
                  <Input type="date" value={formData.courseDate} onChange={(e) => setFormData(p => ({...p, courseDate: e.target.value}))} required className="rounded-xl h-11" />
               </div>
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Complétée le</Label>
                  <Input type="date" value={formData.completionDate} onChange={(e) => setFormData(p => ({...p, completionDate: e.target.value}))} className="rounded-xl h-11" />
               </div>
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Prochain recyclage</Label>
                  <Input type="date" value={formData.expiryDate} onChange={(e) => setFormData(p => ({...p, expiryDate: e.target.value}))} className="rounded-xl h-11 bg-accent/5 border-accent/20" />
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Durée (Heures)</Label>
                  <Input type="number" step="0.5" value={formData.durationHours || ""} onChange={(e) => setFormData(p => ({...p, durationHours: e.target.value ? parseFloat(e.target.value) : undefined}))} placeholder="Ex: 4" className="rounded-xl h-11" />
               </div>
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Statut actuel</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData(p => ({...p, status: v}))}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(TRAINING_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>
            </div>

            <div className="space-y-2 pt-2">
               <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes internes RH</Label>
               <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-xl min-h-[80px]" />
            </div>

            <DialogFooter className="pt-4 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading} className="rounded-xl px-8 font-black shadow-lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                {trainingId ? "Mettre à jour" : "Enregistrer la formation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
