
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Search, Edit, PowerOff, Loader2, 
  Library, FileText, Calendar, ShieldCheck,
  Filter, X, ListFilter, MoreVertical, Eye,
  AlertCircle
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
import { createCcnl, updateCcnl, archiveCcnl } from "@/services/ccnl.service";
import { CCNL, CCNLStatus } from "@/types/ccnl";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const initialForm = {
  name: "",
  sector: "",
  cnelCode: "",
  standardWeeklyHours: 40,
  monthlyPayments: 13,
  hourlyDivisor: 173,
  effectiveFrom: new Date().toISOString().split('T')[0],
  notes: ""
};

export default function CcnlRegistryPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  // UI State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [archivingId, setArchivingId] = useState<string | null>(null);

  // Queries
  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/ccnls`), orderBy("name", "asc"));
  }, [db, entityId]);

  const { data: ccnls, loading: loadingCcnls } = useCollection<CCNL>(ccnlsQuery);

  const filteredCcnls = useMemo(() => {
    const term = search.toLowerCase();
    return ccnls?.filter(c => {
      const matchesSearch = 
        c.name.toLowerCase().includes(term) || 
        c.sector.toLowerCase().includes(term) ||
        c.cnelCode?.toLowerCase().includes(term);
      
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;

      return matchesSearch && matchesStatus;
    }) || [];
  }, [ccnls, search, statusFilter]);

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleEdit = (c: CCNL) => {
    setFormData({
      name: c.name,
      sector: c.sector,
      cnelCode: c.cnelCode || "",
      standardWeeklyHours: c.standardWeeklyHours,
      monthlyPayments: c.monthlyPayments,
      hourlyDivisor: c.hourlyDivisor,
      effectiveFrom: c.effectiveFrom,
      notes: c.notes || ""
    });
    setEditingId(c.ccnlId);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      if (editingId) {
        await updateCcnl(entityId, editingId, formData, user.uid);
        toast({ title: "CCNL mis à jour" });
      } else {
        await createCcnl(entityId, formData, user.uid);
        toast({ title: "CCNL créé" });
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
      await archiveCcnl(entityId, archivingId, user.uid);
      toast({ title: "CCNL archivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setArchivingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="text-muted-foreground">Inactif</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Référentiel CCNL</h1>
          <p className="text-muted-foreground text-sm">Gestion des contrats collectifs et grilles de salaires.</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="gap-2 shadow-lg shadow-primary/10">
          <Plus className="w-4 h-4" /> Nouveau CCNL
        </Button>
      </div>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10" 
              placeholder="Rechercher par nom, secteur ou code..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="active">Actif</SelectItem>
              <SelectItem value="inactive">Inactif</SelectItem>
              <SelectItem value="archived">Archivé</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead>Contrat & Secteur</TableHead>
                <TableHead>Code CNEL</TableHead>
                <TableHead className="text-center">Détails Paie</TableHead>
                <TableHead>Date d'effet</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingCcnls ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredCcnls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-medium">Aucun CCNL trouvé.</p>
                      <Button variant="outline" size="sm" onClick={() => {setSearch(""); setStatusFilter("all");}}>Réinitialiser filtres</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredCcnls.map((c) => (
                  <TableRow key={c.ccnlId} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="font-bold text-primary">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground uppercase mt-1">{c.sector}</div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{c.cnelCode || "—"}</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-3 text-[10px] font-bold">
                          <span title="Mensualités">{c.monthlyPayments} mensualités</span>
                          <span title="Diviseur horaire">Div: {c.hourlyDivisor}</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground uppercase">{c.standardWeeklyHours}h hebdomadaires</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium">{c.effectiveFrom}</div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(c.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/ccnls/${c.ccnlId}`)} className="gap-2 font-bold text-primary">
                             <Eye className="w-4 h-4" /> Gérer les niveaux
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(c)} className="gap-2">
                             <Edit className="w-4 h-4" /> Modifier
                          </DropdownMenuItem>
                          {c.status !== 'archived' && (
                            <DropdownMenuItem onClick={() => setArchivingId(c.ccnlId)} className="gap-2 text-destructive">
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

      {/* CCNL Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le CCNL" : "Nouveau CCNL"}</DialogTitle>
            <DialogDescription>Définissez les paramètres globaux du contrat collectif.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="name">Nom du CCNL</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData(p => ({...p, name: e.target.value}))} required placeholder="Ex: Commerce et Tertiaire" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sector">Secteur d'activité</Label>
                <Input id="sector" value={formData.sector} onChange={(e) => setFormData(p => ({...p, sector: e.target.value}))} required placeholder="Ex: Tertiaire" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cnelCode">Code CNEL (Optionnel)</Label>
                <Input id="cnelCode" value={formData.cnelCode} onChange={(e) => setFormData(p => ({...p, cnelCode: e.target.value}))} placeholder="Ex: H012" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="standardWeeklyHours">Heures Hebdo.</Label>
                <Input id="standardWeeklyHours" type="number" step="0.5" value={formData.standardWeeklyHours} onChange={(e) => setFormData(p => ({...p, standardWeeklyHours: parseFloat(e.target.value)}))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthlyPayments">Mensualités</Label>
                <Input id="monthlyPayments" type="number" value={formData.monthlyPayments} onChange={(e) => setFormData(p => ({...p, monthlyPayments: parseInt(e.target.value)}))} required />
                {formData.monthlyPayments > 0 && ![12, 13, 14].includes(formData.monthlyPayments) && (
                  <p className="text-[10px] text-orange-600 font-bold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Valeur inhabituelle
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="hourlyDivisor">Diviseur Horaire</Label>
                <Input id="hourlyDivisor" type="number" value={formData.hourlyDivisor} onChange={(e) => setFormData(p => ({...p, hourlyDivisor: parseInt(e.target.value)}))} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="effectiveFrom">Date d'effet</Label>
              <Input id="effectiveFrom" type="date" value={formData.effectiveFrom} onChange={(e) => setFormData(p => ({...p, effectiveFrom: e.target.value}))} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={formData.notes} onChange={(e) => setFormData(p => ({...p, notes: e.target.value}))} placeholder="Observations..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer" : "Créer CCNL"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive Alert */}
      <AlertDialog open={!!archivingId} onOpenChange={() => setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce CCNL ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le contrat passera en statut "archivé". Il restera consultable historiquement mais ne pourra plus être sélectionné pour de nouveaux contrats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmArchive(); }} className="bg-red-600" disabled={loading}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
