"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Search, FileText, Loader2, Eye, 
  Filter, X, ListFilter, Briefcase, 
  Calendar as CalendarIcon, Building2,
  Scale, Euro, Fingerprint, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Filters {
  search: string;
  status: string;
  type: string;
}

const initialFilters: Filters = {
  search: "",
  status: "all",
  type: "all",
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

  // Main real-time query - Order by createdAt desc, fallback to startDate
  const contractsQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/contracts`), orderBy("createdAt", "desc")) as Query<Contract>;
  }, [db, entityId, canRead, permissionsReady]);

  const { data: contracts, loading: loadingContracts } = useCollection<Contract>(contractsQuery);

  // Fallback Employee lookup query - Lightweight
  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canReadEmployees || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canReadEmployees, permissionsReady]);

  const { data: employees } = useCollection<Employee>(employeesQuery);

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  // Derived filter options
  const uniqueTypes = useMemo(() => 
    Array.from(new Set(contracts?.map(c => c.contractType) || [])).sort(), 
  [contracts]);

  // Filtering Logic
  const filteredContracts = useMemo(() => {
    if (!contracts) return [];
    
    return contracts.filter(c => {
      // Robust name/code resolution for search
      const emp = employeesMap.get(c.employeeId);
      const displayName = c.employeeDisplayName || (emp ? `${emp.firstName} ${emp.lastName}` : "");
      const code = c.employeeCode || (emp ? emp.employeeCode : "");

      if (filters.search) {
        const term = filters.search.toLowerCase();
        const match = 
          displayName.toLowerCase().includes(term) ||
          code.toLowerCase().includes(term) ||
          c.contractId.toLowerCase().includes(term);
        if (!match) return false;
      }
      if (filters.status !== "all" && c.status !== filters.status) return false;
      if (filters.type !== "all" && c.contractType !== filters.type) return false;
      return true;
    });
  }, [contracts, filters, employeesMap]);

  // Pagination
  const totalResults = filteredContracts.length;
  const paginatedContracts = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return filteredContracts.slice(start, start + pagination.pageSize);
  }, [filteredContracts, pagination]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(p => ({ ...p, page: 1 }));
  };

  const formatMoney = (value: any, decimals = 2) => {
    if (value === undefined || value === null) return "-";
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return num.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Registre des Contrats</h1>
          <p className="text-muted-foreground text-sm">Gestion des engagements contractuels et documents signés.</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Filter Bar */}
        <div className="flex flex-col gap-4">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-3 p-1">
              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input 
                  placeholder="Rechercher nom, code, ID..." 
                  className="h-9 pl-8 text-xs bg-background" 
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => updateFilter('status', v)}
                options={[
                  { label: "Brouillon", value: "draft" },
                  { label: "En attente signature", value: "pending_signature" },
                  { label: "Actif", value: "active" },
                  { label: "Suspendu", value: "suspended" },
                  { label: "Terminé", value: "terminated" },
                  { label: "Archivé", value: "archived" }
                ]}
              />

              {/* Type Filter */}
              <FilterDropdown 
                label="Type" 
                value={filters.type} 
                onValueChange={(v) => updateFilter('type', v)}
                options={uniqueTypes.map(t => ({ label: t, value: t }))}
              />

              <Button variant="ghost" size="sm" onClick={() => setFilters(initialFilters)} className="h-9 text-xs text-muted-foreground hover:text-primary">
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
                      {value.replace(/_/g, ' ')}
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

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Collaborateur</TableHead>
                <TableHead>Type de contrat</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date Début</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Rémunération</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingContracts ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredContracts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <FileText className="h-10 w-10 opacity-20" />
                      <p>Aucun contrat trouvé.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedContracts.map((c) => {
                  const emp = employeesMap.get(c.employeeId);
                  const displayName = c.employeeDisplayName || (emp ? `${emp.firstName} ${emp.lastName}` : "Collaborateur inconnu");
                  const code = c.employeeCode || (emp ? emp.employeeCode : "Code non disponible");
                  const isDeleted = !emp && !!c.employeeId;

                  return (
                    <TableRow key={c.contractId} className="hover:bg-muted/50 transition-colors">
                      <TableCell>
                        <div className="flex flex-col">
                           <div className="font-bold text-primary">{displayName}</div>
                           <div className="flex items-center gap-2 mt-0.5">
                             <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-mono">
                                <Fingerprint className="w-2.5 h-2.5" /> {code}
                             </div>
                             {isDeleted && (
                               <Badge variant="outline" className="text-[8px] h-3 px-1 border-orange-200 text-orange-600 bg-orange-50 uppercase font-black">
                                 <AlertCircle className="w-2 h-2 mr-0.5" />
                                 Employé introuvable
                               </Badge>
                             )}
                           </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-bold text-slate-700">{c.contractType || "N/A"}</div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(c.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" /> {c.startDate || "N/A"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                           <div className="text-[10px] font-bold text-primary truncate max-w-[120px]">{c.ccnlName || "N/A"}</div>
                           <Badge variant="outline" className="text-[8px] h-4 px-1">{c.levelCode || "—"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                         <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-[11px] font-black text-accent">
                               <Euro className="w-2.5 h-2.5" /> {formatMoney(c.grossMonthly)} /mois
                            </div>
                            <div className="text-[9px] text-muted-foreground font-bold">RAL: {formatMoney(c.grossAnnual, 0)} €</div>
                         </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 gap-2 rounded-lg font-bold shadow-sm"
                          onClick={() => router.push(`/entity/${entityId}/contracts/${c.contractId}`)}
                        >
                          <Eye className="w-3.5 h-3.5 text-primary" />
                          <span className="hidden sm:inline">Détails</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function FilterDropdown({ label, value, onValueChange, options }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(
        "h-9 w-auto min-w-[140px] text-xs font-medium bg-background",
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
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[10px] h-5">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] h-5">En signature</Badge>;
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white text-[10px] h-5">Actif</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5">Terminé</Badge>;
    case 'suspended': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px] h-5">Suspendu</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground text-[10px] h-5">Archivé</Badge>;
    default: return <Badge variant="outline" className="text-[10px] h-5">{status}</Badge>;
  }
}
