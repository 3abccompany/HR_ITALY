"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  CalendarDays, Plus, Loader2, Calendar as CalendarIcon, 
  Trash2, ShieldCheck, RefreshCw, AlertCircle, Info,
  CheckCircle2, Filter, X, ListFilter, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, where, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  seedItalianNationalHolidays, 
  createHoliday, 
  archiveHoliday 
} from "@/services/holiday.service";
import { Holiday, HolidayType } from "@/types/holiday";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { startOfYear, endOfYear, format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const initialForm = {
  name: "",
  date: "",
  type: "national" as HolidayType,
  paid: true,
  region: "",
  province: ""
};

export default function HolidaysRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // --- Year Management ---
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  
  useEffect(() => {
    setSelectedYear(new Date().getFullYear());
  }, []);

  const years = useMemo(() => {
    if (selectedYear === null) return [];
    const current = new Date().getFullYear();
    const list = [];
    for (let i = current - 2; i <= current + 2; i++) {
      list.push(i);
    }
    return list;
  }, [selectedYear]);

  // --- UI State ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSeedOpen, setIsSeedOpen] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const [includeSanFrancesco, setIncludeSanFrancesco] = useState(false);
  const [loading, setLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const canManage = hasPermission("holidays.manage");
  const canRead = hasPermission("holidays.read");

  // --- Query ---
  const holidaysQuery = useMemo(() => {
    if (!db || !entityId || !canRead || selectedYear === null) return null;
    const start = `${selectedYear}-01-01`;
    const end = `${selectedYear}-12-31`;
    return query(
      collection(db, `entities/${entityId}/holidays`),
      where("date", ">=", start),
      where("date", "<=", end),
      orderBy("date", "asc")
    ) as Query<Holiday>;
  }, [db, entityId, canRead, selectedYear]);

  const { data: holidays, loading: loadingHolidays } = useCollection<Holiday>(holidaysQuery);

  const activeHolidays = useMemo(() => {
    return holidays?.filter(h => h.status === "active") || [];
  }, [holidays]);

  // --- Handlers ---

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;
    setLoading(true);
    try {
      await createHoliday(entityId, formData, user.uid);
      toast({ title: "Jour férié ajouté" });
      setIsFormOpen(false);
      setFormData(initialForm);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    if (!user || !entityId || selectedYear === null) return;
    setLoading(true);
    try {
      await seedItalianNationalHolidays(entityId, selectedYear, user.uid, { includeSanFrancesco });
      toast({ title: "Calendrier national généré", description: `Les jours fériés italiens pour ${selectedYear} ont été ajoutés.` });
      setIsSeedOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const executeArchive = async () => {
    if (!archivingId || !user || !entityId) return;
    setLoading(true);
    try {
      await archiveHoliday(entityId, archivingId, user.uid);
      toast({ title: "Jour férié archivé" });
      setArchivingId(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading || selectedYear === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="max-w-2xl mx-auto rounded-[2rem]">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Accès Refusé</AlertTitle>
          <AlertDescription>Vous n'avez pas la permission de consulter le calendrier des jours fériés.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 pb-32">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
              <CalendarDays className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Registre des Jours Fériés</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Gestion du calendrier annuel des jours non travaillés et fermetures d'entreprise.</p>
        </div>
        
        <div className="flex gap-3">
          {canManage && (
            <Button onClick={() => setIsSeedOpen(true)} variant="outline" className="rounded-xl font-bold gap-2 bg-white border-primary/20 hover:bg-primary/5">
               <RefreshCw className="w-4 h-4" /> Générer jours IT
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setIsFormOpen(true)} className="rounded-xl font-bold gap-2 shadow-lg shadow-primary/10">
               <Plus className="w-4 h-4" /> Nouveau jour férié
            </Button>
          )}
        </div>
      </header>

      <Card className="rounded-[2.5rem] border-primary/5 shadow-xl shadow-primary/5 bg-white overflow-hidden">
        <CardHeader className="bg-slate-50 border-b py-6 px-8 flex flex-row items-center justify-between">
           <div className="flex items-center gap-4">
              <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Sélectionner l'année</Label>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-[120px] h-9 rounded-xl font-black text-primary bg-white border-primary/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                   {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
           </div>
           <div className="text-[10px] font-bold text-muted-foreground uppercase bg-white px-3 py-1.5 rounded-full border border-primary/5">
              {activeHolidays.length} jour{activeHolidays.length > 1 ? 's' : ''} enregistré{activeHolidays.length > 1 ? 's' : ''}
           </div>
        </CardHeader>
        
        <CardContent className="p-0">
           <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                   <TableHead className="pl-8 text-[10px] font-black uppercase tracking-widest w-[180px]">Date</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest">Nom / Libellé</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest">Type</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest text-center">Rémunéré</TableHead>
                   <TableHead className="text-right pr-8 text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                 {loadingHolidays ? (
                   <TableRow><TableCell colSpan={5} className="text-center py-20"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary/20" /></TableCell></TableRow>
                 ) : activeHolidays.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-32 space-y-4">
                        <div className="bg-slate-50 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                           <CalendarIcon className="w-10 h-10 text-slate-200" />
                        </div>
                        <div className="space-y-1">
                           <p className="font-bold text-slate-400 uppercase text-xs tracking-widest">Calendrier vide</p>
                           <p className="text-xs text-slate-300">Aucun jour férié configuré pour {selectedYear}.</p>
                        </div>
                        {canManage && (
                          <Button onClick={() => setIsSeedOpen(true)} variant="secondary" className="mt-4 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10">
                            Générer les jours fériés italiens
                          </Button>
                        )}
                     </TableCell>
                   </TableRow>
                 ) : (
                   activeHolidays.map(h => (
                     <TableRow key={h.holidayId} className="hover:bg-slate-50 transition-colors">
                        <TableCell className="pl-8 py-4">
                           <div className="flex items-center gap-3">
                              <div className="bg-primary/5 p-2 rounded-lg text-primary"><CalendarIcon className="w-4 h-4" /></div>
                              <span className="font-bold text-slate-900 text-sm">{format(parseISO(h.date), "dd MMMM yyyy", { locale: fr })}</span>
                           </div>
                        </TableCell>
                        <TableCell className="font-medium text-slate-700">{h.name}</TableCell>
                        <TableCell>
                           <Badge variant="outline" className={cn("uppercase text-[8px] font-black px-2 h-5", getTypeColor(h.type))}>
                             {h.type.replace('_', ' ')}
                           </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                           {h.paid ? (
                             <Badge className="bg-green-600 text-white border-none text-[8px] font-black uppercase h-5">OUI</Badge>
                           ) : (
                             <Badge variant="outline" className="text-[8px] font-black uppercase h-5">NON</Badge>
                           )}
                        </TableCell>
                        <TableCell className="text-right pr-8">
                           {canManage && (
                             <Button 
                               variant="ghost" 
                               size="icon" 
                               onClick={() => setArchivingId(h.holidayId)}
                               className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-red-50"
                             >
                                <Trash2 className="w-4 h-4" />
                             </Button>
                           )}
                        </TableCell>
                     </TableRow>
                   ))
                 )}
              </TableBody>
           </Table>
        </CardContent>
      </Card>

      <div className="flex items-start gap-4 p-6 bg-blue-50/50 rounded-[2rem] border border-blue-100">
         <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
         <div className="space-y-1">
            <p className="text-xs font-black uppercase text-blue-800 tracking-widest">Aide au paramétrage</p>
            <p className="text-[11px] text-blue-700 leading-relaxed font-medium">
               Ce calendrier est utilisé par le module <strong>Présences</strong> pour justifier automatiquement les absences les jours fériés. 
               Si un collaborateur travaille un jour férié, le système calculera automatiquement les heures majorées correspondantes.
            </p>
         </div>
      </div>

      {/* NEW HOLIDAY DIALOG */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Nouveau jour férié</DialogTitle>
            <DialogDescription>Ajoutez une fermeture exceptionnelle ou un jour férié local.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-6 py-4">
             <div className="space-y-4">
                <div className="space-y-2">
                   <Label className="text-[10px] uppercase font-black">Date</Label>
                   <Input type="date" value={formData.date} onChange={(e) => setFormData(p => ({...p, date: e.target.value}))} required className="rounded-xl h-11" />
                </div>
                <div className="space-y-2">
                   <Label className="text-[10px] uppercase font-black">Nom de l'événement</Label>
                   <Input value={formData.name} onChange={(e) => setFormData(p => ({...p, name: e.target.value}))} required placeholder="Ex: Saint Patron, Fermeture annuelle..." className="rounded-xl h-11" />
                </div>
                <div className="space-y-2">
                   <Label className="text-[10px] uppercase font-black">Type</Label>
                   <Select value={formData.type} onValueChange={(v: any) => setFormData(p => ({...p, type: v}))}>
                      <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="national">National</SelectItem>
                        <SelectItem value="regional">Régional</SelectItem>
                        <SelectItem value="local">Local (Ville / Patron)</SelectItem>
                        <SelectItem value="company_closure">Fermeture Entreprise</SelectItem>
                      </SelectContent>
                   </Select>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border">
                   <div className="space-y-0.5">
                      <Label className="font-bold text-sm">Jour rémunéré</Label>
                      <p className="text-[10px] text-muted-foreground">Impact sur la paie (Ferie/Festività)</p>
                   </div>
                   <Switch checked={formData.paid} onCheckedChange={(v) => setFormData(p => ({...p, paid: v}))} />
                </div>
             </div>
             <DialogFooter className="pt-2">
                <Button variant="ghost" type="button" onClick={() => setIsFormOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={loading || !formData.date || !formData.name} className="rounded-xl px-8 font-black shadow-lg">
                   {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Enregistrer
                </Button>
             </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* GENERATE IT HOLIDAYS DIALOG */}
      <Dialog open={isSeedOpen} onOpenChange={setIsSeedOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Générer le calendrier {selectedYear}</DialogTitle>
            <DialogDescription>
               Cette action va peupler automatiquement les 11 jours fériés nationaux italiens pour l'année {selectedYear}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-6">
             <div className="flex items-start space-x-3 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <Checkbox id="san-francesco" checked={includeSanFrancesco} onCheckedChange={(v) => setIncludeSanFrancesco(!!v)} className="mt-1" />
                <div className="space-y-1">
                   <Label htmlFor="san-francesco" className="font-bold text-sm leading-none cursor-pointer">Inclure San Francesco (04/10)</Label>
                   <p className="text-[10px] text-muted-foreground leading-relaxed">Jour férié additionnel pour certains secteurs d'activité.</p>
                </div>
             </div>
             <Alert className="rounded-xl border-orange-200 bg-orange-50 text-orange-800 py-3">
                <Info className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-[10px] font-bold uppercase tracking-tight">
                   Les jours déjà existants ne seront pas modifiés (idempotent).
                </AlertDescription>
             </Alert>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setIsSeedOpen(false)} disabled={loading}>Annuler</Button>
             <Button onClick={handleSeed} disabled={loading} className="rounded-xl px-8 font-black shadow-lg shadow-primary/10 gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Générer maintenant
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ARCHIVE DIALOG */}
      <AlertDialog open={!!archivingId} onOpenChange={(o) => !o && setArchivingId(null)}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce jour férié ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le jour férié ne sera plus utilisé pour les réconciliations futures, mais restera visible dans l'historique.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); executeArchive(); }} 
              disabled={loading} 
              className="bg-destructive hover:bg-destructive/90 rounded-xl font-bold"
            >
               {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />} Confirmer l'archivage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

function getTypeColor(type: HolidayType) {
  switch (type) {
    case 'national': return "bg-blue-50 text-blue-700 border-blue-200";
    case 'regional': return "bg-indigo-50 text-indigo-700 border-indigo-100";
    case 'local': return "bg-purple-50 text-purple-700 border-purple-100";
    case 'company_closure': return "bg-orange-50 text-orange-700 border-orange-100";
    default: return "bg-slate-50 text-slate-600";
  }
}

function formatDate(val: any) {
  if (!val) return "-";
  const d = val.toDate ? val.toDate() : new Date(val);
  return format(d, "dd/MM/yyyy", { locale: fr });
}

function formatTime(val: any) {
  if (!val) return "";
  const d = val.toDate ? val.toDate() : new Date(val);
  return format(d, "HH:mm", { locale: fr });
}

function StatCard({ title, value, icon: Icon, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    green: "bg-green-50 text-green-600 border-green-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };
  return (
    <Card className="border-primary/5 shadow-sm rounded-3xl bg-white group hover:shadow-md transition-all">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border transition-colors", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{title}</p>
          <p className="text-2xl font-black text-primary leading-none mt-1">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}