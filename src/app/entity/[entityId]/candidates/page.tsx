"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Search, UserPlus, Edit, PowerOff, RefreshCcw, 
  Loader2, Mail, Briefcase, AlertCircle, MoreVertical, Globe, User,
  LayoutDashboard, X, Filter, ChevronRight, Calendar as CalendarIcon,
  Building2, MapPin, ListFilter, Trash2, ChevronDown, Download,
  ChevronUp, ChevronLeft, ListFilter as ListFilterIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  createCandidate, 
  updateCandidate, 
  disableCandidate, 
  reactivateCandidate 
} from "@/services/candidate.service";
import { Candidate, CandidateStatus, CANDIDATE_STATUS_LABELS } from "@/types/candidate";
import { Person } from "@/types/person";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CandidateApplicationPanel } from "@/components/candidates/CandidateApplicationPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { fr } from "date-fns/locale";

const initialForm = {
  personId: "",
  positionApplied: "",
  department: "",
  source: "manual",
  applicationDate: new Date().toISOString().split('T')[0],
  availabilityDate: "",
  expectedSalary: "",
  status: "new" as CandidateStatus,
  notes: ""
};

type GroupByType = 'none' | 'status' | 'job' | 'department' | 'worksite' | 'status_then_job';

interface Filters {
  status: string;
  job: string;
  department: string;
  worksite: string;
  source: string;
  search: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
}

const initialFilters: Filters = {
  status: 'all',
  job: 'all',
  department: 'all',
  worksite: 'all',
  source: 'all',
  search: '',
  dateRange: { from: undefined, to: undefined }
};

type SortConfig = {
  field: keyof Candidate | 'displayName';
  direction: 'asc' | 'desc' | null;
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
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDateDisplay(val: any): string {
  const d = parseSafeDate(val);
  if (!d) return "Date non disponible";
  return format(d, "dd/MM/yyyy", { locale: fr });
}

export default function CandidatesManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const isMobile = useIsMobile();
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // --- UI State ---
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // --- Table UX State ---
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [sort, setSort] = useState<SortConfig>({ field: 'applicationDate', direction: 'desc' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });

  // Permissions
  const canRead = hasPermission("candidates.read");
  const canCreate = hasPermission("candidates.create");
  const canUpdate = hasPermission("candidates.update");
  const canReadPersons = hasPermission("persons.read");

  // Queries
  const candidatesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/candidates`), orderBy("createdAt", "desc")) as Query<Candidate>;
  }, [db, entityId, canRead]);

  const personsQuery = useMemo(() => {
    if (!db || !entityId || !canReadPersons) return null;
    return query(collection(db, `entities/${entityId}/persons`), orderBy("lastName", "asc")) as Query<Person>;
  }, [db, entityId, canReadPersons]);

  const { data: candidates, loading: loadingCandidates } = useCollection<Candidate>(candidatesQuery);
  const { data: persons, loading: loadingPersons } = useCollection<Person>(personsQuery);

  // --- Logic Chains ---

  // 1. Filtering Logic
  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    
    return candidates.filter(c => {
      // Search
      if (filters.search) {
        const search = filters.search.toLowerCase().trim();
        const matchesSearch = 
          c.displayName?.toLowerCase().includes(search) ||
          c.email?.toLowerCase().includes(search) ||
          c.phone?.toLowerCase().includes(search) ||
          c.positionApplied?.toLowerCase().includes(search) ||
          c.department?.toLowerCase().includes(search) ||
          c.source?.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Status
      if (filters.status !== 'all' && c.status !== filters.status) return false;
      
      // Job
      if (filters.job !== 'all' && (c.positionApplied || 'Non renseigné') !== filters.job) return false;

      // Department
      if (filters.department !== 'all' && (c.department || 'Non renseigné') !== filters.department) return false;

      // Worksite
      const worksiteName = (c as any).worksiteNameSnapshot || (c as any).worksiteName || 'Non renseigné';
      if (filters.worksite !== 'all' && worksiteName !== filters.worksite) return false;

      // Source
      if (filters.source !== 'all' && (c.source || 'Non renseigné') !== filters.source) return false;

      // Date Range
      if (filters.dateRange.from || filters.dateRange.to) {
        const cDate = parseSafeDate(c.applicationDate || c.createdAt);
        if (!cDate) return false;
        const from = filters.dateRange.from ? startOfDay(filters.dateRange.from) : undefined;
        const to = filters.dateRange.to ? endOfDay(filters.dateRange.to) : undefined;

        if (from && cDate < from) return false;
        if (to && cDate > to) return false;
      }

      return true;
    });
  }, [candidates, filters]);

  // 2. Sorting Logic
  const sortedCandidates = useMemo(() => {
    if (!sort.field || !sort.direction) return filteredCandidates;

    return [...filteredCandidates].sort((a, b) => {
      let valA: any = a[sort.field as keyof Candidate] ?? "";
      let valB: any = b[sort.field as keyof Candidate] ?? "";

      if (sort.field === 'displayName') {
        valA = a.displayName ?? "";
        valB = b.displayName ?? "";
      }

      // Date handling
      if (sort.field === 'applicationDate' || sort.field === 'createdAt' || sort.field === 'updatedAt') {
        const dateA = parseSafeDate(valA)?.getTime() || 0;
        const dateB = parseSafeDate(valB)?.getTime() || 0;
        return sort.direction === 'asc' ? dateA - dateB : dateB - dateA;
      }

      // String comparison
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();

      if (sort.direction === 'asc') return strA.localeCompare(strB);
      return strB.localeCompare(strA);
    });
  }, [filteredCandidates, sort]);

  // 3. Pagination Logic
  const totalResults = sortedCandidates.length;
  const totalPages = Math.ceil(totalResults / pagination.pageSize);
  const paginatedCandidates = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return sortedCandidates.slice(start, start + pagination.pageSize);
  }, [sortedCandidates, pagination]);

  // Reset pagination on filter change
  useEffect(() => {
    setPagination(p => ({ ...p, page: 1 }));
  }, [filters, pagination.pageSize, sort]);

  // 4. Grouping Logic (Applied to Paginated Set for consistency, or Filtered Set depending on preference)
  // Standard UX: Grouping usually applies to the visible page OR the whole set. 
  // Here we group the PAGINATED results to keep the UI clean if pagination is used.
  const groupedData = useMemo(() => {
    if (groupBy === 'none') return null;

    const groups: Record<string, any> = {};

    paginatedCandidates.forEach(c => {
      let key = 'Non renseigné';
      
      if (groupBy === 'status') key = CANDIDATE_STATUS_LABELS[c.status as CandidateStatus] || c.status;
      else if (groupBy === 'job') key = c.positionApplied || 'Non renseigné';
      else if (groupBy === 'department') key = c.department || 'Non renseigné';
      else if (groupBy === 'worksite') key = (c as any).worksiteNameSnapshot || (c as any).worksiteName || 'Non renseigné';
      else if (groupBy === 'status_then_job') {
        const statusKey = CANDIDATE_STATUS_LABELS[c.status as CandidateStatus] || c.status;
        const jobKey = c.positionApplied || 'Non renseigné';
        if (!groups[statusKey]) groups[statusKey] = {};
        if (!groups[statusKey][jobKey]) groups[statusKey][jobKey] = [];
        groups[statusKey][jobKey].push(c);
        return;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    return groups;
  }, [paginatedCandidates, groupBy]);

  // Dynamic values for dropdowns
  const uniqueJobs = useMemo(() => Array.from(new Set(candidates?.map(c => c.positionApplied || 'Non renseigné') || [])).sort(), [candidates]);
  const uniqueDepts = useMemo(() => Array.from(new Set(candidates?.map(c => c.department || 'Non renseigné') || [])).sort(), [candidates]);
  const uniqueWorksites = useMemo(() => Array.from(new Set(candidates?.map(c => (c as any).worksiteNameSnapshot || (c as any).worksiteName || 'Non renseigné') || [])).sort(), [candidates]);
  const uniqueSources = useMemo(() => Array.from(new Set(candidates?.map(c => c.source || 'Non renseigné') || [])).sort(), [candidates]);

  // --- Handlers ---

  const handleUpdateFilter = (key: keyof Filters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleRemoveFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: initialFilters[key] }));
  };

  const handleResetFilters = () => setFilters(initialFilters);

  const handleToggleSort = (field: keyof Candidate | 'displayName') => {
    setSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleExportCSV = () => {
    if (sortedCandidates.length === 0) return;

    const headers = [
      "Nom complet", "Email", "Téléphone", "Poste", "Département", 
      "Site / Localisation", "Statut", "Source", "Date de candidature"
    ];

    const rows = sortedCandidates.map(c => [
      c.displayName || "Non renseigné",
      c.email || "Non renseigné",
      c.phone || "Non renseigné",
      c.positionApplied || "Non renseigné",
      c.department || "Non renseigné",
      (c as any).worksiteNameSnapshot || (c as any).worksiteName || "Non renseigné",
      CANDIDATE_STATUS_LABELS[c.status] || c.status,
      c.source || "Non renseigné",
      formatDateDisplay(c.applicationDate || c.createdAt)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const dateStr = format(new Date(), "yyyy-MM-dd");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `candidats_${dateStr}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleResetForm = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (c: Candidate) => {
    setFormData({
      personId: c.personId,
      positionApplied: c.positionApplied,
      department: c.department || "",
      source: c.source || "manual",
      applicationDate: c.applicationDate || "",
      availabilityDate: c.availabilityDate || "",
      expectedSalary: c.expectedSalary || "",
      status: c.status || "new",
      notes: c.notes || ""
    });
    setEditingId(c.candidateId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      if (editingId) {
        await updateCandidate(entityId, editingId, formData, user.uid);
        toast({ title: "Mis à jour", description: "La candidature a été modifiée." });
      } else {
        await createCandidate(entityId, formData.personId, formData, user.uid);
        toast({ title: "Créée", description: "La candidature a été enregistrée." });
      }
      handleResetForm();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmDisable = async () => {
    if (!disablingId || !user) return;
    setLoading(true);
    try {
      await disableCandidate(entityId, disablingId, user.uid);
      toast({ title: "Désactivée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setDisablingId(null);
    }
  };

  const confirmReactivate = async () => {
    if (!reactivatingId || !user) return;
    setLoading(true);
    try {
      await reactivateCandidate(entityId, reactivatingId, user.uid);
      toast({ title: "Réactivée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="p-8 pb-4 shrink-0 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-headline font-bold text-primary">Pipeline Candidats</h1>
            <p className="text-muted-foreground text-sm">Gestion avancée et suivi du flux de recrutement.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleExportCSV} className="gap-2 bg-white" disabled={sortedCandidates.length === 0}>
               <Download className="w-4 h-4" /> Exporter CSV
            </Button>
            {canCreate && (
              <Button onClick={() => setIsFormVisible(true)} className="gap-2 shadow-lg shadow-primary/10">
                <UserPlus className="w-4 h-4" /> Nouvelle candidature
              </Button>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="space-y-4">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-3 p-1">
              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input 
                  placeholder="Rechercher..." 
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                  value={filters.search}
                  onChange={(e) => handleUpdateFilter('search', e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => handleUpdateFilter('status', v)}
                options={Object.keys(CANDIDATE_STATUS_LABELS).map(s => ({ label: CANDIDATE_STATUS_LABELS[s as CandidateStatus], value: s }))}
              />

              {/* Job Filter */}
              <FilterDropdown 
                label="Poste" 
                value={filters.job} 
                onValueChange={(v) => handleUpdateFilter('job', v)}
                options={uniqueJobs.map(j => ({ label: j, value: j }))}
              />

              {/* Dept Filter */}
              <FilterDropdown 
                label="Département" 
                value={filters.department} 
                onValueChange={(v) => handleUpdateFilter('department', v)}
                options={uniqueDepts.map(d => ({ label: d, value: d }))}
              />

              {/* Worksite Filter */}
              <FilterDropdown 
                label="Site" 
                value={filters.worksite} 
                onValueChange={(v) => handleUpdateFilter('worksite', v)}
                options={uniqueWorksites.map(w => ({ label: w, value: w }))}
              />

              {/* Source Filter */}
              <FilterDropdown 
                label="Source" 
                value={filters.source} 
                onValueChange={(v) => handleUpdateFilter('source', v)}
                options={uniqueSources.map(s => ({ label: s === 'public_application_form' ? 'Formulaire public' : s, value: s }))}
              />

              {/* Date Filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-medium bg-white">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {filters.dateRange.from ? (
                      filters.dateRange.to ? (
                        <>
                          {format(filters.dateRange.from, "dd/MM")} - {format(filters.dateRange.to, "dd/MM")}
                        </>
                      ) : (
                        format(filters.dateRange.from, "dd/MM/yyyy")
                      )
                    ) : (
                      "Date de candidature"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={filters.dateRange.from}
                    selected={{ from: filters.dateRange.from, to: filters.dateRange.to }}
                    onSelect={(range: any) => handleUpdateFilter('dateRange', { from: range?.from, to: range?.to })}
                    numberOfMonths={2}
                    locale={fr}
                  />
                </PopoverContent>
              </Popover>

              <div className="h-9 w-px bg-border mx-2" />

              {/* Group By Control */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Grouper par</span>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupByType)}>
                  <SelectTrigger className="h-9 w-40 text-xs font-bold bg-secondary/30">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    <SelectItem value="status">Pipeline (Statut)</SelectItem>
                    <SelectItem value="job">Poste / Métier</SelectItem>
                    <SelectItem value="department">Département</SelectItem>
                    <SelectItem value="worksite">Site / Localisation</SelectItem>
                    <SelectItem value="status_then_job">Statut {'>'} Poste</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button variant="ghost" size="sm" onClick={handleResetFilters} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Active Filter Chips */}
          <div className="flex flex-wrap gap-2 px-1 min-h-[32px] items-center">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || key === 'dateRange' || value === 'all') return null;
              
              let label = value;
              if (key === 'status') label = CANDIDATE_STATUS_LABELS[value as CandidateStatus] || value;
              if (key === 'source' && value === 'public_application_form') label = 'Formulaire public';

              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {label}
                  <button onClick={() => handleRemoveFilter(key as keyof Filters)} className="hover:bg-primary/10 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            {(filters.dateRange.from || filters.dateRange.to) && (
              <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                Période: {filters.dateRange.from ? format(filters.dateRange.from, "dd/MM") : '?'} - {filters.dateRange.to ? format(filters.dateRange.to, "dd/MM") : '?'}
                <button onClick={() => handleUpdateFilter('dateRange', { from: undefined, to: undefined })} className="hover:bg-primary/10 rounded-full p-0.5">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            
            {totalResults > 0 && !loadingCandidates && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {totalResults} candidat{totalResults > 1 ? 's' : ''} trouvé{totalResults > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden p-8 pt-0 gap-8">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <Card className="flex-1 min-h-0 flex flex-col overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
            <ScrollArea className="flex-1">
              {loadingCandidates ? (
                <div className="py-20 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>
              ) : filteredCandidates.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-3">
                  <ListFilterIcon className="h-10 w-10 opacity-20" />
                  <p className="font-medium">Aucun candidat ne correspond à vos critères.</p>
                  <Button variant="outline" size="sm" onClick={handleResetFilters}>Effacer les filtres</Button>
                </div>
              ) : groupBy === 'none' ? (
                <CandidateTable 
                  candidates={paginatedCandidates} 
                  selectedId={selectedCandidate?.candidateId} 
                  onSelect={setSelectedCandidate}
                  canUpdate={canUpdate}
                  onEdit={handleEdit}
                  onDisable={setDisablingId}
                  onReactivate={setReactivatingId}
                  sort={sort}
                  onSort={handleToggleSort}
                />
              ) : (
                <div className="p-4 space-y-4">
                  <Accordion type="multiple" defaultValue={Object.keys(groupedData || {})} className="space-y-4">
                    {Object.entries(groupedData || {}).map(([groupName, content]) => {
                      const count = groupBy === 'status_then_job' 
                        ? Object.values(content).reduce((sum: number, arr: any) => sum + arr.length, 0)
                        : (content as any[]).length;

                      return (
                        <AccordionItem key={groupName} value={groupName} className="border rounded-2xl bg-card overflow-hidden">
                          <AccordionTrigger className="hover:no-underline px-6 py-4 bg-secondary/10">
                            <div className="flex items-center gap-3">
                              <span className="font-black text-sm uppercase tracking-wider text-primary">{groupName}</span>
                              <Badge variant="secondary" className="h-5 px-1.5 min-w-[1.5rem] flex items-center justify-center font-bold">{count}</Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-0">
                            {groupBy === 'status_then_job' ? (
                              <div className="space-y-4 p-4">
                                {Object.entries(content).map(([jobName, candidatesList]: [string, any]) => (
                                  <div key={jobName} className="space-y-2">
                                    <div className="flex items-center gap-2 px-2">
                                      <Briefcase className="h-3 w-3 text-muted-foreground" />
                                      <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{jobName} ({candidatesList.length})</span>
                                    </div>
                                    <div className="border rounded-xl overflow-hidden">
                                      <CandidateTable 
                                        candidates={candidatesList} 
                                        selectedId={selectedCandidate?.candidateId} 
                                        onSelect={setSelectedCandidate}
                                        canUpdate={canUpdate}
                                        onEdit={handleEdit}
                                        onDisable={setDisablingId}
                                        onReactivate={setReactivatingId}
                                        compact
                                        sort={sort}
                                        onSort={handleToggleSort}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <CandidateTable 
                                candidates={content as any[]} 
                                selectedId={selectedCandidate?.candidateId} 
                                onSelect={setSelectedCandidate}
                                canUpdate={canUpdate}
                                onEdit={handleEdit}
                                onDisable={setDisablingId}
                                onReactivate={setReactivatingId}
                                sort={sort}
                                onSort={handleToggleSort}
                              />
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              )}
            </ScrollArea>
            
            {/* Pagination Footer */}
            {!loadingCandidates && filteredCandidates.length > 0 && (
              <div className="border-t bg-secondary/10 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Lignes par page:</span>
                    <Select 
                      value={String(pagination.pageSize)} 
                      onValueChange={(v) => setPagination(p => ({ ...p, pageSize: Number(v), page: 1 }))}
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

      {/* Review Side Drawer */}
      <Sheet open={!!selectedCandidate} onOpenChange={(open) => !open && setSelectedCandidate(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[620px] p-0 flex flex-col gap-0 border-l shadow-2xl">
          <SheetHeader className="px-8 py-6 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-left font-black uppercase text-primary tracking-widest text-xs flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" /> Revue de candidature
              </SheetTitle>
            </div>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <CandidateApplicationPanel 
               entityId={entityId} 
               candidate={selectedCandidate} 
               onStatusUpdate={(updated) => setSelectedCandidate(updated)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Form & Confirmation Dialogs */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleResetForm()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier la candidature" : "Nouvelle candidature"}</DialogTitle>
            <DialogDescription>Rattachez un profil à un processus de recrutement.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            {!editingId && (
              <div className="space-y-2">
                <Label htmlFor="personId">Personne concernée</Label>
                <Select value={formData.personId} onValueChange={(v) => setFormData(p => ({...p, personId: v}))}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingPersons ? "Chargement..." : "Sélectionner une personne active"} />
                  </SelectTrigger>
                  <SelectContent>
                    {persons?.filter(p => p.status === 'active' && !p.currentCandidateId && !p.currentEmployeeId).map(p => (
                      <SelectItem key={p.personId} value={p.personId}>
                        {p.displayName} ({p.codiceFiscale})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="positionApplied">Poste visé</Label>
                <Input id="positionApplied" value={formData.positionApplied} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Département</Label>
                <Input id="department" value={formData.department} onChange={handleInputChange} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Input id="source" value={formData.source} onChange={handleInputChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Statut</Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(v) => setFormData(p => ({...p, status: v as CandidateStatus}))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(CANDIDATE_STATUS_LABELS).map(s => (
                      <SelectItem key={s} value={s}>{CANDIDATE_STATUS_LABELS[s as CandidateStatus]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="applicationDate">Date de candidature</Label>
                <Input id="applicationDate" type="date" value={formData.applicationDate} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedSalary">Prétention Salariale</Label>
                <Input id="expectedSalary" value={formData.expectedSalary} onChange={handleInputChange} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Internes</Label>
              <Input id="notes" value={formData.notes} onChange={handleInputChange} />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleResetForm} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer" : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!disablingId} onOpenChange={() => setDisablingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
            <AlertDialogDescription>Le candidat sera marqué comme inactif.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDisable(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivatingId} onOpenChange={() => setReactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la réactivation</AlertDialogTitle>
            <AlertDialogDescription>Souhaitez-vous réactiver ce candidat ?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmReactivate(); }} className="bg-green-600 hover:bg-green-700" disabled={loading}>
              Réactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterDropdown({ label, value, onValueChange, options }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(
        "h-9 w-auto min-w-[140px] text-xs font-medium bg-white",
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
  const s = (status || "new") as CandidateStatus;
  switch (s) {
    case 'new': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Nouveau</Badge>;
    case 'under_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">En revue</Badge>;
    case 'shortlisted': return <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200">Présélectionné</Badge>;
    case 'interview_to_schedule': return <Badge variant="secondary" className="bg-cyan-50 text-cyan-700 border-cyan-200">À planifier</Badge>;
    case 'interview_scheduled': return <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200">Planifié</Badge>;
    case 'interview_completed': return <Badge variant="secondary" className="bg-teal-50 text-teal-700 border-teal-200">Réalisé</Badge>;
    case 'accepted': return <Badge className="bg-green-600 hover:bg-green-700 border-none">Accepté</Badge>;
    case 'rejected': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Refusé</Badge>;
    case 'hired': return <Badge className="bg-slate-900 hover:bg-black border-none text-white">Embauché</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-slate-50 text-slate-400 border-slate-200">Archivé</Badge>;
    case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
    default: return <Badge variant="outline">{s}</Badge>;
  }
}

function CandidateTable({ 
  candidates, 
  selectedId, 
  onSelect, 
  canUpdate, 
  onEdit, 
  onDisable, 
  onReactivate,
  compact = false,
  sort,
  onSort
}: { 
  candidates: Candidate[], 
  selectedId?: string, 
  onSelect: (c: Candidate) => void, 
  canUpdate: boolean, 
  onEdit: (c: Candidate) => void, 
  onDisable: (id: string) => void, 
  onReactivate: (id: string) => void,
  compact?: boolean,
  sort: SortConfig,
  onSort: (field: keyof Candidate | 'displayName') => void
}) {
  return (
    <Table>
      <TableHeader className={cn("sticky top-0 z-10 bg-secondary/20", compact && "hidden")}>
        <TableRow>
          <TableHead className="w-[30%]">
            <SortableHeader label="Candidat" field="displayName" currentSort={sort} onSort={onSort} />
          </TableHead>
          <TableHead className="hidden md:table-cell">
            <SortableHeader label="Poste / Dept" field="positionApplied" currentSort={sort} onSort={onSort} />
          </TableHead>
          <TableHead className="hidden sm:table-cell">
            <SortableHeader label="Statut" field="status" currentSort={sort} onSort={onSort} />
          </TableHead>
          <TableHead className="hidden lg:table-cell text-center">
            <SortableHeader label="Source" field="source" currentSort={sort} onSort={onSort} />
          </TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((c) => (
          <TableRow 
            key={c.candidateId} 
            onClick={() => onSelect(c)}
            className={cn(
              "cursor-pointer transition-colors", 
              selectedId === c.candidateId ? "bg-primary/5 hover:bg-primary/5" : "hover:bg-muted/50",
              compact && "h-12"
            )}
          >
            <TableCell>
              <div className="font-bold text-primary truncate max-w-[180px]">{c.displayName}</div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                <Mail className="h-2.5 w-2.5" /> {c.email || "Non renseigné"}
              </div>
              {compact && <div className="md:hidden mt-1">{getStatusBadge(c.status)}</div>}
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <div className="flex items-center gap-1.5 font-bold text-[11px] text-primary">
                {c.positionApplied || "Non renseigné"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase mt-0.5">{c.department || "Non renseigné"}</div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              {getStatusBadge(c.status)}
            </TableCell>
            <TableCell className="hidden lg:table-cell text-center">
               {c.source === 'public_application_form' ? (
                 <Badge variant="outline" className="text-[8px] uppercase border-accent/20 text-accent font-black h-4 px-1">Web</Badge>
               ) : (
                 <Badge variant="outline" className="text-[8px] uppercase h-4 px-1">{c.source || "HR"}</Badge>
               )}
            </TableCell>
            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onSelect(c)}>
                   <ChevronRight className="h-4 w-4" />
                </Button>
                {canUpdate && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(c)} className="gap-2">
                        <Edit className="w-3.5 h-3.5" /> Modifier
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {c.status !== 'inactive' ? (
                        <DropdownMenuItem onClick={() => onDisable(c.candidateId)} className="gap-2 text-destructive">
                          <PowerOff className="w-3.5 h-3.5" /> Désactiver
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => onReactivate(c.candidateId)} className="gap-2 text-green-600">
                          <RefreshCcw className="w-3.5 h-3.5" /> Réactiver
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortableHeader({ label, field, currentSort, onSort }: { label: string, field: keyof Candidate | 'displayName', currentSort: SortConfig, onSort: (field: any) => void }) {
  const isActive = currentSort.field === field;
  return (
    <button 
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-1 hover:text-primary transition-colors uppercase text-[10px] font-black tracking-widest",
        isActive ? "text-primary" : "text-muted-foreground"
      )}
    >
      {label}
      {isActive ? (
        currentSort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      ) : (
        <div className="w-3 h-3 opacity-20"><ChevronUp className="w-3 h-3" /></div>
      )}
    </button>
  );
}
