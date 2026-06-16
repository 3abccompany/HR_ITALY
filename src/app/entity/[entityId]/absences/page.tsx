"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Plus, Loader2, Calendar, User, Briefcase, 
  Clock, Filter, X, ListFilter, AlertCircle,
  FileText, CheckCircle2, History, Send,
  ChevronRight, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query, where } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { TimeOffRequest, TimeOffRequestType, TimeOffRequestKind, TIME_OFF_TYPE_LABELS } from "@/types/time-off";
import { createTimeOffRequestForEmployee } from "@/services/time-off.service";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const initialForm = {
  employeeId: "",
  requestKind: "leave" as TimeOffRequestKind,
  requestType: "paid_leave" as TimeOffRequestType,
  startDate: new Date().toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0],
  dayPart: "full_day" as any,
  reason: ""
};

export default function TimeOffManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const [statusFilter, setStatusFilter] = useState("all");

  const canRead = hasPermission("leaveRequests.read");
  const canCreate = hasPermission("leaveRequests.create");

  // Queries
  const requestsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/timeOffRequests`), orderBy("createdAt", "desc")) as Query<TimeOffRequest>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active"), orderBy("displayName", "asc")) as Query<Employee>;
  }, [db, entityId, canRead]);

  const { data: requests, loading: loadingRequests } = useCollection<TimeOffRequest>(requestsQuery);
  const { data: employees } = useCollection<Employee>(employeesQuery);

  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    if (statusFilter === "all") return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !membership || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez sélectionner un employé." });
      return;
    }

    if (formData.endDate < formData.startDate) {
      toast({ variant: "destructive", title: "Erreur", description: "La date de fin ne peut pas être antérieure à la date de début." });
      return;
    }

    setLoading(true);
    try {
      const emp = employees?.find(e => e.employeeId === formData.employeeId);
      
      await createTimeOffRequestForEmployee(
        entityId,
        {
          ...formData,
          employeeName: emp?.displayName || "Employé inconnu",
          personId: emp?.personId || ""
        },
        user.uid,
        membership.roleId
      );

      toast({ title: "Demande créée", description: "La demande a été enregistrée avec succès." });
      setIsFormOpen(false);
      setFormData(initialForm);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Échec", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Absences & Congés</h1>
          <p className="text-muted-foreground text-sm">Gestion des demandes de temps libre et absences maladie.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormOpen(true)} className="gap-2 shadow-lg shadow-primary/10 rounded-xl font-bold">
            <Plus className="w-4 h-4" /> Nouvelle demande
          </Button>
        )}
      </header>

      <div className="space-y-6">
        <div className="flex items-center gap-4">
           <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px] h-10 rounded-xl">
                <SelectValue placeholder="Filtrer par statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="submitted">En attente (Submitted)</SelectItem>
                <SelectItem value="approved">Approuvé</SelectItem>
                <SelectItem value="rejected">Refusé</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
              </SelectContent>
           </Select>
        </div>

        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-2xl">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead className="pl-6">Employé</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Durée</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRequests ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune demande trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((r) => (
                  <TableRow key={r.requestId} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="pl-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/5 p-2 rounded-lg text-primary"><User className="w-4 h-4" /></div>
                        <div>
                          <p className="font-bold text-slate-900">{r.employeeName}</p>
                          <p className="text-[10px] text-muted-foreground uppercase font-black tracking-tighter">Source: {r.source === 'hr_created' ? 'RH' : 'Employé'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={cn("text-[9px] uppercase font-black w-fit", r.requestKind === 'leave' ? "border-blue-200 text-blue-700 bg-blue-50" : "border-orange-200 text-orange-700 bg-orange-50")}>
                          {r.requestKind === 'leave' ? 'Congé' : 'Absence'}
                        </Badge>
                        <span className="text-xs font-bold text-slate-700">{TIME_OFF_TYPE_LABELS[r.requestType]}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <Calendar className="w-3.5 h-3.5 text-primary/40" />
                        {r.startDate === r.endDate ? (
                          <span>{formatDate(r.startDate)}</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span>{formatDate(r.startDate)}</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
                            <span>{formatDate(r.endDate)}</span>
                          </div>
                        )}
                        {r.dayPart !== "full_day" && (
                          <Badge variant="outline" className="text-[8px] h-4 bg-slate-50">{r.dayPart === 'morning' ? 'Matin' : 'Après-midi'}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 font-black text-primary">
                          <Clock className="w-3.5 h-3.5 opacity-30" />
                          {r.durationDays} j
                       </div>
                    </TableCell>
                    <TableCell>
                       {getStatusBadge(r.status)}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                       <Button variant="ghost" size="sm" className="h-8 rounded-lg font-bold gap-2 text-muted-foreground opacity-40 cursor-not-allowed">
                          Actions <ChevronRight className="w-3.5 h-3.5" />
                       </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Creation Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[550px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Nouvelle demande (RH)</DialogTitle>
            <DialogDescription>Créez manuellement une absence ou un congé pour un collaborateur.</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSave} className="space-y-6 py-4">
             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">Collaborateur</Label>
                <Select value={formData.employeeId} onValueChange={(v) => setFormData(p => ({...p, employeeId: v}))}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Sélectionner un employé actif..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees?.map(e => (
                      <SelectItem key={e.employeeId} value={e.employeeId}>{e.displayName} ({e.jobTitle})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Type global</Label>
                  <Select value={formData.requestKind} onValueChange={(v: any) => setFormData(p => ({...p, requestKind: v, requestType: v === 'leave' ? 'paid_leave' : 'sickness'}))}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leave">Congé (Vacances/RTT)</SelectItem>
                      <SelectItem value="absence">Absence (Maladie/Autre)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Motif précis</Label>
                  <Select value={formData.requestType} onValueChange={(v: any) => setFormData(p => ({...p, requestType: v}))}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {formData.requestKind === 'leave' ? (
                        <>
                          <SelectItem value="paid_leave">Congé payé</SelectItem>
                          <SelectItem value="unpaid_leave">Congé sans solde</SelectItem>
                          <SelectItem value="permission">Permission / RTT</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="sickness">Maladie</SelectItem>
                          <SelectItem value="work_accident">Accident du travail</SelectItem>
                          <SelectItem value="unjustified_absence">Absence injustifiée</SelectItem>
                          <SelectItem value="other">Autre motif</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Date de début</Label>
                  <Input type="date" value={formData.startDate} onChange={(e) => setFormData(p => ({...p, startDate: e.target.value}))} required className="rounded-xl h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Date de fin (incluse)</Label>
                  <Input type="date" value={formData.endDate} onChange={(e) => setFormData(p => ({...p, endDate: e.target.value}))} required className="rounded-xl h-11" />
                </div>
             </div>

             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">Format de la journée (Si dates identiques)</Label>
                <Select 
                  value={formData.dayPart} 
                  onValueChange={(v: any) => setFormData(p => ({...p, dayPart: v}))}
                  disabled={formData.startDate !== formData.endDate}
                >
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_day">Journée entière</SelectItem>
                    <SelectItem value="morning">Matin uniquement (0.5j)</SelectItem>
                    <SelectItem value="afternoon">Après-midi uniquement (0.5j)</SelectItem>
                  </SelectContent>
                </Select>
                {formData.startDate !== formData.endDate && (
                   <p className="text-[9px] text-muted-foreground italic pl-1">Le format "Demi-journée" n'est disponible que pour les demandes d'un seul jour.</p>
                )}
             </div>

             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">Observations / Commentaires (RH)</Label>
                <Textarea 
                  value={formData.reason} 
                  onChange={(e) => setFormData(p => ({...p, reason: e.target.value}))} 
                  placeholder="Notes internes sur cette absence..."
                  className="rounded-xl min-h-[100px]"
                />
             </div>

             <DialogFooter className="pt-4 border-t gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} disabled={loading}>Annuler</Button>
                <Button type="submit" disabled={loading} className="rounded-xl font-black px-8 shadow-lg shadow-primary/20">
                   {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                   Enregistrer la demande
                </Button>
             </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(val: string) {
  if (!val) return "-";
  return format(new Date(val), "dd/MM/yyyy", { locale: fr });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'submitted': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">En attente</Badge>;
    case 'approved': return <Badge className="bg-green-600 text-white border-none">Approuvé</Badge>;
    case 'rejected': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Refusé</Badge>;
    case 'cancelled': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Annulé</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}
