"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { uploadHRDocument, getDocumentDownloadUrl } from "@/services/document.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, GraduationCap, Save, Info, FileSignature, Search, User, AlertCircle, Paperclip, Upload, FileCheck, Eye } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { parseISO, differenceInCalendarDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useActiveMembership } from "@/hooks/use-active-membership";

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
  notes: "",
  certificateDocumentId: "" as string | null
};

export function TrainingDialog({ open, onOpenChange, entityId, trainingId, resultMode = false, employees }: TrainingDialogProps) {
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { membership } = useActiveMembership(entityId);
  
  const [formData, setFormData] = useState(initialForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const isEditing = !!trainingId;
  const lastInitializedId = useRef<string | null>(null);

  // Single effect for initialization to prevent loops
  useEffect(() => {
    if (!open) {
      lastInitializedId.current = null;
      return;
    }

    if (lastInitializedId.current === (trainingId || 'new')) return;
    lastInitializedId.current = (trainingId || 'new');

    const initialize = async () => {
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
              startDate: data.startDate || data.courseDate || "",
              endDate: data.endDate || "",
              completionDate: data.completionDate || "",
              expiryDate: data.expiryDate || "",
              durationHours: data.durationHours || undefined,
              status: data.status,
              resultStatus: data.resultStatus || "not_required",
              notes: data.notes || "",
              certificateDocumentId: data.certificateDocumentId || null
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
        setSelectedFile(null);
      }
    };

    initialize();
  }, [open, trainingId, entityId, db, toast]);

  // Derived filtered list
  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.toLowerCase().trim();
    if (!term) return employees;
    return employees.filter(e => 
      e.displayName.toLowerCase().includes(term) || 
      (e.employeeCode && e.employeeCode.toLowerCase().includes(term))
    );
  }, [employees, employeeSearch]);

  // Derived duration in days (Inclusive calculation)
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

  const toggleEmployeeSelection = (id: string) => {
    if (isEditing) return;
    setSelectedEmployeeIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleViewDoc = async (docId: string) => {
    if (!db || !entityId || !docId) return;
    setLoading(true);
    try {
      const docSnap = await getDoc(doc(db, `entities/${entityId}/documents`, docId));
      if (docSnap.exists()) {
        const url = await getDocumentDownloadUrl(docSnap.data().storagePath);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("Document introuvable.");
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible d'ouvrir le document." });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (selectedEmployeeIds.length === 0) {
      toast({ variant: "destructive", title: "Saisie incomplète", description: "Veuillez sélectionner au moins un collaborateur." });
      return;
    }

    if (daysCount < 0) {
      toast({ variant: "destructive", title: "Dates invalides", description: "La date de fin ne peut pas être antérieure à la date de début." });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        daysCount: daysCount > 0 ? daysCount : 1,
      };

      let activeTrainingId = trainingId;

      if (isEditing && trainingId) {
        await updateTraining(entityId, trainingId, payload, user.uid);
      } else {
        if (selectedEmployeeIds.length === 1) {
          const emp = employees.find(x => x.employeeId === selectedEmployeeIds[0]);
          activeTrainingId = await createTraining(entityId, { 
            ...payload, 
            employeeId: emp!.employeeId, 
            personId: emp?.personId || null 
          }, user.uid);
        } else {
          const targets = selectedEmployeeIds.map(id => {
            const emp = employees.find(x => x.employeeId === id);
            return { employeeId: id, personId: emp?.personId || null };
          });
          const batchResult = await createTrainingBatch(entityId, payload, targets, user.uid);
          // Batch mode: multiple records created, activeTrainingId is not unique here
          activeTrainingId = null;
        }
      }

      // Handle optional GED upload (only for single record edits or single creation)
      if (selectedFile && activeTrainingId) {
        try {
          const empId = formData.employeeId || selectedEmployeeIds[0];
          const emp = employees.find(x => x.employeeId === empId);
          
          const docId = await uploadHRDocument(
            entityId,
            selectedFile,
            {
              title: `Attestato Formazione - ${emp?.displayName || 'Employé'} - ${formData.title}`,
              documentType: "training_certificate",
              employeeId: empId,
              personId: emp?.personId || null,
              relatedModule: "trainings",
              relatedId: activeTrainingId,
              status: "valid"
            },
            user.uid,
            membership?.userDisplayName || "Utilisateur"
          );

          await updateTraining(entityId, activeTrainingId, { certificateDocumentId: docId }, user.uid);
        } catch (uploadErr) {
          console.error("[Training] Upload failed:", uploadErr);
          toast({ 
            variant: "destructive", 
            title: "Résultat enregistré", 
            description: "La formation est sauvegardée, mais l'envoi de l'attestation PDF a échoué. Vous pouvez la joindre plus tard dans la GED." 
          });
        }
      }

      toast({ title: isEditing ? "Mise à jour effectuée" : "Formations enregistrées" });
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
        <DialogHeader className="p-8 pb-4">
          <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
            {resultMode ? <FileSignature className="w-5 h-5 text-accent" /> : <GraduationCap className="w-5 h-5 text-accent" />}
            {resultMode ? "Résultat formation" : (isEditing ? "Modifier formation" : "Planifier formation")}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Détails individuels de la formation." : "Sélectionnez les collaborateurs et configurez la session."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-8 py-2">
          {fetching ? (
            <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
          ) : (
            <form id="training-form" onSubmit={handleSave} className="space-y-6 pb-8">
              
              {/* Collaborator Selection Block */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                   <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">Collaborateur(s)</Label>
                   {!isEditing && selectedEmployeeIds.length > 0 && (
                      <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px] font-black border-none">
                        {selectedEmployeeIds.length} sélectionné(s)
                      </Badge>
                   )}
                </div>

                {isEditing ? (
                  <div className="p-4 bg-secondary/20 rounded-2xl border flex items-center gap-3">
                     <User className="w-5 h-5 text-primary/40" />
                     <div>
                        <p className="text-sm font-bold text-slate-800">
                          {employees.find(e => e.employeeId === formData.employeeId)?.displayName || "Collaborateur"}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase">{formData.employeeId}</p>
                     </div>
                  </div>
                ) : (
                  <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        placeholder="Rechercher par nom ou matricule..." 
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        className="pl-10 h-10 rounded-xl bg-white"
                      />
                    </div>

                    <div className="space-y-1 max-h-[160px] overflow-y-auto border rounded-xl p-1 bg-white">
                      {filteredEmployees.map(emp => {
                        const isSelected = selectedEmployeeIds.includes(emp.employeeId);
                        return (
                          <div 
                            key={emp.employeeId}
                            className={cn(
                              "flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors",
                              isSelected && "bg-primary/5"
                            )}
                            onClick={() => toggleEmployeeSelection(emp.employeeId)}
                          >
                            <input 
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 truncate">{emp.displayName}</p>
                              <p className="text-[9px] text-muted-foreground font-mono uppercase">{emp.employeeCode || "—"}</p>
                            </div>
                          </div>
                        );
                      })}
                      {filteredEmployees.length === 0 && <p className="text-xs text-center py-4 text-muted-foreground italic">Aucun collaborateur trouvé</p>}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Type de formation</Label>
                    <Select value={formData.trainingType} onValueChange={(v: any) => setFormData(p => ({...p, trainingType: v}))} disabled={resultMode}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Intitulé de la formation</Label>
                    <Input value={formData.title} onChange={(e) => setFormData(p => ({...p, title: e.target.value}))} required className="rounded-xl" disabled={resultMode} placeholder="Ex: Risque spécifique - Mécanique" />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Date de début</Label>
                    <Input type="date" value={formData.startDate} onChange={(e) => setFormData(p => ({...p, startDate: e.target.value}))} required className="rounded-xl" disabled={resultMode} />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Date de fin (Optionnelle)</Label>
                    <div className="flex gap-2">
                       <Input 
                        type="date" 
                        value={formData.endDate} 
                        onChange={(e) => setFormData(p => ({...p, endDate: e.target.value}))} 
                        className="rounded-xl flex-1" 
                        disabled={resultMode} 
                       />
                       {daysCount > 0 && (
                          <div className="flex items-center">
                             <Badge variant="secondary" className="h-10 px-3 rounded-xl bg-primary/5 text-primary border-primary/10 whitespace-nowrap font-black">
                                {daysCount} {daysCount > 1 ? 'jours' : 'jour'}
                             </Badge>
                          </div>
                       )}
                    </div>
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-black">Organisme / Provider</Label>
                    <Input value={formData.provider} onChange={(e) => setFormData(p => ({...p, provider: e.target.value}))} placeholder="Ex: Studio Sicurezza" className="rounded-xl" disabled={resultMode} />
                 </div>
                 <div className="space-y-2">
                    <div className="flex items-center justify-between">
                       <Label className="text-[10px] uppercase font-black">Durée totale (Heures)</Label>
                       <span title="Saisie manuelle de la durée totale certifiée.">
                          <Info className="w-3 h-3 text-blue-500 cursor-help" />
                       </span>
                    </div>
                    <Input 
                      type="number" 
                      step="0.5"
                      value={formData.durationHours ?? ""} 
                      onChange={(e) => setFormData(p => ({...p, durationHours: e.target.value === "" ? undefined : parseFloat(e.target.value)}))} 
                      placeholder="Ex: 8"
                      className="rounded-xl" 
                    />
                 </div>
              </div>

              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
                 <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                 <p className="text-[10px] text-blue-800 leading-tight">
                    Le nombre de jours est calculé automatiquement à partir des dates de début et de fin. 
                    <strong> La durée en heures doit être saisie manuellement</strong> car elle dépend du programme pédagogique certifié.
                 </p>
              </div>

              <Separator className="opacity-40" />

              <div className={cn("p-6 rounded-[2rem] border space-y-4", resultMode ? "bg-accent/5 border-accent/20 ring-4 ring-accent/5" : "bg-slate-50 border-slate-100")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Statut</Label>
                      <Select value={formData.status} onValueChange={(v: any) => setFormData(p => ({...p, status: v}))}>
                        <SelectTrigger className="bg-white rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRAINING_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Résultat / Évaluation</Label>
                      <Select value={formData.resultStatus} onValueChange={(v: any) => setFormData(p => ({...p, resultStatus: v}))}>
                        <SelectTrigger className="bg-white rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRAINING_RESULT_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Date de validation</Label>
                      <Input type="date" value={formData.completionDate} onChange={(e) => setFormData(p => ({...p, completionDate: e.target.value}))} className="rounded-xl bg-white" />
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Prochain recyclage</Label>
                      <Input type="date" value={formData.expiryDate} onChange={(e) => setFormData(p => ({...p, expiryDate: e.target.value}))} className="rounded-xl bg-white" />
                   </div>
                </div>
                
                {resultMode && (
                  <div className="space-y-4">
                    {formData.certificateDocumentId && (
                      <div className="p-4 bg-white rounded-2xl border border-green-100 flex items-center justify-between shadow-sm animate-in fade-in">
                        <div className="flex items-center gap-3">
                           <div className="bg-green-100 p-2 rounded-xl text-green-600"><FileCheck className="w-5 h-5" /></div>
                           <p className="text-xs font-bold text-slate-700">Attestation déjà jointe</p>
                        </div>
                        <Button type="button" variant="secondary" size="sm" className="h-8 rounded-lg font-bold gap-2" onClick={() => handleViewDoc(formData.certificateDocumentId!)} disabled={loading}>
                           <Eye className="w-3.5 h-3.5" /> Voir
                        </Button>
                      </div>
                    )}
                    <div className="space-y-3 p-5 bg-white border border-accent/10 rounded-2xl">
                      <div className="flex items-center gap-2 mb-1">
                        <Paperclip className="w-4 h-4 text-accent" />
                        <Label className="text-xs font-black uppercase text-accent tracking-tight">
                           {formData.certificateDocumentId ? "Remplacer l'attestation" : "Joindre l'attestation de formation (Optionnel)"}
                        </Label>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Input 
                          type="file" 
                          accept=".pdf,.png,.jpg,.jpeg" 
                          className="h-11 pt-2.5 cursor-pointer file:font-black file:text-[10px] file:uppercase file:bg-accent/10 file:text-accent file:border-none file:rounded-md file:mr-4 hover:bg-slate-50 transition-colors"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                        />
                        {selectedFile && <p className="text-[10px] text-green-600 font-bold">Nouveau fichier prêt : {selectedFile.name}</p>}
                        <p className="text-[9px] text-muted-foreground leading-relaxed italic">
                          Format: PDF, PNG, JPG. Peut être ajoutée ou consultée plus tard dans l'onglet GED.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Observations / Notes internes</Label>
                 <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} className="rounded-xl min-h-[80px]" placeholder="Détails sur la session ou le comportement..." />
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="p-8 border-t bg-slate-50 gap-2">
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-xl font-bold">Annuler</Button>
          <Button type="submit" form="training-form" disabled={loading || selectedEmployeeIds.length === 0} className="px-8 rounded-xl font-black shadow-lg">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {isEditing ? "Mettre à jour" : "Enregistrer la session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
