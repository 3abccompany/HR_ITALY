"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Search, FileText, Loader2, Eye, 
  Filter, X, ListFilter, Briefcase, 
  Calendar as CalendarIcon, Building2,
  Scale, Euro, Fingerprint, AlertCircle,
  Clock, CheckCircle2, AlertTriangle, ArrowUpRight,
  RefreshCcw, ChevronLeft, ChevronRight,
  Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, isBefore, addDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";

interface Filters {
  search: string;
  status: string;
  type: string;
  ccnl: string;
  expiry: string;
}

const initialFilters: Filters = {
  search: "",
  status: "all",
  type: "all",
  ccnl: "all",
  expiry: "all",
};

/**
 * Robust date parser for mixed formats.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    return null;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// --- Helpers ---
const getNumberLikeField = (source: unknown, keys: string[]): number | null => {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

export default function ContractsRegistryPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission, membership } = useActiveMembership(entityId);

  // Permission Readiness Guard
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  // UX State
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });

  const canRead = hasPermission("contracts.read");
  const canReadEmployees = hasPermission("employees.read");

  // Main real-time query
  const contractsQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/contracts`)) as Query<Contract>;
  }, [db, entityId, canRead, permissionsReady]);

  const { data: contracts, loading: loadingContracts } = useCollection<Contract>(contractsQuery, "contracts.registry");

  // Fallback Employee lookup query
  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canReadEmployees || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canReadEmployees, permissionsReady]);

  const { data: employees } = useCollection<Employee>(employeesQuery, "contracts.employees_lookup");

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  // Dynamic filter options
  const filterOptions = useMemo(() => {
    const statuses = new Set<string>();
    const types = new Set<string>();
    const ccnls = new Set<string>();

    contracts?.forEach(c => {
      if (c.status) statuses.add(c.status);
      if (c.contractType) types.add(c.contractType);
      if (c.ccnlName) ccnls.add(c.ccnlName);
    });

    return {
      statuses: Array.from(statuses).sort(),
      types: Array.from(types).sort(),
      ccnls: Array.from(ccnls).sort(),
    };
  }, [contracts]);

  // KPIs
  const stats = useMemo(() => {
    if (!contracts) return { total: 0, active: 0, pending: 0, alert: 0 };
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return contracts.reduce((acc, c) => {
      acc.total++;
      if (c.status === 'active') acc.active++;
      if (c.status === 'pending_activation') acc.pending++;
      
      const endDate = parseSafeDate(c.endDate);
      if (c.status === 'active' && endDate && isBefore(endDate, thirtyDaysOut)) {
        acc.alert++;
      }
      return acc;
    }, { total: 0, active: 0, pending: 0, alert: 0 });
  }, [contracts]);

  // Filtering & Sorting Logic
  const filteredContracts = useMemo(() => {
    if (!contracts) return [];
    
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    let result = contracts.filter(c => {
      const emp = employeesMap.get(c.employeeId);
      const displayName = c.employeeDisplayName || (emp ? `${emp.firstName} ${emp.lastName}` : "");
      const code = c.employeeCode || (emp ? emp.employeeCode : "");

      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const searchTarget = [
          displayName, code, c.contractId, c.contractType, 
          c.ccnlName, c.levelCode, c.status
        ].join(' ').toLowerCase();
        if (!searchTarget.includes(term)) return false;
      }

      // 2. Status
      if (filters.status !== "all" && c.status !== filters.status) return false;

      // 3. Type
      if (filters.type !== "all" && c.contractType !== filters.type) return false;

      // 4. CCNL
      if (filters.ccnl !== "all" && c.ccnlName !== filters.ccnl) return false;

      // 5. Expiry
      if (filters.expiry !== "all") {
        const endDate = parseSafeDate(c.endDate);
        if (c.status !== 'active' || !endDate) return false;
        
        if (filters.expiry === "overdue" && !isBefore(endDate, today)) return false;
        if (filters.expiry === "soon" && !(isBefore(endDate, thirtyDaysOut) && !isBefore(endDate, today))) return false;
        if (filters.expiry === "none" && isBefore(endDate, thirtyDaysOut)) return false;
      }

      return true;
    });

    // 6. Weighted Sorting
    result.sort((a, b) => {
      const getWeight = (c: Contract) => {
        const endDate = parseSafeDate(c.endDate);
        if (c.status === 'active') {
          if (endDate && isBefore(endDate, today)) return 0; // Overdue Active
          if (endDate && isBefore(endDate, thirtyDaysOut)) return 1; // Soon Active
          return 2; // Normal Active
        }
        if (c.status === 'pending_activation') return 3;
        if (c.status === 'draft') return 4;
        return 10; // Historical
      };

      const weightA = getWeight(a);
      const weightB = getWeight(b);

      if (weightA !== weightB) return weightA - weightB;

      // Secondary sort: Recency
      const dateA = parseSafeDate(a.updatedAt || a.createdAt || 0)?.getTime() || 0;
      const dateB = parseSafeDate(b.updatedAt || b.createdAt || 0)?.getTime() || 0;
      return dateB - dateA;
    });

    return result;
  }, [contracts, filters, employeesMap]);

  // Pagination
  const totalResults = filteredContracts.length;
  const totalPages = Math.ceil(totalResults / pagination.pageSize);
  const paginatedContracts = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return filteredContracts.slice(start, start + pagination.pageSize);
  }, [filteredContracts, pagination]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(p => ({ ...p, page: 1 }));
  };

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header>
        <h1 className="text-3xl font-black text-primary tracking-tight">Registre des Contrats</h1>
        <p className="text-muted-foreground text-sm font-medium">Gestion des engagements contractuels et documents signés.</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total contrats" value={stats.total} icon={FileText} color="blue" />
         <StatCard title="Contrats actifs" value={stats.active} icon={CheckCircle2} color="green" />
         <StatCard title="En attente activation" value={stats.pending} icon={Clock} color="indigo" />
         <StatCard title="Échéances critiques" value={stats.alert} icon={AlertTriangle} color="orange" alert={stats.alert > 0} />
      </div>

      <div className="space-y-4">
        {/* Filter Bar */}
        <div className="flex flex-col gap-4">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-3 p-1">
              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input 
                  placeholder="Nom, matricule, ID..." 
                  className="h-10 pl-8 text-xs bg-background rounded-xl border-primary/10" 
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => updateFilter('status', v)}
                options={filterOptions.statuses.map(s => ({ label: s.replace(/_/g, ' ').toUpperCase(), value: s }))}
              />

              {/* Type Filter */}
              <FilterDropdown 
                label="Type" 
                value={filters.type} 
                onValueChange={(v) => updateFilter('type', v)}
                options={filterOptions.types.map(t => ({ label: t, value: t }))}
              />

              {/* Classification Filter */}
              <FilterDropdown 
                label="Classification" 
                value={filters.ccnl} 
                onValueChange={(v) => updateFilter('ccnl', v)}
                options={filterOptions.ccnls.map(c => ({ label: c, value: c }))}
              />

              {/* Expiry Filter */}
              <FilterDropdown 
                label="Échéance" 
                value={filters.expiry} 
                onValueChange={(v) => updateFilter('expiry', v)}
                options={[
                  { label: "Échéance dépassée", value: "overdue" },
                  { label: "Échéance proche (<30j)", value: "soon" },
                  { label: "Sans alerte", value: "none" }
                ]}
              />

              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setFilters(initialFilters)} 
                className="h-10 text-xs text-muted-foreground hover:text-primary rounded-xl"
              >
                <RefreshCcw className="w-3.5 h-3.5 mr-2" />
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <div className="flex items-center justify-between px-1">
             <div className="flex flex-wrap items-center gap-2">
                {Object.entries(filters).map(([key, value]) => {
                  if (key === 'search' || value === 'all' || !value) return null;
                  return (
                    <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                      {key === 'ccnl' ? 'CCNL: ' : key === 'expiry' ? 'Échéance: ' : ''} {value.replace(/_/g, ' ')}
                      <button onClick={() => updateFilter(key as keyof Filters, "all")} className="hover:bg-primary/10 rounded-full p-0.5">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  );
                })}
             </div>
             {totalResults > 0 && !loadingContracts && (
               <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                 {totalResults} contrat{totalResults > 1 ? 's' : ''} trouvé{totalResults > 1 ? 's' : ''}
               </span>
             )}
          </div>
        </div>

        {/* Table Container */}
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20 hover:bg-secondary/20">
                <TableHead className="pl-6">Collaborateur</TableHead>
                <TableHead>Type de contrat</TableHead>
                <TableHead>Statut & Alertes</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Rémunération</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingContracts ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredContracts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucun contrat ne correspond aux critères.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedContracts.map((c) => {
                  const emp = employeesMap.get(c.employeeId);
                  const displayName = c.employeeDisplayName || (emp ? `${emp.firstName} ${emp.lastName}` : "Collaborateur inconnu");
                  const code = c.employeeCode || (emp ? emp.employeeCode : "N/A");

                  const monthlyRem = getNumberLikeField(c, ['proposedGrossMonthly', 'grossMonthly', 'grossMonthlySalary', 'monthlyGross', 'monthlySalary', 'salaryMonthly', 'remunerationMonthly']) || 0;
                  const annualRem = getNumberLikeField(c, ['proposedGrossAnnual', 'grossAnnual', 'grossAnnualSalary', 'annualGross', 'annualSalary', 'salaryAnnual', 'ral', 'ralAnnuel']) || 0;

                  return (
                    <TableRow key={c.contractId} className="group hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{displayName}</span>
                           <span className="text-[10px] font-mono text-muted-foreground uppercase bg-secondary/30 w-fit px-1 rounded mt-0.5">
                              <Fingerprint className="w-2.5 h-2.5 inline mr-1" /> {code}
                           </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-bold text-slate-700">{c.contractType || "N/A"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                           {getStatusBadge(c.status)}
                           {getExpiryBadge(c)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                           <div className="flex items-center gap-1.5 text-xs font-medium">
                             <CalendarIcon className="w-3 h-3 text-primary/40" /> {c.startDate || "N/A"}
                           </div>
                           {c.endDate && (
                             <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                               <ArrowUpRight className="w-2.5 h-2.5" /> Fin: {c.endDate}
                             </div>
                           )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                           <div className="text-[10px] font-bold text-primary truncate max-w-[120px]">{c.ccnlName || "Non renseignée"}</div>
                           <Badge variant="outline" className="text-[8px] h-4 px-1">{c.levelCode || "—"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                         <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-[11px] font-black text-accent">
                               <Euro className="w-2.5 h-2.5" /> {monthlyRem.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} /mois
                            </div>
                            <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-tight">RAL: {annualRem.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</div>
                         </div>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 gap-2 rounded-xl font-bold bg-white shadow-sm hover:bg-primary/5 transition-all"
                          onClick={() => router.push(`/entity/${entityId}/contracts/${c.contractId}`)}
                        >
                          <Eye className="w-3.5 h-3.5 text-primary" />
                          Détails
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination Footer */}
          {!loadingContracts && filteredContracts.length > 0 && (
            <div className="border-t bg-secondary/10 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Lignes:</span>
                  <Select 
                    value={String(pagination.pageSize)} 
                    onValueChange={(v) => { setPagination(p => ({ ...p, pageSize: Number(v), page: 1 })); }}
                  >
                    <SelectTrigger className="h-7 w-20 text-[10px] font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">
                  Page {pagination.page} sur {Math.max(1, totalPages)}
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8" 
                  onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                  disabled={pagination.page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8" 
                  onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                  disabled={pagination.page >= totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, alert }: { title: string, value: number, icon: any, color: string, alert?: boolean }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-green-50 text-green-600 border-green-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };

  return (
    <Card className={cn(
      "border-primary/5 shadow-sm rounded-2xl group bg-white hover:shadow-md transition-all",
      alert && "ring-1 ring-red-500/20"
    )}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border transition-colors", colors[color] || colors.blue)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest truncate">{title}</p>
          <div className="flex items-baseline gap-1">
             <p className="text-2xl font-black text-primary leading-none mt-1">{value}</p>
             <ArrowUpRight className="w-3 h-3 text-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterDropdown({ label, value, onValueChange, options }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(
        "h-10 w-auto min-w-[150px] text-xs font-medium bg-background rounded-xl border-primary/10",
        value !== 'all' && "border-primary ring-1 ring-primary/10"
      )}>
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

function getStatusBadge(status: ContractStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[9px] font-black h-5 uppercase px-2">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[9px] font-black h-5 uppercase px-2">Signature</Badge>;
    case 'pending_activation': return <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[9px] font-black h-5 uppercase px-2">En attente</Badge>;
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white text-[9px] font-black h-5 uppercase px-2">Actif</Badge>;
    case 'renewed': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[9px] font-black h-5 uppercase px-2">Renouvelé</Badge>;
    case 'expired': return <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 text-[9px] font-black h-5 uppercase px-2">Expiré</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[9px] font-black h-5 uppercase px-2">Terminé</Badge>;
    case 'suspended': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-[9px] font-black h-5 uppercase px-2">Suspendu</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground text-[9px] font-black h-5 uppercase px-2">Archivé</Badge>;
    default: return <Badge variant="outline" className="text-[9px] font-black h-5 uppercase px-2">{status}</Badge>;
  }
}

function getExpiryBadge(contract: Contract) {
  if (contract.status !== 'active') return null;
  const endDate = parseSafeDate(contract.endDate);
  if (!endDate) return null;
  
  const today = startOfDay(new Date());
  if (isBefore(endDate, today)) {
    return (
      <Badge variant="destructive" className="bg-red-600 text-[9px] font-black h-4 uppercase border-none px-1.5 animate-pulse">
        <AlertTriangle className="w-2.5 h-2.5 mr-1" /> Échéance dépassée
      </Badge>
    );
  }
  
  const thirtyDaysOut = addDays(today, 30);
  if (isBefore(endDate, thirtyDaysOut)) {
    return (
      <Badge variant="secondary" className="bg-orange-500 text-white text-[9px] font-black h-4 uppercase border-none px-1.5">
        <Clock className="w-2.5 h-2.5 mr-1" /> Échéance proche
      </Badge>
    );
  }

  const sixtyDaysOut = addDays(today, 60);
  if (isBefore(endDate, sixtyDaysOut)) {
    return (
      <Badge variant="outline" className="text-orange-500 border-orange-200 bg-orange-50 text-[9px] font-black h-4 uppercase px-1.5">
        <Info className="w-2.5 h-2.5 mr-1" /> Expire bientôt
      </Badge>
    );
  }

  return null;
}
