"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { 
  Euro, Calculator, Loader2, Calendar, 
  User, AlertTriangle, CheckCircle2, 
  Info, Clock, RefreshCw, ChevronRight, 
  Filter, X, Search, FileText, Ban,
  ShieldCheck, AlertCircle, TrendingUp,
  XCircle, ArrowDownCircle, ArrowUpCircle, Banknote, HelpCircle
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, where, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  PayrollCalculation, 
  PayrollCalculationStatus,
  PayrollReconciliationWarning 
} from "@/types/payroll";
import { Employee } from "@/types/employee";
import { calculateAndSaveMonthlyPayroll } from "@/services/payroll.service";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon / Incomplet",
  calculated: "Calculé",
  approved: "Approuvé",
  exported: "Exporté",
  locked: "Verrouillé",
  cancelled: "Annulé"
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  calculated: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  exported: "bg-indigo-50 text-indigo-700 border-indigo-200",
  locked: "bg-slate-900 text-white border-none",
  cancelled: "bg-red-50 text-red-700 border-red-200"
};

type PayrollMode = NonNullable<PayrollCalculation["rateSnapshot"]["payCalculationMode"]>;

const MODE_LABELS: Record<PayrollMode, string> = {
  monthly: "Mensualisé",
  hourly: "Horaire historique",
  actual_worked_hours: "Heures réellement travaillées",
};

const MODE_BADGE_STYLES: Record<PayrollMode, string> = {
  monthly: "bg-indigo-50 text-indigo-700 border-indigo-100",
  hourly: "bg-slate-100 text-slate-700 border-slate-200",
  actual_worked_hours: "bg-teal-50 text-teal-700 border-teal-100",
};

const BASE_LABELS: Record<PayrollMode, string> = {
  monthly: "Base mensuelle",
  hourly: "Base horaire",
  actual_worked_hours: "Base heures travaillées",
};

const formatEuro = (value?: number | null) =>
  `€ ${(value ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })}`;

const formatHours = (value?: number | null) =>
  `${(value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

export default function PayrollSynthesisPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // Period State
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");

  // Processing State
  const [calculating, setCalculating] = useState(false);
  const [calcSummary, setCalcSummary] = useState<any>(null);

  // Queries
  const canRead = hasPermission("payroll.read");
  const canCalculate = hasPermission("payroll.calculate") || hasPermission("payroll.write");

  const calculationsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(
      collection(db, `entities/${entityId}/payrollCalculations`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth)
    ) as Query<PayrollCalculation>;
  }, [db, entityId, canRead, selectedYear, selectedMonth]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const { data: calculations, loading: loadingCalcs } = useCollection<PayrollCalculation>(calculationsQuery, "payroll.calculations");
  const { data: employees } = useCollection<Employee>(employeesQuery, "payroll.employees");

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const filteredCalculations = useMemo(() => {
    if (!calculations) return [];
    if (!search) return calculations;
    const term = search.toLowerCase();
    return calculations.filter(c => {
      const emp = employeesMap.get(c.employeeId);
      return (
        emp?.displayName.toLowerCase().includes(term) ||
        emp?.employeeCode?.toLowerCase().includes(term)
      );
    });
  }, [calculations, search, employeesMap]);

  const handleCalculate = async () => {
    if (!db || !user || !entityId) return;
    setCalculating(true);
    setCalcSummary(null);

    try {
      const result = await calculateAndSaveMonthlyPayroll(
        db,
        entityId,
        selectedYear,
        selectedMonth,
        user.uid
      );
      setCalcSummary(result);
      toast({ title: "Calcul terminé", description: `${result.totalEmployees} dossiers traités.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de calcul", description: err.message });
    } finally {
      setCalculating(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="rounded-3xl">
          <AlertCircle className="w-4 h-4" />
          <AlertTitle>Accès Refusé</AlertTitle>
          <AlertDescription>Vous n'avez pas la permission de consulter la synthèse économique.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2.5 rounded-2xl text-white shadow-xl shadow-primary/20">
            <Banknote className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Synthèse économique — Pré-paie brute</h1>
            <p className="text-muted-foreground text-sm font-medium">Récapitulatif des éléments variables pour {entity?.nomEntreprise}.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white rounded-xl border p-1 shadow-sm h-11">
             <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
               <SelectTrigger className="w-[140px] border-none shadow-none font-bold text-primary">
                 <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <SelectItem key={m} value={String(m)}>{format(new Date(2024, m-1), 'MMMM', { locale: fr })}</SelectItem>
                  ))}
               </SelectContent>
             </Select>
             <Separator orientation="vertical" className="h-4 mx-1" />
             <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
               <SelectTrigger className="w-[100px] border-none shadow-none font-bold text-primary">
                 <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {[2024, 2025, 2026].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
               </SelectContent>
             </Select>
          </div>

          {canCalculate && (
            <Button 
              onClick={handleCalculate} 
              disabled={calculating}
              className="h-11 rounded-xl font-black gap-2 shadow-lg shadow-primary/10 px-6"
            >
              {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              Calculer / Recalculer
            </Button>
          )}
        </div>
      </header>

      {/* Stats Summary Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <SummaryStat label="Dossiers générés" value={calculations?.length || 0} icon={FileText} color="blue" />
         <SummaryStat label="H. Totales" value={calculations?.reduce((s, c) => s + (c.attendanceAggregation.totalValidatedHours), 0).toFixed(1) || "0"} icon={Clock} color="slate" />
         <SummaryStat label="Alertes" value={calculations?.reduce((s, c) => s + (c.reconciliationWarnings.length), 0) || 0} icon={AlertTriangle} color="orange" />
         <Card className="rounded-2xl bg-primary text-white shadow-xl shadow-primary/10">
            <CardContent className="p-4 flex items-center gap-4">
               <div className="bg-white/20 p-2.5 rounded-xl"><Euro className="w-5 h-5" /></div>
               <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Total Brut Estimé</p>
                  <p className="text-xl font-black">€ {calculations?.reduce((s, c) => s + (c.grossEconomicTotal || 0), 0).toLocaleString('fr-FR', { minimumFractionDigits: 0 })}</p>
               </div>
            </CardContent>
         </Card>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-4">
           <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                className="pl-10 h-11 rounded-xl bg-white border-primary/10" 
                placeholder="Rechercher un employé ou matricule..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
        </div>

        <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
          <ScrollArea className="w-full">
            <Table>
              <TableHeader className="bg-secondary/20 hover:bg-secondary/20">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="pl-8 text-[10px] font-black uppercase tracking-widest h-12">Collaborateur</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest">Mode</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Heures validées</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Base</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Variables</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">TOTAL BRUT</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-center">Alertes</TableHead>
                  <TableHead className="text-right pr-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCalcs ? (
                  <TableRow><TableCell colSpan={8} className="py-20 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary/20" /></TableCell></TableRow>
                ) : filteredCalculations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-32 text-center space-y-4">
                       <div className="bg-slate-50 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                          <TrendingUp className="w-10 h-10 text-slate-200" />
                       </div>
                       <div className="space-y-1">
                          <p className="font-bold text-slate-400 uppercase text-xs tracking-widest">Aucune synthèse générée</p>
                          <p className="text-xs text-slate-300">Lancez le calcul pour visualiser les montants du mois.</p>
                       </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCalculations.map((c) => {
                    const emp = employeesMap.get(c.employeeId);
                    const totalExtras = (c.mealTicketsValue || 0) + (c.mileageValue || 0) + (c.bonusValue || 0);
                    const mode = c.rateSnapshot.payCalculationMode || "monthly";
                    const isActualWorkedHours = mode === "actual_worked_hours";
                    const baseValue =
                      isActualWorkedHours && c.baseWorkedValue != null
                        ? c.baseWorkedValue
                        : c.baseGrossValue;
                    const variablesTotal =
                      (c.nightValue || 0) +
                      (c.overtimeValue || 0) +
                      (c.holidayWorkedValue || 0) +
                      totalExtras -
                      (c.deductionValue || 0);
                    
                    return (
                      <TableRow key={c.id} className="hover:bg-slate-50 transition-colors group">
                        <TableCell className="pl-8 py-5">
                           <div className="flex items-center gap-3">
                              <div className="bg-primary/5 p-2 rounded-lg text-primary"><User className="w-4 h-4" /></div>
                              <div className="min-w-0">
                                 <p className="font-bold text-slate-900 text-sm truncate">{emp?.displayName || "Inconnu"}</p>
                                 <p className="text-[9px] font-mono text-muted-foreground uppercase">{emp?.employeeCode || c.employeeId.slice(0, 8)}</p>
                              </div>
                           </div>
                        </TableCell>
                        <TableCell>
                           <div className="flex flex-col items-start gap-1.5">
                              <Badge variant="outline" className={cn("rounded-lg border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide", MODE_BADGE_STYLES[mode])}>
                                {MODE_LABELS[mode]}
                              </Badge>
                              {c.rateSnapshot.ccnlLevelId && (
                                <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-tight">Level {c.rateSnapshot.levelCode}</span>
                              )}
                           </div>
                        </TableCell>
                        <TableCell className="text-right">
                           <div className="space-y-0.5">
                              <p className="text-sm font-black text-slate-800">{formatHours(c.attendanceAggregation.totalValidatedHours)}</p>
                              <p className="text-[10px] font-bold text-muted-foreground">
                                Nuit {formatHours(c.attendanceAggregation.ordinaryNightHours)} · Sup. {formatHours(c.attendanceAggregation.overtimeHours)}
                              </p>
                           </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{BASE_LABELS[mode]}</p>
                            <p className="font-black text-slate-700">{formatEuro(baseValue)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="space-y-0.5">
                            <p className="font-bold text-slate-700">{formatEuro(variablesTotal)}</p>
                            {isActualWorkedHours && c.paidHolidayValue != null && (
                              <p className="text-[10px] font-bold text-teal-700">
                                Fériés rémunérés: {formatEuro(c.paidHolidayValue)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right bg-primary/[0.02]">
                           <span className="font-black text-primary text-sm">{formatEuro(c.grossEconomicTotal)}</span>
                        </TableCell>
                        <TableCell className="text-center">
                           {renderWarningIndicator(c.reconciliationWarnings)}
                        </TableCell>
                        <TableCell className="text-right pr-8">
                           <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
                             <Link href={`/entity/${entityId}/payroll/${encodeURIComponent(c.id)}`}>
                               Voir détail
                               <ChevronRight className="w-4 h-4" />
                             </Link>
                           </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row items-stretch gap-6">
        <div className="flex-1 p-6 bg-blue-50/50 rounded-[2rem] border border-blue-100 flex items-start gap-4">
           <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
           <div className="space-y-1">
              <p className="text-xs font-black uppercase text-blue-800 tracking-widest">Information Importante — Non officiel</p>
              <p className="text-[11px] text-blue-700 leading-relaxed font-medium">
                Cette synthèse représente les <strong>éléments variables bruts</strong> basés sur les données RH (présences, CCNL). 
                Ceci <strong>n'est pas une fiche de paie officielle</strong> : le calcul des cotisations sociales, de l'impôt (IRPEF/PAS) et du salaire net à payer est réalisé par le logiciel de paie du consultant après export.
              </p>
           </div>
        </div>
        <Card className="md:w-72 rounded-[2rem] border-orange-100 bg-orange-50/20 overflow-hidden">
           <CardHeader className="py-3 px-6 bg-orange-50/50 border-b">
              <CardTitle className="text-[10px] font-black uppercase tracking-widest text-orange-700 flex items-center gap-2">
                 <HelpCircle className="w-4 h-4" /> Mode de calcul
              </CardTitle>
           </CardHeader>
           <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-[10px]">
                 <span className="text-muted-foreground font-bold">Mensualisé</span>
                 <span className="font-black">Base fixe + Maj.</span>
              </div>
              <div className="flex justify-between text-[10px]">
                 <span className="text-muted-foreground font-bold">Horaire historique</span>
                 <span className="font-black">Compatibilité</span>
              </div>
              <div className="flex justify-between gap-3 text-[10px]">
                 <span className="text-muted-foreground font-bold">Heures réelles</span>
                 <span className="text-right font-black">Base + majorations</span>
              </div>
           </CardContent>
        </Card>
      </div>

      {/* Summary Dialog */}
      <Dialog open={!!calcSummary} onOpenChange={() => setCalcSummary(null)}>
        <DialogContent className="sm:max-w-[500px] rounded-[2.5rem]">
           <DialogHeader>
              <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
                 <CheckCircle2 className="w-6 h-6 text-green-600" /> Calcul terminé
              </DialogTitle>
              <DialogDescription>Rapport d'exécution pour la période {selectedMonth}/{selectedYear}.</DialogDescription>
           </DialogHeader>
           
           <div className="py-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                 <SummaryBox label="Total employés" value={calcSummary?.totalEmployees} color="slate" />
                 <SummaryBox label="Records créés" value={calcSummary?.createdCount} color="green" />
                 <SummaryBox label="Records mis à jour" value={calcSummary?.updatedCount} color="blue" />
                 <SummaryBox label="Ignorés (Verrouillés)" value={calcSummary?.skippedCount} color="orange" />
              </div>

              {calcSummary?.blockingWarningsCount > 0 && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                   <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                   <div>
                      <p className="text-xs font-bold text-red-800 uppercase">Attention : Anomalies bloquantes</p>
                      <p className="text-[11px] text-red-700 font-medium">{calcSummary.blockingWarningsCount} dossier(s) sont restés en "Brouillon" car des données contractuelles (taux horaire ou base mensuelle) sont manquantes.</p>
                   </div>
                </div>
              )}
           </div>

           <DialogFooter>
              <Button onClick={() => setCalcSummary(null)} className="w-full h-12 rounded-xl font-black uppercase tracking-widest text-xs">Fermer le rapport</Button>
           </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({ label, value, icon: Icon, color }: { label: string, value: number | string, icon: any, color: string }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-50 text-slate-600 border-slate-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100"
  };
  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl bg-white">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={cn("p-2.5 rounded-xl border", colors[color] || colors.slate)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
          <p className="text-lg font-black text-primary leading-none mt-1">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryBox({ label, value, color }: { label: string, value: number, color: string }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100"
  };
  return (
    <div className={cn("p-4 rounded-2xl border text-center", colors[color])}>
       <p className="text-[9px] font-black uppercase opacity-60 tracking-widest mb-1">{label}</p>
       <p className="text-2xl font-black">{value || 0}</p>
    </div>
  );
}

function renderWarningIndicator(warnings: PayrollReconciliationWarning[]) {
  if (!warnings || warnings.length === 0) return <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto opacity-20" />;

  const hasBlocking = warnings.some(w => w.severity === 'blocking');
  const hasWarning = warnings.some(w => w.severity === 'warning');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative group mx-auto block">
          {hasBlocking ? (
            <AlertCircle className="w-5 h-5 text-red-600 animate-pulse" />
          ) : hasWarning ? (
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          ) : (
            <Info className="w-5 h-5 text-blue-400" />
          )}
          <Badge className="absolute -top-1 -right-1 h-3.5 w-3.5 p-0 flex items-center justify-center text-[8px] font-black bg-slate-900 border-white border-2">
            {warnings.length}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 rounded-2xl shadow-2xl border-primary/5 overflow-hidden">
        <div className="bg-primary/5 p-3 border-b">
           <p className="text-[10px] font-black uppercase text-primary tracking-widest">Alertes de réconciliation</p>
        </div>
        <ScrollArea className="max-h-[300px]">
           <div className="p-4 space-y-4">
              {warnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-3">
                   <div className={cn("mt-1 p-1 rounded-md shrink-0", 
                     w.severity === 'blocking' ? "bg-red-100 text-red-600" : 
                     w.severity === 'warning' ? "bg-orange-100 text-orange-600" : "bg-blue-100 text-blue-600")}>
                      {w.severity === 'blocking' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                   </div>
                   <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter">
                         {w.date ? format(parseISO(w.date), "dd/MM") : "Global"} • {w.code.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[11px] font-bold text-slate-700 leading-tight mt-0.5">{w.message}</p>
                      {w.differenceHours !== undefined && (
                        <p className="text-[9px] text-muted-foreground mt-1 font-mono">
                           Prévu: {w.expectedDailyHours}h | Réel: {w.validatedHours}h
                        </p>
                      )}
                   </div>
                </div>
              ))}
           </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
