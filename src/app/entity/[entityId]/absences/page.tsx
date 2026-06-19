"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Plus, Loader2, Calendar, User, Briefcase, 
  Clock, Filter, X, ListFilter, AlertCircle,
  FileText, CheckCircle2, History, Send,
  ChevronRight, ArrowRight, MoreVertical,
  XCircle, Ban, FileWarning, Paperclip, Upload,
  Download, Eye, Euro, Settings2, Calculator, Save,
  BarChart, Trash2, ShieldCheck, RefreshCw, CheckCircle,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query, where, getDoc, doc } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { TimeOffRequest, TimeOffRequestType, TimeOffRequestKind, TIME_OFF_TYPE_LABELS, LeaveBalance, normalizeBalance, MonthlyAccrual } from "@/types/time-off";
import { HRDocumentType } from "@/types/hr-document";
import { 
  createTimeOffRequestForEmployee, 
  approveTimeOffRequest, 
  rejectTimeOffRequest, 
  cancelTimeOffRequest,
  addJustificationDocumentToRequest,
  updateLeaveBalanceManual,
  runMonthlyAccrualCalculation,
  updateMonthlyAccrualStatus,
  postMonthlyAccrualToBalance
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import React from "react";

const initialForm = {
  employeeId: "",
  requestKind: "leave" as TimeOffRequestKind,
  requestType: "paid_leave" as TimeOffRequestType,
  startDate: new Date().toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0],
  startTime: "09:00",
  endTime: "10:00",
  dayPart: "full_day" as any,
  durationHours: "",
  reason: "",
  requiresJustification: false,
  justificationNote: ""
};

const initialBalanceForm = {
  employeeId: "",
  year: new Date().getFullYear(),
  paid_leave: { entitlement: 25, carriedOver: 0, accrued: 0 },
  rol: { entitlement: 0, carriedOver: 0, accrued: 0 },
  ex_holidays: { entitlement: 0, carriedOver: 0, accrued: 0 }
};

const initialAccrualForm = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  employeeId: "all",
  usefulDaysMode: "time_off_estimate" as any,
  manualUsefulDays: 22
};

function calculateDecimalHours(start: string, end: string): string {
  if (!start || !end) return "0";
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const startMins = sH * 60 + sM;
  const endMins = eH * 60 + eM;
  if (endMins <= startMins) return "0";
  const hours = (endMins - startMins) / 60;
  return hours.toFixed(2).replace(/\.00$/, "");
}

export default function TimeOffManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  const [activeTab, setActiveTab] = useState("requests");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isBalanceModalOpen, setIsBalanceModalOpen] = useState(false);
  const [isAccrualModalOpen, setIsAccrualModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const [balanceForm, setBalanceForm] = useState(initialBalanceForm);
  const [accrualForm, setAccrualForm] = useState(initialAccrualForm);
  const [statusFilter, setStatusFilter] = useState("all");

  // Posting State (Phase 2I)
  const [accrualToPost, setAccrualToPost] = useState<MonthlyAccrual | null>(null);

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
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, canRead]);

  const balancesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/leaveBalances`), orderBy("year", "desc")) as Query<LeaveBalance>;
  }, [db, entityId, canRead]);

  const accrualsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/monthlyAccruals`), orderBy("periodKey", "desc")) as Query<MonthlyAccrual>;
  }, [db, entityId, canRead]);

  const { data: requests, loading: loadingRequests } = useCollection<TimeOffRequest>(requestsQuery);
  const { data: employees } = useCollection<Employee>(employeesQuery);
  const { data: rawBalances, loading: loadingBalances } = useCollection<LeaveBalance>(balancesQuery);
  const { data: accruals, loading: loadingAccruals } = useCollection<MonthlyAccrual>(accrualsQuery);

  const activeEmployees = useMemo(() => {
    if (!employees) return [];
    return employees.filter(e => {
      const s = String(e.status || '').toLowerCase();
      return s === 'active' || s === 'actif' || s === 'active_contract';
    });
  }, [employees]);

  const balances = useMemo(() => rawBalances.map(normalizeBalance), [rawBalances]);

  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    if (statusFilter === "all") return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleTypeChange = (type: TimeOffRequestType) => {
    let requires = false;
    if (["sickness", "work_accident"].includes(type)) {
      requires = true;
    }
    
    setFormData(p => ({ 
      ...p, 
      requestType: type, 
      requiresJustification: requires,
      requestKind: (type === "rol_permission" || type === "ex_holiday_permission") ? "leave" : p.requestKind
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !membership || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez sélectionner un employé." });
      return;
    }

    const isHourly = ["rol_permission", "ex_holiday_permission"].includes(formData.requestType);
    let finalDurationHours = undefined;

    if (isHourly) {
      const duration = Number(calculateDecimalHours(formData.startTime, formData.endTime));
      if (duration <= 0) {
        toast({ variant: "destructive", title: "Heures invalides", description: "L'heure de fin doit être supérieure à l'heure de début." });
        return;
      }
      finalDurationHours = duration;
    } else {
      if (formData.endDate < formData.startDate) {
        toast({ variant: "destructive", title: "Erreur", description: "La date de fin ne peut pas être antérieure à la date de début." });
        return;
      }
    }

    setLoading(true);
    try {
      const emp = activeEmployees.find(e => e.employeeId === formData.employeeId);
      
      await createTimeOffRequestForEmployee(
        entityId,
        {
          ...formData,
          durationHours: isHourly ? finalDurationHours : undefined,
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

  const handleRunAccrual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      await runMonthlyAccrualCalculation({
        entityId,
        year: accrualForm.year,
        month: accrualForm.month,
        employeeId: accrualForm.employeeId === "all" ? undefined : accrualForm.employeeId,
        usefulDaysMode: accrualForm.usefulDaysMode,
        manualUsefulDays: accrualForm.manualUsefulDays,
        actorUid: user.uid
      });

      toast({ title: "Calcul terminé", description: "Les maturations ont été générées en mode brouillon." });
      setIsAccrualModalOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de calcul", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAccrualStatus = async (id: string, status: "confirmed" | "cancelled") => {
    if (!user || !entityId) return;
    try {
      await updateMonthlyAccrualStatus(entityId, id, status, user.uid);
      toast({ title: status === 'confirmed' ? "Maturation confirmée" : "Maturation annulée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  const handlePostAccrualToBalance = async () => {
    if (!user || !entityId || !accrualToPost || !membership) return;
    setLoading(true);
    try {
      await postMonthlyAccrualToBalance(
        entityId, 
        accrualToPost.id, 
        user.uid, 
        membership.roleId
      );
      toast({ title: "Maturation postée", description: "Le solde annuel a été mis à jour." });
      setAccrualToPost(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de transfert", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !membership || !entityId) return;
    if (!balanceForm.employeeId) return;

    setLoading(true);
    try {
      await updateLeaveBalanceManual(
        entityId,
        balanceForm.employeeId,
        balanceForm.year,
        {
          paid_leave: {
             entitlement: Number(balanceForm.paid_leave.entitlement),
             carriedOver: Number(balanceForm.paid_leave.carriedOver),
             accrued: Number(balanceForm.paid_leave.accrued)
          },
          rol: {
             entitlement: Number(balanceForm.rol.entitlement),
             carriedOver: Number(balanceForm.rol.carriedOver),
             accrued: Number(balanceForm.rol.accrued)
          },
          ex_holidays: {
             entitlement: Number(balanceForm.ex_holidays.entitlement),
             carriedOver: Number(balanceForm.ex_holidays.carriedOver),
             accrued: Number(balanceForm.ex_holidays.accrued)
          }
        },
        user.uid,
        membership.roleId
      );
      toast({ title: "Solde mis à jour" });
      setIsBalanceModalOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
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
        await rejectTimeOffRequest(entityId, decisionPending.id, rejectionReason, user.uid, membership.roleId);
        toast({ title: "Demande refusée" });
      } else if (decisionPending.action === 'cancel') {
        await cancelTimeOffRequest(entityId, decisionPending.id, user.uid, membership.roleId);
        toast({ title: "Demande annulée" });
      }
      setDecisionPending(null);
      rejectionReason && setRejectionReason("");
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

  const isHourly = ["rol_permission", "ex_holiday_permission"].includes(formData.requestType);

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Absences & Congés</h1>
          <p className="text-muted-foreground text-sm">Gestion des demandes de temps libre et absences maladie.</p>
        </div>
        <div className="flex gap-3">
          {canUpdate && (
            <Button onClick={() => setIsAccrualModalOpen(true)} variant="outline" className="gap-2 rounded-xl font-bold border-accent text-accent hover:bg-accent/5">
              <RefreshCw className="w-4 h-4" /> Calculer maturation
            </Button>
          )}
          {canUpdate && (
            <Button onClick={() => setIsBalanceModalOpen(true)} variant="outline" className="gap-2 rounded-xl font-bold border-dashed">
              <Calculator className="w-4 h-4" /> Gérer les soldes
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setIsFormOpen(true)} className="gap-2 shadow-lg shadow-primary/10 rounded-xl font-bold">
              <Plus className="w-4 h-4" /> Nouvelle demande
            </Button>
          )}
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-white border rounded-xl p-1 h-11">
          <TabsTrigger value="requests" className="rounded-lg px-6 font-bold">Demandes</TabsTrigger>
          <TabsTrigger value="accruals" className="rounded-lg px-6 font-bold">Maturations mensuelles</TabsTrigger>
          <TabsTrigger value="balances" className="rounded-lg px-6 font-bold">Soldes annuels</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-6 mt-0">
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
                        </div>
                        {r.startTime && r.endTime && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                             <Clock className="w-2.5 h-2.5" />
                             {r.startTime} - {r.endTime}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                         <div className="flex items-center gap-1.5 font-black text-primary">
                            <Clock className="w-3.5 h-3.5 opacity-30" />
                            {(() => {
                              if (r.unit === "hours" || ['rol_permission', 'ex_holiday_permission'].includes(r.requestType)) {
                                return r.durationHours !== undefined && r.durationHours !== null ? `${r.durationHours} h` : "—";
                              }
                              return r.durationDays !== undefined && r.durationDays !== null ? `${r.durationDays} j` : "—";
                            })()}
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
                                    <DropdownMenuItem 
                                      onClick={() => setDecisionPending({ id: r.requestId, action: 'approve' })} 
                                      className={cn("text-green-600 font-bold gap-2", 
                                        (r.requiresJustification && r.justificationStatus === 'missing') && "opacity-50 pointer-events-none"
                                      )}
                                    >
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
        </TabsContent>

        <TabsContent value="accruals" className="mt-0 space-y-6">
           <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-2xl">
              <Table>
                 <TableHeader className="bg-secondary/20">
                    <TableRow>
                       <TableHead className="pl-6">Employé</TableHead>
                       <TableHead>Période</TableHead>
                       <TableHead>Qualification</TableHead>
                       <TableHead>Jours utiles</TableHead>
                       <TableHead>Congés (j)</TableHead>
                       <TableHead>ROL (h)</TableHead>
                       <TableHead>Ex Fest. (h)</TableHead>
                       <TableHead>Statut</TableHead>
                       <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                 </TableHeader>
                 <TableBody>
                    {loadingAccruals ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                    ) : accruals?.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-20 text-muted-foreground italic">Aucune maturation calculée.</TableCell></TableRow>
                    ) : (
                      accruals?.map(a => (
                        <TableRow key={a.id} className="hover:bg-muted/50">
                           <TableCell className="pl-6 py-4 font-bold text-slate-900">{a.employeeName}</TableCell>
                           <TableCell className="text-xs font-medium uppercase">{a.periodKey}</TableCell>
                           <TableCell>
                              {a.isAccrualQualified ? (
                                <Badge className="bg-green-600 text-white border-none text-[8px]">QUALIFIÉ</Badge>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                   <Badge variant="destructive" className="text-[8px]">NON QUALIFIÉ</Badge>
                                   {a.blockingReasonFound && <p className="text-[8px] text-red-600 font-bold">Bloquant trouvé</p>}
                                </div>
                              )}
                           </TableCell>
                           <TableCell className="text-xs">
                              <span className={cn("font-bold", a.usefulDaysCount < (a.ruleSnapshot?.usefulDaysThreshold || 14) ? "text-red-600" : "text-green-700")}>
                                {a.usefulDaysCount} j
                              </span>
                              <p className="text-[9px] text-muted-foreground uppercase">{a.usefulDaysSource === 'manual' ? 'Saisie' : 'Est.'}</p>
                           </TableCell>
                           <TableCell className="font-bold">{a.accrued.paid_leave.toFixed(2)}</TableCell>
                           <TableCell className="font-bold">{a.accrued.rol.toFixed(2)}</TableCell>
                           <TableCell className="font-bold">{a.accrued.ex_holidays.toFixed(2)}</TableCell>
                           <TableCell>
                              {getAccrualStatusBadge(a.status)}
                           </TableCell>
                           <TableCell className="text-right pr-6">
                              {a.status === 'draft' && (
                                <div className="flex justify-end gap-2">
                                   <Button variant="ghost" size="icon" className="text-green-600" onClick={() => handleUpdateAccrualStatus(a.id, 'confirmed')}><CheckCircle className="w-4 h-4" /></Button>
                                   <Button variant="ghost" size="icon" className="text-red-600" onClick={() => handleUpdateAccrualStatus(a.id, 'cancelled')}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              )}
                              {a.status === 'confirmed' && (
                                <div className="flex justify-end gap-2">
                                   <Button variant="secondary" size="sm" className="h-8 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10 gap-1.5" onClick={() => setAccrualToPost(a)}>
                                      <Send className="w-3.5 h-3.5" /> Poster au solde
                                   </Button>
                                   <Button variant="ghost" size="icon" className="text-red-600" onClick={() => handleUpdateAccrualStatus(a.id, 'cancelled')}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              )}
                           </TableCell>
                        </TableRow>
                      ))
                    )}
                 </TableBody>
              </Table>
           </Card>
        </TabsContent>

        <TabsContent value="balances" className="mt-0">
           <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-2xl">
              <Table>
                <TableHeader className="bg-secondary/20">
                   <TableRow>
                      <TableHead className="pl-6">Embauché (Matricule)</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Droit CCNL / Report N-1</TableHead>
                      <TableHead>Acquis (Maturation)</TableHead>
                      <TableHead>Utilisé</TableHead>
                      <TableHead>Attente</TableHead>
                      <TableHead>Restant</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                   {loadingBalances ? (
                     <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                   ) : balances?.length === 0 ? (
                     <TableRow><TableCell colSpan={8} className="text-center py-20 text-muted-foreground italic">Aucun solde initialisé.</TableCell></TableRow>
                   ) : (
                     balances?.map(b => (
                       <React.Fragment key={`${b.employeeId}_${b.year}`}>
                         {/* Paid Leave Row */}
                         <TableRow className="border-t-2">
                            <TableCell rowSpan={3} className="pl-6 py-4 bg-slate-50/30 align-top">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900">{activeEmployees.find(e => e.employeeId === b.employeeId)?.displayName || b.employeeId}</span>
                                <Badge variant="outline" className="w-fit mt-1">{b.year}</Badge>
                                {b.ccnlSnapshot?.ccnlName && (
                                  <span className="text-[9px] text-muted-foreground uppercase font-bold mt-2">
                                    Source: {b.ccnlSnapshot.ccnlName} {b.ccnlSnapshot.levelCode ? `(${b.ccnlSnapshot.levelCode})` : ''}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-black text-xs text-blue-700">Ferie (Congés)</TableCell>
                            <TableCell className="text-xs">
                               <div className="flex flex-col">
                                  <span className="text-muted-foreground">Annuel: {b.counters?.paid_leave.entitlement ?? 0}j</span>
                                  <span className="font-bold">Report: {b.counters?.paid_leave.carriedOver ?? 0}j</span>
                               </div>
                            </TableCell>
                            <TableCell className="text-xs">{b.counters?.paid_leave.accrued.toFixed(2)}j</TableCell>
                            <TableCell className="text-xs font-bold text-red-600">{b.counters?.paid_leave.used ?? 0}j</TableCell>
                            <TableCell className="text-xs font-medium text-orange-600">{b.counters?.paid_leave.pending ?? 0}j</TableCell>
                            <TableCell><Badge className="bg-primary text-white font-black">{b.counters?.paid_leave.remaining.toFixed(2)}j</Badge></TableCell>
                            <TableCell rowSpan={3} className="text-right pr-6 bg-slate-50/30 align-top py-4">
                               <Button variant="ghost" size="icon" onClick={() => {
                                 setBalanceForm({
                                   employeeId: b.employeeId,
                                   year: b.year,
                                   paid_leave: { entitlement: b.counters?.paid_leave.entitlement || 0, carriedOver: b.counters?.paid_leave.carriedOver || 0, accrued: b.counters?.paid_leave.accrued || 0 },
                                   rol: { entitlement: b.counters?.rol.entitlement || 0, carriedOver: b.counters?.rol.carriedOver || 0, accrued: b.counters?.rol.accrued || 0 },
                                   ex_holidays: { entitlement: b.counters?.ex_holidays.entitlement || 0, carriedOver: b.counters?.ex_holidays.carriedOver || 0, accrued: b.counters?.ex_holidays.accrued || 0 }
                                 });
                                 setIsBalanceModalOpen(true);
                               }}>
                                 <Settings2 className="w-4 h-4" />
                               </Button>
                            </TableCell>
                         </TableRow>
                         {/* ROL Row */}
                         <TableRow>
                            <TableCell className="font-black text-xs text-indigo-700">ROL</TableCell>
                            <TableCell className="text-xs">
                               <div className="flex flex-col">
                                  <span className="text-muted-foreground">Annuel: {b.counters?.rol.entitlement ?? 0}h</span>
                                  <span className="font-bold">Report: {b.counters?.rol.carriedOver ?? 0}h</span>
                               </div>
                            </TableCell>
                            <TableCell className="text-xs">{b.counters?.rol.accrued.toFixed(2)}h</TableCell>
                            <TableCell className="text-xs font-bold text-red-600">{b.counters?.rol.used ?? 0}h</TableCell>
                            <TableCell className="text-xs font-medium text-orange-600">{b.counters?.rol.pending ?? 0}h</TableCell>
                            <TableCell><Badge variant="outline" className="font-black border-indigo-200 text-indigo-700">{b.counters?.rol.remaining.toFixed(2)}h</Badge></TableCell>
                         </TableRow>
                         {/* Ex Holidays Row */}
                         <TableRow>
                            <TableCell className="font-black text-xs text-teal-700">Ex Festività</TableCell>
                            <TableCell className="text-xs">
                               <div className="flex flex-col">
                                  <span className="text-muted-foreground">Annuel: {b.counters?.ex_holidays.entitlement ?? 0}h</span>
                                  <span className="font-bold">Report: {b.counters?.ex_holidays.carriedOver ?? 0}h</span>
                               </div>
                            </TableCell>
                            <TableCell className="text-xs">{b.counters?.ex_holidays.accrued.toFixed(2)}h</TableCell>
                            <TableCell className="text-xs font-bold text-red-600">{b.counters?.ex_holidays.used ?? 0}h</TableCell>
                            <TableCell className="text-xs font-medium text-orange-600">{b.counters?.ex_holidays.pending ?? 0}h</TableCell>
                            <TableCell><Badge variant="outline" className="font-black border-teal-200 text-teal-700">{b.counters?.ex_holidays.remaining.toFixed(2)}h</Badge></TableCell>
                         </TableRow>
                       </React.Fragment>
                     ))
                   )}
                </TableBody>
              </Table>
           </Card>
        </TabsContent>
      </Tabs>

      {/* Posting Confirmation Dialog (Phase 2I) */}
      <AlertDialog open={!!accrualToPost} onOpenChange={(open) => !open && setAccrualToPost(null)}>
        <AlertDialogContent className="rounded-[2rem] sm:max-w-[450px]">
           <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black text-primary">Poster la maturation au solde ?</AlertDialogTitle>
              <AlertDialogDescription>
                 Cette action ajoutera les droits calculés au solde annuel de l’employé. Elle ne doit être réalisée qu’après vérification RH.
              </AlertDialogDescription>
           </AlertDialogHeader>
           
           {accrualToPost && (
             <div className="py-4 space-y-3">
                <div className="p-4 bg-slate-50 rounded-2xl border flex flex-col gap-2">
                   <div className="flex justify-between text-sm">
                      <span className="font-medium text-muted-foreground">Congés (Ferie)</span>
                      <span className="font-black text-blue-700">{accrualToPost.accrued.paid_leave.toFixed(2)} j</span>
                   </div>
                   <div className="flex justify-between text-sm">
                      <span className="font-medium text-muted-foreground">ROL</span>
                      <span className="font-black text-indigo-700">{accrualToPost.accrued.rol.toFixed(2)} h</span>
                   </div>
                   <div className="flex justify-between text-sm">
                      <span className="font-medium text-muted-foreground">Ex Festività</span>
                      <span className="font-black text-teal-700">{accrualToPost.accrued.ex_holidays.toFixed(2)} h</span>
                   </div>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase font-bold text-center">Employé: {accrualToPost.employeeName}</p>
             </div>
           )}

           <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
              <AlertDialogAction 
                onClick={(e) => { e.preventDefault(); handlePostAccrualToBalance(); }}
                disabled={loading}
                className="bg-primary text-white font-black rounded-xl px-8"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Poster au solde
              </AlertDialogAction>
           </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Accrual Calculation Modal */}
      <Dialog open={isAccrualModalOpen} onOpenChange={setIsAccrualModalOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-[2rem]">
           <DialogHeader>
              <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
                 <RefreshCw className="w-5 h-5 text-accent" /> Calculer maturation mensuelle
              </DialogTitle>
              <DialogDescription>Générez les acquisitions de congés et ROL pour une période donnée.</DialogDescription>
           </DialogHeader>

           <form onSubmit={handleRunAccrual} className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase">Année</Label>
                    <Input type="number" value={accrualForm.year} onChange={(e) => setAccrualForm(p => ({...p, year: parseInt(e.target.value)}))} className="rounded-xl h-11" />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase">Mois</Label>
                    <Select value={accrualForm.month.toString()} onValueChange={(v) => setAccrualForm(p => ({...p, month: parseInt(v)}))}>
                       <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                       <SelectContent>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                            <SelectItem key={m} value={m.toString()}>{format(new Date(2000, m-1), 'MMMM', { locale: fr })}</SelectItem>
                          ))}
                       </SelectContent>
                    </Select>
                 </div>
              </div>

              <div className="space-y-2">
                 <Label className="text-[10px] font-black uppercase">Collaborateur (Optionnel)</Label>
                 <Select value={accrualForm.employeeId} onValueChange={(v) => setAccrualForm(p => ({...p, employeeId: v}))}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Tous les actifs" /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="all">Calcul groupé (Tous les actifs)</SelectItem>
                       {activeEmployees.map(e => (
                         <SelectItem key={e.employeeId} value={e.employeeId}>{e.displayName}</SelectItem>
                       ))}
                    </SelectContent>
                 </Select>
              </div>

              <Separator />

              <div className="space-y-4">
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase">Mode jours utiles</Label>
                    <Select value={accrualForm.usefulDaysMode} onValueChange={(v: any) => setAccrualForm(p => ({...p, usefulDaysMode: v}))}>
                       <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                       <SelectContent>
                          <SelectItem value="time_off_estimate">Estimation système (via absences)</SelectItem>
                          <SelectItem value="manual">Saisie manuelle fixe</SelectItem>
                       </SelectContent>
                    </Select>
                 </div>

                 {accrualForm.usefulDaysMode === 'manual' && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                       <Label className="text-[10px] font-black uppercase">Jours utiles à appliquer</Label>
                       <Input type="number" value={accrualForm.manualUsefulDays} onChange={(e) => setAccrualForm(p => ({...p, manualUsefulDays: parseInt(e.target.value)}))} className="rounded-xl h-11" />
                       <p className="text-[9px] text-muted-foreground italic">Standard : 22j pour une semaine de 5j.</p>
                    </div>
                 )}
              </div>

              <DialogFooter>
                 <Button type="button" variant="ghost" onClick={() => setIsAccrualModalOpen(false)} disabled={loading}>Annuler</Button>
                 <Button type="submit" disabled={loading} className="rounded-xl font-black px-8">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Lancer le calcul
                 </Button>
              </DialogFooter>
           </form>
        </DialogContent>
      </Dialog>

      {/* Manual Balance Dialog */}
      <Dialog open={isBalanceModalOpen} onOpenChange={setIsBalanceModalOpen}>
        <DialogContent className="sm:max-w-[650px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Définir solde annuel</DialogTitle>
            <DialogDescription>Initialisez ou ajustez les droits annuels d'un collaborateur.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateBalance} className="space-y-6 py-4">
             <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Collaborateur</Label>
                  <Select value={balanceForm.employeeId} onValueChange={(v) => setBalanceForm(p => ({...p, employeeId: v}))}>
                    <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Sélectionner..." />
                    </SelectTrigger>
                    <SelectContent>
                        {activeEmployees.map(e => (
                          <SelectItem key={e.employeeId} value={e.employeeId}>
                            {e.displayName} {e.employeeCode ? `— ${e.employeeCode}` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
               </div>
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Année</Label>
                  <Input type="number" value={balanceForm.year} onChange={(e) => setBalanceForm(p => ({...p, year: parseInt(e.target.value)}))} className="rounded-xl h-11" />
               </div>
             </div>

             <Separator />

             <div className="grid grid-cols-3 gap-8">
                {/* Paid Leave Column */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-blue-700 uppercase border-b pb-1">Congés (Jours)</p>
                   <div className="space-y-3">
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Droit CCNL</Label>
                         <Input type="number" value={balanceForm.paid_leave.entitlement} onChange={(e) => setBalanceForm(p => ({...p, paid_leave: {...p.paid_leave, entitlement: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                         <Input type="number" value={balanceForm.paid_leave.carriedOver} onChange={(e) => setBalanceForm(p => ({...p, paid_leave: {...p.paid_leave, carriedOver: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis manuel</Label>
                         <Input type="number" value={balanceForm.paid_leave.accrued} onChange={(e) => setBalanceForm(p => ({...p, paid_leave: {...p.paid_leave, accrued: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                   </div>
                </div>

                {/* ROL Column */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-indigo-700 uppercase border-b pb-1">ROL (Heures)</p>
                   <div className="space-y-3">
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Droit CCNL</Label>
                         <Input type="number" step="0.01" value={balanceForm.rol.entitlement} onChange={(e) => setBalanceForm(p => ({...p, rol: {...p.rol, entitlement: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                         <Input type="number" step="0.01" value={balanceForm.rol.carriedOver} onChange={(e) => setBalanceForm(p => ({...p, rol: {...p.rol, carriedOver: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis manuel</Label>
                         <Input type="number" step="0.01" value={balanceForm.rol.accrued} onChange={(e) => setBalanceForm(p => ({...p, rol: {...p.rol, accrued: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                   </div>
                </div>

                {/* Ex Holidays Column */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-teal-700 uppercase border-b pb-1">Ex Fest. (Heures)</p>
                   <div className="space-y-3">
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Droit CCNL</Label>
                         <Input type="number" step="0.01" value={balanceForm.ex_holidays.entitlement} onChange={(e) => setBalanceForm(p => ({...p, ex_holidays: {...p.ex_holidays, entitlement: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                         <Input type="number" step="0.01" value={balanceForm.ex_holidays.carriedOver} onChange={(e) => setBalanceForm(p => ({...p, ex_holidays: {...p.ex_holidays, carriedOver: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                      <div className="space-y-1">
                         <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis manuel</Label>
                         <Input type="number" step="0.01" value={balanceForm.ex_holidays.accrued} onChange={(e) => setBalanceForm(p => ({...p, ex_holidays: {...p.ex_holidays, accrued: parseFloat(e.target.value)}}))} className="rounded-lg h-9" />
                      </div>
                   </div>
                </div>
             </div>

             <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsBalanceModalOpen(false)} disabled={loading}>Annuler</Button>
                <Button type="submit" disabled={loading || !balanceForm.employeeId} className="rounded-xl font-black px-8">
                   {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Enregistrer
                </Button>
             </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                    {activeEmployees.map(e => (
                      <SelectItem key={e.employeeId} value={e.employeeId}>
                        {e.displayName} {e.employeeCode ? `— ${e.employeeCode}` : ''} {e.jobTitle ? `— ${e.jobTitle}` : ''}
                      </SelectItem>
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
                      <SelectItem value="leave">Congé (Vacances/Permis)</SelectItem>
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
                          <SelectItem value="paid_leave">Congé payé (Ferie)</SelectItem>
                          <SelectItem value="rol_permission">Permission ROL</SelectItem>
                          <SelectItem value="ex_holiday_permission">Permission Ex Festività</SelectItem>
                          <SelectItem value="unpaid_leave">Congé sans solde</SelectItem>
                          <SelectItem value="permission">Autre Permission / RTT</SelectItem>
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

             {/* Conditional Fields based on Request Type */}
             {isHourly ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Date</Label>
                    <Input type="date" value={formData.startDate} onChange={(e) => setFormData(p => ({...p, startDate: e.target.value, endDate: e.target.value}))} required className="rounded-xl h-11" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase text-muted-foreground">Heure début</Label>
                      <Input type="time" value={formData.startTime} onChange={(e) => setFormData(p => ({...p, startTime: e.target.value}))} required className="rounded-xl h-11" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase text-muted-foreground">Heure fin</Label>
                      <Input type="time" value={formData.endTime} onChange={(e) => setFormData(p => ({...p, endTime: e.target.value}))} required className="rounded-xl h-11" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Durée estimée (Heures)</Label>
                    <div className="h-11 px-3 bg-secondary/20 border rounded-xl flex items-center text-sm font-bold text-primary">
                       {calculateDecimalHours(formData.startTime, formData.endTime)} h
                    </div>
                    <p className="text-[9px] text-muted-foreground italic">Exemple : 09:00 → 11:30 = 2.5 h</p>
                  </div>
                </>
             ) : (
                <>
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
                    {formData.requestType === "paid_leave" ? (
                       <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Partie de la journée</Label>
                          <Select value={formData.dayPart} onValueChange={(v: any) => setFormData(p => ({...p, dayPart: v}))}>
                            <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full_day">Journée entière</SelectItem>
                              <SelectItem value="morning">Matinée</SelectItem>
                              <SelectItem value="afternoon">Après-midi</SelectItem>
                            </SelectContent>
                          </Select>
                       </div>
                    ) : null}
                  </div>
                </>
             )}

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
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
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
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
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

function getAccrualStatusBadge(status: string) {
  switch (status) {
    case 'draft': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Brouillon</Badge>;
    case 'confirmed': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Confirmé</Badge>;
    case 'posted': return <Badge className="bg-green-600 text-white border-none">Posté</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700">Annulé</Badge>;
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