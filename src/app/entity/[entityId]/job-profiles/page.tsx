
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  FileBadge, Plus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Calendar as CalendarIcon, Building2, Eye,
  AlertCircle, MoreVertical, Filter, X, ChevronDown, ListFilter,
  History, Settings2, Trash2, Scale
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  disableJobProfile, 
  reactivateJobProfile 
} from "@/services/job-profile.service";
import { JobProfile } from "@/types/job-profile";
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
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Filters {
  department: string;
  status: string;
  version: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  search: string;
}

const initialFilters: Filters = {
  department: 'all',
  status: 'all',
  version: 'all',
  dateRange: { from: undefined, to: undefined },
  search: ''
};

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
  return format(d, "dd/MM/yyyy HH:mm", { locale: fr });
}

export default function JobProfilesManagementPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [visibleFilters, setVisibleFilters] = useState<string[]>(['department']);
  const [statusChange, setStatusChange] = useState<{ id: string, action: 'disable' | 'reactivate' } | null>(null);

  const canRead = hasPermission("jobProfiles.read");
  const canCreate = hasPermission("jobProfiles.create");
  const canUpdate = hasPermission("jobProfiles.update");

  const profilesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("updatedAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: profiles, loading: loadingProfiles } = useCollection<JobProfile>(profilesQuery);

  const uniqueDepartments = useMemo(() => 
    Array.from(new Set(profiles?.map(p => p.departmentName || 'Non renseigné') || [])).sort(), 
  [profiles]);

  const uniqueVersions = useMemo(() => 
    Array.from(new Set(profiles?.map(p => p.versionLabel || 'V1') || [])).sort(), 
  [profiles]);

  const filteredProfiles = useMemo(() => {
    if (!profiles) return [];
    
    return profiles.filter(p => {
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const matchesSearch = 
          p.jobTitleName.toLowerCase().includes(term) ||
          p.departmentName.toLowerCase().includes(term) ||
          p.jobProfileId.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }
      if (filters.department !== 'all' && (p.departmentName || 'Non renseigné') !== filters.department) return false;
      if (filters.status !== 'all' && p.status !== filters.status) return false;
      if (filters.version !== 'all' && (p.versionLabel || 'V1') !== filters.version) return false;
      if (filters.dateRange.from || filters.dateRange.to) {
        const pDate = parseSafeDate(p.lastModifiedAt) || parseSafeDate(p.updatedAt);
        if (!pDate) return false;
        const from = filters.dateRange.from ? startOfDay(filters.dateRange.from) : undefined;
        const to = filters.dateRange.to ? endOfDay(filters.dateRange.to) : undefined;
        if (from && pDate < from) return false;
        if (to && pDate > to) return false;
      }
      return true;
    });
  }, [profiles, filters]);

  const updateFilter = (key: keyof Filters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleFilterVisibility = (filterKey: string) => {
    setVisibleFilters(prev => 
      prev.includes(filterKey) 
        ? prev.filter(f => f !== filterKey) 
        : [...prev, filterKey]
    );
  };

  const removeFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: initialFilters[key] }));
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setVisibleFilters(['department']);
  };

  const executeStatusChange = async () => {
    if (!statusChange || !user) return;
    setLoading(true);
    try {
      if (statusChange.action === 'disable') {
        await disableJobProfile(entityId, statusChange.id, user.uid);
      } else {
        await reactivateJobProfile(entityId, statusChange.id, user.uid);
      }
      toast({ title: "Statut mis à jour" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter les fiches de postes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary tracking-tight">Gestion des fiches de postes</h1>
          <p className="text-muted-foreground text-sm">Référentiel documentaire des métiers et responsabilités.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/job-profiles/new`)} className="gap-2 shadow-lg shadow-primary/10">
            <Plus className="w-4 h-4" /> Nouvelle fiche
          </Button>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative w-full lg:max-w-md shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                className="pl-10 h-10 text-sm bg-background border-primary/10" 
                placeholder="Rechercher par intitulé ou département..." 
                value={filters.search} 
                onChange={(e) => updateFilter('search', e.target.value)} 
              />
            </div>
            <ScrollArea className="w-full whitespace-nowrap lg:flex-1">
              <div className="flex items-center gap-3 p-1">
                <FilterDropdown 
                  label="Département" 
                  value={filters.department} 
                  onValueChange={(v) => updateFilter('department', v)}
                  options={uniqueDepartments.map(d => ({ label: d, value: d }))}
                  icon={Building2}
                />
                {visibleFilters.includes('status') && (
                  <FilterDropdown 
                    label="Statut" 
                    value={filters.status} 
                    onValueChange={(v) => updateFilter('status', v)}
                    options={[
                      { label: "Actif", value: "active" },
                      { label: "Inactif", value: "inactive" },
                      { label: "Archivé", value: "archived" }
                    ]}
                    icon={Settings2}
                  />
                )}
                {visibleFilters.includes('version') && (
                  <FilterDropdown 
                    label="Version" 
                    value={filters.version} 
                    onValueChange={(v) => updateFilter('version', v)}
                    options={uniqueVersions.map(v => ({ label: v, value: v }))}
                    icon={History}
                  />
                )}
                {visibleFilters.includes('date') && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-10 gap-2 text-xs font-medium bg-background border-primary/10">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {filters.dateRange.from ? (
                          filters.dateRange.to ? (
                            <>{format(filters.dateRange.from, "dd/MM")} - {format(filters.dateRange.to, "dd/MM")}</>
                          ) : (
                            format(filters.dateRange.from, "dd/MM/yyyy")
                          )
                        ) : (
                          "Modification"
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
                )}
                <div className="h-8 w-px bg-border mx-1" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-10 gap-2 text-primary font-bold">
                      <Plus className="w-3.5 h-3.5" /> Ajouter un filtre
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => toggleFilterVisibility('status')} className={cn("gap-2", visibleFilters.includes('status') && "text-primary font-bold")}>
                      <Settings2 className="w-4 h-4" /> Statut {visibleFilters.includes('status') && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleFilterVisibility('version')} className={cn("gap-2", visibleFilters.includes('version') && "text-primary font-bold")}>
                      <History className="w-4 h-4" /> Version {visibleFilters.includes('version') && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleFilterVisibility('date')} className={cn("gap-2", visibleFilters.includes('date') && "text-primary font-bold")}>
                      <CalendarIcon className="w-4 h-4" /> Date de modification {visibleFilters.includes('date') && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={resetFilters} className="text-destructive gap-2">
                       <RefreshCcw className="w-4 h-4" /> Réinitialiser tout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-1 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || key === 'dateRange') return null;
              if (value === 'all') return null;
              let label = value;
              if (key === 'status') label = value === 'active' ? 'Actif' : value === 'inactive' ? 'Inactif' : 'Archivé';
              if (key === 'department') label = `Dépt: ${value}`;
              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {label}
                  <button onClick={() => removeFilter(key as keyof Filters)} className="hover:bg-primary/10 rounded-full p-0.5"><X className="h-2.5 w-2.5" /></button>
                </Badge>
              );
            })}
            {(filters.dateRange.from || filters.dateRange.to) && (
              <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                Période: {filters.dateRange.from ? format(filters.dateRange.from, "dd/MM") : '?'} - {filters.dateRange.to ? format(filters.dateRange.to, "dd/MM") : '?'}
                <button onClick={() => removeFilter('dateRange')} className="hover:bg-primary/10 rounded-full p-0.5"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            )}
            {filteredProfiles.length > 0 && !loadingProfiles && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {filteredProfiles.length} fiche{filteredProfiles.length > 1 ? 's' : ''} trouvée{filteredProfiles.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Intitulé de poste</TableHead>
                <TableHead>Département</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Dernière modification</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingProfiles ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredProfiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-medium">Aucune fiche ne correspond à vos critères.</p>
                      <Button variant="outline" size="sm" onClick={resetFilters}>Effacer les filtres</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProfiles.map((p) => (
                  <TableRow key={p.jobProfileId} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="font-bold text-primary">{p.jobTitleName}</div>
                      {p.defaultCcnlName && (
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-accent uppercase mt-1">
                          <Scale className="w-2.5 h-2.5" />
                          <span>{p.defaultCcnlName} • {p.defaultLevelCode || "Sél. Niveau"}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-sm font-medium">
                         <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> {p.departmentName || "Non renseigné"}
                       </div>
                    </TableCell>
                    <TableCell>
                       <Badge variant="outline" className="font-bold h-6 px-2 bg-slate-50">{p.versionLabel || "V1"}</Badge>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <CalendarIcon className="w-3.5 h-3.5" /> {formatDateDisplay(p.lastModifiedAt || p.updatedAt)}
                       </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(p.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/job-profiles/${p.jobProfileId}/preview`)} className="gap-2 text-primary font-bold">
                            <Eye className="w-4 h-4" /> Consulter / Imprimer
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {canUpdate && (
                            <>
                              <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/job-profiles/${p.jobProfileId}/edit`)} className="gap-2">
                                <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                              {p.status === 'active' ? (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'disable' })} className="gap-2 text-destructive">
                                  <PowerOff className="w-4 h-4" /> Désactiver
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'reactivate' })} className="gap-2 text-green-600">
                                  <RefreshCcw className="w-4 h-4" /> Réactiver
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'disable' ? "Souhaitez-vous désactiver cette fiche de poste ? Elle ne sera plus proposée pour les recrutements." : "Souhaitez-vous réactiver cette fiche de poste ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeStatusChange(); }} className={statusChange?.action === 'disable' ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} disabled={loading}>
              {loading ? "Traitement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterDropdown({ label, value, onValueChange, options, icon: Icon }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[], icon?: any }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("h-10 w-auto min-w-[150px] text-xs font-medium bg-background border-primary/10", value !== 'all' && "border-primary ring-1 ring-primary/10")}>
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
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
