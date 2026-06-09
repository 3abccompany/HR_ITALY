"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Users, Search, UserCheck, Loader2, 
  ChevronRight, ListFilter, Filter, X,
  Building2, MapPin, Calendar, Briefcase, Eye
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
  department: string;
  site: string;
}

const initialFilters: Filters = {
  search: "",
  status: "active",
  department: "all",
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

  // Query - Minimal list using 'employees' directly for basic implementation
  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`), orderBy("hireDate", "desc"));
  }, [db, entityId, canRead, permissionsReady]);

  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery);

  // Derived unique options for filters
  const uniqueDepts = useMemo(() => Array.from(new Set(employees?.map(e => e.departmentName || "Non renseigné") || [])).sort(), [employees]);
  const uniqueSites = useMemo(() => Array.from(new Set(employees?.map(e => e.worksiteName || "Non renseigné") || [])).sort(), [employees]);

  // Filtering Logic
  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    
    return employees.filter(e => {
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const match = 
          e.displayName?.toLowerCase().includes(term) ||
          e.employeeCode?.toLowerCase().includes(term) ||
          e.jobTitle?.toLowerCase().includes(term) ||
          e.email?.toLowerCase().includes(term);
        if (!match) return false;
      }
      if (filters.status !== "all" && e.status !== filters.status) return false;
      if (filters.department !== "all" && (e.departmentName || "Non renseigné") !== filters.department) return false;
      if (filters.site !== "all" && (e.worksiteName || "Non renseigné") !== filters.site) return false;
      return true;
    });
  }, [employees, filters]);

  // Pagination
  const totalResults = filteredEmployees.length;
  const paginatedEmployees = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return filteredEmployees.slice(start, start + pagination.pageSize);
  }, [filteredEmployees, pagination]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(p => ({ ...p, page: 1 }));
  };

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Employés</h1>
          <p className="text-muted-foreground text-sm">Registre du personnel et fiches collaborateurs.</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Filter Bar */}
        <div className="flex flex-col gap-4">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-3 p-1">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input 
                  placeholder="Rechercher nom, code, poste..." 
                  className="h-9 pl-8 text-xs bg-background" 
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                />
              </div>

              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => updateFilter('status', v)}
                options={[
                  { label: "Actif", value: "active" },
                  { label: "Suspendu", value: "suspended" },
                  { label: "Terminé", value: "terminated" }
                ]}
              />

              <FilterDropdown 
                label="Département" 
                value={filters.department} 
                onValueChange={(v) => updateFilter('department', v)}
                options={uniqueDepts.map(d => ({ label: d, value: d }))}
              />

              <FilterDropdown 
                label="Site" 
                value={filters.site} 
                onValueChange={(v) => updateFilter('site', v)}
                options={uniqueSites.map(s => ({ label: s, value: s }))}
              />

              <Button variant="ghost" size="sm" onClick={() => setFilters(initialFilters)} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <div className="flex flex-wrap items-center gap-2 px-1 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || value === 'all' || !value) return null;
              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {value}
                  <button onClick={() => updateFilter(key as keyof Filters, "all")} className="hover:bg-primary/10 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            {totalResults > 0 && !loadingEmployees && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {totalResults} employé{totalResults > 1 ? 's' : ''} trouvé{totalResults > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Employé</TableHead>
                <TableHead>Poste & Dept</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Date Embauche</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingEmployees ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <Users className="h-10 w-10 opacity-20" />
                      <p>Aucun employé trouvé.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedEmployees.map((e) => (
                  <TableRow key={e.employeeId} className="hover:bg-muted/50 transition-colors group cursor-pointer" onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}>
                    <TableCell>
                      <div className="font-bold text-primary">{e.displayName}</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{e.employeeCode}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-bold text-slate-700">{e.jobTitle || "Non renseigné"}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{e.departmentName || "Non renseigné"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <MapPin className="w-3 h-3 text-muted-foreground" /> {e.worksiteName || "Non renseigné"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Calendar className="w-3 h-3 text-muted-foreground" /> {e.hireDate || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(e.status)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 gap-2 rounded-lg font-bold shadow-sm"
                          onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}
                        >
                          <Eye className="w-3.5 h-3.5 text-primary" />
                          <span className="hidden sm:inline">Voir fiche</span>
                        </Button>
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

function getStatusBadge(status: string) {
  switch (status) {
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white text-[10px] h-5">Actif</Badge>;
    case 'suspended': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] h-5">Suspendu</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5">Terminé</Badge>;
    default: return <Badge variant="outline" className="text-[10px] h-5">{status}</Badge>;
  }
}
