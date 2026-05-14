"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Users, UserPlus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Mail, Phone, Fingerprint, MapPin, MoreVertical,
  AlertCircle, ShieldCheck, X, LayoutDashboard
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
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
} from "@/components/ui/dropdown-menu";
import { ITALIAN_PROVINCES, getCitiesForProvince } from "@/config/geo-italy";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PersonDetailPanel } from "@/components/persons/PersonDetailPanel";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

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

export default function PersonsManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const isMobile = useIsMobile();
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
  const [search, setSearch] = useState("");
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

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
    return query(collection(db, `entities/${entityId}/persons`), orderBy("lastName", "asc"));
  }, [db, entityId, canRead]);

  const { data: persons, loading: loadingPersons } = useCollection<Person>(personsQuery);

  // Dynamic city list
  const provinceOptions = useMemo(() => {
    return ITALIAN_PROVINCES.map(p => ({
      label: `${p.code} — ${p.name}`,
      value: p.code,
      searchText: `${p.code} ${p.name}`
    }));
  }, []);

  const cityOptions = useMemo(() => {
    if (!formData.province) return [];
    const cities = getCitiesForProvince(formData.province);
    const options = cities.map(c => ({ label: c, value: c }));
    options.push({ label: "Autre ville...", value: "OTHER" });
    return options;
  }, [formData.province]);

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

  const filteredPersons = useMemo(() => {
    const term = search.toLowerCase();
    return persons?.filter(p => 
      p.displayName.toLowerCase().includes(term) || 
      p.codiceFiscale?.toLowerCase().includes(term) ||
      p.email.toLowerCase().includes(term)
    ) || [];
  }, [persons, search]);

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
          {canCreate && (
            <Button onClick={() => setIsFormVisible(true)} className="gap-2 shadow-lg shadow-primary/10">
              <UserPlus className="w-4 h-4" /> Ajouter une identité
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-8 pt-0 gap-8">
        {/* Left Table Section */}
        <div className={cn("flex-1 flex flex-col gap-4 min-w-0", selectedPerson && "hidden lg:flex")}>
          <div className="relative max-w-md shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10" 
              placeholder="Rechercher par nom, email ou identifiant..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>

          <Card className="flex-1 min-h-0 flex flex-col overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-secondary/20">
                  <TableRow>
                    <TableHead>Identité</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead>Situation</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPersons ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                  ) : filteredPersons.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucun résultat trouvé.</TableCell></TableRow>
                  ) : (
                    filteredPersons.map((p) => (
                      <TableRow 
                        key={p.personId} 
                        onClick={() => setSelectedPerson(p)}
                        className={cn(
                          "cursor-pointer transition-colors", 
                          selectedPerson?.personId === p.personId ? "bg-primary/5 hover:bg-primary/5" : "hover:bg-muted/50"
                        )}
                      >
                        <TableCell>
                          <div className="font-bold text-primary">{p.displayName}</div>
                          <div className="text-[10px] text-muted-foreground uppercase font-mono mt-0.5">{p.codiceFiscale || "SANS ID"}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-col gap-0.5">
                            <div className="text-xs flex items-center gap-1"><Mail className="w-2.5 h-2.5 opacity-50" /> {p.email}</div>
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
          </Card>
        </div>

        {/* Right Detail Panel - Desktop */}
        {!isMobile && selectedPerson && (
          <div className="w-[500px] flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
             <div className="flex items-center justify-between shrink-0">
                <h3 className="text-sm font-black uppercase text-primary tracking-widest flex items-center gap-2">
                   <LayoutDashboard className="w-4 h-4" /> Fiche Identité & Parcours
                </h3>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedPerson(null)}>
                   <X className="w-4 h-4" />
                </Button>
             </div>
             <div className="flex-1 min-h-0">
               <PersonDetailPanel 
                 entityId={entityId} 
                 person={selectedPerson} 
               />
             </div>
          </div>
        )}

        {!isMobile && !selectedPerson && (
          <div className="w-[500px] hidden lg:flex flex-col items-center justify-center border-2 border-dashed rounded-3xl bg-secondary/5 text-center p-8">
             <Fingerprint className="w-12 h-12 text-muted-foreground/20 mb-4" />
             <p className="text-sm text-muted-foreground font-medium">Sélectionnez une personne pour consulter sa fiche complète et son historique.</p>
          </div>
        )}
      </div>

      {/* Mobile Detail Panel */}
      {isMobile && (
        <Sheet open={!!selectedPerson} onOpenChange={(open) => !open && setSelectedPerson(null)}>
          <SheetContent side="bottom" className="h-[90vh] px-0">
            <SheetHeader className="px-6 mb-4">
              <SheetTitle className="text-left font-black uppercase text-primary tracking-widest text-xs">Fiche Identité</SheetTitle>
            </SheetHeader>
            <div className="h-full pb-20">
              <PersonDetailPanel 
                 entityId={entityId} 
                 person={selectedPerson} 
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

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
                  options={provinceOptions}
                  value={formData.province}
                  onValueChange={(v) => setFormData(p => ({...p, province: v, city: ""}))}
                />
              </div>
              <div className="space-y-2">
                <Label>Ville</Label>
                <SearchableSelect 
                  options={cityOptions}
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
