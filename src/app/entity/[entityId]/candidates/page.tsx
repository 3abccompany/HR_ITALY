
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Search, UserPlus, Edit, PowerOff, RefreshCcw, 
  Loader2, Mail, Phone, Briefcase, Calendar, 
  AlertCircle, ShieldCheck, MoreVertical, Globe, User
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
  createCandidate, 
  updateCandidate, 
  disableCandidate, 
  reactivateCandidate 
} from "@/services/candidate.service";
import { Candidate, CandidateStatus } from "@/types/candidate";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const initialForm = {
  personId: "",
  positionApplied: "",
  department: "",
  source: "manual",
  applicationDate: new Date().toISOString().split('T')[0],
  availabilityDate: "",
  expectedSalary: "",
  status: "new" as CandidateStatus,
  notes: ""
};

export default function CandidatesManagementPage() {
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

  // Permissions
  const canRead = hasPermission("candidates.read");
  const canCreate = hasPermission("candidates.create");
  const canUpdate = hasPermission("candidates.update");
  const canReadPersons = hasPermission("persons.read");

  // Queries
  const candidatesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/candidates`), orderBy("createdAt", "desc"));
  }, [db, entityId, canRead]);

  const personsQuery = useMemo(() => {
    if (!db || !entityId || !canReadPersons || !isFormVisible || editingId) return null;
    return query(collection(db, `entities/${entityId}/persons`), orderBy("lastName", "asc"));
  }, [db, entityId, canReadPersons, isFormVisible, editingId]);

  const { data: candidates, loading: loadingCandidates } = useCollection<Candidate>(candidatesQuery);
  const { data: persons, loading: loadingPersons } = useCollection<Person>(personsQuery);

  const eligiblePersons = useMemo(() => {
    return persons?.filter(p => p.status === "active" && !p.currentCandidateId && !p.currentEmployeeId) || [];
  }, [persons]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (c: Candidate) => {
    setFormData({
      personId: c.personId,
      positionApplied: c.positionApplied,
      department: c.department || "",
      source: c.source || "manual",
      applicationDate: c.applicationDate || "",
      availabilityDate: c.availabilityDate || "",
      expectedSalary: c.expectedSalary || "",
      status: c.status,
      notes: c.notes || ""
    });
    setEditingId(c.candidateId);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      if (editingId) {
        await updateCandidate(entityId, editingId, formData, user.uid);
        toast({ title: "Mis à jour", description: "La candidature a été modifiée." });
      } else {
        await createCandidate(entityId, formData.personId, formData, user.uid);
        toast({ title: "Créée", description: "La candidature a été enregistrée." });
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
      await disableCandidate(entityId, disablingId, user.uid);
      toast({ title: "Désactivée", description: "La candidature est désormais inactive." });
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
      await reactivateCandidate(entityId, reactivatingId, user.uid);
      toast({ title: "Réactivée", description: "La candidature a été réactivée." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  const filteredCandidates = useMemo(() => {
    const term = search.toLowerCase();
    return candidates?.filter(c => 
      c.displayName.toLowerCase().includes(term) || 
      c.positionApplied.toLowerCase().includes(term) ||
      c.email.toLowerCase().includes(term)
    ) || [];
  }, [candidates, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Nouveau</Badge>;
      case 'screening': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">Tri / Sélection</Badge>;
      case 'interview': return <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200">Entretien</Badge>;
      case 'offered': return <Badge variant="secondary" className="bg-cyan-50 text-cyan-700 border-cyan-200">Proposition</Badge>;
      case 'hired': return <Badge className="bg-green-500 hover:bg-green-600 border-none">Embauché</Badge>;
      case 'rejected': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Refusé</Badge>;
      case 'withdrawn': return <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">Désistement</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSourceBadge = (source: string) => {
    if (source === 'public_application_form') {
      return <Badge variant="outline" className="bg-accent/5 text-accent border-accent/20 gap-1"><Globe className="w-3 h-3" /> Formulaire public</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground gap-1"><User className="w-3 h-3" /> Manuel</Badge>;
  };

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
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter le flux de recrutement.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Candidats</h1>
          <p className="text-muted-foreground text-sm">Suivi du pipeline de recrutement par entité.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <UserPlus className="w-4 h-4" /> Nouvelle candidature
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par nom, poste ou email..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Candidat</TableHead>
                <TableHead>Poste / Département</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingCandidates ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredCandidates.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucun candidat trouvé.</TableCell></TableRow>
              ) : (
                filteredCandidates.map((c) => (
                  <TableRow key={c.candidateId}>
                    <TableCell>
                      <div className="font-bold text-primary">{c.displayName}</div>
                      <div className="flex flex-col gap-0.5 mt-1">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Mail className="w-3 h-3" /> {c.email}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium text-sm">
                        <Briefcase className="w-3.5 h-3.5 text-muted-foreground" /> {c.positionApplied}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase mt-1">{c.department || "N/A"}</div>
                    </TableCell>
                    <TableCell>
                      {getSourceBadge(c.source || 'manual')}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(c.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canUpdate && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(c)} className="gap-2">
                              <Edit className="w-4 h-4" /> Modifier
                            </DropdownMenuItem>
                            {c.status !== 'inactive' ? (
                              <DropdownMenuItem onClick={() => setDisablingId(c.candidateId)} className="gap-2 text-destructive">
                                <PowerOff className="w-4 h-4" /> Désactiver
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setReactivatingId(c.candidateId)} className="gap-2 text-green-600">
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
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier la candidature" : "Nouvelle candidature"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Mise à jour du parcours de recrutement." : "Liez une personne existante à un nouveau poste."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            {!editingId && (
              <div className="space-y-2">
                <Label htmlFor="personId">Personne concernée</Label>
                <Select value={formData.personId} onValueChange={(v) => setFormData(p => ({...p, personId: v}))}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingPersons ? "Chargement..." : "Sélectionner une personne active"} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligiblePersons.map(p => (
                      <SelectItem key={p.personId} value={p.personId}>
                        {p.displayName} ({p.codiceFiscale})
                      </SelectItem>
                    ))}
                    {eligiblePersons.length === 0 && !loadingPersons && (
                      <div className="p-2 text-xs text-muted-foreground text-center">Aucune personne éligible trouvée.</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="positionApplied">Poste visé</Label>
                <Input id="positionApplied" value={formData.positionApplied} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Département</Label>
                <Input id="department" value={formData.department} onChange={handleInputChange} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source">Source (Jobboard, Referal...)</Label>
                <Input id="source" value={formData.source} onChange={handleInputChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Statut du pipeline</Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(v) => setFormData(p => ({...p, status: v as CandidateStatus}))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Nouveau</SelectItem>
                    <SelectItem value="screening">Tri / Sélection</SelectItem>
                    <SelectItem value="interview">Entretien</SelectItem>
                    <SelectItem value="offered">Proposition</SelectItem>
                    <SelectItem value="rejected">Refusé</SelectItem>
                    <SelectItem value="withdrawn">Désistement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="applicationDate">Date de candidature</Label>
                <Input id="applicationDate" type="date" value={formData.applicationDate} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedSalary">Prétention Salariale (Annuel Brute)</Label>
                <Input id="expectedSalary" value={formData.expectedSalary} onChange={handleInputChange} placeholder="Ex: 45000€" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Internes</Label>
              <Input id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Commentaires sur le profil..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || (!editingId && !formData.personId)}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer les modifications" : "Créer la candidature"}
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
            <AlertDialogDescription>Le candidat sera marqué comme inactif et son lien avec la fiche identité sera suspendu.</AlertDialogDescription>
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
            <AlertDialogDescription>Souhaitez-vous réactiver ce candidat et restaurer son statut précédent ?</AlertDialogDescription>
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
