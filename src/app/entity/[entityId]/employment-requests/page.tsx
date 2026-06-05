
"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Send, Search, Eye, Loader2, 
  Filter, X, ListFilter, Calendar, 
  Building2, Briefcase, User, Info,
  MoreVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { EmploymentRequest, EmploymentRequestStatus } from "@/types/employment-request";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_LABELS: Record<EmploymentRequestStatus, string> = {
  draft: "Brouillon",
  to_send: "À envoyer",
  sent_to_consultant: "Envoyé consultant",
  waiting_for_communication: "Attente UniLav",
  communication_done: "Communication faite",
  completed: "Terminé",
  cancelled: "Annulé"
};

export default function EmploymentRequestsRegistryPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const canRead = hasPermission("employmentRequests.read");

  const requestsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employmentRequests`), orderBy("createdAt", "desc"));
  }, [db, entityId, canRead]);

  const { data: requests, loading } = useCollection<EmploymentRequest>(requestsQuery);

  const filteredRequests = useMemo(() => {
    return requests?.filter(r => {
      const term = search.toLowerCase();
      const matchesSearch = 
        (r.consultantName || "").toLowerCase().includes(term) ||
        (r.jobRoleId || "").toLowerCase().includes(term) ||
        (r.id || "").toLowerCase().includes(term);
      
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    }) || [];
  }, [requests, search, statusFilter]);

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Embauches / Communications CPI</h1>
          <p className="text-muted-foreground text-sm">Registre des communications obligatoires (UniLav) et dossiers consultants.</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 h-10 text-sm" 
              placeholder="Rechercher par consultant, poste ou ID..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] h-10">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead>Type & Source</TableHead>
                <TableHead>Détails Poste</TableHead>
                <TableHead>Consultant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-medium">Aucune demande trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                         <Badge variant="outline" className="w-fit text-[9px] uppercase font-black px-2 h-5">{r.type}</Badge>
                         <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Source: {r.source}</div>
                         <div className="text-[9px] font-mono text-muted-foreground opacity-50 truncate max-w-[120px]">{r.id}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-bold text-slate-800 text-sm">{r.jobRoleId || "N/A"}</div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                         <Building2 className="w-3 h-3" /> Site ID: {r.worksiteId || "Général"}
                      </div>
                    </TableCell>
                    <TableCell>
                       <div className="text-xs font-bold text-primary">{r.consultantName || "Non assigné"}</div>
                       <div className="text-[10px] text-muted-foreground">{r.consultantEmail}</div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(r.status)}
                    </TableCell>
                    <TableCell>
                       <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700">
                             <Calendar className="w-3 h-3" /> Emb. : {r.plannedHireDate || "—"}
                          </div>
                          <div className="text-[9px] text-muted-foreground italic">Créé le {formatDate(r.createdAt)}</div>
                       </div>
                    </TableCell>
                    <TableCell className="text-right">
                       <Button 
                         variant="ghost" 
                         size="sm" 
                         className="h-8 gap-2 font-bold"
                         onClick={() => router.push(`/entity/${entityId}/employment-requests/${r.id}`)}
                       >
                          <Eye className="w-4 h-4" /> Consulter
                       </Button>
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

function formatDate(val: any) {
  if (!val) return "—";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return format(d, "dd/MM/yyyy", { locale: fr });
  } catch (e) { return "—"; }
}

function getStatusBadge(status: EmploymentRequestStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[10px] h-5 px-2">Brouillon</Badge>;
    case 'sent_to_consultant': return <Badge className="bg-blue-500 text-white border-none text-[10px] h-5 px-2">Envoyé</Badge>;
    case 'waiting_for_communication': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] h-5 px-2">En attente</Badge>;
    case 'completed': return <Badge className="bg-green-600 text-white border-none text-[10px] h-5 px-2">Terminé</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5 px-2">Annulé</Badge>;
    default: return <Badge variant="outline" className="text-[10px] h-5 px-2">{status}</Badge>;
  }
}
