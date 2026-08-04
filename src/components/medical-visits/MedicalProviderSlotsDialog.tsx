"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Plus, Save, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import {
  assignMedicalVisitParticipantsToSlotsAction,
  deleteMedicalProviderSlotAction,
  getMedicalVisitRequestDetailsAction,
  saveMedicalProviderSlotsAction,
} from "@/app/entity/[entityId]/medical-visits/actions";

type SlotForm = {
  slotId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  capacity: string;
  instructions: string;
};

type ParticipantRow = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  assignedSlotId: string | null;
  assignedStartTime: string | null;
  assignedEndTime: string | null;
};

type AssignmentForm = {
  slotId: string;
  appointmentStartTime: string;
  appointmentEndTime: string;
};

interface MedicalProviderSlotsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  requestId: string | null;
  onSaved: () => void;
}

const emptySlot = (): SlotForm => ({
  slotId: null,
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  capacity: "",
  instructions: "",
});

export function MedicalProviderSlotsDialog({
  open,
  onOpenChange,
  entityId,
  requestId,
  onSaved,
}: MedicalProviderSlotsDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [slots, setSlots] = useState<SlotForm[]>([emptySlot()]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignmentForm>>({});
  const [dispatchSlotId, setDispatchSlotId] = useState("none");
  const [dispatchDurationMinutes, setDispatchDurationMinutes] = useState("60");
  const [loading, setLoading] = useState(false);
  const [savingSlots, setSavingSlots] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);

  useEffect(() => {
    async function loadDetails() {
      if (!open) {
        setSlots([emptySlot()]);
        setParticipants([]);
        setAssignments({});
        setDispatchSlotId("none");
        setDispatchDurationMinutes("60");
        return;
      }
      if (!user || !requestId) return;
      setLoading(true);
      try {
        const idToken = await user.getIdToken(true);
        const result = await getMedicalVisitRequestDetailsAction({ idToken, entityId, requestId });
        if (!result.success) throw new Error(result.error);
        const loadedSlots = result.slots.map((slot) => ({
          slotId: slot.slotId,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime || "",
          location: slot.location,
          capacity: slot.capacity ? String(slot.capacity) : "",
          instructions: slot.instructions || "",
        }));
        setSlots(loadedSlots.length > 0 ? loadedSlots : [emptySlot()]);
        setParticipants(result.participants.map((participant) => ({
          employeeId: participant.employeeId,
          employeeCodeSnapshot: participant.employeeCodeSnapshot,
          employeeDisplayNameSnapshot: participant.employeeDisplayNameSnapshot,
          assignedSlotId: participant.assignedSlotId || null,
          assignedStartTime: participant.assignedStartTime || null,
          assignedEndTime: participant.assignedEndTime || null,
        })));
        setAssignments(Object.fromEntries(
          result.participants.map((participant) => [participant.employeeId, {
            slotId: participant.assignedSlotId || "none",
            appointmentStartTime: participant.assignedStartTime || "",
            appointmentEndTime: participant.assignedEndTime || "",
          }])
        ));
      } catch (error: any) {
        toast({ variant: "destructive", title: "Erreur", description: error.message || "Créneaux indisponibles." });
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    }
    loadDetails();
  }, [entityId, onOpenChange, open, requestId, toast, user]);

  const slotById = useMemo(() => new Map(slots.filter((slot) => slot.slotId).map((slot) => [slot.slotId as string, slot])), [slots]);
  const capacityUsage = useMemo(() => {
    const usage = new Map<string, number>();
    Object.values(assignments).forEach((assignment) => {
      if (!assignment.slotId || assignment.slotId === "none") return;
      usage.set(assignment.slotId, (usage.get(assignment.slotId) || 0) + 1);
    });
    return usage;
  }, [assignments]);

  const scheduledCount = useMemo(() => (
    participants.filter((participant) => {
      const assignment = assignments[participant.employeeId];
      return assignment?.slotId && assignment.slotId !== "none" && assignment.appointmentStartTime && assignment.appointmentEndTime;
    }).length
  ), [assignments, participants]);

  const updateSlot = (index: number, patch: Partial<SlotForm>) => {
    setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
  };

  const updateAssignment = (employeeId: string, patch: Partial<AssignmentForm>) => {
    setAssignments((current) => {
      const existing = current[employeeId] || { slotId: "none", appointmentStartTime: "", appointmentEndTime: "" };
      const next = { ...existing, ...patch };
      if (patch.slotId === "none") {
        next.appointmentStartTime = "";
        next.appointmentEndTime = "";
      }
      return { ...current, [employeeId]: next };
    });
  };

  const addMinutesToTime = (time: string, minutesToAdd: number) => {
    const [hours, minutes] = time.split(":").map(Number);
    const total = hours * 60 + minutes + minutesToAdd;
    const nextHours = Math.floor(total / 60);
    const nextMinutes = total % 60;
    return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
  };

  const timeToMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const handleAutoDispatch = () => {
    const slot = slotById.get(dispatchSlotId);
    const duration = Number(dispatchDurationMinutes);
    if (!slot || dispatchSlotId === "none") {
      toast({ variant: "destructive", title: "Créneau requis", description: "Sélectionnez un créneau médecin à dispatcher." });
      return;
    }
    if (!slot.endTime) {
      toast({ variant: "destructive", title: "Heure de fin requise", description: "Le créneau médecin doit avoir une heure de fin." });
      return;
    }
    if (!Number.isInteger(duration) || duration <= 0) {
      toast({ variant: "destructive", title: "Durée invalide", description: "La durée par collaborateur doit être un entier positif." });
      return;
    }
    const targetParticipants = participants.filter((participant) => {
      const assignment = assignments[participant.employeeId];
      return !assignment?.slotId || assignment.slotId === "none" || assignment.slotId === dispatchSlotId;
    });
    const availableMinutes = timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime);
    if (targetParticipants.length * duration > availableMinutes) {
      toast({
        variant: "destructive",
        title: "Plage insuffisante",
        description: `La plage ${slot.startTime}–${slot.endTime} ne permet pas de planifier ${targetParticipants.length} rendez-vous de ${duration} minutes.`,
      });
      return;
    }
    if (slot.capacity && targetParticipants.length > Number(slot.capacity)) {
      toast({ variant: "destructive", title: "Capacité dépassée", description: "Le nombre de collaborateurs dépasse la capacité du créneau." });
      return;
    }
    setAssignments((current) => {
      const next = { ...current };
      let cursor = slot.startTime;
      targetParticipants.forEach((participant) => {
        const end = addMinutesToTime(cursor, duration);
        next[participant.employeeId] = {
          slotId: dispatchSlotId,
          appointmentStartTime: cursor,
          appointmentEndTime: end,
        };
        cursor = end;
      });
      return next;
    });
  };

  const handleSaveSlots = async () => {
    if (!user || !requestId || savingSlots) return;
    setSavingSlots(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await saveMedicalProviderSlotsAction({
        idToken,
        entityId,
        requestId,
        slots: slots.map((slot) => ({
          slotId: slot.slotId || null,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime || null,
          location: slot.location,
          capacity: slot.capacity ? Number(slot.capacity) : null,
          instructions: slot.instructions || null,
        })),
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: "Créneaux enregistrés", description: "La réponse du médecin a été sauvegardée." });
      onSaved();
      const refreshToken = await user.getIdToken(true);
      const refreshed = await getMedicalVisitRequestDetailsAction({ idToken: refreshToken, entityId, requestId });
      if (refreshed.success) {
        setSlots(refreshed.slots.map((slot) => ({
          slotId: slot.slotId,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime || "",
          location: slot.location,
          capacity: slot.capacity ? String(slot.capacity) : "",
          instructions: slot.instructions || "",
        })));
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erreur", description: error.message || "Impossible d'enregistrer les créneaux." });
    } finally {
      setSavingSlots(false);
    }
  };

  const handleDeleteSlot = async (index: number) => {
    const slot = slots[index];
    if (!slot.slotId) {
      setSlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
      return;
    }
    if (!user || !requestId || deletingSlotId) return;
    setDeletingSlotId(slot.slotId);
    try {
      const idToken = await user.getIdToken(true);
      const result = await deleteMedicalProviderSlotAction({ idToken, entityId, requestId, slotId: slot.slotId });
      if (!result.success) throw new Error(result.error);
      toast({ title: "Créneau supprimé", description: "Le créneau a été retiré de la demande." });
      setSlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
      onSaved();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Suppression impossible", description: error.message || "Impossible de supprimer ce créneau." });
    } finally {
      setDeletingSlotId(null);
    }
  };

  const handleSaveAssignments = async () => {
    if (!user || !requestId || savingAssignments) return;
    setSavingAssignments(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await assignMedicalVisitParticipantsToSlotsAction({
        idToken,
        entityId,
        requestId,
        assignments: participants.map((participant) => ({
          employeeId: participant.employeeId,
          slotId: assignments[participant.employeeId]?.slotId && assignments[participant.employeeId].slotId !== "none"
            ? assignments[participant.employeeId].slotId
            : null,
          appointmentStartTime: assignments[participant.employeeId]?.appointmentStartTime || null,
          appointmentEndTime: assignments[participant.employeeId]?.appointmentEndTime || null,
        })),
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: "Affectations enregistrées", description: "Les collaborateurs ont été affectés aux créneaux disponibles." });
      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erreur", description: error.message || "Impossible d'enregistrer les affectations." });
    } finally {
      setSavingAssignments(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black text-primary">
            <CalendarClock className="h-6 w-6 text-accent" />
            Créneaux et affectations
          </DialogTitle>
          <DialogDescription>
            Enregistrez les disponibilités communiquées par le médecin, puis affectez chaque collaborateur à un créneau.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-black text-primary">Créneaux communiqués par le médecin</h3>
                  <p className="text-xs text-muted-foreground">Date, heure et lieu proviennent de la réponse du prestataire.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="rounded-xl font-bold" onClick={() => setSlots((current) => [...current, emptySlot()])}>
                  <Plus className="mr-2 h-4 w-4" />
                  Ajouter un créneau
                </Button>
              </div>

              <div className="space-y-3">
                {slots.map((slot, index) => {
                  const usage = slot.slotId ? capacityUsage.get(slot.slotId) || 0 : 0;
                  return (
                    <div key={slot.slotId || index} className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-3 md:grid-cols-6">
                      <div className="space-y-1 md:col-span-1">
                        <Label>Date</Label>
                        <Input type="date" value={slot.date} onChange={(event) => updateSlot(index, { date: event.target.value })} className="rounded-xl" />
                      </div>
                      <div className="space-y-1">
                        <Label>Heure début</Label>
                        <Input type="time" value={slot.startTime} onChange={(event) => updateSlot(index, { startTime: event.target.value })} className="rounded-xl" />
                      </div>
                      <div className="space-y-1">
                        <Label>Heure fin</Label>
                        <Input type="time" value={slot.endTime} onChange={(event) => updateSlot(index, { endTime: event.target.value })} className="rounded-xl" />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <Label>Lieu</Label>
                        <Input value={slot.location} onChange={(event) => updateSlot(index, { location: event.target.value })} className="rounded-xl" />
                      </div>
                      <div className="space-y-1">
                        <Label>Nombre maximal de rendez-vous</Label>
                        <Input type="number" min={1} value={slot.capacity} onChange={(event) => updateSlot(index, { capacity: event.target.value })} className="rounded-xl" />
                        {slot.slotId && (
                          <p className="text-[10px] font-bold text-muted-foreground">{usage} / {slot.capacity || "∞"} rendez-vous affectés</p>
                        )}
                      </div>
                      <div className="space-y-1 md:col-span-5">
                        <Label>Instructions facultatives</Label>
                        <Textarea value={slot.instructions} onChange={(event) => updateSlot(index, { instructions: event.target.value })} className="min-h-16 rounded-xl" />
                      </div>
                      <div className="flex items-end md:col-span-1">
                        <Button type="button" variant="ghost" className="w-full rounded-xl text-destructive" disabled={deletingSlotId === slot.slotId} onClick={() => handleDeleteSlot(index)}>
                          {deletingSlotId === slot.slotId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Supprimer
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={handleSaveSlots} disabled={savingSlots || slots.length === 0} className="rounded-xl font-black">
                  {savingSlots ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Enregistrer les créneaux
                </Button>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div>
                <h3 className="flex items-center gap-2 font-black text-primary">
                  <Users className="h-4 w-4" />
                  Affectation des collaborateurs
                </h3>
                <p className="text-xs text-muted-foreground">
                  {capacityUsage.size > 0 ? Array.from(capacityUsage.values()).reduce((sum, value) => sum + value, 0) : 0} / {participants.length} collaborateurs affectés · {scheduledCount} / {participants.length} horaires individuels définis
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-3 md:grid-cols-[1fr_180px_auto]">
                <div className="space-y-1">
                  <Label>Créneau médecin à dispatcher</Label>
                  <Select value={dispatchSlotId} onValueChange={setDispatchSlotId}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sélectionner un créneau" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sélectionner un créneau</SelectItem>
                      {slots.filter((slot) => slot.slotId).map((slot) => (
                        <SelectItem key={slot.slotId} value={slot.slotId as string}>
                          {slot.date} · {slot.startTime}{slot.endTime ? `–${slot.endTime}` : ""} · {slot.location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Durée par collaborateur</Label>
                  <Input type="number" min={1} value={dispatchDurationMinutes} onChange={(event) => setDispatchDurationMinutes(event.target.value)} className="rounded-xl" />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" className="w-full rounded-xl font-bold" onClick={handleAutoDispatch}>
                    Dispatcher automatiquement
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {participants.map((participant) => {
                  const assignment = assignments[participant.employeeId] || { slotId: "none", appointmentStartTime: "", appointmentEndTime: "" };
                  const assignedSlot = assignment.slotId !== "none" ? slotById.get(assignment.slotId) : null;
                  return (
                    <div key={participant.employeeId} className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-3 lg:grid-cols-[1fr_320px_240px]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-primary">{participant.employeeDisplayNameSnapshot}</p>
                        <p className="text-xs text-muted-foreground">{participant.employeeCodeSnapshot}</p>
                        <p className="mt-2 text-xs font-bold text-muted-foreground">
                          Disponibilité médecin : {assignedSlot ? `${assignedSlot.date} · ${assignedSlot.startTime}${assignedSlot.endTime ? `–${assignedSlot.endTime}` : ""} · ${assignedSlot.location}` : "Non affectée"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label>Créneau médecin</Label>
                        <Select value={assignment.slotId} onValueChange={(value) => updateAssignment(participant.employeeId, { slotId: value })}>
                          <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sélectionner un créneau" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sans créneau</SelectItem>
                            {slots.filter((slot) => slot.slotId).map((slot) => (
                              <SelectItem key={slot.slotId} value={slot.slotId as string}>
                                {slot.date} · {slot.startTime}{slot.endTime ? `–${slot.endTime}` : ""} · {slot.location}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label>Début salarié</Label>
                          <Input type="time" value={assignment.appointmentStartTime} onChange={(event) => updateAssignment(participant.employeeId, { appointmentStartTime: event.target.value })} className="rounded-xl" />
                        </div>
                        <div className="space-y-1">
                          <Label>Fin salarié</Label>
                          <Input type="time" value={assignment.appointmentEndTime} onChange={(event) => updateAssignment(participant.employeeId, { appointmentEndTime: event.target.value })} className="rounded-xl" />
                        </div>
                        <p className="col-span-2 text-[10px] font-bold text-muted-foreground">
                          Rendez-vous salarié : {assignment.appointmentStartTime && assignment.appointmentEndTime ? `${assignment.appointmentStartTime}–${assignment.appointmentEndTime}` : "À définir"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={savingAssignments || savingSlots}>Fermer</Button>
                <Button type="button" onClick={handleSaveAssignments} disabled={savingAssignments || slotById.size === 0} className="rounded-xl font-black">
                  {savingAssignments && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enregistrer les affectations
                </Button>
              </DialogFooter>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
