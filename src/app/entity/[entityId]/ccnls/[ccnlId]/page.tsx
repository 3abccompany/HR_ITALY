"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Edit, PowerOff, Loader2, ArrowLeft,
  LayoutDashboard, ListTodo, ShieldCheck, 
  Trash2, Info, Euro, Briefcase, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useDoc, useUser } from "@/firebase";
import { collection, query, orderBy, doc } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { createCcnlLevel, updateCcnlLevel, archiveCcnlLevel } from "@/services/ccnl.service";
import { CCNL, CCNLLevel } from "@/types/ccnl";
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
import { Separator } from "@/components/ui/separator";

// Use strings for numeric inputs in form state to allow empty values while typing
const initialLevelForm = {
  levelCode: "",
  label: "",
  qualificationLabel: "",
  minimumGrossMonthly: "0",
  minimumGrossHourly: "0",
  annualPaidLeaveDays: "0",
  annualRolHours: "0",
  annualExHolidayHours: "0",
  effectiveFrom: new Date().toISOString().split('T')[0],
  notes: ""
};

export default function CcnlLevelsPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const ccnlId = params.ccnlId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading } = useActiveMembership(entityId);

  const ccnlRef = useMemo(() => doc(db!, `entities/${entityId}/ccnls`, ccnlId), [db, entityId, ccnlId]);
  const { data: ccnl, loading: loadingCcnl } = useDoc<CCNL>(ccnlRef as any);

  const [isLevelFormOpen, setIsLevelFormOpen] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialLevelForm);
  const [loading, setLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const levelsQuery = useMemo(() => {
    if (!db || !entityId || !ccnlId) return null;
    return query(collection(db, `entities/${entityId}/ccnls/${ccnlId}/levels`), orderBy("levelCode", "asc"));
  }, [db, entityId, ccnlId]);

  const { data: levels, loading: loadingLevels } = useCollection<CCNLLevel>(levelsQuery);

  const handleReset = () => {
    setFormData(initialLevelForm);
    setEditingLevelId(null);
    setIsLevelFormOpen(false);
  };

  const handleEdit = (l: CCNLLevel) => {
    setFormData({
      levelCode: l.levelCode,
      label: l.label,
      qualificationLabel: l.qualificationLabel,
      minimumGrossMonthly: l.minimumGrossMonthly.toString(),
      minimumGrossHourly: l.minimumGrossHourly.toString(),
      annualPaidLeaveDays: (l.annualPaidLeaveDays || 0).toString(),
      annualRolHours: (l.annualRolHours || 0).toString(),
      annualExHolidayHours: (l.annualExHolidayHours || 0).toString(),
      effectiveFrom: l.effectiveFrom,
      notes: l.notes || ""
    });
    setEditingLevelId(l.levelId);
    setIsLevelFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Numeric Validation
    const mStr = formData.minimumGrossMonthly.toString().trim().replace(',', '.');
    const hStr = formData.minimumGrossHourly.toString().trim().replace(',', '.');

    if (mStr === "") {
      toast({ variant: "destructive", title: "Erreur", description: "Le brut mensuel minimum est obligatoire." });
      return;
    }
    if (hStr === "") {
      toast({ variant: "destructive", title: "Erreur", description: "Le brut horaire minimum est obligatoire." });
      return;
    }

    const monthlyNum = Number(mStr);
    const hourlyNum = Number(hStr);

    if (isNaN(monthlyNum) || isNaN(hourlyNum)) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez saisir des montants valides." });
      return;
    }

    if (monthlyNum < 0 || hourlyNum < 0) {
      toast({ variant: "destructive", title: "Erreur", description: "Le montant ne peut pas être négatif." });
      return;
    }

    if (levels?.some(l => l.levelCode === formData.levelCode && l.levelId !== editingLevelId && l.status === "active")) {
        toast({ variant: "destructive", title: "Doublon", description: "Ce code de niveau est déjà actif pour ce CCNL." });
        return;
    }

    setLoading(true);
    try {
      const finalPayload = {
        ...formData,
        minimumGrossMonthly: monthlyNum,
        minimumGrossHourly: hourlyNum,
        annualPaidLeaveDays: parseFloat(formData.annualPaidLeaveDays.toString()) || 0,
        annualRolHours: parseFloat(formData.annualRolHours.toString()) || 0,
        annualExHolidayHours: parseFloat(formData.annualExHolidayHours.toString()) || 0
      };

      if (editingLevelId) {
        await updateCcnlLevel(entityId, ccnlId, editingLevelId, finalPayload, user.uid);
        toast({ title: "Niveau mis à jour" });
      } else {
        await createCcnlLevel(entityId, ccnlId, finalPayload, user.uid);
        toast({ title: "Niveau ajouté" });
      }
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmArchive = async () => {
    if (!archivingId || !user) return;
    setLoading(true);
    try {
      await archiveCcnlLevel(entityId, ccnlId, archivingId, user.uid);
      toast({ title: "Niveau archivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setArchivingId(null);
    }
  };

  if (membershipLoading || loadingCcnl) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!ccnl) return <div className="p-8 text-center">CCNL introuvable.</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/ccnls`)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">{ccnl.name}</h1>
          <p className="text-muted-foreground text-sm uppercase font-bold tracking-widest">{ccnl.sector} — Grille des niveaux</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* CCNL Summary Card */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-primary/10 bg-primary/5">
            <CardHeader className="border-b bg-primary/10">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" /> Récapitulatif CCNL
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-sm">
               <SummaryRow label="Code CNEL" value={ccnl.cnelCode} />
               <SummaryRow label="Hebdo" value={`${ccnl.standardWeeklyHours}h`} />
               <SummaryRow label="Mensualités" value={ccnl.monthlyPayments} />
               <SummaryRow label="Diviseur" value={ccnl.hourlyDivisor} />
               <Separator />
               <SummaryRow label="Date d'effet" value={ccnl.effectiveFrom} />
               <div className="pt-2">
                 <Badge variant="outline" className="bg-white">{ccnl.status.toUpperCase()}</Badge>
               </div>
            </CardContent>
          </Card>
        </div>

        {/* Levels List */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-primary flex items-center gap-2">
              <ListTodo className="w-5 h-5" /> Niveaux de salaire
            </h2>
            <Button onClick={() => setIsLevelFormOpen(true)} className="gap-2 h-9">
              <Plus className="w-4 h-4" /> Ajouter un niveau
            </Button>
          </div>

          <Card className="overflow-hidden border-primary/10 shadow-lg">
            <Table>
              <TableHeader className="bg-secondary/10">
                <TableRow>
                  <TableHead className="w-[100px]">Niveau</TableHead>
                  <TableHead>Libellé & Qualification</TableHead>
                  <TableHead>Minimum Brut</TableHead>
                  <TableHead>Date d'effet</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLevels ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                ) : levels?.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">Aucun niveau défini pour ce CCNL.</TableCell></TableRow>
                ) : (
                  levels?.map((l) => (
                    <TableRow key={l.levelId}>
                      <TableCell className="font-black text-primary">
                        <Badge variant="outline" className="text-sm border-primary/20 bg-primary/5">{l.levelCode}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-sm">{l.label}</div>
                        <div className="text-[10px] text-muted-foreground uppercase mt-0.5">{l.qualificationLabel}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <div className="flex items-center gap-1 text-sm font-bold text-accent">
                             <Euro className="w-3.5 h-3.5" /> {l.minimumGrossMonthly.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} /mois
                           </div>
                           <div className="text-[10px] text-muted-foreground">{l.minimumGrossHourly.toLocaleString('fr-FR', { minimumFractionDigits: 4 })} €/h</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{l.effectiveFrom}</TableCell>
                      <TableCell>
                         <Badge variant={l.status === 'active' ? 'secondary' : 'outline'} className={l.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : ''}>
                           {l.status}
                         </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(l)}><Edit className="w-3.5 h-3.5" /></Button>
                          {l.status !== 'archived' && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setArchivingId(l.levelId)}><PowerOff className="w-3.5 h-3.5" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      {/* Level Form Dialog */}
      <Dialog open={isLevelFormOpen} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingLevelId ? "Modifier le niveau" : "Nouveau niveau"}</DialogTitle>
            <DialogDescription>Détails du salaire minimum pour ce niveau CCNL.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-4">
               <div className="space-y-2">
                 <Label htmlFor="levelCode">Code Niveau</Label>
                 <Input id="levelCode" value={formData.levelCode} onChange={(e) => setFormData(p => ({...p, levelCode: e.target.value}))} required placeholder="Ex: 1, A1, Q" />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label htmlFor="label">Libellé du niveau</Label>
                 <Input id="label" value={formData.label} onChange={(e) => setFormData(p => ({...p, label: e.target.value}))} required placeholder="Ex: Premier niveau" />
               </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qualificationLabel">Qualification (Flexible)</Label>
              <Input id="qualificationLabel" value={formData.qualificationLabel} onChange={(e) => setFormData(p => ({...p, qualificationLabel: e.target.value}))} required placeholder="Ex: Impiegato, Operaio specializzato..." />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
               <div className="space-y-2">
                 <Label className="flex items-center gap-1"><Euro className="w-3 h-3" /> Brut Mensuel Min.</Label>
                 <Input 
                   type="text" 
                   inputMode="decimal"
                   value={formData.minimumGrossMonthly} 
                   onChange={(e) => setFormData(p => ({...p, minimumGrossMonthly: e.target.value}))} 
                 />
               </div>
               <div className="space-y-2">
                 <Label className="flex items-center gap-1"><Euro className="w-3 h-3" /> Brut Horaire Min.</Label>
                 <Input 
                   type="text" 
                   inputMode="decimal"
                   value={formData.minimumGrossHourly} 
                   onChange={(e) => setFormData(p => ({...p, minimumGrossHourly: e.target.value}))} 
                 />
               </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-bold">Congés (j/an)</Label>
                 <Input 
                   type="number" 
                   value={formData.annualPaidLeaveDays} 
                   onChange={(e) => setFormData(p => ({...p, annualPaidLeaveDays: e.target.value}))} 
                 />
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-bold">ROL (h/an)</Label>
                 <Input 
                   type="number" 
                   value={formData.annualRolHours} 
                   onChange={(e) => setFormData(p => ({...p, annualRolHours: e.target.value}))} 
                 />
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-bold">Ex Fest. (h/an)</Label>
                 <Input 
                   type="number" 
                   value={formData.annualExHolidayHours} 
                   onChange={(e) => setFormData(p => ({...p, annualExHolidayHours: e.target.value}))} 
                 />
               </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="effectiveFrom">Date d'effet de la grille</Label>
              <Input id="effectiveFrom" type="date" value={formData.effectiveFrom} onChange={(e) => setFormData(p => ({...p, effectiveFrom: e.target.value}))} required />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {editingLevelId ? "Enregistrer" : "Ajouter le niveau"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Level Alert */}
      <AlertDialog open={!!archivingId} onOpenChange={() => setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce niveau ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce niveau de salaire sera archivé. Il restera visible historiquement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmArchive(); }} className="bg-red-600" disabled={loading}>Archiver</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground font-medium">{label} :</span>
      <span className="font-bold text-primary">{value || "Non renseigné"}</span>
    </div>
  );
}
