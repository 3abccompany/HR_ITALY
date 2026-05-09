
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Plus, Search, Edit, Eye, Archive, 
  Loader2, CheckCircle2, XCircle, Clock, 
  FileCode, MoreVertical, Globe, Lock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { ApplicationForm } from "@/types/application-form";
import { 
  publishApplicationForm, 
  closeApplicationForm, 
  archiveApplicationForm 
} from "@/services/application-form.service";
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

export default function ApplicationFormsPage() {
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
  const [actionPending, setActionPending] = useState<{ id: string, action: 'publish' | 'close' | 'archive' } | null>(null);

  // Permissions
  const canRead = hasPermission("applicationForms.read");
  const canCreate = hasPermission("applicationForms.create");
  const canUpdate = hasPermission("applicationForms.update");
  const canPublish = hasPermission("applicationForms.publish");

  // Queries
  const formsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/applicationForms`), orderBy("createdAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: forms, loading: loadingForms } = useCollection<ApplicationForm>(formsQuery);

  const executeAction = async () => {
    if (!actionPending || !user) return;
    setLoading(true);
    try {
      if (actionPending.action === 'publish') {
        await publishApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire publié", description: "Le formulaire est désormais accessible via son lien public." });
      } else if (actionPending.action === 'close') {
        await closeApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire fermé", description: "Les nouvelles soumissions sont suspendues." });
      } else if (actionPending.action === 'archive') {
        await archiveApplicationForm(entityId, actionPending.id, user.uid);
        toast({ title: "Formulaire archivé" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setActionPending(null);
    }
  };

  const filteredForms = useMemo(() => {
    const term = search.toLowerCase();
    return forms?.filter(f => 
      f.title.toLowerCase().includes(term) || 
      f.jobTitleName.toLowerCase().includes(term)
    ) || [];
  }, [forms, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200">Brouillon</Badge>;
      case 'published': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">Publié</Badge>;
      case 'closed': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Fermé</Badge>;
      case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300">Archivé</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Formulaires de candidature</h1>
          <p className="text-muted-foreground text-sm">Gestion des formulaires de capture candidats.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/entity/${entityId}/application-forms/new`)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouveau formulaire
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            className="pl-10" 
            placeholder="Rechercher un formulaire..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>

        <Card className="overflow-hidden border-primary/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Formulaire & Poste</TableHead>
                <TableHead>Besoin RH</TableHead>
                <TableHead>Lien Public</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingForms ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredForms.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucun formulaire trouvé.</TableCell></TableRow>
              ) : (
                filteredForms.map((f) => (
                  <TableRow key={f.formId}>
                    <TableCell>
                      <div className="font-bold text-primary truncate max-w-[250px]">{f.title}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                        <FileCode className="w-3 h-3" /> {f.jobTitleName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium truncate max-w-[200px]">{f.recruitmentNeedTitle}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{f.departmentName}</div>
                    </TableCell>
                    <TableCell>
                      {f.status === 'published' ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-accent">
                          <Globe className="w-3 h-3" /> /{f.publicSlug}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Lock className="w-3 h-3" /> Non publié
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(f.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/application-forms/${f.formId}/preview`)} className="gap-2">
                            <Eye className="w-4 h-4" /> Aperçu
                          </DropdownMenuItem>
                          {canUpdate && f.status === 'draft' && (
                            <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/application-forms/${f.formId}/edit`)} className="gap-2">
                              <Edit className="w-4 h-4" /> Configurer
                            </DropdownMenuItem>
                          )}
                          {canPublish && f.status === 'draft' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'publish' })} className="gap-2 text-green-600 font-semibold">
                              <Globe className="w-4 h-4" /> Publier
                            </DropdownMenuItem>
                          )}
                          {canUpdate && f.status === 'published' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'close' })} className="gap-2 text-orange-600">
                              <XCircle className="w-4 h-4" /> Fermer
                            </DropdownMenuItem>
                          )}
                          {canUpdate && f.status !== 'archived' && (
                            <DropdownMenuItem onClick={() => setActionPending({ id: f.formId, action: 'archive' })} className="gap-2 text-muted-foreground border-t mt-1">
                              <Archive className="w-4 h-4" /> Archiver
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

      <AlertDialog open={!!actionPending} onOpenChange={() => setActionPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation de l'action</AlertDialogTitle>
            <AlertDialogDescription>
              {actionPending?.action === 'publish' && "Êtes-vous sûr de vouloir rendre ce formulaire public ?"}
              {actionPending?.action === 'close' && "La fermeture empêchera toute nouvelle candidature via ce lien."}
              {actionPending?.action === 'archive' && "L'archivage masquera ce formulaire de la liste active."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeAction(); }} disabled={loading}>
              {loading ? "Traitement..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
