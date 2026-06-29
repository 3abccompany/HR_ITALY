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
  MedicalVisit, 
  MedicalVisitType, 
  MedicalFitnessStatus, 
  MedicalVisitStatus,
  MEDICAL_VISIT_TYPE_LABELS,
  FITNESS_STATUS_LABELS
} from "@/types/medical-visit";
import { Employee } from "@/types/employee";
import { createMedicalVisit, updateMedicalVisit } from "@/services/medical-visit.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, Stethoscope, AlertCircle, Info, FileSignature } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface MedicalVisitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  visitId: string | null;
  resultMode?: boolean;
  employees: Employee[];
}

const initialForm = {
  employeeId: "",
  personId: "" as string | null,
  visitType: "periodic" as MedicalVisitType,
  visitDate: new Date().toISOString().split('T')[0],
  doctorName: "",
  medicalCenter: "",
  fitnessStatus: "pending_result" as MedicalFitnessStatus,
  status: "scheduled" as MedicalVisitStatus,
  nextVisitDate: "",
  prescriptions: "",
  restrictions: "",
  notes: ""
};

export function MedicalVisitDialog({ open, onOpenChange, entityId, visitId, resultMode = false, employees }: MedicalVisitDialogProps) {
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    async function load() {
      if (visitId && db && open) {
        setFetching(true);
        try {
          const snap = await getDoc(doc(db, `entities/${entityId}/medicalVisits`, visitId));
          if (snap.exists()) {
            const data = snap.data() as MedicalVisit;
            setFormData({
              employeeId: data.employeeId,
              personId: data.personId || null,
              visitType: data.visitType,
              visitDate: data.visitDate,
              doctorName: data.doctorName,
              medicalCenter: data.medicalCenter || "",
              fitnessStatus: data.fitnessStatus,
              status: data.status,
              nextVisitDate: data.nextVisitDate || "",
              prescriptions: data.prescriptions || "",
              restrictions: data.restrictions || "",
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
  }, [visitId, db, entityId, open, toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Employé requis" });
      return;
    }

    setLoading(true);
    try {
      let finalPayload = { ...formData };
      
      // Auto-complete logic for result entry
      if (resultMode && formData.fitnessStatus !== 'pending_result' && formData.status === 'scheduled') {
        finalPayload.status = 'completed';
      }

      if (visitId) {
        await updateMedicalVisit(entityId, visitId, finalPayload, user.uid);
        toast({ title: "Visite mise à jour" });
      } else {
        await createMedicalVisit(entityId, finalPayload, user.uid);
        toast({ title: "Visite enregistrée" });
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
            {resultMode ? <FileSignature className="w-6 h-6 text-accent" /> : <Stethoscope className="w-6 h-6 text-accent" />}
            {resultMode ? "Saisir le résultat de la visite médicale" : (visitId ? "Détails de la visite" : "Planifier une visite médicale")}
          </DialogTitle>
          <DialogDescription>
            {resultMode 
              ? "Enregistrez le jugement d'aptitude émis par le médecin compétent." 
              : "Gestion des visites médicales / Sorveglianza sanitaria pour le collaborateur."}
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
                    disabled={!!visitId || resultMode}
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
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de visite</Label>
                  <Select value={formData.visitType} onValueChange={(v: any) => setFormData(p => ({...p, visitType: v}))} disabled={resultMode}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(MEDICAL_VISIT_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Date de la visite</Label>
                  <Input type="date" value={formData.visitDate} onChange={(e) => setFormData(p => ({...p, visitDate: e.target.value}))} required className="rounded-xl h-11" disabled={resultMode} />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Médecin compétent (Medico competente)</Label>
                  <Input value={formData.doctorName} onChange={(e) => setFormData(p => ({...p, doctorName: e.target.value}))} required placeholder="Nom du médecin" className="rounded-xl h-11" disabled={resultMode} />
               </div>
            </div>

            {!resultMode && (
              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Centre médical</Label>
                 <Input value={formData.medicalCenter} onChange={(e) => setFormData(p => ({...p, medicalCenter: e.target.value}))} placeholder="Ex: Centre de médecine du travail..." className="rounded-xl h-11" />
              </div>
            )}

            <Separator className="opacity-50" />

            <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-[1.5rem] border", resultMode ? "bg-accent/5 border-accent/20 ring-4 ring-accent/5" : "bg-slate-50 border-slate-100")}>
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Jugement d’aptitude (Giudizio di idoneità)</Label>
                  <Select value={formData.fitnessStatus} onValueChange={(v: any) => setFormData(p => ({...p, fitnessStatus: v}))}>
                    <SelectTrigger className="bg-white rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(FITNESS_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Date de prochaine visite</Label>
                  <Input type="date" value={formData.nextVisitDate} onChange={(e) => setFormData(p => ({...p, nextVisitDate: e.target.value}))} className="bg-white rounded-xl h-11" />
               </div>

               <div className="space-y-2 col-span-full">
                  <Label className="text-[10px] uppercase font-black text-primary">Statut du dossier</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData(p => ({...p, status: v}))}>
                    <SelectTrigger className="bg-white rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="scheduled">Planifiée / En attente</SelectItem>
                       <SelectItem value="completed">Terminée / Jugement rendu</SelectItem>
                       <SelectItem value="pending_result">En attente de résultat</SelectItem>
                       <SelectItem value="cancelled">Annulée</SelectItem>
                       <SelectItem value="archived">Archivée</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
            </div>

            <div className="space-y-4">
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Prescriptions / limitations de travail</Label>
                  <Textarea value={formData.prescriptions} onChange={(e) => setFormData(p => ({...p, prescriptions: e.target.value}))} placeholder="Détails sur l'aptitude physique (ex: port de charges limité...)" className="rounded-xl min-h-[80px]" />
               </div>
               
               <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-800 leading-relaxed font-medium">
                    <strong>Note de confidentialité :</strong> Ne pas saisir de diagnostic ni de détails cliniques. Indiquer uniquement les prescriptions ou limitations de travail.
                  </p>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes internes RH</Label>
                  <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-xl" />
               </div>
            </div>

            <DialogFooter className="pt-4 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading} className="rounded-xl px-8 font-black shadow-lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {resultMode ? "Enregistrer le résultat" : (visitId ? "Mettre à jour" : "Enregistrer la visite")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
