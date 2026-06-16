"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Plus, Loader2, Calendar, User, Briefcase, 
  Clock, Filter, X, ListFilter, AlertCircle,
  FileText, CheckCircle2, History, Send,
  ChevronRight, ArrowRight, MoreVertical,
  XCircle, Ban, FileWarning, Paperclip, Upload,
  Download, Eye
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
import { TimeOffRequest, TimeOffRequestType, TimeOffRequestKind, TIME_OFF_TYPE_LABELS, JustificationStatus } from "@/types/time-off";
import { HRDocumentType } from "@/types/hr-document";
import { 
  createTimeOffRequestForEmployee, 
  approveTimeOffRequest, 
  rejectTimeOffRequest, 
  cancelTimeOffRequest,
  addJustificationDocumentToRequest
} from "@/services/time-off.service";
import { uploadHRDocument, getDocumentDownloadUrl } from "@/services/document.service";
import { Employee } from "@/types/employee";
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
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
  reason: "",
  requiresJustification: false,
  justificationNote: ""
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

  // Decision State
  const [decisionPending, setDecisionPending] = useState<{ id: string, action: 'approve' | 'reject' | 'cancel' } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Upload State
  const [uploadingRequest, setUploadingRequest] = useState<TimeOffRequest | null>(null);
  const [uploadFile, setReplacementFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const canRead = hasPermission("leaveRequests.read");
  const canCreate = hasPermission("leaveRequests.create");
  const canUpdate = hasPermission("leaveRequests.update");
  const canApprove = hasPermission("leaveRequests.approve");

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

  // Handle default justification rules in UI
  const handleTypeChange = (type: TimeOffRequestType) => {
    let requires = false;
    if (["sickness", "work_accident"].includes(type)) {
      requires = true;
    } else if (["permission", "other"].includes(type)) {
      requires = false; // Default to false but can be toggled
    }
    setFormData(p => ({ ...p, requestType: type, requiresJustification: requires }));
  };

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

  const handleExecuteDecision = async () => {
    if (!decisionPending || !user || !membership) return;
    setLoading(true);
    try {
      if (decisionPending.action === 'approve') {
        await approveTimeOffRequest(entityId, decisionPending.id, user.uid, membership.roleId);
        toast({ title: "Demande approuvée" });
      } else if (decisionPending.action === 'reject') {
        if (!rejectionReason.trim()) throw new Error("Le motif du refus est obligatoire.");
        await rejectTimeOffRequest(entityId, decisionPending.id, rejectionReason, user.uid, membership.roleId);
        toast({ title: "Demande refusée" });
      } else if (decisionPending.action === 'cancel') {
        await cancelTimeOffRequest(entityId, decisionPending.id, user.uid, membership.roleId);
        toast({ title: "Demande annulée" });
      }
      setDecisionPending(null);
      setRejectionReason("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !uploadingRequest || !uploadFile) return;

    setIsUploading(true);
    try {
      let docType: HRDocumentType = "absence_justification";
      let title = `Justificatif d'absence - ${uploadingRequest.employeeName} - ${uploadingRequest.startDate}`;

      if (uploadingRequest.requestType === "sickness") {
        docType = "medical_certificate";
        title = `Certificat médical - ${uploadingRequest.employeeName} - ${uploadingRequest.startDate}`;
      } else if (uploadingRequest.requestType === "work_accident") {
        docType = "work_accident_justification";
        title = `Justificatif accident du travail - ${uploadingRequest.employeeName} - ${uploadingRequest.startDate}`;
      }

      const docId = await uploadHRDocument(
        entityId,
        uploadFile,
        {
          title,
          documentType: docType,
          employeeId: uploadingRequest.employeeId,
          personId: uploadingRequest.personId || null,
          relatedModule: "timeOffRequests",
          relatedId: uploadingRequest.requestId,
          status: "valid"
        },
        user.uid,
        membership?.userDisplayName || "Utilisateur"
      );

      await addJustificationDocumentToRequest(
        entityId,
        uploadingRequest.requestId,
        docId,
        uploadNote,
        user.uid
      );

      toast({ title: "Justificatif ajouté", description: "Le document a été lié à la demande." });
      setUploadingRequest(null);
      setReplacementFile(null);
      setUploadNote("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenJustification = async (requestId: string) => {
    const request = requests?.find(r => r.requestId === requestId);
    if (!request || !request.justificationDocumentIds || request.justificationDocumentIds.length === 0) return;

    const docId = request.justificationDocumentIds[0];
    setLoading(true);
    try {
      // We need storage path from the document registry
      const { useFirestore } = await import("@/firebase");
      const { getDoc, doc } = await import("firebase/firestore");
      const docSnap = await getDoc(doc(db!, `entities/${entityId}/documents`, docId));
      
      if (docSnap.exists()) {
        const url = await getDocumentDownloadUrl(docSnap.data().storagePath);
        window.open(url, "_blank");
      } else {
        throw new Error("Document introuvable dans le registre.");
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
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
                <SelectItem value="submitted">En attente</SelectItem>
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
                <TableHead>Justificatif</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRequests ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-20 text-muted-foreground">
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
                       {renderJustificationStatus(r)}
                    </TableCell>
                    <TableCell>
                       <div className="flex flex-col gap-1">
                          {getStatusBadge(r.status)}
                          {r.status === 'rejected' && r.rejectionReason && (
                            <p className="text-[9px] text-red-600 italic font-medium truncate max-w-[120px]" title={r.rejectionReason}>
                               "{r.rejectionReason}"
                            </p>
                          )}
                       </div>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                       <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                             <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                             {canUpdate && r.justificationStatus === 'missing' && r.requiresJustification && (
                               <DropdownMenuItem onClick={() => setUploadingRequest(r)} className="text-primary font-bold gap-2">
                                  <Upload className="w-4 h-4" /> Ajouter justificatif
                               </DropdownMenuItem>
                             )}
                             {r.justificationStatus === 'provided' && (
                               <DropdownMenuItem onClick={() => handleOpenJustification(r.requestId)} className="gap-2">
                                  <Eye className="w-4 h-4" /> Voir justificatif
                               </DropdownMenuItem>
                             )}
                             <DropdownMenuSeparator />
                             {canApprove && r.status === 'submitted' && (
                                <>
                                  <DropdownMenuItem onClick={() => setDecisionPending({ id: r.requestId, action: 'approve' })} className="text-green-600 font-bold gap-2">
                                     <CheckCircle2 className="w-4 h-4" /> Approuver
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setDecisionPending({ id: r.requestId, action: 'reject' })} className="text-red-600 font-bold gap-2">
                                     <XCircle className="w-4 h-4" /> Refuser
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                             )}
                             {canApprove && (r.status === 'submitted' || r.status === 'approved') && (
                                <DropdownMenuItem onClick={() => setDecisionPending({ id: r.requestId, action: 'cancel' })} className="text-muted-foreground gap-2">
                                   <Ban className="w-4 h-4" /> Annuler
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
                  <Select value={formData.requestType} onValueChange={(v: any) => handleTypeChange(v)}>
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
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border">
                   <div className="space-y-0.5">
                      <Label className="text-xs font-bold text-primary">Justificatif requis ?</Label>
                      <p className="text-[10px] text-muted-foreground">Activez si un document GED est nécessaire.</p>
                   </div>
                   <Switch 
                    checked={formData.requiresJustification} 
                    onCheckedChange={(v) => setFormData(p => ({...p, requiresJustification: v}))}
                    disabled={["sickness", "work_accident"].includes(formData.requestType)}
                   />
                </div>
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

      {/* Justification Upload Modal */}
      <Dialog open={!!uploadingRequest} onOpenChange={(open) => !open && setUploadingRequest(null)}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
           <DialogHeader>
              <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
                <Paperclip className="w-6 h-6" /> Ajouter un justificatif
              </DialogTitle>
              <DialogDescription>
                 Joindre un document officiel pour {uploadingRequest?.employeeName}.
              </DialogDescription>
           </DialogHeader>
           
           <form onSubmit={handleExecuteUpload} className="space-y-6 py-4">
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center relative group hover:bg-slate-100 transition-colors">
                   <input 
                    type="file" 
                    accept=".pdf,.png,.jpg,.jpeg" 
                    onChange={(e) => setReplacementFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    required
                   />
                   <div className="flex flex-col items-center gap-2">
                      <div className="bg-white p-3 rounded-2xl shadow-sm text-primary/40 group-hover:text-primary transition-colors">
                        <Upload className="w-6 h-6" />
                      </div>
                      {uploadFile ? (
                        <p className="text-xs font-bold text-green-600 truncate max-w-xs">{uploadFile.name}</p>
                      ) : (
                        <p className="text-xs font-bold text-slate-500">Cliquer pour choisir un fichier (PDF, Image)</p>
                      )}
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Max 10 Mo</p>
                   </div>
                </div>

                <div className="space-y-2">
                   <Label className="text-[10px] uppercase font-black text-muted-foreground">Note ou commentaire (Optionnel)</Label>
                   <Textarea 
                    value={uploadNote}
                    onChange={(e) => setUploadNote(e.target.value)}
                    placeholder="Détails sur le document..."
                    className="rounded-xl min-h-[80px]"
                   />
                </div>
              </div>

              <DialogFooter className="pt-4 border-t">
                 <Button type="button" variant="ghost" onClick={() => setUploadingRequest(null)} disabled={isUploading}>Annuler</Button>
                 <Button type="submit" disabled={isUploading || !uploadFile} className="rounded-xl font-black px-8 shadow-lg shadow-primary/10">
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    Confirmer l'ajout
                 </Button>
              </DialogFooter>
           </form>
        </DialogContent>
      </Dialog>

      {/* Decision AlertDialogs */}
      <AlertDialog open={!!decisionPending && decisionPending.action !== 'reject'} onOpenChange={(open) => !open && setDecisionPending(null)}>
        <AlertDialogContent className="rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decisionPending?.action === 'approve' ? 'Approuver la demande ?' : 'Annuler la demande ?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decisionPending?.action === 'approve' 
                ? "Cette action confirmera l'absence du collaborateur." 
                : "Cette action marquera la demande comme annulée et non avenue."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Retour</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); handleExecuteDecision(); }}
              className={cn("rounded-xl font-bold px-8", decisionPending?.action === 'approve' ? "bg-green-600 hover:bg-green-700" : "bg-destructive")}
              disabled={loading}
            >
               {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
               Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejection Dialog */}
      <Dialog open={!!decisionPending && decisionPending.action === 'reject'} onOpenChange={(open) => !open && setDecisionPending(null)}>
         <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
            <DialogHeader>
               <DialogTitle className="text-xl font-black text-red-600">Refuser la demande</DialogTitle>
               <DialogDescription>Veuillez indiquer le motif du refus pour informer le collaborateur.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Motif du refus (Requis)</Label>
                  <Textarea 
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Ex: Nécessité de service, effectif insuffisant..."
                    className="rounded-xl min-h-[100px]"
                  />
               </div>
            </div>
            <DialogFooter>
               <Button variant="ghost" onClick={() => { setDecisionPending(null); setRejectionReason(""); }} disabled={loading}>Annuler</Button>
               <Button 
                onClick={handleExecuteDecision} 
                disabled={loading || !rejectionReason.trim()}
                className="bg-red-600 hover:bg-red-700 text-white font-black rounded-xl px-8"
               >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                  Confirmer le refus
               </Button>
            </DialogFooter>
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

function renderJustificationStatus(r: TimeOffRequest) {
  const isSickness = ["sickness", "work_accident"].includes(r.requestType);
  const requires = r.requiresJustification ?? isSickness;
  const docIds = r.justificationDocumentIds || [];
  const status = r.justificationStatus || (requires ? (docIds.length > 0 ? "provided" : "missing") : "not_required");

  if (!requires) return <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">Non requis</span>;

  switch (status) {
    case 'missing': 
      return (
        <div className="flex items-center gap-1.5 text-red-600 font-bold text-[10px] uppercase">
          <FileWarning className="w-3.5 h-3.5" />
          Manquant
        </div>
      );
    case 'provided':
      return (
        <div className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase">
          <FileText className="w-3.5 h-3.5" />
          Fourni
        </div>
      );
    default:
      return <span className="text-[10px] text-muted-foreground uppercase">N/A</span>;
  }
}
