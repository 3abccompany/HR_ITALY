"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  FileText, Search, Edit, Eye, XCircle, 
  Loader2, Calendar as CalendarIcon, User, 
  Briefcase, MoreVertical, Filter, ListFilter,
  ArrowRight, ShieldCheck, Clock, FilePlus2,
  AlertCircle, Send, CheckCircle2, Ban
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { cancelEmploymentOffer } from "@/services/employment-offer.service";
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
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function EmploymentOffersListPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canRead = hasPermission("contracts.read");
  const canUpdate = hasPermission("contracts.create");

  const offersQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employmentOffers`), orderBy("updatedAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: offers, loading: loadingOffers } = useCollection<EmploymentOffer>(offersQuery);

  const filteredOffers = useMemo(() => {
    const term = search.toLowerCase();
    return offers?.filter(o => 
      (o.candidateDisplayName ?? "").toLowerCase().includes(term) ||
      (o.jobTitleName ?? "").toLowerCase().includes(term) ||
      (o.offerId ?? "").toLowerCase().includes(term) ||
      (o.candidateEmail ?? "").toLowerCase().includes(term) ||
      (o.status ?? "").toLowerCase().includes(term)
    ) || [];
  }, [offers, search]);

  const executeCancel = async () => {
    if (!cancellingId || !user) return;
    setLoading(true);
    try {
      await cancelEmploymentOffer(entityId, cancellingId, user.uid);
      toast({ title: "Proposition annulée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setCancellingId(null);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Propositions d'embauche</h1>
          <p className="text-muted-foreground text-sm">Gestion des offres contractuelles internes et réponses candidats.</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 h-11 bg-white border-primary/10 shadow-sm" 
              placeholder="Rechercher par candidat, poste ou statut..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/20">
                <TableHead>Candidat & Poste</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Contrat & Début</TableHead>
                <TableHead>CCNL / Niveau</TableHead>
                <TableHead>Dernière modification</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingOffers ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredOffers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">Aucune proposition trouvée.</TableCell>
                </TableRow>
              ) : (
                filteredOffers.map((o) => (
                  <TableRow key={o.offerId} className="hover:bg-muted/50 transition-colors group cursor-pointer" onClick={() => router.push(`/entity/${entityId}/employment-offers/${o.offerId}`)}>
                    <TableCell>
                      <div className="font-bold text-primary">{o.candidateDisplayName || "Non renseigné"}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                        <Briefcase className="w-3 h-3" /> {o.jobTitleName || "Non renseigné"}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {getStatusBadge(o.status)}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                         <div className="font-medium text-slate-700">{o.contractType || "Non renseigné"}</div>
                         <div className="flex items-center gap-1 text-muted-foreground text-[10px]">
                            <CalendarIcon className="w-3 h-3" /> 
                            Début: {o.proposedStartDate || "Non fixée"}
                         </div>
                      </div>
                    </TableCell>
                    <TableCell>
                       {o.ccnlName ? (
                         <div className="space-y-1">
                            <div className="text-[10px] font-bold text-primary truncate max-w-[150px]">{o.ccnlName}</div>
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{o.levelCode || "—"}</Badge>
                         </div>
                       ) : (
                         <span className="text-[10px] text-muted-foreground italic">Non renseigné</span>
                       )}
                    </TableCell>
                    <TableCell>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {o.updatedAt ? format((o.updatedAt as any).toDate(), "dd/MM HH:mm", { locale: fr }) : "N/A"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/entity/${entityId}/employment-offers/${o.offerId}`)} className="gap-2">
                             <Edit className="w-4 h-4" /> Modifier / Consulter
                          </DropdownMenuItem>
                          {canUpdate && !["cancelled", "accepted", "declined"].includes(o.status) && (
                            <DropdownMenuItem onClick={() => setCancellingId(o.offerId)} className="gap-2 text-destructive">
                               <Ban className="w-4 h-4" /> Annuler la proposition
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

      <AlertDialog open={!!cancellingId} onOpenChange={() => setCancellingId(null)}>
        <AlertDialogContent className="rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler la proposition ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action marquera la proposition comme annulée. Elle ne sera plus accessible pour le candidat.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Retour</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); executeCancel(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getStatusBadge(status: EmploymentOfferStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700">En revue</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700">Prête</Badge>;
    case 'sent': return <Badge variant="secondary" className="bg-primary text-white border-none">Envoyée</Badge>;
    case 'viewed': return <Badge variant="secondary" className="bg-cyan-500 text-white border-none">Consultée</Badge>;
    case 'accepted': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white font-black">ACCEPTÉE</Badge>;
    case 'declined': return <Badge variant="destructive" className="bg-red-500 border-none">REFUSÉE</Badge>;
    case 'expired': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Expirée</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Annulée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}
