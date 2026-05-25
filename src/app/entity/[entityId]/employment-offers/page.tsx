
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  FileText, Search, Edit, Eye, XCircle, 
  Loader2, Calendar as CalendarIcon, User, 
  Briefcase, MoreVertical, Filter, ListFilter,
  ArrowRight, ShieldCheck, Clock, FilePlus2,
  AlertCircle, Send, CheckCircle2, Ban, X,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, where } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { cancelEmploymentOffer } from "@/services/employment-offer.service";
import { useToast } from "@/hooks/use-toast";
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
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Filters {
  status: string;
  ccnlId: string;
  levelId: string;
  search: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
}

const initialFilters: Filters = {
  status: 'all',
  ccnlId: 'all',
  levelId: 'all',
  search: '',
  dateRange: { from: undefined, to: undefined }
};

type SortField = 'updatedAt' | 'status' | 'candidateDisplayName' | 'jobTitleName' | 'ccnlName' | 'levelCode';

interface SortConfig {
  field: SortField;
  direction: 'asc' | 'desc';
}

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
  if (!d) return "N/A";
  return format(d, "dd/MM/yyyy", { locale: fr });
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  internal_review: "En validation",
  ready_to_send: "Prête à envoyer",
  sent: "Envoyée",
  viewed: "Consultée",
  accepted: "Acceptée",
  declined: "Refusée",
  expired: "Expirée",
  cancelled: "Annulée"
};

export default function EmploymentOffersListPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  // --- UI State ---
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortConfig>({ field: 'updatedAt', direction: 'desc' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // --- Queries ---
  const canRead = hasPermission("contracts.read");
  const canUpdate = hasPermission("contracts.create");

  const offersQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    // We fetch all for client-side filtering/sorting/pagination as per usual pattern
    return query(collection(db, `entities/${entityId}/employmentOffers`), orderBy("updatedAt", "desc"));
  }, [db, entityId, canRead]);

  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active"), orderBy("name", "asc"));
  }, [db, entityId, canRead]);

  const levelsQuery = useMemo(() => {
    if (!db || !entityId || !canRead || filters.ccnlId === 'all') return null;
    return query(collection(db, `entities/${entityId}/ccnls/${filters.ccnlId}/levels`), where("status", "==", "active"), orderBy("levelCode", "asc"));
  }, [db, entityId, canRead, filters.ccnlId]);

  const { data: offers, loading: loadingOffers } = useCollection<EmploymentOffer>(offersQuery);
  const { data: activeCcnls } = useCollection<CCNL>(ccnlsQuery);
  const { data: activeLevels } = useCollection<CCNLLevel>(levelsQuery);

  // --- Filtering & Sorting Logic ---

  const filteredOffers = useMemo(() => {
    if (!offers) return [];

    let result = offers.filter(o => {
      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const match = 
          (o.candidateDisplayName ?? "").toLowerCase().includes(term) ||
          (o.jobTitleName ?? "").toLowerCase().includes(term) ||
          (o.offerId ?? "").toLowerCase().includes(term) ||
          (o.candidateEmail ?? "").toLowerCase().includes(term);
        if (!match) return false;
      }

      // 2. Status
      if (filters.status !== 'all' && o.status !== filters.status) return false;

      // 3. CCNL
      if (filters.ccnlId !== 'all' && o.ccnlId !== filters.ccnlId) return false;

      // 4. Level
      if (filters.levelId !== 'all' && o.levelId !== filters.levelId) return false;

      // 5. Date Range (on updatedAt)
      if (filters.dateRange.from || filters.dateRange.to) {
        const date = parseSafeDate(o.updatedAt);
        if (!date) return false;
        const from = filters.dateRange.from ? startOfDay(filters.dateRange.from) : undefined;
        const to = filters.dateRange.to ? endOfDay(filters.dateRange.to) : undefined;
        if (from && date < from) return false;
        if (to && date > to) return false;
      }

      return true;
    });

    // 6. Sort
    result.sort((a, b) => {
      let valA: any = a[sort.field] ?? "";
      let valB: any = b[sort.field] ?? "";

      if (sort.field === 'updatedAt') {
        const dA = parseSafeDate(valA)?.getTime() || 0;
        const dB = parseSafeDate(valB)?.getTime() || 0;
        return sort.direction === 'asc' ? dA - dB : dB - dA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      if (sort.direction === 'asc') return strA.localeCompare(strB);
      return strB.localeCompare(strA);
    });

    return result;
  }, [offers, filters, sort]);

  // --- Pagination Logic ---
  const totalResults = filteredOffers.length;
  const totalPages = Math.ceil(totalResults / pagination.pageSize);
  const paginatedOffers = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return filteredOffers.slice(start, start + pagination.pageSize);
  }, [filteredOffers, pagination]);

  // --- Handlers ---

  const updateFilter = (key: keyof Filters, value: any) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'ccnlId') next.levelId = 'all'; // Reset level if CCNL changes
      return next;
    });
    setPagination(p => ({ ...p, page: 1 }));
  };

  const removeFilter = (key: keyof Filters) => {
    updateFilter(key, initialFilters[key]);
  };

  const handleToggleSort = (field: SortField) => {
    setSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const executeCancel = async () => {
    if (!cancellingId || !user) return;
    setLoading(true);
    try {
      await cancelEmploymentOffer(entityId, cancellingId, user.uid);
      toast({ title: "Proposition annulée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setCancellingId(null);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Propositions d'embauche</h1>
          <p className="text-muted-foreground text-sm">Gestion des offres contractuelles internes et réponses candidats.</p>
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
                  placeholder="Rechercher candidat, poste..." 
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
                options={Object.entries(STATUS_LABELS).map(([val, label]) => ({ label, value: val }))}
              />

              {/* CCNL Filter */}
              <FilterDropdown 
                label="CCNL" 
                value={filters.ccnlId} 
                onValueChange={(v) => updateFilter('ccnlId', v)}
                options={activeCcnls?.map(c => ({ label: c.name, value: c.ccnlId })) || []}
              />

              {/* Level Filter */}
              <FilterDropdown 
                label="Niveau" 
                value={filters.levelId} 
                onValueChange={(v) => updateFilter('levelId', v)}
                options={activeLevels?.map(l => ({ label: `${l.levelCode} - ${l.label}`, value: l.levelId })) || []}
                disabled={filters.ccnlId === 'all'}
              />

              {/* Date Filter (on Update) */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-medium bg-background">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {filters.dateRange.from ? (
                      filters.dateRange.to ? (
                        <>{format(filters.dateRange.from, "dd/MM")} - {format(filters.dateRange.to, "dd/MM")}</>
                      ) : (
                        format(filters.dateRange.from, "dd/MM/yyyy")
                      )
                    ) : (
                      "Date de modification"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={filters.dateRange.from}
                    selected={{ from: filters.dateRange.from, to: filters.dateRange.to }}
                    onSelect={(range: any) => updateFilter('dateRange', { from: range?.from, to: range?.to })}
                    numberOfMonths={2}
                    locale={fr}
                  />
                </PopoverContent>
              </Popover>

              <Button variant="ghost" size="sm" onClick={() => { setFilters(initialFilters); setPagination(p => ({...p, page: 1})); }} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Active Chips */}
          <div className="flex flex-wrap items-center gap-2 px-1 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || key === 'dateRange' || value === 'all') return null;
              
              let label = value;
              if (key === 'status') label = STATUS_LABELS[value] || value;
              if (key === 'ccnlId') label = activeCcnls?.find(c => c.ccnlId === value)?.name || value;
              if (key === 'levelId') label = activeLevels?.find(l => l.levelId === value)?.levelCode || value;

              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {label}
                  <button onClick={() => removeFilter(key as keyof Filters)} className="hover:bg-primary/10 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            {(filters.dateRange.from || filters.dateRange.to) && (
              <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                Période: {filters.dateRange.from ? format(filters.dateRange.from, "dd/MM") : '?'} - {filters.dateRange.to ? format(filters.dateRange.to, "dd/MM") : '?'}
                <button onClick={() => removeFilter('dateRange')} className="hover:bg-primary/10 rounded-full p-0.5">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            
            {totalResults > 0 && !loadingOffers && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {totalResults} proposition{totalResults > 1 ? 's' : ''} trouvée{totalResults > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-2xl">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead>
                  <SortHeader label="Candidat & Poste" field="candidateDisplayName" currentSort={sort} onSort={handleToggleSort} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Statut" field="status" currentSort={sort} onSort={handleToggleSort} />
                </TableHead>
                <SortableTableCellHeader label="Contrat & Début" />
                <TableHead>
                  <SortHeader label="CCNL / Niveau" field="ccnlName" currentSort={sort} onSort={handleToggleSort} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Modification" field="updatedAt" currentSort={sort} onSort={handleToggleSort} />
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingOffers ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : paginatedOffers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-muted-foreground flex flex-col items-center gap-3">
                    <ListFilter className="h-10 w-10 opacity-20" />
                    <p className="font-medium">Aucune proposition ne correspond à vos critères.</p>
                    <Button variant="outline" size="sm" onClick={() => setFilters(initialFilters)}>Réinitialiser</Button>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedOffers.map((o) => (
                  <TableRow key={o.offerId} className="hover:bg-muted/50 transition-colors group cursor-pointer" onClick={() => router.push(`/entity/${entityId}/employment-offers/${o.offerId}`)}>
                    <TableCell>
                      <div className="font-bold text-primary">{o.candidateDisplayName || "N/A"}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                        <Briefcase className="w-3 h-3" /> {o.jobTitleName || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {getStatusBadge(o.status)}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                         <div className="font-medium text-slate-700">{o.contractType || "N/A"}</div>
                         <div className="flex items-center gap-1 text-muted-foreground text-[10px]">
                            <CalendarIcon className="w-3 h-3" /> 
                            Début: {o.proposedStartDate || "N/A"}
                         </div>
                      </div>
                    </TableCell>
                    <TableCell>
                       {o.ccnlName ? (
                         <div className="space-y-1">
                            <div className="text-[10px] font-bold text-primary truncate max-w-[150px]">{o.ccnlName}</div>
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{o.levelCode || "—"}</Badge>
                         </div>
                       ) : (
                         <span className="text-[10px] text-muted-foreground italic">Non renseigné</span>
                       )}
                    </TableCell>
                    <TableCell>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {o.updatedAt ? format(parseSafeDate(o.updatedAt)!, "dd/MM HH:mm", { locale: fr }) : "N/A"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/employment-offers/${o.offerId}`)} className="gap-2">
                             <Edit className="w-4 h-4" /> Modifier / Consulter
                          </DropdownMenuItem>
                          {canUpdate && !["cancelled", "accepted", "declined"].includes(o.status) && (
                            <DropdownMenuItem onClick={() => setCancellingId(o.offerId)} className="gap-2 text-destructive">
                               <Ban className="w-4 h-4" /> Annuler la proposition
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination Footer */}
          {!loadingOffers && filteredOffers.length > 0 && (
            <div className="border-t bg-secondary/10 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Lignes par page:</span>
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

      <AlertDialog open={!!cancellingId} onOpenChange={() => setCancellingId(null)}>
        <AlertDialogContent className="rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler la proposition ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action marquera la proposition comme annulée. Elle ne sera plus accessible pour le candidat.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Retour</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeCancel(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortHeader({ label, field, currentSort, onSort }: { label: string, field: SortField, currentSort: SortConfig, onSort: (f: SortField) => void }) {
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

function SortableTableCellHeader({ label }: { label: string }) {
  return (
    <TableHead className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">
      {label}
    </TableHead>
  );
}

function FilterDropdown({ 
  label, 
  value, 
  onValueChange, 
  options,
  disabled = false
}: { 
  label: string, 
  value: string, 
  onValueChange: (v: string) => void, 
  options: { label: string, value: string }[],
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
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

function getStatusBadge(status: EmploymentOfferStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700">En revue</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700">Prête</Badge>;
    case 'sent': return <Badge variant="secondary" className="bg-primary text-white border-none">Envoyée</Badge>;
    case 'viewed': return <Badge variant="secondary" className="bg-cyan-500 text-white border-none">Consultée</Badge>;
    case 'accepted': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white font-black">ACCEPTÉE</Badge>;
    case 'declined': return <Badge variant="destructive" className="bg-red-500 border-none">REFUSÉE</Badge>;
    case 'expired': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Expirée</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}
