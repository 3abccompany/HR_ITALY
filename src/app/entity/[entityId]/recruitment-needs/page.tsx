"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Search, Edit, PowerOff, Loader2, 
  Calendar, Building2, MapPin, Users,
  AlertCircle, MoreVertical, Archive, Eye,
  Clock, FileText, Briefcase, FileCode,
  Filter, X, ListFilter, ChevronDown, CheckCircle2,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { cancelRecruitmentNeed, archiveRecruitmentNeed } from "@/services/recruitment-need.service";
import { RecruitmentNeed, RecruitmentNeedStatus } from "@/types/recruitment-need";
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
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComp } from "@/components/ui/calendar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isAfter } from "date-fns";
import { fr } from "date-fns/locale";

interface Filters {
  search: string;
  status: string;
  department: string;
  job: string;
  site: string;
  progression: string;
  emissionDate: string;
  availabilityDate: string;
}

const initialFilters: Filters = {
  search: "",
  status: "all",
  department: "all",
  job: "all",
  site: "all",
  progression: "all",
  emissionDate: "all",
  availabilityDate: "all",
};

/**
 * Safe date parser for mixed formats
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

export default function RecruitmentNeedsPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  // State
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [statusChange, setStatusChange] = useState<{ id: string, action: 'cancel' | 'archive' } | null>(null);
  
  // Pagination State
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });

  // Permissions
  const canRead = hasPermission("recruitmentNeeds.read");
  const canCreate = hasPermission("recruitmentNeeds.create");
  const canUpdate = hasPermission("recruitmentNeeds.update");
  const canCancel = hasPermission("recruitmentNeeds.cancel");
  const canCreateForm = hasPermission("applicationForms.create");

  // Queries
  const needsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    // Hardened: Removed Firestore-side orderBy to ensure visibility of records missing createdAt
    return query(collection(db, `entities/${entityId}/recruitmentNeeds`));
  }, [db, entityId, canRead]);

  const { data: needs, loading: loadingNeeds } = useCollection<RecruitmentNeed>(needsQuery);

  // Utility to get the best site name
  const getResolvedSiteName = (n: RecruitmentNeed) => {
    return n.worksiteName || n.worksiteNameSnapshot || n.siteName || n.location || "Non renseigné";
  };

  // Dynamic Options
  const uniqueDepartments = useMemo(() => 
    Array.from(new Set(needs?.map(n => n.departmentName || "Non renseigné") || [])).sort(),
  [needs]);

  const uniqueJobs = useMemo(() => 
    Array.from(new Set(needs?.map(n => n.jobTitleName || n.jobProfileTitle || "Non renseigné") || [])).sort(),
  [needs]);

  const uniqueSites = useMemo(() => 
    Array.from(new Set(needs?.map(n => getResolvedSiteName(n)) || [])).sort(),
  [needs]);

  // Filtering & Sorting Logic
  const filteredNeeds = useMemo(() => {
    if (!needs) return [];
    
    const result = needs.filter(n => {
      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const site = getResolvedSiteName(n).toLowerCase();
        const matchesSearch = 
          n.jobTitleName?.toLowerCase().includes(term) ||
          n.departmentName?.toLowerCase().includes(term) ||
          site.includes(term) ||
          n.needId.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // 2. Status
      if (filters.status !== "all" && n.status !== filters.status) return false;

      // 3. Department
      if (filters.department !== "all" && (n.departmentName || "Non renseigné") !== filters.department) return false;

      // 4. Job
      if (filters.job !== "all" && (n.jobTitleName || n.jobProfileTitle || "Non renseigné") !== filters.job) return false;

      // 5. Site
      if (filters.site !== "all" && getResolvedSiteName(n) !== filters.site) return false;

      // 6. Progression
      if (filters.progression !== "all") {
        const fullfilled = n.fulfilledHeadcount || 0;
        const requested = n.requestedHeadcount || 1;
        if (filters.progression === "no_candidate" && fullfilled !== 0) return false;
        if (filters.progression === "in_progress" && (fullfilled === 0 || fullfilled >= requested)) return false;
        if (filters.progression === "complete" && fullfilled < requested) return false;
      }

      // 7. Emission Date (createdAt)
      if (filters.emissionDate !== "all") {
        const date = parseSafeDate(n.createdAt);
        if (!date) return false;
        const now = new Date();
        if (filters.emissionDate === "today" && !isWithinInterval(date, { start: startOfDay(now), end: endOfDay(now) })) return false;
        if (filters.emissionDate === "this_week" && !isWithinInterval(date, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) })) return false;
        if (filters.emissionDate === "this_month" && !isWithinInterval(date, { start: startOfMonth(now), end: endOfMonth(now) })) return false;
      }

      // 8. Availability Date (desiredAvailabilityDate)
      if (filters.availabilityDate !== "all") {
        const date = parseSafeDate(n.desiredAvailabilityDate);
        if (!date) return false;
        const now = new Date();
        if (filters.availabilityDate === "late" && isAfter(now, date) && n.status !== "fulfilled") return false;
        if (filters.availabilityDate === "this_week" && !isWithinInterval(date, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) })) return false;
        if (filters.availabilityDate === "this_month" && !isWithinInterval(date, { start: startOfMonth(now), end: endOfMonth(now) })) return false;
        if (filters.availabilityDate === "upcoming" && !isAfter(date, now)) return false;
      }

      return true;
    });

    // Hardened: Descending chronological sorting in memory
    result.sort((a, b) => {
      const dateA = parseSafeDate(a.createdAt || a.updatedAt || a.issueDate || 0)?.getTime() || 0;
      const dateB = parseSafeDate(b.createdAt || b.updatedAt || b.issueDate || 0)?.getTime() || 0;
      return dateB - dateA;
    });

    return result;
  }, [needs, filters]);

  // Pagination Logic
  const totalResults = filteredNeeds.length;
  const totalPages = Math.ceil(totalResults / pagination.pageSize);
  const paginatedNeeds = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return filteredNeeds.slice(start, start + pagination.pageSize);
  }, [filteredNeeds, pagination]);

  useEffect(() => {
    setPagination(p => ({ ...p, page: 1 }));
  }, [filters, pagination.pageSize]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const removeFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: initialFilters[key] }));
  };

  const resetFilters = () => setFilters(initialFilters);

  const executeStatusChange = async () => {
    if (!statusChange || !user) return;
    setLoading(true);
    try {
      if (statusChange.action === 'cancel') {
        await cancelRecruitmentNeed(entityId, statusChange.id, user.uid);
        toast({ title: "Besoin annulé" });
      } else {
        await archiveRecruitmentNeed(entityId, statusChange.id, user.uid);
        toast({ title: "Besoin archivé" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Ouvert</Badge>;
      case 'partially_fulfilled': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">Partiel</Badge>;
      case 'fulfilled': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white">Pourvu</Badge>;
      case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulé</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Besoins RH</h1>
          <p className="text-muted-foreground text-sm">Ouverture de postes, planification et offres d'emploi.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/recruitment-needs/new`)} className="gap-2 shadow-lg shadow-primary/10">
            <Plus className="w-4 h-4" /> Nouveau besoin RH
          </Button>
        )}
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
                  placeholder="Rechercher..." 
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
                  { label: "Ouvert", value: "open" },
                  { label: "Partiel", value: "partially_fulfilled" },
                  { label: "Pourvu", value: "fulfilled" },
                  { label: "Annulé", value: "cancelled" },
                  { label: "Archivé", value: "archived" }
                ]}
              />

              {/* Department Filter */}
              <FilterDropdown 
                label="Département" 
                value={filters.department} 
                onValueChange={(v) => updateFilter('department', v)}
                options={uniqueDepartments.map(d => ({ label: d, value: d }))}
              />

              {/* Job Filter */}
              <FilterDropdown 
                label="Poste" 
                value={filters.job} 
                onValueChange={(v) => updateFilter('job', v)}
                options={uniqueJobs.map(j => ({ label: j, value: j }))}
              />

              {/* Site Filter */}
              <FilterDropdown 
                label="Site / Localisation" 
                value={filters.site} 
                onValueChange={(v) => updateFilter('site', v)}
                options={uniqueSites.map(s => ({ label: s, value: s }))}
              />

              {/* Progression Filter */}
              <FilterDropdown 
                label="Progression" 
                value={filters.progression} 
                onValueChange={(v) => updateFilter('progression', v)}
                options={[
                  { label: "Aucun candidat", value: "no_candidate" },
                  { label: "En cours", value: "in_progress" },
                  { label: "Complet", value: "complete" }
                ]}
              />

              {/* Emission Date Filter */}
              <FilterDropdown 
                label="Date d'émission" 
                value={filters.emissionDate} 
                onValueChange={(v) => updateFilter('emissionDate', v)}
                options={[
                  { label: "Aujourd'hui", value: "today" },
                  { label: "Cette semaine", value: "this_week" },
                  { label: "Ce mois", value: "this_month" }
                ]}
              />

              {/* Availability Filter */}
              <FilterDropdown 
                label="Date dispo." 
                value={filters.availabilityDate} 
                onValueChange={(v) => updateFilter('availabilityDate', v)}
                options={[
                  { label: "En retard", value: "late" },
                  { label: "Cette semaine", value: "this_week" },
                  { label: "Ce mois", value: "this_month" },
                  { label: "À venir", value: "upcoming" }
                ]}
              />

              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Active Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 px-1 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || value === 'all') return null;
              
              let label = value;
              if (key === 'status') label = value === 'open' ? 'Ouvert' : value === 'partially_fulfilled' ? 'Partiel' : value === 'fulfilled' ? 'Pourvu' : value === 'cancelled' ? 'Annulé' : 'Archivé';
              if (key === 'progression') label = value === 'no_candidate' ? 'Aucun candidat' : value === 'in_progress' ? 'En cours' : 'Complet';
              if (key === 'emissionDate') label = `Émis: ${value.replace('_', ' ')}`;
              if (key === 'availabilityDate') label = `Dispo: ${value.replace('_', ' ')}`;

              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {label}
                  <button onClick={() => removeFilter(key as keyof Filters)} className="hover:bg-primary/10 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            
            {filteredNeeds.length > 0 && !loadingNeeds && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {filteredNeeds.length} besoin{filteredNeeds.length > 1 ? 's' : ''} RH trouvé{filteredNeeds.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Poste & Département</TableHead>
                <TableHead>Site / Localisation</TableHead>
                <TableHead>Progression</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Calendrier</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingNeeds ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : paginatedNeeds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-medium">Aucun besoin ne correspond à vos critères.</p>
                      <Button variant="outline" size="sm" onClick={resetFilters}>Effacer les filtres</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedNeeds.map((n) => {
                  const progress = n.requestedHeadcount > 0 ? ((n.fulfilledHeadcount || 0) / n.requestedHeadcount) * 100 : 0;
                  const siteName = getResolvedSiteName(n);
                  
                  return (
                    <TableRow key={n.needId} className="hover:bg-muted/50 transition-colors">
                      <TableCell>
                        <div className="font-bold text-primary truncate max-w-[200px]">{n.jobTitleName}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                          <Building2 className="w-3 h-3" /> {n.departmentName || "Non renseigné"}
                        </div>
                      </TableCell>
                      <TableCell>
                         <div className="flex items-center gap-1.5 text-sm font-medium">
                           <MapPin className={cn("w-3.5 h-3.5", siteName === "Non renseigné" ? "text-muted-foreground/30" : "text-primary/60")} /> 
                           <span className={siteName === "Non renseigné" ? "text-muted-foreground italic text-xs" : ""}>{siteName}</span>
                         </div>
                      </TableCell>
                      <TableCell>
                         <div className="flex items-center justify-between mb-1 text-[10px] font-bold">
                           <span className="flex items-center gap-1"><Users className="w-3 h-3 text-muted-foreground" /> {n.fulfilledHeadcount || 0}/{n.requestedHeadcount}</span>
                           <span className={cn(progress >= 100 ? "text-green-600" : "text-primary")}>{Math.round(progress)}%</span>
                         </div>
                         <Progress value={progress} className="h-1.5" />
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(n.status)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Calendar className="w-3 h-3" /> Émis: {formatDate(n.createdAt)}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                            <Clock className="w-3 h-3" /> Dispo: {n.desiredAvailabilityDate || "N/A"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onSelect={() => {
                                // CRITICAL: Wrap navigation in setTimeout to allow Radix UI 
                                // to close the menu before the page unmounts.
                                setTimeout(() => {
                                  router.push(`/entity/${entityId}/recruitment-needs/${n.needId}/preview`);
                                }, 0);
                              }}
                              className="gap-2 text-primary font-semibold"
                            >
                              <Eye className="w-4 h-4" /> Consulter
                            </DropdownMenuItem>
                            {canCreateForm && ["open", "partially_fulfilled"].includes(n.status) && (
                              <DropdownMenuItem 
                                onSelect={() => {
                                  setTimeout(() => {
                                    router.push(`/entity/${entityId}/application-forms/new?recruitmentNeedId=${n.needId}`);
                                  }, 0);
                                }}
                                className="gap-2 font-bold text-accent"
                              >
                                <FileCode className="w-4 h-4" /> Créer formulaire
                              </DropdownMenuItem>
                            )}
                            {canUpdate && (
                              <DropdownMenuItem 
                                onSelect={() => {
                                  setTimeout(() => {
                                    router.push(`/entity/${entityId}/recruitment-needs/${n.needId}/edit`);
                                  }, 0);
                                }}
                                className="gap-2"
                              >
                                <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                            )}
                            {canCancel && !["cancelled", "archived", "fulfilled"].includes(n.status) && (
                               <DropdownMenuItem 
                                 onSelect={() => setStatusChange({ id: n.needId, action: 'cancel' })} 
                                 className="gap-2 text-destructive"
                               >
                                 <PowerOff className="w-4 h-4" /> Annuler la demande
                               </DropdownMenuItem>
                            )}
                            {canUpdate && n.status !== 'archived' && (
                               <DropdownMenuItem 
                                 onSelect={() => setStatusChange({ id: n.needId, action: 'archive' })} 
                                 className="gap-2 text-muted-foreground"
                               >
                                 <Archive className="w-4 h-4" /> Archiver
                               </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination Footer */}
          {!loadingNeeds && filteredNeeds.length > 0 && (
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

      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation de l'action</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'cancel' 
                ? "Êtes-vous sûr de vouloir annuler ce besoin RH ? L'offre ne sera plus active."
                : "Voulez-vous archiver cette demande de recrutement ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); executeStatusChange(); }}
              className={statusChange?.action === 'cancel' ? "bg-red-600 hover:bg-red-700" : "bg-primary"}
              disabled={loading}
            >
              {loading ? "Traitement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

function formatDate(val: any) {
  const d = parseSafeDate(val);
  if (!d) return "—";
  return format(d, "dd/MM/yyyy", { locale: fr });
}
