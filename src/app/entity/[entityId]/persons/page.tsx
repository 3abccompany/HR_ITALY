"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Users, UserPlus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Mail, Phone, Fingerprint, MapPin, MoreVertical,
  AlertCircle, ShieldCheck
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
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // State
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
      value: p.code
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
      toast({ title: "Désactivée", description: "La fiche est désormais inactive." });
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
      toast({ title: "Réactivée", description: "La fiche est de nouveau active." });
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

  if (membershipLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground max-w-md">
              Vous n'avez pas la permission de consulter le catalogue des personnes de cette entreprise.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Personnes</h1>
          <p className="text-muted-foreground text-sm">Base d'identité unique pour les candidats et employés.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <UserPlus className="w-4 h-4" /> Nouvelle personne
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par nom, email ou identifiant..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Identité</TableHead>
                <TableHead>Identifiant National</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Localisation</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingPersons ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredPersons.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucun résultat trouvé.</TableCell></TableRow>
              ) : (
                filteredPersons.map((p) => (
                  <TableRow key={p.personId}>
                    <TableCell>
                      <div className="font-bold text-primary">{p.displayName}</div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase font-mono">
                        <Fingerprint className="w-3 h-3" /> {p.personId}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm uppercase font-bold">{p.codiceFiscale || "N/A"}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Mail className="w-3 h-3 text-muted-foreground" /> {p.email}
                        </div>
                        {p.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone className="w-3 h-3" /> {p.phone}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" /> {p.city}, {p.province}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'default' : 'outline'} className={p.status === 'active' ? "bg-green-500 hover:bg-green-600 border-none" : "bg-red-50 text-red-600 border-red-200"}>
                        {p.status === 'active' ? "Actif" : "Inactif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
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
        </Card>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier la personne" : "Ajouter une personne"}</DialogTitle>
            <DialogDescription>Saisissez les informations d'identité et de localisation.</DialogDescription>
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
                <Label htmlFor="codiceFiscale">Identifiant national (ex: Code Fiscal)</Label>
                <Input id="codiceFiscale" value={formData.codiceFiscale} onChange={handleInputChange} className="font-mono uppercase font-bold" placeholder="XXXXXX00X00X000X" required />
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
                  placeholder="Choisir une province"
                  searchPlaceholder="Rechercher une province..."
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
                    if (v !== "OTHER") setCustomCityName("");
                  }}
                  placeholder={formData.province ? "Choisir une ville" : "Sélectionnez d'abord une province"}
                  disabled={!formData.province}
                  searchPlaceholder="Rechercher une ville..."
                />
              </div>
            </div>

            {isOtherCity && (
              <div className="space-y-2 bg-secondary/20 p-3 rounded-lg border border-dashed border-primary/20 animate-in fade-in slide-in-from-top-1">
                <Label htmlFor="customCity">Nom de la ville personnalisée</Label>
                <Input id="customCity" value={customCityName} onChange={(e) => setCustomCityName(e.target.value)} placeholder="Entrez le nom de la ville" required />
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="address">Adresse</Label>
                <Input id="address" value={formData.address} onChange={handleInputChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">Code Postal</Label>
                <Input id="postalCode" value={formData.postalCode} onChange={handleInputChange} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" value={formData.phone} onChange={handleInputChange} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Internes</Label>
              <Input id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Observations..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer les modifications" : "Créer la personne"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialogs */}
      <AlertDialog open={!!disablingId} onOpenChange={() => setDisablingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
            <AlertDialogDescription>Cette fiche sera masquée des processus opérationnels actifs.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDisable(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>
              {loading ? "Chargement..." : "Confirmer"}
            </AlertDialogAction>
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
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmReactivate(); }} className="bg-green-600 hover:bg-green-700" disabled={loading}>
              {loading ? "Chargement..." : "Réactiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
