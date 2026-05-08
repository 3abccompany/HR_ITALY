
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Calendar, Search, Plus, Edit, PowerOff, RefreshCcw, 
  Loader2, User, Briefcase, MapPin, CheckCircle2, 
  AlertCircle, MoreVertical, Star, MessageSquare
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
  scheduleInterview, 
  updateInterview, 
  recordInterviewDecision,
  disableInterview, 
  reactivateInterview 
} from "@/services/interview.service";
import { Interview, InterviewStatus, InterviewDecision, InterviewType } from "@/types/interview";
import { Candidate } from "@/types/candidate";
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
import { Slider } from "@/components/ui/slider";

const initialForm = {
  candidateId: "",
  scheduledAt: new Date().toISOString().slice(0, 16),
  interviewType: "video" as InterviewType,
  interviewerName: "",
  location: "",
  notes: ""
};

const initialDecisionForm = {
  decision: "pending" as InterviewDecision,
  score: 3,
  feedback: ""
};

export default function InterviewsManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading } = useActiveMembership(entityId);

  // State
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isDecisionVisible, setIsDecisionVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [decidingId, setDecisionId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [decisionData, setDecisionData] = useState(initialDecisionForm);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Permissions
  const canRead = hasPermission("interviews.read");
  const canCreate = hasPermission("interviews.create");
  const canUpdate = hasPermission("interviews.update");
  const canDecide = hasPermission("interviews.decide");
  const canReadCandidates = hasPermission("candidates.read");

  // Queries
  const interviewsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/interviews`), orderBy("scheduledAt", "desc"));
  }, [db, entityId, canRead]);

  const candidatesQuery = useMemo(() => {
    if (!db || !entityId || !canReadCandidates || !isFormVisible || editingId) return null;
    return query(collection(db, `entities/${entityId}/candidates`), orderBy("createdAt", "desc"));
  }, [db, entityId, canReadCandidates, isFormVisible, editingId]);

  const { data: interviews, loading: loadingInterviews } = useCollection<Interview>(interviewsQuery);
  const { data: candidates, loading: loadingCandidates } = useCollection<Candidate>(candidatesQuery);

  const eligibleCandidates = useMemo(() => {
    const invalidStatuses = ["inactive", "archived", "hired", "rejected", "withdrawn"];
    return candidates?.filter(c => !invalidStatuses.includes(c.status)) || [];
  }, [candidates]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setDecisionData(initialDecisionForm);
    setEditingId(null);
    setDecisionId(null);
    setIsFormVisible(false);
    setIsDecisionVisible(false);
  };

  const handleEdit = (i: Interview) => {
    setFormData({
      candidateId: i.candidateId,
      scheduledAt: i.scheduledAt,
      interviewType: i.interviewType,
      interviewerName: i.interviewerName,
      location: i.location || "",
      notes: i.notes || ""
    });
    setEditingId(i.interviewId);
    setIsFormVisible(true);
  };

  const handleOpenDecision = (i: Interview) => {
    setDecisionData({
      decision: i.decision || "pending",
      score: i.score || 3,
      feedback: i.feedback || ""
    });
    setDecisionId(i.interviewId);
    setIsDecisionVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      if (editingId) {
        await updateInterview(entityId, editingId, formData, user.uid);
        toast({ title: "Mis à jour", description: "L'entretien a été modifié." });
      } else {
        await scheduleInterview(entityId, formData, user.uid);
        toast({ title: "Planifié", description: "L'entretien a été enregistré." });
      }
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId || !decidingId) return;

    setLoading(true);
    try {
      await recordInterviewDecision(entityId, decidingId, decisionData, user.uid);
      toast({ title: "Décision enregistrée", description: "L'entretien a été marqué comme terminé." });
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
      await disableInterview(entityId, disablingId, user.uid);
      toast({ title: "Désactivé", description: "L'entretien est désormais inactif." });
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
      await reactivateInterview(entityId, reactivatingId, user.uid);
      toast({ title: "Réactivé", description: "L'entretien a été réactivé." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  const filteredInterviews = useMemo(() => {
    const term = search.toLowerCase();
    return interviews?.filter(i => 
      i.candidateDisplayName.toLowerCase().includes(term) || 
      i.positionApplied.toLowerCase().includes(term) ||
      i.interviewerName.toLowerCase().includes(term)
    ) || [];
  }, [interviews, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'scheduled': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Planifié</Badge>;
      case 'completed': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Terminé</Badge>;
      case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulé</Badge>;
      case 'no_show': return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Absent</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'accepted': return <Badge className="bg-green-500 border-none">Retenu</Badge>;
      case 'rejected': return <Badge variant="destructive">Refusé</Badge>;
      case 'on_hold': return <Badge variant="secondary">En attente</Badge>;
      default: return <Badge variant="outline" className="text-muted-foreground">À décider</Badge>;
    }
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
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter les entretiens.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Entretiens</h1>
          <p className="text-muted-foreground text-sm">Planification et évaluation des candidats.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvel entretien
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par candidat, poste ou recruteur..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Candidat & Poste</TableHead>
                <TableHead>Rendez-vous</TableHead>
                <TableHead>Recruteur</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Décision</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingInterviews ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredInterviews.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucun entretien trouvé.</TableCell></TableRow>
              ) : (
                filteredInterviews.map((i) => (
                  <TableRow key={i.interviewId}>
                    <TableCell>
                      <div className="font-bold text-primary">{i.candidateDisplayName}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase font-medium mt-1">
                        <Briefcase className="w-3 h-3" /> {i.positionApplied}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Calendar className="w-3.5 h-3.5 text-primary" /> {new Date(i.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Badge variant="outline" className="text-[9px] h-4 py-0 leading-none capitalize">{i.interviewType}</Badge>
                          {i.location && <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {i.location}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs">
                        <div className="bg-secondary rounded-full p-1"><User className="w-3 h-3" /></div>
                        {i.interviewerName || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(i.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        {getDecisionBadge(i.decision)}
                        {i.score && (
                           <div className="flex items-center gap-0.5 text-[10px] text-orange-600 font-bold">
                             <Star className="w-2.5 h-2.5 fill-current" /> {i.score}/5
                           </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && (
                            <DropdownMenuItem onClick={() => handleEdit(i)} className="gap-2">
                              <Edit className="w-4 h-4" /> Modifier
                            </DropdownMenuItem>
                          )}
                          {canDecide && i.status !== 'inactive' && (
                            <DropdownMenuItem onClick={() => handleOpenDecision(i)} className="gap-2 font-bold text-primary">
                              <CheckCircle2 className="w-4 h-4" /> Décision / Terminer
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="gap-2 border-t mt-1">
                             <MessageSquare className="w-4 h-4" /> Voir Feedback
                          </DropdownMenuItem>
                          {canUpdate && (
                             i.status !== 'inactive' ? (
                               <DropdownMenuItem onClick={() => setDisablingId(i.interviewId)} className="gap-2 text-destructive">
                                 <PowerOff className="w-4 h-4" /> Désactiver
                               </DropdownMenuItem>
                             ) : (
                               <DropdownMenuItem onClick={() => setReactivatingId(i.interviewId)} className="gap-2 text-green-600">
                                 <RefreshCcw className="w-4 h-4" /> Réactiver
                               </DropdownMenuItem>
                             )
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

      {/* Create / Edit Dialog */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier l'entretien" : "Planifier un entretien"}</DialogTitle>
            <DialogDescription>Définissez les détails du rendez-vous.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            {!editingId && (
              <div className="space-y-2">
                <Label htmlFor="candidateId">Candidat éligible</Label>
                <Select value={formData.candidateId} onValueChange={(v) => setFormData(p => ({...p, candidateId: v}))}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCandidates ? "Chargement..." : "Sélectionner un candidat actif"} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleCandidates.map(c => (
                      <SelectItem key={c.candidateId} value={c.candidateId}>
                        {c.displayName} — {c.positionApplied}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Date et Heure</Label>
                <Input id="scheduledAt" type="datetime-local" value={formData.scheduledAt} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interviewType">Type d'entretien</Label>
                <Select value={formData.interviewType} onValueChange={(v) => setFormData(p => ({...p, interviewType: v as InterviewType}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Téléphone</SelectItem>
                    <SelectItem value="video">Visioconférence</SelectItem>
                    <SelectItem value="onsite">Sur site</SelectItem>
                    <SelectItem value="technical">Technique</SelectItem>
                    <SelectItem value="hr">RH</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="interviewerName">Nom du Recruteur</Label>
                <Input id="interviewerName" value={formData.interviewerName} onChange={handleInputChange} placeholder="Ex: Jean Dupont" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Lieu / Lien</Label>
                <Input id="location" value={formData.location} onChange={handleInputChange} placeholder="Ex: Bureau 4 ou Meet..." />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes Préparatoires</Label>
              <Textarea id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Points à aborder..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || (!editingId && !formData.candidateId)}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer les modifications" : "Confirmer la planification"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Decision Dialog */}
      <Dialog open={isDecisionVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Évaluation de l'entretien</DialogTitle>
            <DialogDescription>Enregistrez le résultat et les feedbacks après l'échange.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveDecision} className="space-y-6 py-4">
            <div className="space-y-3">
              <Label>Score Global (0 à 5)</Label>
              <div className="flex items-center gap-4">
                <Slider 
                  value={[decisionData.score]} 
                  min={0} 
                  max={5} 
                  step={0.5} 
                  onValueChange={(v) => setDecisionData(p => ({...p, score: v[0]}))}
                  className="flex-1"
                />
                <span className="text-xl font-bold text-primary min-w-[3rem] text-center">{decisionData.score}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="decision">Décision finale de l'entretien</Label>
              <Select 
                value={decisionData.decision} 
                onValueChange={(v) => setDecisionData(p => ({...p, decision: v as InterviewDecision}))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">En attente</SelectItem>
                  <SelectItem value="accepted">Retenu (À embaucher)</SelectItem>
                  <SelectItem value="rejected">Refusé</SelectItem>
                  <SelectItem value="on_hold">Vivier / Stand-by</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback">Feedback détaillé</Label>
              <Textarea 
                id="feedback" 
                value={decisionData.feedback} 
                onChange={(e) => setDecisionData(p => ({...p, feedback: e.target.value}))} 
                className="min-h-[120px]"
                placeholder="Forces, faiblesses, points clés..." 
              />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Fermer</Button>
              <Button type="submit" disabled={loading} className="bg-primary hover:bg-primary/90">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Clôturer l'entretien
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
            <AlertDialogDescription>L'entretien sera marqué comme inactif.</AlertDialogDescription>
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
            <AlertDialogDescription>Souhaitez-vous restaurer cet entretien ?</AlertDialogDescription>
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
