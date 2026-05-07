"use client";

import { useState, useMemo } from "react";
import { 
  Building, Plus, Loader2, Search, ArrowLeft, 
  AlertCircle, Save, X, Edit, PowerOff 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { createEntity, updateEntity, disableEntity } from "@/services/entity.service";
import { Entity, EntityType } from "@/types/entity";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const initialForm: Omit<Entity, 'entityId' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'> = {
  legalName: "",
  name: "",
  numeroTVA: "",
  codeFiscalEntreprise: "",
  adresseSiegeSocial: "",
  codePostal: "",
  ville: "",
  province: "",
  telephone: "",
  email: "",
  pec: "",
  referentEntreprise: "",
  type: "internal_entity",
  notes: ""
};

export default function EntitiesManagementPage() {
  const { db, missingVars } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const entitiesQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, "entities"), orderBy("createdAt", "desc"));
  }, [db]);

  const { data: entities, loading: loadingEntities } = useCollection<Entity>(entitiesQuery);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (entity: Entity) => {
    setFormData({
      legalName: entity.legalName,
      name: entity.name,
      numeroTVA: entity.numeroTVA,
      codeFiscalEntreprise: entity.codeFiscalEntreprise,
      adresseSiegeSocial: entity.adresseSiegeSocial,
      codePostal: entity.codePostal,
      ville: entity.ville,
      province: entity.province,
      telephone: entity.telephone,
      email: entity.email,
      pec: entity.pec,
      referentEntreprise: entity.referentEntreprise,
      type: entity.type,
      notes: entity.notes || ""
    });
    setEditingId(entity.id || entity.entityId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) {
      toast({ variant: "destructive", title: "Erreur", description: "Firestore n'est pas prêt." });
      return;
    }
    
    setLoading(true);
    try {
      const actorUid = user?.uid || "system";
      if (editingId) {
        await updateEntity(editingId, { ...formData, updatedBy: actorUid });
        toast({ title: "Modifiée", description: "L'entreprise a été mise à jour." });
      } else {
        await createEntity({ ...formData, createdBy: actorUid });
        toast({ title: "Créée", description: "L'entreprise a été ajoutée au système." });
      }
      handleReset();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err.message || "Impossible d'enregistrer l'entreprise.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (entityId: string) => {
    if (!db) {
      toast({ variant: "destructive", title: "Erreur", description: "Firestore n'est pas initialisé." });
      return;
    }
    
    if (!confirm("Êtes-vous sûr de vouloir désactiver cette entreprise ?")) return;

    setLoading(true);
    try {
      const actorUid = user?.uid || "system";
      await disableEntity(entityId, actorUid);
      toast({ title: "Désactivée", description: "L'entreprise est désormais inactive." });
    } catch (err: any) {
      toast({ 
        variant: "destructive", 
        title: "Erreur", 
        description: err.message || "Impossible de désactiver l'entreprise." 
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredEntities = useMemo(() => {
    const term = search.toLowerCase();
    return entities?.filter(e => {
      const nom = (e.name || "").toLowerCase();
      const raison = (e.legalName || "").toLowerCase();
      const tva = (e.numeroTVA || "").toLowerCase();
      return nom.includes(term) || raison.includes(term) || tva.includes(term);
    }) || [];
  }, [entities, search]);

  if (missingVars.length > 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Firebase Incomplète</AlertTitle>
          <AlertDescription>
            Firestore n'est pas prêt. Variables manquantes : {missingVars.join(', ')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/super-admin">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-3xl font-headline font-bold text-primary">Fiche Entreprises</h1>
            <p className="text-muted-foreground">Gestion des entreprises et partenaires.</p>
          </div>
        </div>
        {!isFormVisible && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvelle entreprise
          </Button>
        )}
      </div>

      {isFormVisible && (
        <Card className="mb-8 border-primary/20 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              {editingId ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {editingId ? "Modifier l'entreprise" : "Nouvelle fiche entreprise"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="legalName">Raison Sociale</Label>
                  <Input id="legalName" value={formData.legalName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Nom Commercial</Label>
                  <Input id="name" value={formData.name} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select value={formData.type} onValueChange={(v) => setFormData(p => ({...p, type: v as EntityType}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal_entity">Interne</SelectItem>
                      <SelectItem value="supplier">Fournisseur</SelectItem>
                      <SelectItem value="customer">Client</SelectItem>
                      <SelectItem value="other">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="numeroTVA">Numéro TVA</Label>
                  <Input id="numeroTVA" value={formData.numeroTVA} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="codeFiscalEntreprise">Code Fiscal</Label>
                  <Input id="codeFiscalEntreprise" value={formData.codeFiscalEntreprise} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="referentEntreprise">Référent</Label>
                  <Input id="referentEntreprise" value={formData.referentEntreprise} onChange={handleInputChange} required />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="adresseSiegeSocial">Adresse Siège Social</Label>
                  <Input id="adresseSiegeSocial" value={formData.adresseSiegeSocial} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="codePostal">Code Postal</Label>
                  <Input id="codePostal" value={formData.codePostal} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ville">Ville</Label>
                  <Input id="ville" value={formData.ville} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="province">Province</Label>
                  <Input id="province" value={formData.province} onChange={handleInputChange} required />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="telephone">Téléphone</Label>
                  <Input id="telephone" value={formData.telephone} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={formData.email} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pec">PEC (Email Certifié)</Label>
                  <Input id="pec" value={formData.pec} onChange={handleInputChange} required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Commentaires additionnels..." />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>
                  <X className="w-4 h-4 mr-2" /> Annuler
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  {editingId ? "Enregistrer les modifications" : "Enregistrer l'entreprise"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Rechercher par nom, raison sociale ou TVA..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entreprise</TableHead>
                <TableHead>Contact / Ville</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingEntities ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredEntities.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucune entreprise trouvée.</TableCell></TableRow>
              ) : (
                filteredEntities.map((entity) => (
                  <TableRow key={entity.id || entity.entityId}>
                    <TableCell>
                      <div className="font-bold">{entity.name}</div>
                      <div className="text-xs text-muted-foreground uppercase">{entity.legalName}</div>
                      <div className="text-[10px] font-mono mt-1">TVA: {entity.numeroTVA}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{entity.referentEntreprise}</div>
                      <div className="text-xs text-muted-foreground">{entity.ville} ({entity.province})</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize text-[10px]">
                        {entity.type?.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entity.status === 'active' ? 'default' : 'outline'} className={entity.status === 'active' ? "bg-green-500 hover:bg-green-600 text-white border-none" : "bg-red-50 text-red-600 border-red-200"}>
                        {entity.status === 'active' ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(entity)} disabled={loading}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        {entity.status === 'active' && (
                          <Button variant="ghost" size="sm" onClick={() => handleDisable(entity.id || entity.entityId)} className="text-red-500 hover:text-red-600" disabled={loading}>
                            <PowerOff className="w-4 h-4" />
                          </Button>
                        )}
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
