
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  MapPin, Plus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Building2, MoreVertical, AlertCircle, Home,
  Warehouse, Briefcase, Globe, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  createWorksite, 
  updateWorksite, 
  archiveWorksite 
} from "@/services/worksite.service";
import { Worksite, WorksiteType } from "@/types/worksite";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const initialForm = {
  name: "",
  code: "",
  type: "operational_site" as WorksiteType,
  address: "",
  city: "",
  province: "",
  country: "France",
  notes: ""
};

const WORKSITE_TYPE_LABELS: Record<WorksiteType, string> = {
  main_office: "Siège Social",
  operational_site: "Site Opérationnel",
  client_site: "Site Client",
  warehouse: "Entrepôt",
  other: "Autre"
};

export default function WorksitesManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  // UI State
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [archivingId, setArchivingId] = useState<string | null>(null);

  // Permissions
  const canRead = !membershipLoading && !!membership && hasPermission("worksites.read");
  const canCreate = hasPermission("worksites.create");
  const canUpdate = hasPermission("worksites.update");
  const canArchive = hasPermission("worksites.archive");

  // Query
  const worksitesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/worksites`), orderBy("name", "asc"));
  }, [db, entityId, canRead]);

  const { data: worksites, loading: loadingWorksites } = useCollection<Worksite>(worksitesQuery);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (w: Worksite) => {
    setFormData({
      name: w.name,
      code: w.code,
      type: w.type,
      address: w.address || "",
      city: w.city || "",
      province: w.province || "",
      country: w.country || "France",
      notes: w.notes || ""
    });
    setEditingId(w.worksiteId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      if (editingId) {
        await updateWorksite(entityId, editingId, formData, user.uid);
        toast({ title: "Site mis à jour" });
      } else {
        await createWorksite(entityId, formData, user.uid);
        toast({ title: "Site créé" });
      }
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmArchive = async () => {
    if (!archivingId || !user) return;
    setLoading(true);
    try {
      await archiveWorksite(entityId, archivingId, user.uid);
      toast({ title: "Site archivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setArchivingId(null);
    }
  };

  const filteredWorksites = useMemo(() => {
    const term = search.toLowerCase();
    return worksites?.filter(w => 
      w.name.toLowerCase().includes(term) || 
      w.city.toLowerCase().includes(term) ||
      w.code.toLowerCase().includes(term)
    ) || [];
  }, [worksites, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="text-muted-foreground">Inactif</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeIcon = (type: WorksiteType) => {
    switch(type) {
      case "main_office": return <Building2 className="w-4 h-4" />;
      case "warehouse": return <Warehouse className="w-4 h-4" />;
      case "client_site": return <Globe className="w-4 h-4" />;
      default: return <Home className="w-4 h-4" />;
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
            <p className="text-muted-foreground">Vous n'avez pas la permission de gérer les sites de l'entreprise.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Lieux de travail / Sites</h1>
          <p className="text-muted-foreground text-sm">Gestion des établissements et sites d'affectation.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau site
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par nom, ville ou code..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead>Nom & Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Localisation</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingWorksites ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredWorksites.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucun site trouvé.</TableCell></TableRow>
              ) : (
                filteredWorksites.map((w) => (
                  <TableRow key={w.worksiteId}>
                    <TableCell>
                      <div className="font-bold text-primary">{w.name}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono mt-1">{w.code || "SANS CODE"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs font-medium">
                        {getTypeIcon(w.type)}
                        {WORKSITE_TYPE_LABELS[w.type]}
                      </div>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-xs">
                         <MapPin className="w-3.5 h-3.5 text-muted-foreground" /> {w.city} ({w.province})
                       </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(w.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && (
                            <DropdownMenuItem onClick={() => handleEdit(w)} className="gap-2">
                              <Edit className="w-4 h-4" /> Modifier
                            </DropdownMenuItem>
                          )}
                          {canArchive && w.status !== 'archived' && (
                            <DropdownMenuItem onClick={() => setArchivingId(w.worksiteId)} className="gap-2 text-destructive">
                              <PowerOff className="w-4 h-4" /> Archiver
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

      {/* Form Dialog */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le site" : "Nouveau lieu de travail"}</DialogTitle>
            <DialogDescription>Définissez un établissement physique de l'entreprise.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3 space-y-2">
                <Label htmlFor="name">Nom du site</Label>
                <Input id="name" value={formData.name} onChange={handleInputChange} required placeholder="Ex: Entrepôt Nord" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={formData.code} onChange={handleInputChange} required placeholder="Ex: WH-N" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type d'établissement</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData(p => ({...p, type: v as WorksiteType}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(WORKSITE_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresse complète</Label>
              <Input id="address" value={formData.address} onChange={handleInputChange} placeholder="Numéro, rue..." />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">Ville</Label>
                <Input id="city" value={formData.city} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Province / Département</Label>
                <Input id="province" value={formData.province} onChange={handleInputChange} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Internes</Label>
              <Textarea id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Observations sur l'accessibilité..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer les modifications" : "Créer le site"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive AlertDialog */}
      <AlertDialog open={!!archivingId} onOpenChange={() => setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'archivage</AlertDialogTitle>
            <AlertDialogDescription>
              Le site sera marqué comme archivé. Il ne pourra plus être sélectionné pour de nouveaux recrutements, mais restera visible dans les historiques.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); confirmArchive(); }}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={loading}
            >
              {loading ? "Chargement..." : "Confirmer l'archivage"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
