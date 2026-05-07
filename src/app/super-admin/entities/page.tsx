"use client";

import { useState, useMemo } from "react";
import { Building, Plus, Loader2, Search, ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { createEntity } from "@/services/entity.service";
import { EntityType } from "@/types/entity";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function EntitiesManagementPage() {
  const { db, missingVars } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [type, setType] = useState<EntityType>("internal_entity");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const entitiesQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, "entities"), orderBy("createdAt", "desc"));
  }, [db]);

  const { data: entities, loading: loadingEntities } = useCollection(entitiesQuery);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !legalName || !db) return;
    
    setLoading(true);
    try {
      await createEntity({
        name,
        legalName,
        type,
        createdBy: user?.uid || "system"
      });
      
      setName("");
      setLegalName("");
      setType("internal_entity");
      
      toast({
        title: "Succès",
        description: "L'entité a été créée avec succès.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err.message || "Impossible de créer l'entité.",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredEntities = entities?.filter(e => 
    e.name?.toLowerCase().includes(search.toLowerCase()) || 
    e.legalName?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (missingVars.length > 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Firebase Incomplète</AlertTitle>
          <AlertDescription>
            Les variables suivantes sont manquantes dans .env.local :
            <ul className="list-disc ml-6 mt-2">
              {missingVars.map(v => <li key={v} className="font-mono text-xs">{v}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/super-admin">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Entités</h1>
          <p className="text-muted-foreground">Ajoutez et gérez les entreprises de la plateforme.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form Column */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Nouvelle Entité
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom Commercial</Label>
                  <Input 
                    id="name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="Ex: Nexus Studio" 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legalName">Raison Sociale</Label>
                  <Input 
                    id="legalName" 
                    value={legalName} 
                    onChange={(e) => setLegalName(e.target.value)} 
                    placeholder="Ex: Nexus Solutions SAS" 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type d'entité</Label>
                  <Select value={type} onValueChange={(val) => setType(val as EntityType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal_entity">Entité Interne</SelectItem>
                      <SelectItem value="supplier">Fournisseur</SelectItem>
                      <SelectItem value="customer">Client</SelectItem>
                      <SelectItem value="other">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={loading || !db}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Building className="w-4 h-4 mr-2" />}
                  Créer l'entité
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* List Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10" 
              placeholder="Rechercher une entité..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEntities ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </TableCell>
                  </TableRow>
                ) : filteredEntities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Aucune entité trouvée.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEntities.map((entity) => (
                    <TableRow key={entity.entityId}>
                      <TableCell>
                        <div className="font-medium">{entity.name}</div>
                        <div className="text-xs text-muted-foreground">{entity.legalName}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {entity.type?.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entity.status === 'active' ? 'default' : 'outline'} className={entity.status === 'active' ? "bg-green-500 hover:bg-green-600 text-white border-none" : ""}>
                          {entity.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">Détails</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
