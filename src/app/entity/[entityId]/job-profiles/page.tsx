
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  FileBadge, Plus, Search, Edit, PowerOff, RefreshCcw, 
  Loader2, Calendar, Building2, Eye,
  AlertCircle, MoreVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  disableJobProfile, 
  reactivateJobProfile 
} from "@/services/job-profile.service";
import { JobProfile } from "@/types/job-profile";
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

export default function JobProfilesManagementPage() {
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
  const [statusChange, setStatusChange] = useState<{ id: string, action: 'disable' | 'reactivate' } | null>(null);

  // Permissions
  const canRead = hasPermission("jobProfiles.read");
  const canCreate = hasPermission("jobProfiles.create");
  const canUpdate = hasPermission("jobProfiles.update");

  // Queries
  const profilesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("updatedAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: profiles, loading: loadingProfiles } = useCollection<JobProfile>(profilesQuery);

  const executeStatusChange = async () => {
    if (!statusChange || !user) return;
    setLoading(true);
    try {
      if (statusChange.action === 'disable') {
        await disableJobProfile(entityId, statusChange.id, user.uid);
      } else {
        await reactivateJobProfile(entityId, statusChange.id, user.uid);
      }
      toast({ title: "Statut mis à jour" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setStatusChange(null);
    }
  };

  const filteredProfiles = useMemo(() => {
    const term = search.toLowerCase();
    return profiles?.filter(p => 
      p.jobTitleName.toLowerCase().includes(term) || 
      p.departmentName.toLowerCase().includes(term)
    ) || [];
  }, [profiles, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Actif</Badge>;
      case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Inactif</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (val: any) => {
    if (!val) return "N/A";
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter les fiches de postes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des fiches de postes</h1>
          <p className="text-muted-foreground text-sm">Référentiel documentaire des métiers et responsabilités.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/job-profiles/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvelle fiche
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher par intitulé ou département..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Intitulé de poste</TableHead>
                <TableHead>Département</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Dernière modification</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingProfiles ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredProfiles.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucune fiche de poste trouvée.</TableCell></TableRow>
              ) : (
                filteredProfiles.map((p) => (
                  <TableRow key={p.jobProfileId}>
                    <TableCell>
                      <div className="font-bold text-primary">{p.jobTitleName}</div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono mt-1">ID: {p.jobProfileId}</div>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-sm">
                         <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> {p.departmentName}
                       </div>
                    </TableCell>
                    <TableCell>
                       <Badge variant="outline" className="font-bold">{p.versionLabel || "V1"}</Badge>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <Calendar className="w-3.5 h-3.5" /> {formatDate(p.lastModifiedAt || p.updatedAt)}
                       </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(p.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => router.push(`/entity/${entityId}/job-profiles/${p.jobProfileId}/preview`)}
                            className="gap-2 text-primary font-semibold"
                          >
                            <Eye className="w-4 h-4" /> Consulter / Imprimer
                          </DropdownMenuItem>
                          {canUpdate && (
                            <>
                              <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/job-profiles/${p.jobProfileId}/edit`)} className="gap-2">
                                <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                              {p.status === 'active' ? (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'disable' })} className="gap-2 text-destructive">
                                  <PowerOff className="w-4 h-4" /> Désactiver
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setStatusChange({ id: p.jobProfileId, action: 'reactivate' })} className="gap-2 text-green-600">
                                  <RefreshCcw className="w-4 h-4" /> Réactiver
                                </DropdownMenuItem>
                              )}
                            </>
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

      {/* Status AlertDialog */}
      <AlertDialog open={!!statusChange} onOpenChange={() => setStatusChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.action === 'disable' 
                ? "Souhaitez-vous désactiver cette fiche de poste ? Elle ne sera plus proposée pour les recrutements."
                : "Souhaitez-vous réactiver cette fiche de poste ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); executeStatusChange(); }}
              className={statusChange?.action === 'disable' ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
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
