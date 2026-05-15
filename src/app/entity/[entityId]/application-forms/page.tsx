
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Search, Edit, Eye, Archive, 
  Loader2, CheckCircle2, XCircle, Clock, 
  FileCode, MoreVertical, Globe, Lock, Copy, ExternalLink,
  Filter, X, Calendar as CalendarIcon, Briefcase, Building2,
  ListFilter, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { ApplicationForm, ApplicationFormStatus } from "@/types/application-form";
import { 
  publishApplicationForm, 
  closeApplicationForm, 
  archiveApplicationForm 
} from "@/services/application-form.service";
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
  status: string;
  job: string;
  department: string;
  need: string;
  visibility: string;
  search: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
}

const initialFilters: Filters = {
  status: 'all',
  job: 'all',
  department: 'all',
  need: 'all',
  visibility: 'all',
  search: '',
  dateRange: { from: undefined, to: undefined }
};

/**
 * Robust date parser for mixed Firestore/Admin/Corrupted formats.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  
  // Handle Firestore Timestamp or serialized maps
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    // Ignore empty objects or corrupted maps from 7L investigation
    return null;
  }
  
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  
  return null;
}

export default function ApplicationFormsPage() {
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
  const [actionPending, setActionPending] = useState<{ id: string, action: 'publish' | 'close' | 'archive' } | null>(null);

  // Permissions
  const canRead = hasPermission("applicationForms.read");
  const canCreate = hasPermission("applicationForms.create");
  const canUpdate = hasPermission("applicationForms.update");
  const canPublish = hasPermission("applicationForms.publish");

  // Queries
  const formsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/applicationForms`), orderBy("createdAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: forms, loading: loadingForms } = useCollection<ApplicationForm>(formsQuery);

  // Filter Options Generation
  const uniqueJobs = useMemo(() => 
    Array.from(new Set(forms?.map(f => f.jobTitleName || 'Non renseigné') || [])).sort(), 
  [forms]);

  const uniqueDepartments = useMemo(() => 
    Array.from(new Set(forms?.map(f => f.departmentName || 'Non renseigné') || [])).sort(), 
  [forms]);

  const uniqueNeeds = useMemo(() => {
    const needsMap = new Map<string, string>();
    forms?.forEach(f => {
      if (f.recruitmentNeedId) {
        needsMap.set(f.recruitmentNeedId, f.recruitmentNeedTitle || 'Besoin sans titre');
      }
    });
    return Array.from(needsMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [forms]);

  // Filtering Logic
  const filteredForms = useMemo(() => {
    if (!forms) return [];
    
    return forms.filter(f => {
      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const matchesSearch = 
          f.title.toLowerCase().includes(term) ||
          f.jobTitleName?.toLowerCase().includes(term) ||
          f.departmentName?.toLowerCase().includes(term) ||
          f.recruitmentNeedTitle?.toLowerCase().includes(term) ||
          f.publicSlug?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // 2. Status
      if (filters.status !== 'all' && f.status !== filters.status) return false;
      
      // 3. Job
      if (filters.job !== 'all' && (f.jobTitleName || 'Non renseigné') !== filters.job) return false;

      // 4. Department
      if (filters.department !== 'all' && (f.departmentName || 'Non renseigné') !== filters.department) return false;

      // 5. Need
      if (filters.need !== 'all' && f.recruitmentNeedId !== filters.need) return false;

      // 6. Visibility
      if (filters.visibility === 'has_public_link' && !f.publicSlug) return false;
      if (filters.visibility === 'no_public_link' && !!f.publicSlug) return false;

      // 7. Date Range
      if (filters.dateRange.from || filters.dateRange.to) {
        const fDate = parseSafeDate(f.createdAt) || parseSafeDate(f.updatedAt);
        if (!fDate) return false;

        const from = filters.dateRange.from ? startOfDay(filters.dateRange.from) : undefined;
        const to = filters.dateRange.to ? endOfDay(filters.dateRange.to) : undefined;

        if (from && fDate < from) return false;
        if (to && fDate > to) return false;
      }

      return true;
    });
  }, [forms, filters]);

  const updateFilter = (key: keyof Filters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const removeFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: initialFilters[key] }));
  };

  const resetFilters = () => setFilters(initialFilters);

  const executeAction = async () => {
    if (!actionPending || !user) return;
    setLoading(true);
    try {
      if (actionPending.action === 'publish') {
        await publishApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire publié", description: "Le formulaire est désormais accessible via son lien public." });
      } else if (actionPending.action === 'close') {
        await closeApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire fermé", description: "Les nouvelles soumissions sont suspendues." });
      } else if (actionPending.action === 'archive') {
        await archiveApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire archivé" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setActionPending(null);
    }
  };

  const copyPublicLink = (slug: string) => {
    const url = `${window.location.origin}/apply/${slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Lien copié !", description: "Le lien public est prêt à être partagé." });
  };

  const openPublicForm = (slug: string) => {
    window.open(`/apply/${slug}`, '_blank');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200">Brouillon</Badge>;
      case 'published': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Publié</Badge>;
      case 'closed': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Fermé</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Formulaires de candidature</h1>
          <p className="text-muted-foreground text-sm">Gestion des formulaires de capture candidats.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/application-forms/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau formulaire
          </Button>
        )}
      </div>

      <div className="space-y-6 mb-6">
        {/* Advanced Filter Bar */}
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
                  { label: "Brouillon", value: "draft" },
                  { label: "Publié", value: "published" },
                  { label: "Fermé", value: "closed" },
                  { label: "Archivé", value: "archived" }
                ]}
              />

              {/* Job Filter */}
              <FilterDropdown 
                label="Poste" 
                value={filters.job} 
                onValueChange={(v) => updateFilter('job', v)}
                options={uniqueJobs.map(j => ({ label: j, value: j }))}
              />

              {/* Dept Filter */}
              <FilterDropdown 
                label="Département" 
                value={filters.department} 
                onValueChange={(v) => updateFilter('department', v)}
                options={uniqueDepartments.map(d => ({ label: d, value: d }))}
              />

              {/* Recruitment Need Filter */}
              <FilterDropdown 
                label="Besoin RH" 
                value={filters.need} 
                onValueChange={(v) => updateFilter('need', v)}
                options={uniqueNeeds.map(([id, title]) => ({ label: title, value: id }))}
              />

              {/* Visibility Filter */}
              <FilterDropdown 
                label="Lien Public" 
                value={filters.visibility} 
                onValueChange={(v) => updateFilter('visibility', v)}
                options={[
                  { label: "Avec lien", value: "has_public_link" },
                  { label: "Sans lien", value: "no_public_link" }
                ]}
              />

              {/* Date Filter */}
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
                      "Date de création"
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

              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Active Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 px-1 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || key === 'dateRange') return null;
              if (value === 'all') return null;
              
              let label = value;
              if (key === 'status') {
                const map: any = { draft: 'Brouillon', published: 'Publié', closed: 'Fermé', archived: 'Archivé' };
                label = map[value] || value;
              }
              if (key === 'visibility') label = value === 'has_public_link' ? 'Avec lien' : 'Sans lien';
              if (key === 'need') label = uniqueNeeds.find(n => n[0] === value)?.[1] || value;

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
            
            {filteredForms.length > 0 && !loadingForms && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {filteredForms.length} formulaire{filteredForms.length > 1 ? 's' : ''} trouvé{filteredForms.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Formulaire & Poste</TableHead>
                <TableHead>Besoin RH</TableHead>
                <TableHead>Lien Public</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingForms ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredForms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-medium">Aucun formulaire ne correspond à vos critères.</p>
                      <Button variant="outline" size="sm" onClick={resetFilters}>Effacer les filtres</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredForms.map((f) => (
                  <TableRow key={f.formId} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="font-bold text-primary truncate max-w-[250px]">{f.title}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                        <FileCode className="w-3 h-3" /> {f.jobTitleName || "Non renseigné"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium truncate max-w-[200px]">{f.recruitmentNeedTitle || "Non renseigné"}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{f.departmentName || "Non renseigné"}</div>
                    </TableCell>
                    <TableCell>
                      {f.status === 'published' ? (
                        <div className="flex items-center gap-2">
                           <div className="flex items-center gap-1.5 text-[10px] font-mono text-accent">
                            <Globe className="w-3 h-3" /> /{f.publicSlug}
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyPublicLink(f.publicSlug)}>
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Lock className="w-3 h-3" /> Non publié
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(f.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/application-forms/${f.formId}/preview`)} className="gap-2">
                            <Eye className="w-4 h-4" /> Aperçu HR
                          </DropdownMenuItem>
                          
                          {f.status === 'published' && f.publicSlug && (
                            <>
                              <DropdownMenuItem onClick={() => openPublicForm(f.publicSlug)} className="gap-2 text-accent font-bold">
                                <ExternalLink className="w-4 h-4" /> Ouvrir le formulaire
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyPublicLink(f.publicSlug)} className="gap-2">
                                <Copy className="w-4 h-4" /> Copier le lien public
                              </DropdownMenuItem>
                            </>
                          )}

                          {canUpdate && (f.status === 'draft' || f.status === 'published') && (
                            <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/application-forms/${f.formId}/edit`)} className="gap-2">
                              <Edit className="w-4 h-4" /> Configurer
                            </DropdownMenuItem>
                          )}
                          
                          <DropdownMenuSeparator />

                          {canPublish && f.status === 'draft' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'publish' })} className="gap-2 text-green-600 font-bold">
                              <Globe className="w-4 h-4" /> Publier l'offre
                            </DropdownMenuItem>
                          )}
                          {canUpdate && f.status === 'published' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'close' })} className="gap-2 text-orange-600">
                              <XCircle className="w-4 h-4" /> Fermer l'offre
                            </DropdownMenuItem>
                          )}
                          {canUpdate && f.status !== 'archived' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'archive' })} className="gap-2 text-muted-foreground">
                              <Archive className="w-4 h-4" /> Archiver
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
        </Card>
      </div>

      <AlertDialog open={!!actionPending} onOpenChange={() => setActionPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation de l'action</AlertDialogTitle>
            <AlertDialogDescription>
              {actionPending?.action === 'publish' && "Êtes-vous sûr de vouloir rendre ce formulaire public ? Un lien public sera généré."}
              {actionPending?.action === 'close' && "La fermeture empêchera toute nouvelle candidature via ce lien."}
              {actionPending?.action === 'archive' && "L'archivage masquera ce formulaire de la liste active."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeAction(); }} disabled={loading}>
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
