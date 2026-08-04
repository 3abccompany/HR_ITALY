"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import type { Employee } from "@/types/employee";
import {
  MEDICAL_VISIT_PROVIDER_TYPE_LABELS,
  MEDICAL_VISIT_REQUEST_URGENCY_LABELS,
  MEDICAL_VISIT_TYPE_LABELS,
  MedicalVisitProviderType,
  MedicalVisitRequestUrgency,
  MedicalVisitType,
} from "@/types/medical-visit";
import {
  getMedicalVisitRequestDetailsAction,
  saveMedicalVisitRequestWithParticipantsAction,
} from "@/app/entity/[entityId]/medical-visits/actions";

type RequestFormState = {
  visitType: MedicalVisitType;
  providerType: MedicalVisitProviderType;
  providerName: string;
  providerEmail: string;
  medicalCenter: string;
  desiredStartDate: string;
  desiredEndDate: string;
  urgency: MedicalVisitRequestUrgency;
  constraints: string;
};

interface MedicalVisitRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  requestId: string | null;
  employees: Employee[];
  onSaved: () => void;
}

const emptyForm: RequestFormState = {
  visitType: "periodic",
  providerType: "medical_center",
  providerName: "",
  providerEmail: "",
  medicalCenter: "",
  desiredStartDate: new Date().toISOString().split("T")[0],
  desiredEndDate: new Date().toISOString().split("T")[0],
  urgency: "normal",
  constraints: "",
};

const workflowSteps = [
  "Participants et médecin",
  "Demande au médecin",
  "Créneaux reçus",
  "Affectation des employés",
  "Planification et notifications",
  "Suivi individuel",
];

export function MedicalVisitRequestDialog({
  open,
  onOpenChange,
  entityId,
  requestId,
  employees,
  onSaved,
}: MedicalVisitRequestDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [form, setForm] = useState<RequestFormState>(emptyForm);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    async function loadRequest() {
      if (!open) {
        setForm(emptyForm);
        setSelectedEmployeeIds([]);
        setSearch("");
        return;
      }

      if (!requestId) {
        setForm(emptyForm);
        setSelectedEmployeeIds([]);
        return;
      }

      if (!user) return;
      setFetching(true);
      try {
        const idToken = await user.getIdToken(true);
        const result = await getMedicalVisitRequestDetailsAction({ idToken, entityId, requestId });
        if (!result.success) throw new Error(result.error);
        setForm({
          visitType: result.request.visitType,
          providerType: result.request.providerType,
          providerName: result.request.providerName,
          providerEmail: result.request.providerEmail,
          medicalCenter: result.request.medicalCenter || "",
          desiredStartDate: result.request.desiredStartDate,
          desiredEndDate: result.request.desiredEndDate,
          urgency: result.request.urgency,
          constraints: result.request.constraints || "",
        });
        setSelectedEmployeeIds(result.participants.map((participant) => participant.employeeId));
      } catch (error: any) {
        toast({ variant: "destructive", title: "Erreur", description: error.message || "Demande indisponible." });
        onOpenChange(false);
      } finally {
        setFetching(false);
      }
    }
    loadRequest();
  }, [entityId, onOpenChange, open, requestId, toast, user]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((employee) => {
      const target = `${employee.displayName || ""} ${employee.employeeCode || ""}`.toLowerCase();
      return target.includes(needle);
    });
  }, [employees, search]);

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || loading) return;
    if (selectedEmployeeIds.length === 0) {
      toast({ variant: "destructive", title: "Collaborateurs requis", description: "Sélectionnez au moins un collaborateur." });
      return;
    }

    setLoading(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await saveMedicalVisitRequestWithParticipantsAction({
        idToken,
        entityId,
        requestId,
        visitType: form.visitType,
        providerType: form.providerType,
        providerName: form.providerName,
        providerEmail: form.providerEmail,
        medicalCenter: form.medicalCenter || null,
        desiredStartDate: form.desiredStartDate,
        desiredEndDate: form.desiredEndDate,
        urgency: form.urgency,
        constraints: form.constraints || null,
        employeeIds: selectedEmployeeIds,
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: "Brouillon enregistré", description: "La demande groupée de visites médicales a été sauvegardée." });
      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erreur", description: error.message || "Impossible d'enregistrer la demande." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-primary">
            <Stethoscope className="h-6 w-6 text-accent" />
            {requestId ? "Modifier la demande de visites médicales" : "Nouvelle demande de visites médicales"}
          </DialogTitle>
          <DialogDescription>
            Étape 1 : sélectionnez les participants et le médecin ou centre. Aucun e-mail n'est envoyé depuis ce brouillon.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {workflowSteps.map((step, index) => (
            <div
              key={step}
              className={`rounded-2xl border px-3 py-2 text-[10px] font-black uppercase leading-tight ${
                index === 0 ? "border-primary bg-primary/10 text-primary" : "border-muted bg-muted/30 text-muted-foreground"
              }`}
            >
              {index + 1}. {step}
            </div>
          ))}
        </div>

        {fetching ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Type de visite</Label>
                <Select value={form.visitType} onValueChange={(value: MedicalVisitType) => setForm((prev) => ({ ...prev, visitType: value }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEDICAL_VISIT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Type de prestataire</Label>
                <Select value={form.providerType} onValueChange={(value: MedicalVisitProviderType) => setForm((prev) => ({ ...prev, providerType: value }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEDICAL_VISIT_PROVIDER_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Nom du médecin ou centre</Label>
                <Input value={form.providerName} onChange={(event) => setForm((prev) => ({ ...prev, providerName: event.target.value }))} required className="rounded-xl" />
              </div>

              <div className="space-y-2">
                <Label>Adresse e-mail</Label>
                <Input type="email" value={form.providerEmail} onChange={(event) => setForm((prev) => ({ ...prev, providerEmail: event.target.value }))} required className="rounded-xl" />
              </div>

              {form.providerType === "medical_center" && (
                <div className="space-y-2">
                  <Label>Centre médical</Label>
                  <Input value={form.medicalCenter} onChange={(event) => setForm((prev) => ({ ...prev, medicalCenter: event.target.value }))} className="rounded-xl" />
                </div>
              )}

              <div className="space-y-2">
                <Label>Urgence</Label>
                <Select value={form.urgency} onValueChange={(value: MedicalVisitRequestUrgency) => setForm((prev) => ({ ...prev, urgency: value }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEDICAL_VISIT_REQUEST_URGENCY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Début de période souhaitée</Label>
                <Input type="date" value={form.desiredStartDate} onChange={(event) => setForm((prev) => ({ ...prev, desiredStartDate: event.target.value }))} required className="rounded-xl" />
              </div>

              <div className="space-y-2">
                <Label>Fin de période souhaitée</Label>
                <Input type="date" value={form.desiredEndDate} onChange={(event) => setForm((prev) => ({ ...prev, desiredEndDate: event.target.value }))} required className="rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Contraintes facultatives</Label>
              <Textarea value={form.constraints} onChange={(event) => setForm((prev) => ({ ...prev, constraints: event.target.value }))} className="min-h-[90px] rounded-xl" />
            </div>

            <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label className="flex items-center gap-2 font-black">
                    <Users className="h-4 w-4" />
                    {selectedEmployeeIds.length === 1
                      ? "1 collaborateur sélectionné"
                      : `${selectedEmployeeIds.length} collaborateurs sélectionnés`}
                  </Label>
                  <p className="text-xs text-muted-foreground">Collaborateurs actifs de l'entité uniquement.</p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou matricule" className="pl-9 rounded-xl" />
                </div>
              </div>

              <ScrollArea className="h-64 rounded-xl border bg-white">
                <div className="divide-y">
                  {filteredEmployees.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Aucun collaborateur actif trouvé.</div>
                  ) : filteredEmployees.map((employee) => (
                    <label key={employee.employeeId} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40">
                      <Checkbox
                        checked={selectedEmployeeIds.includes(employee.employeeId)}
                        onCheckedChange={() => toggleEmployee(employee.employeeId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{employee.displayName}</span>
                        <span className="block text-xs text-muted-foreground">{employee.employeeCode}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || selectedEmployeeIds.length === 0} className="rounded-xl font-black">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enregistrer le brouillon
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
