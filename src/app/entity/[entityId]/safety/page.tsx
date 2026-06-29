"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Shield, Plus, Search, Eye, Edit, Archive, 
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, 
  Building2, ArrowUpRight, History, MoreVertical,
  RefreshCcw, FileText, Download, FileCheck,
  ShieldCheck, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query, where, doc, getDoc } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { SafetyDpiAssignment, SAFETY_DPI_STATUS_LABELS } from "@/types/safety-dpi";
import { archiveDpiAssignment, updateDpiAssignment } from "@/services/safety-dpi.service";
import { getDocumentDownloadUrl } from "@/services/document.service";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { SafetyDpiDialog } from "@/components/safety/SafetyDpiDialog";
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
  status: "all",
  riskType: "all",
  deadlineStatus: "all"
};

export default function SafetyDpiRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // UI State
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  // Queries
  const canRead = hasPermission("safety.read");
  
  const assignmentsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/safetyDpiAssignments`), orderBy("deliveryDate", "desc")) as Query<SafetyDpiAssignment>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const { data: assignments, loading: loadingAssignments } = useCollection<SafetyDpiAssignment>(assignmentsQuery, "safety-dpi.registry");
  const { data: employees } = useCollection<Employee>(employeesQuery, "safety-dpi.employees_lookup");

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const activeEmployees = useMemo(() => {
    if (!employees) return [];
    return employees
      .filter(e => ['active', 'actif', 'active_contract'].includes(String(e.status || "").toLowerCase()))
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [employees]);

  // Filter Logic
  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return assignments.filter(a => {
      const emp = employeesMap.get(a.employeeId);
      const searchTarget = `${a.dpiName} ${a.riskType} ${emp?.displayName || ""} ${emp?.employeeCode || ""}`.toLowerCase();
      
      if (filters.search && !searchTarget.includes(filters.search.toLowerCase())) return false;
      if (filters.status !== "all" && a.status !== filters.status) return false;
      if (filters.riskType !== "all" && a.riskType !== filters.riskType) return false;

      if (filters.deadlineStatus !== "all" && a.status === 'assigned') {
        const nextDate = parseISO(a.plannedReplacementDate);
        if (filters.deadlineStatus === "expired" && !isBefore(nextDate, today)) return false;
        if (filters.deadlineStatus === "upcoming" && !(isBefore(nextDate, thirtyDaysOut) && !isBefore(nextDate, today))) return false;
        if (filters.deadlineStatus === "ok" && isBefore(nextDate, thirtyDaysOut)) return false;
      }

      return true;
    });
  }, [assignments, filters, employeesMap]);

  const uniqueRiskTypes = useMemo(() => {
    const set = new Set<string>();
    assignments?.forEach(a => set.add(a.riskType));
    return Array.from(set).sort();
  }, [assignments]);

  // Handlers
  const handleViewPV = async (docId: string) => {
    if (!db || !entityId || !docId) return;
    setViewingDocId(docId);
    try {
      const docSnap = await getDoc(doc(db, `entities/${entityId}/documents`, docId));
      if (docSnap.exists()) {
        const url = await getDocumentDownloadUrl(docSnap.data().storagePath);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("Document introuvable.");
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Impossible d'ouvrir le document." });
    } finally {
      setViewingDocId(null);
    }
  };

  const handleUpdateStatus = async (id: string, nextStatus: any) => {
    if (!user) return;
    setLoading(true);
    try {
      await updateDpiAssignment(entityId, id, { status: nextStatus }, user.uid);
      toast({ title: "Statut mis à jour" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await archiveDpiAssignment(entityId, id, user.uid);
      toast({ title: "Assignation archivée" });
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
          <h1 className="text-3xl font-black text-primary tracking-tight">Sécurité / EPI-DPI</h1>
          <p className="text-muted-foreground text-sm font-medium">Suivi des équipements de protection individuelle remis au personnel.</p>
        </div>
        {hasPermission("safety.create") && (
          <Button onClick={() => { setEditingId(null); setIsDialogVisible(true); }} className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold">
            <Plus className="w-4 h-4" /> Remettre un EPI
          </Button>
        )}
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total EPI remis" value={assignments?.filter(a => a.status === 'assigned').length || 0} icon={Shield} color="blue" />
         <StatCard title="À remplacer bientôt" value={assignments?.filter(a => a.status === 'assigned' && isUpcoming(a.plannedReplacementDate)).length || 0} icon={Clock} color="orange" />
         <StatCard title="Retards remplacement" value={assignments?.filter(a => a.status === 'assigned' && isOverdue(a.plannedReplacementDate)).length || 0} icon={AlertTriangle} color="red" />
         <StatCard title="Remplacés / Retirés" value={assignments?.filter(a => ['replaced', 'returned'].includes(a.status)).length || 0} icon={History} color="green" />
      </div>

      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 rounded-xl" 
              placeholder="Rechercher équipement, collaborateur..." 
              value={filters.search}
              onChange={(e) => setFilters(p => ({...p, search: e.target.value}))}
            />
          </div>
          
          <Select value={filters.riskType} onValueChange={(v) => setFilters(p => ({...p, riskType: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Risque" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les risques</SelectItem>
              {uniqueRiskTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.deadlineStatus} onValueChange={(v) => setFilters(p => ({...p, deadlineStatus: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Échéance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les échéances</SelectItem>
              <SelectItem value="expired">En retard</SelectItem>
              <SelectItem value="upcoming">À venir (30j)</SelectItem>
              <SelectItem value="ok">À jour</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
            <SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(SAFETY_DPI_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
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
                <TableHead>Type Risque</TableHead>
                <TableHead>Équipement (EPI/DPI)</TableHead>
                <TableHead>Qté</TableHead>
                <TableHead>Date remise</TableHead>
                <TableHead>Remplacement</TableHead>
                <TableHead>PV signé</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingAssignments ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredAssignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune assignation trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAssignments.map((a) => {
                  const emp = employeesMap.get(a.employeeId);
                  const replacementDate = parseISO(a.plannedReplacementDate);
                  const today = startOfDay(new Date());
                  const isSoonVal = isUpcoming(a.plannedReplacementDate);
                  const isOverdueVal = isOverdue(a.plannedReplacementDate);

                  return (
                    <TableRow key={a.assignmentId} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{emp?.displayName || a.employeeName || "Employé inconnu"}</span>
                           <span className="text-[10px] text-muted-foreground uppercase font-mono">{emp?.employeeCode || a.employeeId.slice(0, 8)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold border-primary/10 bg-primary/5 text-primary/70">{a.riskType}</Badge>
                      </TableCell>
                      <TableCell>
                         <span className="text-sm font-bold text-slate-800">{a.dpiName}</span>
                      </TableCell>
                      <TableCell>
                         <span className="font-black text-xs">x{a.quantity}</span>
                      </TableCell>
                      <TableCell>
                         <span className="text-xs font-medium">{formatDate(a.deliveryDate)}</span>
                      </TableCell>
                      <TableCell>
                         <div className="flex flex-col">
                            <span className={cn("text-xs font-black", a.status === 'assigned' && (isOverdueVal ? "text-red-600" : isSoonVal ? "text-orange-600" : "text-slate-600"))}>
                               {formatDate(a.plannedReplacementDate)}
                            </span>
                            {a.status === 'assigned' && isOverdueVal && <span className="text-[8px] font-black text-red-600 uppercase">Échu</span>}
                         </div>
                      </TableCell>
                      <TableCell>
                         {a.reportDocumentId ? (
                            <button 
                              onClick={() => handleViewPV(a.reportDocumentId!)} 
                              disabled={!!viewingDocId}
                              className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase hover:underline group"
                            >
                               <FileCheck className="w-3.5 h-3.5" /> Joint
                               {viewingDocId === a.reportDocumentId ? (
                                 <Loader2 className="w-2.5 h-2.5 animate-spin ml-1" />
                               ) : (
                                 <Eye className="w-2.5 h-2.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                               )}
                            </button>
                         ) : (
                            <span className="text-[9px] text-muted-foreground font-medium uppercase italic opacity-40">Non joint</span>
                         )}
                      </TableCell>
                      <TableCell>
                         {getStatusBadge(a.status)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                         <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                               {a.reportDocumentId && (
                                 <DropdownMenuItem onClick={() => handleViewPV(a.reportDocumentId!)} className="gap-2 font-bold text-primary">
                                    <Eye className="w-4 h-4" /> Voir le PV
                                 </DropdownMenuItem>
                               )}
                               <DropdownMenuItem onClick={() => { setEditingId(a.assignmentId); setIsDialogVisible(true); }} className="gap-2">
                                  <Edit className="w-4 h-4" /> Modifier
                               </DropdownMenuItem>
                               <DropdownMenuSeparator />
                               {a.status === 'assigned' && (
                                 <>
                                   <DropdownMenuItem onClick={() => handleUpdateStatus(a.assignmentId, 'replaced')} className="gap-2 text-green-600 font-bold">
                                      <RefreshCcw className="w-4 h-4" /> Marquer remplacé
                                   </DropdownMenuItem>
                                   <DropdownMenuItem onClick={() => handleUpdateStatus(a.assignmentId, 'returned')} className="gap-2">
                                      <ArrowUpRight className="w-4 h-4" /> Marquer retourné
                                   </DropdownMenuItem>
                                 </>
                               )}
                               <DropdownMenuSeparator />
                               <DropdownMenuItem onClick={() => handleArchive(a.assignmentId)} className="gap-2 text-destructive">
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

      <SafetyDpiDialog 
        open={isDialogVisible} 
        onOpenChange={setIsDialogVisible}
        entityId={entityId}
        assignmentId={editingId}
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

function getStatusBadge(status: string) {
  switch (status) {
    case 'assigned': return <Badge className="bg-blue-600 text-white border-none text-[10px] uppercase font-black h-5">Assigné</Badge>;
    case 'replaced': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 text-[10px] uppercase font-black h-5">Remplacé</Badge>;
    case 'returned': return <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 text-[10px] uppercase font-black h-5">Retourné</Badge>;
    case 'lost': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] uppercase font-black h-5">Perdu</Badge>;
    case 'damaged': return <Badge variant="destructive" className="text-[10px] uppercase font-black h-5">Abîmé</Badge>;
    case 'archived': return <Badge variant="outline" className="text-[10px] uppercase font-black h-5">Archivé</Badge>;
    default: return <Badge variant="outline" className="text-[10px] font-bold">{status}</Badge>;
  }
}

function isUpcoming(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  const thirtyDaysOut = addDays(today, 30);
  return isBefore(d, thirtyDaysOut) && !isBefore(d, today);
}

function isOverdue(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  return isBefore(d, today);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy", { locale: fr });
  } catch (e) { return dateStr; }
}
