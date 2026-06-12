
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Users, Search, UserCheck, Loader2, 
  ChevronRight, ListFilter, Filter, X,
  Building2, MapPin, Calendar, Briefcase, Eye,
  ArrowUpRight, AlertCircle, UserX, LayoutDashboard,
  RefreshCcw, Mail, Fingerprint
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Employee } from "@/types/employee";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Filters {
  search: string;
  status: string;
  jobTitle: string;
  site: string;
}

const initialFilters: Filters = {
  search: "",
  status: "all",
  jobTitle: "all",
  site: "all",
};

export default function EmployeesManagementPage() {
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

  const canRead = hasPermission("employees.read");

  // Main real-time query
  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`), orderBy("hireDate", "desc"));
  }, [db, entityId, canRead, permissionsReady]);

  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery, "employees.registry");

  // Dynamic Options for Filters
  const uniqueJobTitles = useMemo(() => {
    if (!employees) return [];
    return Array.from(new Set(employees.map(e => e.jobTitle).filter(Boolean))).sort();
  }, [employees]);

  const uniqueSites = useMemo(() => {
    if (!employees) return [];
    return Array.from(new Set(employees.map(e => e.worksiteName).filter(Boolean))).sort();
  }, [employees]);

  const uniqueStatuses = useMemo(() => {
    if (!employees) return [];
    return Array.from(new Set(employees.map(e => e.status).filter(Boolean))).sort();
  }, [employees]);

  // Filtering Logic
  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    
    return employees.filter(e => {
      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const searchTarget = [
          e.displayName,
          e.employeeCode,
          e.email,
          e.jobTitle,
          e.worksiteName,
          e.departmentName,
          e.status
        ].join(' ').toLowerCase();
        
        if (!searchTarget.includes(term)) return false;
      }

      // 2. Job Title
      if (filters.jobTitle !== "all" && e.jobTitle !== filters.jobTitle) return false;

      // 3. Status
      if (filters.status !== "all" && e.status !== filters.status) return false;

      // 4. Site
      if (filters.site !== "all" && e.worksiteName !== filters.site) return false;

      return true;
    });
  }, [employees, filters]);

  // Derived Stats for KPI Cards
  const stats = useMemo(() => {
    if (!employees) return { total: 0, active: 0, inactive: 0, sites: 0 };
    return {
      total: employees.length,
      active: employees.filter(e => e.status === 'active' || e.status === 'ACTIVE' || e.status === 'actif').length,
      inactive: employees.filter(e => e.status !== 'active' && e.status !== 'ACTIVE' && e.status !== 'actif').length,
      sites: uniqueSites.length
    };
  }, [employees, uniqueSites]);

  const handleUpdateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  if (membershipLoading || !permissionsReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Chargement de la liste des employés...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-primary tracking-tight">Gestion des Employés</h1>
          <p className="text-muted-foreground text-sm font-medium">Consultez, recherchez et filtrez les employés par poste, statut et site de travail.</p>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total employés" value={stats.total} icon={Users} color="blue" />
         <StatCard title="Employés actifs" value={stats.active} icon={UserCheck} color="green" />
         <StatCard title="Sortis / Inactifs" value={stats.inactive} icon={UserX} color="orange" />
         <StatCard title="Sites représentés" value={stats.sites} icon={MapPin} color="indigo" />
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
                  placeholder="Nom, matricule, email..." 
                  className="h-9 pl-8 text-xs bg-background rounded-xl border-primary/10" 
                  value={filters.search}
                  onChange={(e) => handleUpdateFilter('search', e.target.value)}
                />
              </div>

              {/* Position Filter */}
              <FilterDropdown 
                label="Poste" 
                value={filters.jobTitle} 
                onValueChange={(v) => handleUpdateFilter('jobTitle', v)}
                options={uniqueJobTitles.map(t => ({ label: t, value: t }))}
              />

              {/* Status Filter */}
              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => handleUpdateFilter('status', v)}
                options={uniqueStatuses.map(s => ({ label: s.toUpperCase(), value: s }))}
              />

              {/* Site Filter */}
              <FilterDropdown 
                label="Site" 
                value={filters.site} 
                onValueChange={(v) => handleUpdateFilter('site', v)}
                options={uniqueSites.map(s => ({ label: s, value: s }))}
              />

              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setFilters(initialFilters)} 
                className="h-9 text-xs text-muted-foreground hover:text-primary rounded-xl"
              >
                <RefreshCcw className="w-3.5 h-3.5 mr-2" />
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Result Count Indicator */}
          <div className="flex items-center justify-between px-1">
             <div className="flex flex-wrap items-center gap-2">
                {Object.entries(filters).map(([key, value]) => {
                  if (key === 'search' || value === 'all' || !value) return null;
                  return (
                    <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                      {key === 'jobTitle' ? 'Poste: ' : key === 'status' ? 'Statut: ' : 'Site: '} {value}
                      <button onClick={() => handleUpdateFilter(key as keyof Filters, "all")} className="hover:bg-primary/10 rounded-full p-0.5">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  );
                })}
             </div>
             {!loadingEmployees && (
               <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                 {filteredEmployees.length} employé{filteredEmployees.length > 1 ? 's' : ''} trouvé{filteredEmployees.length > 1 ? 's' : ''}
               </span>
             )}
          </div>
        </div>

        {/* Table Container */}
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20 hover:bg-secondary/20">
                <TableHead className="pl-6">Employé</TableHead>
                <TableHead>Poste</TableHead>
                <TableHead>Site / Département</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingEmployees ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucun employé ne correspond aux filtres sélectionnés.</p>
                      <Button variant="outline" size="sm" onClick={() => setFilters(initialFilters)} className="rounded-xl">Voir tout le personnel</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map(e => (
                  <TableRow 
                    key={e.employeeId} 
                    className="group cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}
                  >
                    <TableCell className="pl-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 group-hover:text-primary transition-colors">{e.displayName}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                           <span className="text-[10px] font-mono text-muted-foreground uppercase bg-secondary/30 px-1 rounded flex items-center gap-1">
                             <Fingerprint className="w-2.5 h-2.5" /> {e.employeeCode || "N/A"}
                           </span>
                           {e.email && (
                             <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                               <Mail className="w-2.5 h-2.5 opacity-50" /> {e.email}
                             </span>
                           )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-2">
                         <Briefcase className="w-3.5 h-3.5 text-primary/40" />
                         <span className="text-sm font-semibold text-slate-700">{e.jobTitle || "Non renseigné"}</span>
                       </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-primary/30" />
                          <span className="text-xs font-bold text-slate-800">{e.worksiteName || "Non renseigné"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 opacity-60">
                           <Building2 className="w-3 h-3 text-primary/30" />
                           <span className="text-[10px] font-medium uppercase tracking-tight">{e.departmentName || "Sans département"}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(e.status)}
                    </TableCell>
                    <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-8 gap-2 rounded-xl font-bold bg-white hover:bg-primary/5 transition-all shadow-sm"
                        onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Détails
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string, value: number, icon: any, color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-green-50 text-green-600 border-green-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };

  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl group bg-white hover:shadow-md transition-all">
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

function FilterDropdown({ 
  label, 
  value, 
  onValueChange, 
  options 
}: { 
  label: string, 
  value: string, 
  onValueChange: (v: string) => void, 
  options: { label: string, value: string }[] 
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(
        "h-9 w-auto min-w-[140px] text-xs font-medium bg-background rounded-xl border-primary/10",
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

function getStatusBadge(status: string | undefined) {
  const s = (status || "unknown").toLowerCase();
  
  if (['active', 'actif', 'active_contract'].includes(s)) {
    return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white text-[10px] h-5 uppercase font-black">ACTIF</Badge>;
  }
  
  if (['suspended', 'suspendu'].includes(s)) {
    return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] h-5 uppercase font-black">SUSPENDU</Badge>;
  }
  
  if (['terminated', 'sorti', 'inactive', 'inactif'].includes(s)) {
    return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5 uppercase font-black">SORTI</Badge>;
  }

  return <Badge variant="outline" className="text-[10px] h-5 uppercase font-bold text-muted-foreground">{s}</Badge>;
}
