"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Search, Edit, PowerOff, Loader2, 
  Calendar, Building2, MapPin, Users,
  AlertCircle, MoreVertical, Archive, Eye,
  Clock, FileText, Briefcase
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { cancelRecruitmentNeed, archiveRecruitmentNeed } from "@/services/recruitment-need.service";
import { RecruitmentNeed } from "@/types/recruitment-need";
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
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";

export default function RecruitmentNeedsPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  // State
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusChange, setStatusChange] = useState<{ id: string, action: 'cancel' | 'archive' } | null>(null);

  // Permissions
  const canRead = hasPermission("recruitmentNeeds.read");
  const canCreate = hasPermission("recruitmentNeeds.create");
  const canUpdate = hasPermission("recruitmentNeeds.update");
  const canCancel = hasPermission("recruitmentNeeds.cancel");

  // Queries
  const needsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/recruitmentNeeds`), orderBy("createdAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: needs, loading: loadingNeeds } = useCollection<RecruitmentNeed>(needsQuery);

  const executeStatusChange = async () => {
    if (!statusChange || !user) return;
    setLoading(true);
    try {
      if (statusChange.action === 'cancel') {
        await cancelRecruitmentNeed(entityId, statusChange.id, user.uid);
        toast({ title: "Besoin annulé" });
      } else {
        await archiveRecruitmentNeed(entityId, statusChange.id, user.uid);
        toast({ title: "Besoin archivé" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
    }
  };

  const filteredNeeds = useMemo(() => {
    const term = search.toLowerCase();
    return needs?.filter(n => 
      n.jobTitleName?.toLowerCase().includes(term) ||
      n.departmentName?.toLowerCase().includes(term) ||
      n.worksiteName?.toLowerCase().includes(term)
    ) || [];
  }, [needs, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Ouvert</Badge>;
      case 'partially_fulfilled': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">Partiel</Badge>;
      case 'fulfilled': return <Badge className="bg-green-500 hover:bg-green-600 border-none">Pourvu</Badge>;
      case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulé</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
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
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter les besoins RH.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Besoins RH</h1>
          <p className="text-muted-foreground text-sm">Ouverture de postes, planification et offres d'emploi.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/recruitment-needs/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau besoin RH
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher un poste, département..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Poste & Département</TableHead>
                <TableHead>Site / Localisation</TableHead>
                <TableHead>Progression</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Calendrier</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingNeeds ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredNeeds.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucune demande de recrutement trouvée.</TableCell></TableRow>
              ) : (
                filteredNeeds.map((n) => {
                  const progress = n.requestedHeadcount > 0 ? (n.fulfilledHeadcount / n.requestedHeadcount) * 100 : 0;
                  return (
                    <TableRow key={n.needId}>
                      <TableCell>
                        <div className="font-bold text-primary truncate max-w-[200px]">{n.jobTitleName}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                          <Building2 className="w-3 h-3" /> {n.departmentName}
                        </div>
                      </TableCell>
                      <TableCell>
                         <div className="flex items-center gap-1.5 text-sm font-medium">
                           <MapPin className="w-3.5 h-3.5 text-muted-foreground" /> {n.worksiteName}
                         </div>
                         <div className="text-[9px] text-muted-foreground mt-0.5 truncate max-w-[150px]">{n.jobOfferLocation}</div>
                      </TableCell>
                      <TableCell>
                         <div className="flex items-center justify-between mb-1 text-[10px] font-bold">
                           <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {n.fulfilledHeadcount}/{n.requestedHeadcount}</span>
                           <span>{Math.round(progress)}%</span>
                         </div>
                         <Progress value={progress} className="h-1.5" />
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(n.status)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Calendar className="w-3 h-3" /> Émis: {n.issueDate}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                            <Clock className="w-3 h-3" /> Dispo: {n.desiredAvailabilityDate}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={() => router.push(`/entity/${entityId}/recruitment-needs/${n.needId}/preview`)}
                              className="gap-2 text-primary font-semibold"
                            >
                              <Eye className="w-4 h-4" /> Consulter
                            </DropdownMenuItem>
                            {canUpdate && (
                              <DropdownMenuItem 
                                onClick={() => router.push(`/entity/${entityId}/recruitment-needs/${n.needId}/edit`)}
                                className="gap-2"
                              >
                                <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                            )}
                            {canCancel && !["cancelled", "archived", "fulfilled"].includes(n.status) && (
                               <DropdownMenuItem 
                                 onClick={() => setStatusChange({ id: n.needId, action: 'cancel' })} 
                                 className="gap-2 text-destructive"
                               >
                                 <PowerOff className="w-4 h-4" /> Annuler la demande
                               </DropdownMenuItem>
                            )}
                            {canUpdate && n.status !== 'archived' && (
                               <DropdownMenuItem 
                                 onClick={() => setStatusChange({ id: n.needId, action: 'archive' })} 
                                 className="gap-2 text-muted-foreground"
                               >
                                 <Archive className="w-4 h-4" /> Archiver
                               </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation de l'action</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'cancel' 
                ? "Êtes-vous sûr de vouloir annuler ce besoin RH ? L'offre ne sera plus active."
                : "Voulez-vous archiver cette demande de recrutement ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); executeStatusChange(); }}
              className={statusChange?.action === 'cancel' ? "bg-red-600 hover:bg-red-700" : "bg-primary"}
              disabled={loading}
            >
              {loading ? "Traitement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
