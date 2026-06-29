"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Stethoscope, Plus, Search, Eye, Edit, Archive, 
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, 
  Building2, ArrowUpRight, History, MoreVertical,
  RefreshCcw, FileSignature, FileText, Paperclip,
  FileCheck
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
  MedicalVisit, 
  MedicalVisitType, 
  MedicalFitnessStatus, 
  MedicalVisitStatus,
  MEDICAL_VISIT_TYPE_LABELS,
  FITNESS_STATUS_LABELS 
} from "@/types/medical-visit";
import { archiveMedicalVisit } from "@/services/medical-visit.service";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { MedicalVisitDialog } from "@/components/medical-visits/MedicalVisitDialog";
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
  visitType: "all",
  fitnessStatus: "all",
  status: "all",
  deadlineStatus: "all"
};

export default function MedicalVisitsRegistryPage() {
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
  const canRead = hasPermission("medicalVisits.read");
  
  const visitsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/medicalVisits`), orderBy("visitDate", "desc")) as Query<MedicalVisit>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const { data: visits, loading: loadingVisits } = useCollection<MedicalVisit>(visitsQuery, "medical-visits.registry");
  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery, "medical-visits.employees_lookup");

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
  const filteredVisits = useMemo(() => {
    if (!visits) return [];
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return visits.filter(v => {
      const emp = employeesMap.get(v.employeeId);
      const searchTarget = `${v.doctorName} ${v.medicalCenter || ""} ${emp?.displayName || ""} ${emp?.employeeCode || ""}`.toLowerCase();
      
      if (filters.search && !searchTarget.includes(filters.search.toLowerCase())) return false;
      if (filters.visitType !== "all" && v.visitType !== filters.visitType) return false;
      if (filters.fitnessStatus !== "all" && v.fitnessStatus !== filters.fitnessStatus) return false;
      if (filters.status !== "all" && v.status !== filters.status) return false;

      if (filters.deadlineStatus !== "all" && v.nextVisitDate) {
        const nextDate = parseISO(v.nextVisitDate);
        if (filters.deadlineStatus === "expired" && !isBefore(nextDate, today)) return false;
        if (filters.deadlineStatus === "upcoming" && !(isBefore(nextDate, thirtyDaysOut) && !isBefore(nextDate, today))) return false;
        if (filters.deadlineStatus === "ok" && isBefore(nextDate, thirtyDaysOut)) return false;
      } else if (filters.deadlineStatus !== "all" && !v.nextVisitDate) {
        return false;
      }

      return true;
    });
  }, [visits, filters, employeesMap]);

  const handleEdit = (v: MedicalVisit) => {
    setEditingId(v.id);
    setIsResultMode(false);
    setIsDialogVisible(true);
  };

  const handleEnterResult = (v: MedicalVisit) => {
    setEditingId(v.id);
    setIsResultMode(true);
    setIsDialogVisible(true);
  };

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await archiveMedicalVisit(entityId, id, user.uid);
      toast({ title: "Visite archivée" });
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
          <h1 className="text-3xl font-black text-primary tracking-tight">Visites médicales / Sorveglianza sanitaria</h1>
          <p className="text-muted-foreground text-sm font-medium">Gestion des visites médicales et de l'aptitude au travail.</p>
        </div>
        {hasPermission("medicalVisits.create") && (
          <Button onClick={() => { setEditingId(null); setIsResultMode(false); setIsDialogVisible(true); }} className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold">
            <Plus className="w-4 h-4" /> Nouvelle visite
          </Button>
        )}
      </header>

      {/* Stats / KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total visites" value={visits?.length || 0} icon={Stethoscope} color="blue" />
         <StatCard title="Résultats en attente" value={visits?.filter(v => v.fitnessStatus === 'pending_result').length || 0} icon={Clock} color="orange" />
         <StatCard title="Échéances critiques" value={visits?.filter(v => v.nextVisitDate && isBefore(parseISO(v.nextVisitDate), addDays(startOfDay(new Date()), 30))).length || 0} icon={AlertTriangle} color="red" />
         <StatCard title="Aptes (Idonei)" value={visits?.filter(v => v.fitnessStatus === 'fit').length || 0} icon={CheckCircle2} color="green" />
      </div>

      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 rounded-xl" 
              placeholder="Rechercher collaborateur, médecin..." 
              value={filters.search}
              onChange={(e) => setFilters(p => ({...p, search: e.target.value}))}
            />
          </div>
          
          <Select value={filters.visitType} onValueChange={(v) => setFilters(p => ({...p, visitType: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Type de visite" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {Object.entries(MEDICAL_VISIT_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.deadlineStatus} onValueChange={(v) => setFilters(p => ({...p, deadlineStatus: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Échéance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les échéances</SelectItem>
              <SelectItem value="expired">Échue</SelectItem>
              <SelectItem value="upcoming">À échéance proche (30j)</SelectItem>
              <SelectItem value="ok">À jour</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="scheduled">Planifiée</SelectItem>
              <SelectItem value="completed">Terminée</SelectItem>
              <SelectItem value="pending_result">En attente de résultat</SelectItem>
              <SelectItem value="cancelled">Annulée</SelectItem>
              <SelectItem value="archived">Archivée</SelectItem>
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
                <TableHead>Type & Date</TableHead>
                <TableHead>Jugement d'aptitude</TableHead>
                <TableHead>Certificat (GED)</TableHead>
                <TableHead>Médecin</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingVisits ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredVisits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune visite trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredVisits.map((v) => {
                  const emp = employeesMap.get(v.employeeId);
                  const visitDate = parseISO(v.visitDate);
                  const isPast = isBefore(visitDate, startOfDay(new Date()));
                  const isMissingResult = isPast && v.fitnessStatus === 'pending_result' && v.status !== 'cancelled' && v.status !== 'archived';

                  return (
                    <TableRow key={v.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{emp?.displayName || "Employé inconnu"}</span>
                           <span className="text-[10px] text-muted-foreground uppercase font-mono">{emp?.employeeCode || v.employeeId.slice(0, 8)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-bold text-primary">{MEDICAL_VISIT_TYPE_LABELS[v.visitType]}</span>
                           <span className="text-[10px] text-muted-foreground">{format(visitDate, "dd/MM/yyyy")}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                         {getFitnessBadge(v.fitnessStatus, isMissingResult)}
                         {(v.prescriptions || v.restrictions) && (
                            <div className="flex gap-1 mt-1">
                               <Badge variant="outline" className="text-[8px] h-3 px-1 border-orange-200 text-orange-600 bg-orange-50 uppercase font-black">Prescriptions</Badge>
                            </div>
                         )}
                      </TableCell>
                      <TableCell>
                         {v.documentId ? (
                           <div className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase">
                             <FileCheck className="w-3.5 h-3.5" /> Certificat joint
                           </div>
                         ) : (
                           <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase">
                             <Paperclip className="w-3.5 h-3.5 opacity-30" /> Non joint
                           </div>
                         )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-medium text-slate-700">{v.doctorName}</span>
                           <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{v.medicalCenter || "Centre non renseigné"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                         {v.nextVisitDate ? (
                           <div className="flex flex-col">
                              <span className={cn("text-xs font-black", getDeadlineColor(v.nextVisitDate))}>
                                 {format(parseISO(v.nextVisitDate), "dd/MM/yyyy")}
                              </span>
                              {isExpired(v.nextVisitDate) && <span className="text-[8px] font-bold text-red-600 uppercase">Échue</span>}
                           </div>
                         ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                         {getStatusBadge(v.status, isMissingResult)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-48">
                              {v.fitnessStatus === 'pending_result' && !isTerminal(v.status) && (
                                <DropdownMenuItem onClick={() => handleEnterResult(v)} className="gap-2 font-bold text-primary">
                                   <FileSignature className="w-4 h-4" /> Saisir le résultat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(v)} className="gap-2">
                                 <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleArchive(v.id)} className="gap-2 text-destructive">
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

      <MedicalVisitDialog 
        open={isDialogVisible} 
        onOpenChange={(open) => {
          setIsDialogVisible(open);
          if (!open) {
            setEditingId(null);
            setIsResultMode(false);
          }
        }}
        entityId={entityId}
        visitId={editingId}
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
    green: "bg-green-50 text-green-600 border-green-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
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

function getFitnessBadge(status: MedicalFitnessStatus, isMissingResult: boolean) {
  if (isMissingResult) return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] animate-pulse">RÉSULTAT MANQUANT</Badge>;

  switch (status) {
    case 'fit': return <Badge className="bg-green-600 text-white border-none text-[10px]">{FITNESS_STATUS_LABELS.fit}</Badge>;
    case 'fit_with_prescriptions': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{FITNESS_STATUS_LABELS.fit_with_prescriptions}</Badge>;
    case 'temporarily_unfit': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px]">{FITNESS_STATUS_LABELS.temporarily_unfit}</Badge>;
    case 'unfit': return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">{FITNESS_STATUS_LABELS.unfit}</Badge>;
    case 'pending_result': return <Badge variant="outline" className="bg-slate-50 text-slate-400 border-slate-200 text-[10px]">{FITNESS_STATUS_LABELS.pending_result}</Badge>;
    default: return null;
  }
}

function getStatusBadge(status: MedicalVisitStatus, isMissingResult: boolean) {
  if (isMissingResult) return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">EN ATTENTE JUGEMENT</Badge>;

  switch (status) {
    case 'scheduled': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Planifiée</Badge>;
    case 'completed': return <Badge className="bg-slate-900 text-white border-none text-[10px]">Terminée</Badge>;
    case 'pending_result': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">En attente de résultat</Badge>;
    case 'cancelled': return <Badge variant="outline" className="text-muted-foreground text-[10px]">Annulée</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 text-[10px]">Archivée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function isExpired(date: string) {
  return isBefore(parseISO(date), startOfDay(new Date()));
}

function isTerminal(status: MedicalVisitStatus) {
  return status === 'completed' || status === 'cancelled' || status === 'archived';
}

function getDeadlineColor(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  const thirtyDays = addDays(today, 30);

  if (isBefore(d, today)) return "text-red-600";
  if (isBefore(d, thirtyDays)) return "text-orange-600";
  return "text-slate-600";
}
