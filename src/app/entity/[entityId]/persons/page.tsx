"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  UserPlus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Mail, Phone, Fingerprint, MoreVertical,
  AlertCircle, ShieldCheck, X, LayoutDashboard, Download,
  ChevronUp, ChevronDown, Calendar as CalendarIcon,
  ChevronLeft, ChevronRight
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
  createPerson, 
  updatePerson, 
  disablePerson, 
  reactivatePerson 
} from "@/services/person.service";
import { Person } from "@/types/person";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter 
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
} from "@/components/ui/dropdown-menu";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { ITALIAN_PROVINCES, getCitiesForProvince } from "@/config/geo-italy";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PersonDetailPanel } from "@/components/persons/PersonDetailPanel";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { format, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { fr } from "date-fns/locale";

// --- Types & Constants ---

type SortConfig = {
  field: keyof Person | 'displayName';
  direction: 'asc' | 'desc' | null;
};

interface Filters {
  search: string;
  status: string;
  lifecycle: string;
  location: string;
  date: string;
}

const initialFilters: Filters = {
  search: "",
  status: "all",
  lifecycle: "all",
  location: "all",
  date: "all"
};

const initialForm = {
  firstName: "",
  lastName: "",
  codiceFiscale: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  notes: ""
};

// --- Helpers ---

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

function formatLocation(p: Person) {
  const parts = [p.city, p.province, p.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Non renseigné";
}

// --- Main Component ---

export default function PersonsManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // UI State
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Table UX State
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<SortConfig>({ field: 'displayName', direction: 'asc' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });

  // Geo UI State
  const [isOtherCity, setIsOtherCity] = useState(false);
  const [customCityName, setCustomCityName] = useState("");

  // Permissions
  const canRead = hasPermission("persons.read");
  const canCreate = hasPermission("persons.create");
  const canUpdate = hasPermission("persons.update");

  // Query
  const personsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/persons`), orderBy("lastName", "asc")) as Query<Person>;
  }, [db, entityId, canRead]);

  const { data: persons, loading: loadingPersons } = useCollection<Person>(personsQuery);

  // --- Logic Chains ---

  // 1. Unique Options for Dropdowns
  const uniqueOptions = useMemo(() => {
    const statuses = new Set<string>();
    const lifecycles = new Set<string>();
    const locations = new Set<string>();

    persons?.forEach(p => {
      if (p.status) statuses.add(p.status);
      if (p.currentLifecycleStatus) lifecycles.add(p.currentLifecycleStatus);
      const loc = formatLocation(p);
      if (loc !== "Non renseigné") locations.add(loc);
    });

    return {
      statuses: Array.from(statuses).sort(),
      lifecycles: Array.from(lifecycles).sort(),
      locations: Array.from(locations).sort()
    };
  }, [persons]);

  // 2. Filter Logic (Logical AND)
  const filteredPersons = useMemo(() => {
    if (!persons) return [];

    return persons.filter(p => {
      // Search
      if (filters.search) {
        const term = filters.search.toLowerCase().trim();
        const loc = formatLocation(p).toLowerCase();
        const matchesSearch = 
          p.displayName?.toLowerCase().includes(term) ||
          p.firstName?.toLowerCase().includes(term) ||
          p.lastName?.toLowerCase().includes(term) ||
          p.email?.toLowerCase().includes(term) ||
          p.phone?.toLowerCase().includes(term) ||
          p.codiceFiscale?.toLowerCase().includes(term) ||
          loc.includes(term);
        if (!matchesSearch) return false;
      }

      // Status Filter
      if (filters.status !== "all" && p.status !== filters.status) return false;

      // Lifecycle Filter
      if (filters.lifecycle !== "all" && p.currentLifecycleStatus !== filters.lifecycle) return false;

      // Location Filter
      if (filters.location !== "all" && formatLocation(p) !== filters.location) return false;

      // Date Filter
      if (filters.date !== "all") {
        const date = parseSafeDate(p.createdAt);
        if (!date) return false;
        const now = new Date();
        if (filters.date === "today" && !isWithinInterval(date, { start: startOfDay(now), end: endOfDay(now) })) return false;
        if (filters.date === "week" && !isWithinInterval(date, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) })) return false;
        if (filters.date === "month" && !isWithinInterval(date, { start: startOfMonth(now), end: endOfMonth(now) })) return false;
        if (filters.date === "year" && !isWithinInterval(date, { start: startOfYear(now), end: endOfYear(now) })) return false;
      }

      return true;
    });
  }, [persons, filters]);

  // 3. Sorting Logic
  const sortedPersons = useMemo(() => {
    if (!sort.field || !sort.direction) return filteredPersons;

    return [...filteredPersons].sort((a, b) => {
      let valA: any = a[sort.field as keyof Person] ?? "";
      let valB: any = b[sort.field as keyof Person] ?? "";

      if (sort.field === 'displayName') {
        valA = a.displayName ?? "";
        valB = b.displayName ?? "";
      }

      // Special cases for sorting
      if (sort.field === 'createdAt') {
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
  }, [filteredPersons, sort]);

  // 4. Pagination
  const totalResults = sortedPersons.length;
  const totalPages = Math.ceil(totalResults / pagination.pageSize);
  const paginatedPersons = useMemo(() => {
    const start = (pagination.page - 1) * pagination.pageSize;
    return sortedPersons.slice(start, start + pagination.pageSize);
  }, [sortedPersons, pagination]);

  // Reset pagination on filter change
  useEffect(() => {
    setPagination(p => ({ ...p, page: 1 }));
  }, [filters, pagination.pageSize]);

  // --- Handlers ---

  const handleUpdateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleRemoveFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: initialFilters[key] }));
  };

  const handleToggleSort = (field: keyof Person | 'displayName') => {
    setSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleExportCSV = () => {
    if (sortedPersons.length === 0) return;

    const headers = [
      "Nom complet", "Prénom", "Nom", "Email", "Téléphone", 
      "Statut", "Cycle de vie", "Ville", "Province", "Pays", 
      "Localisation", "Date de création"
    ];

    const rows = sortedPersons.map(p => [
      p.displayName || "Non renseigné",
      p.firstName || "",
      p.lastName || "",
      p.email || "",
      p.phone || "",
      p.status || "Non renseigné",
      p.currentLifecycleStatus || "Non renseigné",
      p.city || "",
      p.province || "",
      p.country || "",
      formatLocation(p),
      formatDateDisplay(p.createdAt)
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
    link.setAttribute("download", `personnes_${dateStr}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Original Handlers (Preserved) ---

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
    setIsOtherCity(false);
    setCustomCityName("");
  };

  const handleEdit = (p: Person) => {
    const provinceCode = p.province || "";
    const cityName = p.city || "";
    const citiesInList = provinceCode ? getCitiesForProvince(provinceCode) : [];
    const isInList = citiesInList.includes(cityName);

    setFormData({
      firstName: p.firstName,
      lastName: p.lastName,
      codiceFiscale: p.codiceFiscale || "",
      email: p.email,
      phone: p.phone || "",
      address: p.address || "",
      city: isInList ? cityName : (cityName ? "OTHER" : ""),
      province: provinceCode,
      postalCode: p.postalCode || "",
      notes: p.notes || ""
    });
    
    if (!isInList && cityName) {
      setIsOtherCity(true);
      setCustomCityName(cityName);
    } else {
      setIsOtherCity(false);
      setCustomCityName("");
    }

    setEditingId(p.personId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!formData.codiceFiscale) {
      toast({ variant: "destructive", title: "Incomplet", description: "L'identifiant national est obligatoire." });
      return;
    }

    setLoading(true);
    try {
      const actorUid = user.uid;
      const displayName = `${formData.firstName} ${formData.lastName}`;
      
      const finalPayload = {
        ...formData,
        displayName,
        city: formData.city === "OTHER" ? customCityName : formData.city
      };
      
      if (editingId) {
        await updatePerson(entityId, editingId, finalPayload, actorUid);
        toast({ title: "Modifiée", description: "La fiche identité a été mise à jour." });
      } else {
        await createPerson(entityId, finalPayload, actorUid);
        toast({ title: "Créée", description: "La personne a été ajoutée à l'entreprise." });
      }
      handleReset();
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
      await disablePerson(entityId, disablingId, user.uid);
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
      await reactivatePerson(entityId, reactivatingId, user.uid);
      toast({ title: "Réactivée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  const getLifecycleBadge = (status: string | undefined) => {
    switch (status) {
      case 'candidate': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Candidat</Badge>;
      case 'employee': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Employé</Badge>;
      case 'former_employee': return <Badge variant="outline" className="text-muted-foreground">Ancien employé</Badge>;
      default: return <Badge variant="outline">Personne</Badge>;
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
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter le catalogue des personnes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="p-8 pb-4 shrink-0 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-headline font-bold text-primary">Base de données Personnes</h1>
            <p className="text-muted-foreground text-sm">Référentiel d'identité et parcours de vie HR.</p>
          </div>
          <div className="flex items-center gap-3">
             <Button variant="outline" onClick={handleExportCSV} className="gap-2 bg-white" disabled={sortedPersons.length === 0}>
                <Download className="w-4 h-4" /> Exporter CSV
             </Button>
            {canCreate && (
              <Button onClick={() => setIsFormVisible(true)} className="gap-2 shadow-lg shadow-primary/10">
                <UserPlus className="w-4 h-4" /> Ajouter une identité
              </Button>
            )}
          </div>
        </div>

        {/* Improved Filter Bar */}
        <div className="space-y-4">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-3 p-1">
              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input 
                  placeholder="Rechercher..." 
                  className="h-9 pl-8 text-xs bg-background" 
                  value={filters.search}
                  onChange={(e) => handleUpdateFilter('search', e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <FilterDropdown 
                label="Statut" 
                value={filters.status} 
                onValueChange={(v) => handleUpdateFilter('status', v)}
                options={uniqueOptions.statuses.map(s => ({ label: s, value: s }))}
              />

              {/* Lifecycle Filter */}
              <FilterDropdown 
                label="Cycle" 
                value={filters.lifecycle} 
                onValueChange={(v) => handleUpdateFilter('lifecycle', v)}
                options={uniqueOptions.lifecycles.map(l => ({ label: l, value: l }))}
              />

              {/* Location Filter */}
              <FilterDropdown 
                label="Localisation" 
                value={filters.location} 
                onValueChange={(v) => handleUpdateFilter('location', v)}
                options={uniqueOptions.locations.map(l => ({ label: l, value: l }))}
              />

              {/* Date Filter */}
              <FilterDropdown 
                label="Création" 
                value={filters.date} 
                onValueChange={(v) => handleUpdateFilter('date', v)}
                options={[
                  { label: "Aujourd'hui", value: "today" },
                  { label: "Cette semaine", value: "week" },
                  { label: "Ce mois", value: "month" },
                  { label: "Cette année", value: "year" }
                ]}
              />

              <Button variant="ghost" size="sm" onClick={() => setFilters(initialFilters)} className="h-9 text-xs text-muted-foreground hover:text-primary">
                Réinitialiser
              </Button>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 min-h-[32px]">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'search' || value === 'all' || !value) return null;
              return (
                <Badge key={key} variant="secondary" className="gap-1.5 py-1 px-2.5 text-[10px] font-bold uppercase bg-primary/5 text-primary border-primary/10">
                  {value}
                  <button onClick={() => handleRemoveFilter(key as keyof Filters)} className="hover:bg-primary/10 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            
            {sortedPersons.length > 0 && !loadingPersons && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-auto mr-2">
                {sortedPersons.length} personne{sortedPersons.length > 1 ? 's' : ''} trouvée{sortedPersons.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-8 pt-0">
        {/* Full Width Table Section */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <Card className="flex-1 min-h-0 flex flex-col overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-secondary/20">
                  <TableRow>
                    <TableHead>
                      <button onClick={() => handleToggleSort('displayName')} className="flex items-center gap-1 hover:text-primary transition-colors">
                        Identité {sort.field === 'displayName' && (sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </button>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <button onClick={() => handleToggleSort('email')} className="flex items-center gap-1 hover:text-primary transition-colors">
                        Contact {sort.field === 'email' && (sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => handleToggleSort('currentLifecycleStatus' as any)} className="flex items-center gap-1 hover:text-primary transition-colors">
                        Situation {sort.field === 'currentLifecycleStatus' as any && (sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => handleToggleSort('status')} className="flex items-center gap-1 hover:text-primary transition-colors">
                        Statut {sort.field === 'status' && (sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPersons ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                  ) : paginatedPersons.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">Aucune personne ne correspond aux filtres.</TableCell></TableRow>
                  ) : (
                    paginatedPersons.map((p) => (
                      <TableRow 
                        key={p.personId} 
                        onClick={() => setSelectedPerson(p)}
                        className={cn(
                          "cursor-pointer transition-colors", 
                          selectedPerson?.personId === p.personId ? "bg-primary/5 hover:bg-primary/5" : "hover:bg-muted/50"
                        )}
                      >
                        <TableCell>
                          <div className="font-bold text-primary">{p.displayName || "Non renseigné"}</div>
                          <div className="text-[10px] text-muted-foreground uppercase font-mono mt-0.5">{p.codiceFiscale || "SANS ID"}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-col gap-0.5">
                            <div className="text-xs flex items-center gap-1"><Mail className="w-2.5 h-2.5 opacity-50" /> {p.email || "Non renseigné"}</div>
                            {p.phone && <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Phone className="w-2.5 h-2.5 opacity-50" /> {p.phone}</div>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getLifecycleBadge(p.currentLifecycleStatus)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.status === 'active' ? 'default' : 'outline'} className={p.status === 'active' ? "bg-green-500 hover:bg-green-600 border-none" : ""}>
                            {p.status === 'active' ? "Actif" : "Inactif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {canUpdate && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEdit(p)} className="gap-2">
                                  <Edit className="w-4 h-4" /> Modifier
                                </DropdownMenuItem>
                                {p.status === 'active' ? (
                                  <DropdownMenuItem onClick={() => setDisablingId(p.personId)} className="gap-2 text-destructive">
                                    <PowerOff className="w-4 h-4" /> Désactiver
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => setReactivatingId(p.personId)} className="gap-2 text-green-600">
                                    <RefreshCcw className="w-4 h-4" /> Réactiver
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            {/* Pagination Footer */}
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
          </Card>
        </div>
      </div>

      {/* Person Detail Right-side Drawer */}
      <Sheet open={!!selectedPerson} onOpenChange={(open) => !open && setSelectedPerson(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[620px] p-0 flex flex-col gap-0 border-l shadow-2xl">
          <SheetHeader className="px-8 py-6 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-left font-black uppercase text-primary tracking-widest text-xs flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" /> Fiche Identité & Parcours
              </SheetTitle>
            </div>
            {selectedPerson && (
              <SheetDescription className="text-[10px] font-bold uppercase text-muted-foreground truncate mt-1">
                {selectedPerson.displayName} • {selectedPerson.email}
              </SheetDescription>
            )}
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <PersonDetailPanel 
               entityId={entityId} 
               person={selectedPerson} 
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Forms & Dialogs */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier la personne" : "Ajouter une personne"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom</Label>
                <Input id="firstName" value={formData.firstName} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input id="lastName" value={formData.lastName} onChange={handleInputChange} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="codiceFiscale">Identifiant National (Code Fiscal)</Label>
                <Input id="codiceFiscale" value={formData.codiceFiscale} onChange={handleInputChange} className="font-mono uppercase font-bold" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={formData.email} onChange={handleInputChange} required />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <Label>Province (IT)</Label>
                <SearchableSelect 
                  options={ITALIAN_PROVINCES.map(p => ({ label: `${p.code} — ${p.name}`, value: p.code }))}
                  value={formData.province}
                  onValueChange={(v) => setFormData(p => ({...p, province: v, city: ""}))}
                />
              </div>
              <div className="space-y-2">
                <Label>Ville</Label>
                <SearchableSelect 
                  options={(formData.province ? getCitiesForProvince(formData.province) : []).map(c => ({ label: c, value: c })).concat({ label: "Autre ville...", value: "OTHER" })}
                  value={formData.city}
                  onValueChange={(v) => {
                    setFormData(p => ({...p, city: v}));
                    setIsOtherCity(v === "OTHER");
                  }}
                  disabled={!formData.province}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" value={formData.phone} onChange={handleInputChange} />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!disablingId} onOpenChange={() => setDisablingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
            <AlertDialogDescription>L'accès de cette personne aux futurs processus sera suspendu.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDisable(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivatingId} onOpenChange={() => setReactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la réactivation</AlertDialogTitle>
            <AlertDialogDescription>Souhaitez-vous réactiver cette fiche identité ?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmReactivate(); }} className="bg-green-600 hover:bg-green-700" disabled={loading}>Réactiver</AlertDialogAction>
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
