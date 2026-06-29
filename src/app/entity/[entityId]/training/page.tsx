"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  GraduationCap, Plus, Search, Eye, Edit, Archive, 
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, 
  Building2, ArrowUpRight, ArrowRight, History, MoreVertical,
  RefreshCcw, FileSignature
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query, where } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  Training, 
  TrainingType, 
  TrainingStatus,
  TrainingResultStatus,
  TRAINING_TYPE_LABELS,
  TRAINING_STATUS_LABELS,
  TRAINING_RESULT_LABELS 
} from "@/types/training";
import { archiveTraining } from "@/services/training.service";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { TrainingDialog } from "@/components/trainings/TrainingDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, isBefore, addDays, startOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const initialFilters = {
  search: "",
  trainingType: "all",
  status: "all",
  deadlineStatus: "all"
};

export default function TrainingsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // UI State
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isResultMode, setIsResultMode] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);

  // Queries
  const canRead = hasPermission("training.read");
  
  const trainingsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/trainings`), orderBy("updatedAt", "desc")) as Query<Training>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const { data: trainings, loading: loadingTrainings } = useCollection<Training>(trainingsQuery, "trainings.registry");
  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery, "trainings.employees_lookup");

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const activeEmployees = useMemo(() => {
    if (!employees) return [];
    return employees
      .filter(e => {
        const s = String(e.status || "").toLowerCase();
        return s === 'active' || s === 'actif' || s === 'active_contract';
      })
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [employees]);

  // Filter Logic
  const filteredTrainings = useMemo(() => {
    if (!trainings) return [];
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return trainings.filter(t => {
      const emp = employeesMap.get(t.employeeId);
      const searchTarget = `${t.title} ${t.provider || ""} ${emp?.displayName || ""} ${emp?.employeeCode || ""} ${t.batchId || ""}`.toLowerCase();
      
      if (filters.search && !searchTarget.includes(filters.search.toLowerCase())) return false;
      if (filters.trainingType !== "all" && t.trainingType !== filters.trainingType) return false;
      if (filters.status !== "all" && t.status !== filters.status) return false;

      if (filters.deadlineStatus !== "all" && t.expiryDate) {
        const expiry = parseISO(t.expiryDate);
        if (filters.deadlineStatus === "expired" && !isBefore(expiry, today)) return false;
        if (filters.deadlineStatus === "upcoming" && !(isBefore(expiry, thirtyDaysOut) && !isBefore(expiry, today))) return false;
        if (filters.deadlineStatus === "ok" && isBefore(expiry, thirtyDaysOut)) return false;
      } else if (filters.deadlineStatus !== "all" && !t.expiryDate) {
        return false;
      }

      return true;
    });
  }, [trainings, filters, employeesMap]);

  const handleEdit = (t: Training) => {
    setEditingId(t.id);
    setIsResultMode(false);
    setIsDialogVisible(true);
  };

  const handleEnterResult = (t: Training) => {
    setEditingId(t.id);
    setIsResultMode(true);
    setIsDialogVisible(true);
  };

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await archiveTraining(entityId, id, user.uid);
      toast({ title: "Formation archivée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-primary tracking-tight">Registre des Formations</h1>
          <p className="text-muted-foreground text-sm font-medium">Gestion de la formation obligatoire et continue.</p>
        </div>
        {hasPermission("training.create") && (
          <Button onClick={() => { setEditingId(null); setIsResultMode(false); setIsDialogVisible(true); }} className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold">
            <Plus className="w-4 h-4" /> Nouvelle formation
          </Button>
        )}
      </header>

      {/* Stats / KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total formations" value={trainings?.length || 0} icon={GraduationCap} color="blue" />
         <StatCard title="Terminées" value={trainings?.filter(t => t.status === 'completed').length || 0} icon={CheckCircle2} color="green" />
         <StatCard title="À renouveler (30j)" value={trainings?.filter(t => t.expiryDate && isBefore(parseISO(t.expiryDate), addDays(startOfDay(new Date()), 30))).length || 0} icon={Clock} color="orange" />
         <StatCard title="Expirées" value={trainings?.filter(t => t.expiryDate && isBefore(parseISO(t.expiryDate), startOfDay(new Date()))).length || 0} icon={AlertTriangle} color="red" />
      </div>

      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 rounded-xl" 
              placeholder="Rechercher intitulé, collaborateur, session..." 
              value={filters.search}
              onChange={(e) => setFilters(p => ({...p, search: e.target.value}))}
            />
          </div>
          
          <Select value={filters.trainingType} onValueChange={(v) => setFilters(p => ({...p, trainingType: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.deadlineStatus} onValueChange={(v) => setFilters(p => ({...p, deadlineStatus: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Échéance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les échéances</SelectItem>
              <SelectItem value="expired">Expirée</SelectItem>
              <SelectItem value="upcoming">Proche (30j)</SelectItem>
              <SelectItem value="ok">À jour</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
            <SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(TRAINING_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button variant="ghost" onClick={() => setFilters(initialFilters)} className="text-muted-foreground text-xs font-bold uppercase">
             <X className="w-3.5 h-3.5 mr-1" /> Réinitialiser
          </Button>
        </div>

        {/* Table */}
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead className="pl-6">Employé</TableHead>
                <TableHead>Type & Intitulé</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingTrainings ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredTrainings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune formation trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTrainings.map((t) => {
                  const emp = employeesMap.get(t.employeeId);
                  const expiryDate = t.expiryDate ? parseISO(t.expiryDate) : null;
                  const today = startOfDay(new Date());
                  const isExpiredStatus = expiryDate && isBefore(expiryDate, today);

                  return (
                    <TableRow key={t.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{emp?.displayName || "Employé inconnu"}</span>
                           <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground uppercase font-mono">{emp?.employeeCode || t.employeeId.slice(0, 8)}</span>
                              {t.batchId && (
                                <Badge variant="outline" className="text-[8px] h-3 px-1 border-primary/10 bg-primary/5 text-primary/60 font-black uppercase">Session</Badge>
                              )}
                           </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-bold text-primary truncate max-w-[180px]" title={t.title}>{t.title}</span>
                           <span className="text-[9px] text-muted-foreground uppercase">{TRAINING_TYPE_LABELS[t.trainingType]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <div className="flex items-center gap-1.5 text-xs font-medium">
                              <Calendar className="w-3 h-3 text-primary/40" />
                              <span>{formatDate(t.startDate || t.courseDate)}</span>
                              {t.endDate && t.endDate !== t.startDate && (
                                <>
                                  <ArrowRight className="w-3 h-3 opacity-30" />
                                  <span>{formatDate(t.endDate)}</span>
                                </>
                              )}
                           </div>
                           {t.durationHours && <span className="text-[9px] font-black text-primary/60 uppercase">{t.durationHours} h validées</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                         {t.resultStatus && t.resultStatus !== 'not_required' ? (
                           <div className="flex items-center gap-1.5">
                             {t.resultStatus === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                             <span className={cn("text-[10px] font-black uppercase", t.resultStatus === 'passed' ? "text-green-700" : "text-red-700")}>
                                {TRAINING_RESULT_LABELS[t.resultStatus]}
                             </span>
                           </div>
                         ) : <span className="text-[10px] text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell>
                         {t.expiryDate ? (
                           <div className="flex flex-col">
                              <span className={cn("text-xs font-black", getDeadlineColor(t.expiryDate))}>
                                 {formatDate(t.expiryDate)}
                              </span>
                              {isExpiredStatus && <span className="text-[8px] font-bold text-red-600 uppercase">Expirée</span>}
                           </div>
                         ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                         {getStatusBadge(t.status)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-52">
                              {t.status !== 'completed' && t.status !== 'failed' && (
                                <DropdownMenuItem onClick={() => handleEnterResult(t)} className="gap-2 font-bold text-primary">
                                   <FileSignature className="w-4 h-4" /> Saisir le résultat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(t)} className="gap-2">
                                 <Edit className="w-4 h-4" /> Modifier détails
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleArchive(t.id)} className="gap-2 text-destructive">
                                 <Archive className="w-4 h-4" /> Archiver
                              </DropdownMenuItem>
                           </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <TrainingDialog 
        open={isDialogVisible} 
        onOpenChange={(open) => {
          setIsDialogVisible(open);
          if (!open) {
            setEditingId(null);
            setIsResultMode(false);
          }
        }}
        entityId={entityId}
        trainingId={editingId}
        resultMode={isResultMode}
        employees={activeEmployees}
      />
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    green: "bg-green-50 text-green-600 border-green-100"
  };
  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl group bg-white hover:shadow-md transition-all">
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

function getStatusBadge(status: TrainingStatus) {
  switch (status) {
    case 'planned': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Planifiée</Badge>;
    case 'in_progress': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">En cours</Badge>;
    case 'completed': return <Badge className="bg-green-600 text-white border-none text-[10px]">Terminée</Badge>;
    case 'failed': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px]">Non validée</Badge>;
    case 'expired': return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">Expirée</Badge>;
    case 'cancelled': return <Badge variant="outline" className="text-muted-foreground text-[10px]">Annulée</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 text-[10px]">Archivée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy", { locale: fr });
  } catch (e) {
    return dateStr;
  }
}

function getDeadlineColor(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  const thirtyDays = addDays(today, 30);

  if (isBefore(d, today)) return "text-red-600";
  if (isBefore(d, thirtyDays)) return "text-orange-600";
  return "text-slate-600";
}

function FilterDropdown({ label, value, onValueChange, options }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("h-10 w-auto min-w-[150px] text-xs font-medium bg-background border-primary/10", value !== 'all' && "border-primary ring-1 ring-primary/10")}>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{label}:</span>
          <SelectValue placeholder="Tous" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous ({label})</SelectItem>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
