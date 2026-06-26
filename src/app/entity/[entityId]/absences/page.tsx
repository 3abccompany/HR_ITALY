
"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { 
  Plus, Loader2, Calendar, User, Briefcase, 
  Clock, Filter, X, ListFilter, AlertCircle,
  FileText, CheckCircle2, History, Send,
  ChevronRight, ArrowRight, MoreVertical,
  XCircle, Ban, FileWarning, Paperclip, Upload,
  Download, Eye, Euro, Settings2, Calculator, Save,
  BarChart, Trash2, ShieldCheck, RefreshCw, CheckCircle,
  Check, ListRestart, Info as InfoIcon, Plane, Search,
  ChevronDown, ChevronUp
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
import { 
  TimeOffRequest, 
  DayPart, 
  TimeOffRequestType, 
  TimeOffRequestKind, 
  TIME_OFF_TYPE_LABELS, 
  LeaveBalance, 
  normalizeBalance, 
  MonthlyAccrual,
  BalanceCounterType 
} from "@/types/time-off";
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
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

const initialFilters = {
  search: "",
  status: "all",
  requestType: "all",
  period: "all",
  department: "all",
  worksite: "all",
  justification: "all",
  source: "all",
  blocksAccrual: false,
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

interface JournalMovement {
  date: string;
  source: "opening" | "maturation" | "request";
  label: string;
  movement: number;
  runningBalance: number;
  status: string;
  actor: string;
  notes?: string;
  unit: string;
}

/**
 * Robust date conversion to ISO for sorting. Handles Timestamp, Date, and FieldValue.
 */
function safeToIso(val: any): string {
  if (!val) return "";
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  // Firestore Client SDK
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  // Serialized POJO
  if (val.seconds !== undefined) return new Date(val.seconds * 1000).toISOString();
  if (val._seconds !== undefined) return new Date(val._seconds * 1000).toISOString();
  return String(val);
}

const isHourlyType = (type: string) => ["rol_permission", "ex_holiday_permission"].includes(type);

export default function TimeOffManagementPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  
  // --- Filter State ---
  const [filters, setFilters] = useState(initialFilters);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Journal State (Phase 2I-B)
  const [journalTarget, setJournalTarget] = useState<{ balance: LeaveBalance, employeeName: string } | null>(null);

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

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const activeEmployees = useMemo(() => {
    if (!employees) return [];
    return employees.filter(e => {
      const s = String(e.status || '').toLowerCase();
      return s === 'active' || s === 'actif' || s === 'active_contract';
    });
  }, [employees]);

  const balances = useMemo(() => rawBalances.map(normalizeBalance), [rawBalances]);

  // Derived filter options
  const uniqueDepartments = useMemo(() => 
    Array.from(new Set(activeEmployees.map(e => e.departmentName).filter(Boolean))).sort(), 
  [activeEmployees]);

  const uniqueWorksites = useMemo(() => 
    Array.from(new Set(activeEmployees.map(e => e.worksiteName).filter(Boolean))).sort(), 
  [activeEmployees]);

  // Main Filtering Logic
  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    
    return requests.filter(r => {
      const emp = employeesMap.get(r.employeeId);
      
      // 1. Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const matches = 
          r.employeeName.toLowerCase().includes(term) ||
          emp?.employeeCode?.toLowerCase().includes(term) ||
          r.reason?.toLowerCase().includes(term);
        if (!matches) return false;
      }

      // 2. Status
      if (filters.status !== "all" && r.status !== filters.status) return false;

      // 3. Request Type
      if (filters.requestType !== "all" && r.requestType !== filters.requestType) return false;

      // 4. Source
      if (filters.source !== "all" && r.source !== filters.source) return false;

      // 5. Justification
      if (filters.justification !== "all") {
        if (filters.justification === "required" && !r.requiresJustification) return false;
        if (filters.justification === "missing" && (r.justificationStatus !== "missing" || !r.requiresJustification)) return false;
        if (filters.justification === "provided" && r.justificationStatus !== "provided") return false;
        if (filters.justification === "not_required" && r.requiresJustification) return false;
      }

      // 6. Organization
      if (filters.department !== "all" && emp?.departmentName !== filters.department) return false;
      if (filters.worksite !== "all" && emp?.worksiteName !== filters.worksite) return false;

      // 7. Accrual Impact (Blocking maturation)
      if (filters.blocksAccrual) {
        const blockingTypes = ["unpaid_leave", "unjustified_absence", "expectation"];
        if (!blockingTypes.includes(r.requestType)) return false;
      }

      // 8. Period Filter
      if (filters.period !== "all") {
        const now = new Date();
        let interval: { start: Date; end: Date } | null = null;

        if (filters.period === "today") {
          interval = { start: startOfDay(now), end: endOfDay(now) };
        } else if (filters.period === "this_week") {
          interval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
        } else if (filters.period === "this_month") {
          interval = { start: startOfMonth(now), end: endOfMonth(now) };
        } else if (filters.period === "next_month") {
          const next = addMonths(now, 1);
          interval = { start: startOfMonth(next), end: endOfMonth(next) };
        }

        if (interval) {
          const rStart = parseISO(r.startDate);
          const rEnd = parseISO(r.endDate);
          // Overlap logic: rStart <= intervalEnd && rEnd >= intervalStart
          const overlaps = rStart <= interval.end && rEnd >= interval.start;
          if (!overlaps) return false;
        }
      }

      return true;
    });
  }, [requests, filters, employeesMap]);

  // Initial load from URL
  useEffect(() => {
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    if (status) setFilters(p => ({ ...p, status }));
    if (type) setFilters(p => ({ ...p, requestType: type }));
  }, [searchParams]);

  const handleUpdateFilter = (key: keyof typeof initialFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => setFilters(initialFilters);

  const handleTypeChange = (type: TimeOffRequestType) => {
    let requires = false;
    if (["sickness", "work_accident"].includes(type)) {
      requires = true;
    }
    
    setFormData(p => ({ 
      ...p, 
      requestType: type, 
      requiresJustification: requires,
      requestKind: isHourlyType(type) ? "leave" : p.requestKind
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !membership || !entityId) return;

    if (!formData.employeeId) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez sélectionner un employé." });
      return;
    }

    const isHourly = isHourlyType(formData.requestType);
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
      
      // Clean payload: Omit hourly fields for day-based and vice versa
      const payload: any = {
        ...formData,
        employeeName: emp?.displayName || "Employé inconnu",
        personId: emp?.personId || ""
      };

      if (isHourly) {
        payload.durationHours = finalDurationHours;
        payload.endDate = formData.startDate; // Hourly is always same day
        delete payload.dayPart;
      } else {
        delete payload.startTime;
        delete payload.endTime;
        delete payload.durationHours;
      }

      await createTimeOffRequestForEmployee(
        entityId,
        payload,
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
          
          {/* Advanced Filter UI */}
          <div className="space-y-4">
             <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[250px]">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                   <Input 
                    className="pl-10 h-11 rounded-xl bg-white border-primary/10 shadow-sm" 
                    placeholder="Rechercher employé, code ou motif..." 
                    value={filters.search}
                    onChange={(e) => handleUpdateFilter('search', e.target.value)}
                   />
                </div>
                
                <Select value={filters.status} onValueChange={(v) => handleUpdateFilter('status', v)}>
                   <SelectTrigger className="w-[180px] h-11 rounded-xl bg-white border-primary/10 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-2 w-2 rounded-full p-0 bg-primary/20 border-none" />
                        <SelectValue placeholder="Tous statuts" />
                      </div>
                   </SelectTrigger>
                   <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      <SelectItem value="submitted">En attente RH</SelectItem>
                      <SelectItem value="approved">Approuvés</SelectItem>
                      <SelectItem value="rejected">Refusés</SelectItem>
                      <SelectItem value="cancelled">Annulés</SelectItem>
                   </SelectContent>
                </Select>

                <Select value={filters.requestType} onValueChange={(v) => handleUpdateFilter('requestType', v)}>
                   <SelectTrigger className="w-[200px] h-11 rounded-xl bg-white border-primary/10 shadow-sm">
                      <SelectValue placeholder="Tous types" />
                   </SelectTrigger>
                   <SelectContent>
                      <SelectItem value="all">Tous les motifs</SelectItem>
                      <SelectItem value="paid_leave">Congé payé (Ferie)</SelectItem>
                      <SelectItem value="rol_permission">Permission ROL</SelectItem>
                      <SelectItem value="ex_holiday_permission">Ex Festività</SelectItem>
                      <SelectItem value="sickness">Maladie</SelectItem>
                      <SelectItem value="work_accident">Accident du travail</SelectItem>
                      <SelectItem value="unpaid_leave">Sans solde</SelectItem>
                      <SelectItem value="permission">Autre permission / RTT</SelectItem>
                   </SelectContent>
                </Select>

                <Select value={filters.period} onValueChange={(v) => handleUpdateFilter('period', v)}>
                   <SelectTrigger className="w-[160px] h-11 rounded-xl bg-white border-primary/10 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <SelectValue placeholder="Période" />
                      </div>
                   </SelectTrigger>
                   <SelectContent>
                      <SelectItem value="all">Toutes périodes</SelectItem>
                      <SelectItem value="today">Aujourd'hui</SelectItem>
                      <SelectItem value="this_week">Cette semaine</SelectItem>
                      <SelectItem value="this_month">Ce mois</SelectItem>
                      <SelectItem value="next_month">Mois prochain</SelectItem>
                   </SelectContent>
                </Select>

                <Button 
                  variant="outline" 
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  className={cn("h-11 rounded-xl font-bold gap-2", isAdvancedOpen && "bg-primary/5 text-primary border-primary/20")}
                >
                   <Filter className="w-4 h-4" /> 
                   {isAdvancedOpen ? "Masquer filtres" : "Filtres avancés"}
                </Button>

                <Button variant="ghost" onClick={handleResetFilters} className="text-muted-foreground text-xs font-bold uppercase tracking-tight h-11">
                   Réinitialiser
                </Button>
             </div>

             <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <CollapsibleContent className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
                   <Card className="rounded-[1.5rem] border-primary/10 bg-slate-50/50 shadow-sm">
                      <CardContent className="p-6">
                         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                            <div className="space-y-2">
                               <Label className="text-[10px] font-black uppercase text-muted-foreground">Département</Label>
                               <Select value={filters.department} onValueChange={(v) => handleUpdateFilter('department', v)}>
                                  <SelectTrigger className="bg-white"><SelectValue placeholder="Tous..." /></SelectTrigger>
                                  <SelectContent>
                                     <SelectItem value="all">Tous les services</SelectItem>
                                     {uniqueDepartments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                  </SelectContent>
                               </Select>
                            </div>
                            <div className="space-y-2">
                               <Label className="text-[10px] font-black uppercase text-muted-foreground">Site / Localisation</Label>
                               <Select value={filters.worksite} onValueChange={(v) => handleUpdateFilter('worksite', v)}>
                                  <SelectTrigger className="bg-white"><SelectValue placeholder="Tous..." /></SelectTrigger>
                                  <SelectContent>
                                     <SelectItem value="all">Tous les sites</SelectItem>
                                     {uniqueWorksites.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                                  </SelectContent>
                               </Select>
                            </div>
                            <div className="space-y-2">
                               <Label className="text-[10px] font-black uppercase text-muted-foreground">Source</Label>
                               <Select value={filters.source} onValueChange={(v) => handleUpdateFilter('source', v)}>
                                  <SelectTrigger className="bg-white"><SelectValue placeholder="Toutes sources..." /></SelectTrigger>
                                  <SelectContent>
                                     <SelectItem value="all">Toutes les sources</SelectItem>
                                     <SelectItem value="employee_created">Saisie employé</SelectItem>
                                     <SelectItem value="hr_created">Saisie RH</SelectItem>
                                  </SelectContent>
                               </Select>
                            </div>
                            <div className="space-y-2">
                               <Label className="text-[10px] font-black uppercase text-muted-foreground">Justification</Label>
                               <Select value={filters.justification} onValueChange={(v) => handleUpdateFilter('justification', v)}>
                                  <SelectTrigger className="bg-white"><SelectValue placeholder="Tous..." /></SelectTrigger>
                                  <SelectContent>
                                     <SelectItem value="all">Tous les états</SelectItem>
                                     <SelectItem value="required">Justification requise</SelectItem>
                                     <SelectItem value="missing">Manquante</SelectItem>
                                     <SelectItem value="provided">Fournie</SelectItem>
                                     <SelectItem value="not_required">Non requise</SelectItem>
                                  </SelectContent>
                               </Select>
                            </div>
                         </div>
                         
                         <Separator className="my-6 opacity-40" />
                         
                         <div className="flex items-center justify-between bg-white/50 p-4 rounded-2xl border border-primary/5">
                            <div className="flex items-center gap-3">
                               <div className="bg-orange-100 p-2 rounded-xl text-orange-600">
                                  <Ban className="w-4 h-4" />
                               </div>
                               <div>
                                  <p className="text-xs font-bold text-slate-800">Impact sur l'acquisition (YTD)</p>
                                  <p className="text-[10px] text-muted-foreground">Afficher uniquement les demandes qui bloquent la maturation mensuelle.</p>
                               </div>
                            </div>
                            <Switch 
                              checked={filters.blocksAccrual} 
                              onCheckedChange={(v) => handleUpdateFilter('blocksAccrual', v)} 
                            />
                         </div>
                      </CardContent>
                   </Card>
                </CollapsibleContent>
             </Collapsible>

             {/* Quick Filter Chips */}
             <div className="flex items-center justify-between px-1">
                <div className="flex flex-wrap items-center gap-2">
                   <QuickChip 
                    label="En attente" 
                    count={requests?.filter(r => r.status === 'submitted').length}
                    active={filters.status === 'submitted'}
                    onClick={() => handleUpdateFilter('status', filters.status === 'submitted' ? 'all' : 'submitted')}
                   />
                   <QuickChip 
                    label="Maladie ce mois" 
                    active={filters.requestType === 'sickness' && filters.period === 'this_month'}
                    onClick={() => {
                       setFilters(p => ({ ...p, requestType: 'sickness', period: 'this_month' }));
                    }}
                   />
                   <QuickChip 
                    label="Justificatifs manquants" 
                    active={filters.justification === 'missing'}
                    onClick={() => handleUpdateFilter('justification', filters.justification === 'missing' ? 'all' : 'missing')}
                   />
                   <QuickChip 
                    label="Sans solde" 
                    active={filters.requestType === 'unpaid_leave'}
                    onClick={() => handleUpdateFilter('requestType', filters.requestType === 'unpaid_leave' ? 'all' : 'unpaid_leave')}
                   />
                </div>
                {!loadingRequests && (
                  <div className="text-[10px] font-black uppercase text-muted-foreground tracking-widest bg-slate-100 px-3 py-1.5 rounded-full">
                     {filteredRequests.length} demande{filteredRequests.length > 1 ? 's' : ''} affichée{filteredRequests.length > 1 ? 's' : ''} sur {requests?.length || 0}
                  </div>
                )}
             </div>
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
                  filteredRequests.map((r) => {
                    const isHourly = isHourlyType(r.requestType);
                    const emp = employeesMap.get(r.employeeId);
                    return (
                    <TableRow key={r.requestId} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/5 p-2 rounded-lg text-primary"><User className="w-4 h-4" /></div>
                          <div>
                            <p className="font-bold text-slate-900">{r.employeeName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                               <p className="text-[9px] text-muted-foreground uppercase font-black tracking-tighter">Source: {r.source === 'hr_created' ? 'RH' : 'Employé'}</p>
                               {emp?.departmentName && (
                                 <>
                                   <span className="text-slate-200 text-[8px]">•</span>
                                   <p className="text-[9px] text-primary/60 font-bold uppercase tracking-tighter">{emp.departmentName}</p>
                                 </>
                               )}
                            </div>
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
                      </TableCell>
                      <TableCell>
                         <div className="flex flex-col gap-0.5 font-black text-primary">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 opacity-30" />
                              {isHourly ? (
                                `${r.durationHours ?? 0} h`
                              ) : (
                                `${r.durationDays ?? 0} j`
                              )}
                            </div>
                            {isHourly && r.startTime && r.endTime && (
                              <div className="text-[9px] text-muted-foreground pl-5 uppercase font-bold tracking-tighter">
                                {r.startTime} - {r.endTime}
                              </div>
                            )}
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
                  )})
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
                              {getAccrualStatusBadge(a)}
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
                                   <Button 
                                     variant="secondary" 
                                     size="sm" 
                                     disabled={!!a.needsReview}
                                     className={cn("h-8 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10 gap-1.5", a.needsReview && "opacity-50")} 
                                     onClick={() => setAccrualToPost(a)}
                                   >
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
                <TableHeader>
                   <TableRow className="bg-secondary/20">
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
                     balances?.map(b => {
                        const empName = activeEmployees.find(e => e.employeeId === b.employeeId)?.displayName || b.employeeId;
                        return (
                       <React.Fragment key={`${b.employeeId}_${b.year}`}>
                         {/* Paid Leave Row */}
                         <TableRow className="border-t-2">
                            <TableCell rowSpan={3} className="pl-6 py-4 bg-slate-50/30 align-top">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900">{empName}</span>
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
                               <div className="flex flex-col gap-2 items-end">
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
                                 <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="text-primary"
                                  onClick={() => setJournalTarget({ balance: b, employeeName: empName })}
                                  title="Journal annuel"
                                 >
                                    <ListRestart className="w-4 h-4" />
                                 </Button>
                               </div>
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
                      )})
                   )}
                </TableBody>
              </Table>
           </Card>
        </TabsContent>
      </Tabs>

      {/* Annual Balance Journal Drawer (Phase 2I-B) */}
      <Sheet open={!!journalTarget} onOpenChange={(o) => !o && setJournalTarget(null)}>
        <SheetContent side="right" className="sm:max-w-[800px] p-0 flex flex-col gap-0 border-l shadow-2xl">
           <SheetHeader className="px-8 py-6 border-b shrink-0">
              <div className="flex items-center gap-3">
                 <div className="bg-primary p-2.5 rounded-xl text-white shadow-lg shadow-primary/10">
                    <ListRestart className="w-5 h-5" />
                 </div>
                 <div>
                    <SheetTitle className="text-xl font-black text-primary">Journal annuel des soldes</SheetTitle>
                    <SheetDescription className="text-xs font-bold uppercase text-muted-foreground mt-1">
                       {journalTarget?.employeeName} — {journalTarget?.balance.year}
                    </SheetDescription>
                 </div>
              </div>
           </SheetHeader>
           
           <div className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                 <div className="p-8 pb-32">
                    {journalTarget && (
                      <AnnualJournalContent 
                        balance={journalTarget.balance} 
                        accruals={accruals || []} 
                        requests={requests || []} 
                      />
                    )}
                 </div>
              </ScrollArea>
           </div>
        </SheetContent>
      </Sheet>

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
        <DialogContent className="sm:max-w-[500px] flex flex-col overflow-hidden p-0 rounded-[2rem]">
           <DialogHeader className="p-8 pb-4 shrink-0">
              <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
                 <RefreshCw className="w-5 h-5 text-accent" /> Calculer maturation mensuelle
              </DialogTitle>
              <DialogDescription>Générez les acquisitions de congés et ROL pour une période donnée.</DialogDescription>
           </DialogHeader>

           <div className="flex-1 overflow-y-auto px-8 py-4 min-h-0">
             <form id="accrual-form" onSubmit={handleRunAccrual} className="space-y-6 pb-8">
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
             </form>
           </div>

           <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsAccrualModalOpen(false)} disabled={loading}>Annuler</Button>
              <Button form="accrual-form" type="submit" disabled={loading} className="rounded-xl font-black px-8">
                 {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Lancer le calcul
              </Button>
           </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Balance Dialog */}
      <Dialog open={isBalanceModalOpen} onValueChange={setIsBalanceModalOpen}>
        <DialogContent className="sm:max-w-[650px] flex flex-col overflow-hidden p-0 rounded-[2rem]">
          <DialogHeader className="p-8 pb-4 shrink-0">
            <DialogTitle className="text-xl font-black text-primary">Définir solde annuel</DialogTitle>
            <DialogDescription>Initialisez ou ajustez les droits annuels d'un collaborateur.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-8 py-4 min-h-0">
            <form id="balance-form" onSubmit={handleUpdateBalance} className="space-y-6 pb-8">
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
            </form>
          </div>

          <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsBalanceModalOpen(false)} disabled={loading}>Annuler</Button>
            <Button form="balance-form" type="submit" disabled={loading || !balanceForm.employeeId} className="rounded-xl font-black px-8">
               {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Creation Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[550px] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden p-0 rounded-[2rem]">
          <DialogHeader className="p-8 pb-4 shrink-0">
            <DialogTitle className="text-xl font-black text-primary">Nouvelle demande (RH)</DialogTitle>
            <DialogDescription>Créez manuellement une absence ou un congé pour un collaborateur.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-8 py-4 min-h-0">
            <form id="request-form" onSubmit={handleSave} className="space-y-6 pb-8">
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
               {isHourlyType(formData.requestType) ? (
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
                    placeholder="Notes internes on cette absence..."
                    className="rounded-xl min-h-[100px]"
                  />
               </div>
            </form>
          </div>

          <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex justify-end gap-3">
             <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} disabled={loading}>Annuler</Button>
             <Button form="request-form" type="submit" disabled={loading} className="rounded-xl font-black px-8 shadow-lg shadow-primary/20">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Enregistrer la demande
             </Button>
          </DialogFooter>
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
                      <div className="bg-white p-3 rounded-2xl shadow-sm text-primary/60 group-hover:text-primary transition-colors">
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

function AnnualJournalContent({ balance, accruals, requests }: { balance: LeaveBalance, accruals: MonthlyAccrual[], requests: TimeOffRequest[] }) {
  const tabs = [
    { id: "paid_leave", label: "Ferie / Congés", unit: "j", counter: "paid_leave" },
    { id: "rol", label: "ROL", unit: "h", counter: "rol" },
    { id: "ex_holidays", label: "Ex Festività", unit: "h", counter: "ex_holidays" }
  ];

  return (
    <Tabs defaultValue="paid_leave" className="w-full">
       <TabsList className="bg-slate-100/50 p-1 h-12 rounded-xl mb-6">
          {tabs.map(t => <TabsTrigger key={t.id} value={t.id} className="rounded-lg px-6 font-bold">{t.label}</TabsTrigger>)}
       </TabsList>
       {tabs.map(t => (
         <TabsContent key={t.id} value={t.id} className="mt-0 space-y-6">
            <JournalTabTable 
              balance={balance} 
              counterType={t.counter as BalanceCounterType} 
              accruals={accruals} 
              requests={requests} 
              unit={t.unit}
            />
         </TabsContent>
       ))}
    </Tabs>
  );
}

function JournalTabTable({ balance, counterType, accruals, requests, unit }: { balance: LeaveBalance, counterType: BalanceCounterType, accruals: MonthlyAccrual[], requests: TimeOffRequest[], unit: string }) {
  const movements = useMemo(() => {
    const list: JournalMovement[] = [];
    const year = balance.year;

    // 1. Opening Balance
    const opening = balance.counters?.[counterType]?.carriedOver || 0;
    list.push({
      date: `${year}-01-01`,
      source: "opening",
      label: "Report N-1",
      movement: opening,
      runningBalance: 0, // calculated later
      status: "Ouverture",
      actor: "Système",
      unit
    });

    // 2. Accruals
    accruals.filter(a => a.employeeId === balance.employeeId && a.year === year && a.status === "posted").forEach(a => {
      const val = a.accrued[counterType] || 0;
      if (val !== 0) {
        let dateStr = `${a.year}-${a.month.toString().padStart(2, '0')}-01`;
        if (a.postedAt) {
          dateStr = safeToIso(a.postedAt);
        } else if (a.updatedAt) {
          dateStr = safeToIso(a.updatedAt);
        }

        list.push({
          date: dateStr,
          source: "maturation",
          label: `Maturation ${format(new Date(a.year, a.month - 1), 'MMMM', { locale: fr })} ${a.year}`,
          movement: val,
          runningBalance: 0,
          status: "Posté",
          actor: a.postedByUid === 'server' ? 'Système' : 'RH',
          unit
        });
      }
    });

    // 3. Requests
    requests.filter(r => {
      const matchEmp = r.employeeId === balance.employeeId;
      const matchStatus = r.status === "approved";
      const matchYear = r.startDate.startsWith(year.toString());
      
      let rCounter = r.balanceCounterType;
      // Fallback for missing balanceCounterType on existing records
      if (!rCounter) {
        if (r.requestType === "paid_leave") rCounter = "paid_leave";
        else if (r.requestType === "rol_permission") rCounter = "rol";
        else if (r.requestType === "ex_holiday_permission") rCounter = "ex_holidays";
      }

      return matchEmp && matchStatus && matchYear && rCounter === counterType;
    }).forEach(r => {
      const val = (r.unit === "days") ? (r.durationDays || 0) : (r.durationHours || 0);
      if (val !== 0) {
        const dateStr = r.approvedAt ? safeToIso(r.approvedAt) : r.startDate;

        list.push({
          date: dateStr,
          source: "request",
          label: `${TIME_OFF_TYPE_LABELS[r.requestType] || 'Demande'} du ${formatDate(r.startDate)} au ${formatDate(r.endDate)}`,
          movement: -val,
          runningBalance: 0,
          status: "Approuvé",
          actor: r.approvedByRole === 'companyHR' ? 'RH' : 'Manager',
          unit
        });
      }
    });

    // Final sorting and running balance
    list.sort((a, b) => a.date.localeCompare(b.date));
    
    let rb = 0;
    list.forEach(m => {
      rb += m.movement;
      m.runningBalance = rb;
    });

    return list;
  }, [balance, counterType, accruals, requests, unit]);

  // Diagnostics
  const diag = useMemo(() => {
    const carriedOver = balance.counters?.[counterType]?.carriedOver || 0;
    const registeredAccrued = balance.counters?.[counterType]?.accrued || 0;
    const registeredUsed = balance.counters?.[counterType]?.used || 0;
    const registeredRemaining = balance.counters?.[counterType]?.remaining || 0;

    const reconstructedAccrued = movements.filter(m => m.source === "maturation").reduce((s, m) => s + m.movement, 0);
    const reconstructedUsed = Math.abs(movements.filter(m => m.source === "request").reduce((s, m) => s + m.movement, 0));
    const reconstructedRemaining = carriedOver + reconstructedAccrued - reconstructedUsed;

    const hasMismatch = Math.abs(registeredRemaining - reconstructedRemaining) > 0.01 || 
                        Math.abs(registeredAccrued - reconstructedAccrued) > 0.01 ||
                        Math.abs(registeredUsed - reconstructedUsed) > 0.01;

    return { 
      hasMismatch,
      registered: { accrued: registeredAccrued, used: registeredUsed, remaining: registeredRemaining },
      reconstructed: { accrued: reconstructedAccrued, used: reconstructedUsed, remaining: reconstructedRemaining }
    };
  }, [movements, balance, counterType]);

  return (
    <div className="space-y-6">
       {diag.hasMismatch && (
         <Alert variant="destructive" className="bg-orange-50 border-orange-200 text-orange-800 rounded-2xl py-4">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            <div className="ml-2">
               <AlertTitle className="font-black uppercase text-xs tracking-widest">Diagnostic : Écart détecté</AlertTitle>
               <AlertDescription className="text-xs mt-1 leading-relaxed">
                  Le solde reconstruit ne correspond pas exactement au solde enregistré. Une mise à jour manuelle ou une donnée historique non journalisée peut expliquer cet écart.
                  <div className="mt-2 grid grid-cols-3 gap-4 border-t border-orange-100 pt-2 font-bold uppercase tracking-tighter text-[10px]">
                     <div>Acquis: {diag.registered.accrued.toFixed(2)} vs {diag.reconstructed.accrued.toFixed(2)}</div>
                     <div>Utilisé: {diag.registered.used.toFixed(2)} vs {diag.reconstructed.used.toFixed(2)}</div>
                     <div>Restant: {diag.registered.remaining.toFixed(2)} vs {diag.reconstructed.remaining.toFixed(2)}</div>
                  </div>
               </AlertDescription>
            </div>
         </Alert>
       )}

       <Card className="overflow-hidden border-primary/5 rounded-2xl shadow-sm">
          <Table>
             <TableHeader className="bg-slate-50/50">
                <TableRow>
                   <TableHead className="pl-6 text-[10px] font-black uppercase tracking-widest">Date</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest">Libellé</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest">Mouvement</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest">Solde progressif</TableHead>
                   <TableHead className="text-[10px] font-black uppercase tracking-widest text-right pr-6">Acteur</TableHead>
                </TableRow>
             </TableHeader>
             <TableBody>
                {movements.length === 0 ? (
                   <TableRow><TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">Aucun mouvement trouvé.</TableCell></TableRow>
                ) : (
                  movements.map((m, idx) => (
                    <TableRow key={idx} className="hover:bg-slate-50/30 transition-colors">
                       <TableCell className="pl-6 py-4">
                          <div className="flex flex-col">
                             <span className="text-xs font-bold text-slate-800">{formatDate(m.date)}</span>
                             <span className="text-[8px] font-black text-muted-foreground uppercase opacity-50">{m.status}</span>
                          </div>
                       </TableCell>
                       <TableCell>
                          <div className="flex items-center gap-2">
                             {m.source === 'opening' && <ListRestart className="w-3 h-3 text-muted-foreground" />}
                             {m.source === 'maturation' && <RefreshCw className="w-3 h-3 text-blue-500" />}
                             {m.source === 'request' && <Plane className="w-3 h-3 text-orange-500" />}
                             <span className="text-xs font-medium text-slate-700">{m.label}</span>
                          </div>
                       </TableCell>
                       <TableCell>
                          <span className={cn("font-black text-sm", m.movement > 0 ? "text-green-600" : m.movement < 0 ? "text-red-600" : "text-slate-400")}>
                             {m.movement > 0 ? '+' : ''}{m.movement.toFixed(2)} {m.unit}
                          </span>
                       </TableCell>
                       <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px] bg-white border-primary/5">
                             {m.runningBalance.toFixed(2)} {m.unit}
                          </Badge>
                       </TableCell>
                       <TableCell className="text-right pr-6">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{m.actor}</span>
                       </TableCell>
                    </TableRow>
                  ))
                )}
             </TableBody>
          </Table>
       </Card>

       <div className="flex items-start gap-4 p-6 bg-primary/5 rounded-[2rem] border border-primary/10">
          <div className="bg-white p-2 rounded-xl shadow-sm text-primary">
             <InfoIcon className="w-5 h-5" />
          </div>
          <div className="space-y-1">
             <p className="text-xs font-black uppercase text-primary tracking-widest">Informations sur le solde</p>
             <p className="text-[11px] text-slate-600 leading-relaxed">
                Ce journal affiche l'historique chronologique des transactions affectant le solde. 
                Les mouvements de maturation sont ajoutés lors du posting mensuel, tandis que les demandes approuvées sont déduites immédiatement lors de leur validation.
             </p>
          </div>
       </div>
    </div>
  );
}

function QuickChip({ label, count, active, onClick }: { label: string, count?: number, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight transition-all",
        active 
          ? "bg-primary text-white shadow-md shadow-primary/20 ring-2 ring-primary/10" 
          : "bg-white border border-primary/5 text-muted-foreground hover:bg-slate-50"
      )}
    >
      {label}
      {count !== undefined && <span className={cn("ml-1 px-1.5 rounded-full", active ? "bg-white/20 text-white" : "bg-slate-100 text-muted-foreground")}>{count}</span>}
    </button>
  );
}

function formatDate(val: string) {
  if (!val) return "-";
  try {
    return format(parseISO(val), "dd/MM/yyyy", { locale: fr });
  } catch (e) { return "-"; }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'submitted': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200">En attente</Badge>;
    case 'approved': return <Badge className="bg-green-500 text-white border-none">Approuvé</Badge>;
    case 'rejected': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">Refusé</Badge>;
    case 'cancelled': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Annulé</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function getAccrualStatusBadge(a: MonthlyAccrual) {
  const { status, needsReview, hasDiscrepancy } = a;

  if (status === 'posted' && hasDiscrepancy) {
    return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[9px] animate-pulse">ÉCART DÉTECTÉ</Badge>;
  }

  if (status === 'confirmed' && needsReview) {
    return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[9px]">À REVOIR</Badge>;
  }

  if (status === 'draft' && needsReview) {
    return <Badge variant="outline" className="bg-orange-50 text-orange-400 border-orange-100 text-[9px]">SAISIE PÉRIMÉE</Badge>;
  }

  switch (status) {
    case 'draft': return <Badge variant="outline" className="bg-slate-50 text-slate-400">Brouillon</Badge>;
    case 'confirmed': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">Confirmé</Badge>;
    case 'posted': return <Badge className="bg-green-600 text-white border-none">Posté</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-700">Annulé</Badge>;
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

