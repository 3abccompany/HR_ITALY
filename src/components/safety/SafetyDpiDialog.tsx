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
  SafetyDpiAssignment, 
  SafetyDpiStatus, 
  SAFETY_DPI_STATUS_LABELS 
} from "@/types/safety-dpi";
import { Employee } from "@/types/employee";
import { createDpiAssignment, updateDpiAssignment } from "@/services/safety-dpi.service";
import { uploadHRDocument } from "@/services/document.service";
import { useUser, useFirebase } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, Shield, Save, Upload, Paperclip, FileCheck, Info } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useActiveMembership } from "@/hooks/use-active-membership";

interface SafetyDpiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  assignmentId: string | null;
  employees: Employee[];
}

const initialForm = {
  employeeId: "",
  personId: "" as string | null,
  employeeName: "",
  riskType: "",
  dpiName: "",
  quantity: 1,
  deliveryDate: new Date().toISOString().split('T')[0],
  plannedReplacementDate: "",
  status: "assigned" as SafetyDpiStatus,
  notes: "",
  reportDocumentId: "" as string | null
};

export function SafetyDpiDialog({ open, onOpenChange, entityId, assignmentId, employees }: SafetyDpiDialogProps) {
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { membership } = useActiveMembership(entityId);
  
  const [formData, setFormData] = useState(initialForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const isEditing = !!assignmentId;

  useEffect(() => {
    async function load() {
      if (assignmentId && db && open) {
        setFetching(true);
        try {
          const snap = await getDoc(doc(db, `entities/${entityId}/safetyDpiAssignments`, assignmentId));
          if (snap.exists()) {
            const data = snap.data() as SafetyDpiAssignment;
            setFormData({
              employeeId: data.employeeId,
              personId: data.personId || null,
              employeeName: data.employeeName || "",
              riskType: data.riskType,
              dpiName: data.dpiName,
              quantity: data.quantity,
              deliveryDate: data.deliveryDate,
              plannedReplacementDate: data.plannedReplacementDate,
              status: data.status,
              notes: data.notes || "",
              reportDocumentId: data.reportDocumentId || null
            });
          }
        } catch (err) {
          toast({ variant: "destructive", title: "Erreur de chargement" });
        } finally {
          setFetching(false);
        }
      } else if (open) {
        setFormData(initialForm);
        setSelectedFile(null);
      }
    }
    load();
  }, [assignmentId, db, entityId, open, toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Employé requis" });
      return;
    }

    if (formData.quantity <= 0) {
      toast({ variant: "destructive", title: "Quantité invalide", description: "La quantité doit être supérieure à 0." });
      return;
    }

    if (formData.plannedReplacementDate && formData.plannedReplacementDate < formData.deliveryDate) {
      toast({ variant: "destructive", title: "Dates incohérentes", description: "Le remplacement ne peut pas être antérieur à la remise." });
      return;
    }

    setLoading(true);
    try {
      let activeId = assignmentId;
      const payload = { ...formData };

      if (isEditing && assignmentId) {
        await updateDpiAssignment(entityId, assignmentId, payload, user.uid);
      } else {
        const emp = employees.find(e => e.employeeId === formData.employeeId);
        payload.employeeName = emp?.displayName || "";
        activeId = await createDpiAssignment(entityId, payload, user.uid);
      }

      // Optional file upload
      if (selectedFile && activeId) {
        try {
          const emp = employees.find(e => e.employeeId === formData.employeeId);
          const docId = await uploadHRDocument(
            entityId,
            selectedFile,
            {
              title: `PV de remise EPI - ${emp?.displayName || 'Employé'} - ${formData.dpiName}`,
              documentType: "dpi_delivery_report",
              employeeId: formData.employeeId,
              personId: formData.personId,
              relatedModule: "safety",
              relatedId: activeId,
              status: "valid"
            },
            user.uid,
            membership?.userDisplayName || "Utilisateur"
          );

          await updateDpiAssignment(entityId, activeId, { reportDocumentId: docId }, user.uid);
        } catch (uploadErr) {
          console.error("[SafetyDpi] Upload failed:", uploadErr);
          toast({ 
            variant: "destructive", 
            title: "Assignation enregistrée", 
            description: "Les données sont sauvegardées, mais l'envoi du document PDF a échoué." 
          });
        }
      }

      toast({ title: assignmentId ? "Assignation mise à jour" : "Assignation enregistrée" });
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
            <Shield className="w-6 h-6 text-accent" />
            {assignmentId ? "Modifier remise EPI/DPI" : "Nouvelle remise EPI/DPI"}
          </DialogTitle>
          <DialogDescription>Enregistrez la remise d'équipements de protection individuelle.</DialogDescription>
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
                        personId: emp?.personId || null,
                        employeeName: emp?.displayName || ""
                      }));
                    }}
                    disabled={isEditing}
                  >
                    <SelectTrigger className="rounded-xl h-11">
                       <SelectValue placeholder="Sélectionner..." />
                    </SelectTrigger>
                    <SelectContent>
                       {employees.map(e => (
                         <SelectItem key={e.employeeId} value={e.employeeId}>{e.displayName} ({e.employeeCode})</SelectItem>
                       ))}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de risque</Label>
                  <Input value={formData.riskType} onChange={(e) => setFormData(p => ({...p, riskType: e.target.value}))} required placeholder="Ex: Chute, Bruit..." className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Nom de l'EPI / DPI</Label>
                  <Input value={formData.dpiName} onChange={(e) => setFormData(p => ({...p, dpiName: e.target.value}))} required placeholder="Ex: Casque, Chaussures S3..." className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Quantité</Label>
                  <Input type="number" min="1" value={formData.quantity} onChange={(e) => setFormData(p => ({...p, quantity: parseInt(e.target.value)}))} required className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Date de remise</Label>
                  <Input type="date" value={formData.deliveryDate} onChange={(e) => setFormData(p => ({...p, deliveryDate: e.target.value}))} required className="rounded-xl h-11" />
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Remplacement prévu</Label>
                  <Input type="date" value={formData.plannedReplacementDate} onChange={(e) => setFormData(p => ({...p, plannedReplacementDate: e.target.value}))} required className="rounded-xl h-11" />
               </div>
            </div>

            <Separator className="opacity-50" />

            <div className="space-y-4">
               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Statut actuel</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData(p => ({...p, status: v}))}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       {Object.entries(SAFETY_DPI_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-3 p-5 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="flex items-center gap-2 mb-1">
                    <Paperclip className="w-4 h-4 text-accent" />
                    <Label className="text-xs font-black uppercase text-accent tracking-tight">PV de remise signé (Optionnel)</Label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Input 
                      type="file" 
                      accept=".pdf,.png,.jpg,.jpeg" 
                      className="h-11 pt-2.5 cursor-pointer file:font-black file:text-[10px] file:uppercase file:bg-accent/10 file:text-accent file:border-none file:rounded-md file:mr-4 hover:bg-slate-100 transition-colors"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                    />
                    {selectedFile && <p className="text-[10px] text-green-600 font-bold">Fichier prêt : {selectedFile.name}</p>}
                    <p className="text-[9px] text-muted-foreground italic">PDF recommandé. Peut être ajouté plus tard dans la GED.</p>
                  </div>
               </div>

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Notes / Observations</Label>
                  <Textarea value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} placeholder="Détails sur l'état ou la taille..." className="rounded-xl" />
               </div>
            </div>

            <DialogFooter className="pt-4 border-t gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading} className="rounded-xl px-8 font-black shadow-lg">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
