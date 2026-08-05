"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { 
  Stethoscope, Plus, Search, Eye, Edit, Archive, Mail,
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, Users,
  Building2, ArrowUpRight, History, MoreVertical,
  RefreshCcw, FileSignature, FileText, Paperclip,
  FileCheck, Upload, ShieldCheck, Download, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  MedicalVisit, 
  MedicalVisitType, 
  MedicalFitnessStatus, 
  MedicalVisitStatus,
  MEDICAL_VISIT_TYPE_LABELS,
  FITNESS_STATUS_LABELS,
  MEDICAL_VISIT_PROVIDER_TYPE_LABELS,
  MEDICAL_VISIT_REQUEST_STATUS_LABELS,
  MEDICAL_VISIT_REQUEST_URGENCY_LABELS,
} from "@/types/medical-visit";
import {
  archiveMedicalVisitAction,
  attachMedicalCertificateAction,
  getMedicalVisitRequestDetailsAction,
  getMedicalVisitRequestsAction,
  getMedicalCertificateUrlAction,
  materializeMedicalVisitsFromRequestAction,
  replaceMedicalCertificateAction,
} from "@/app/entity/[entityId]/medical-visits/actions";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { MedicalVisitDialog } from "@/components/medical-visits/MedicalVisitDialog";
import { MedicalVisitRequestDialog } from "@/components/medical-visits/MedicalVisitRequestDialog";
import { MedicalProviderEmailDialog } from "@/components/medical-visits/MedicalProviderEmailDialog";
import { MedicalProviderSlotsDialog } from "@/components/medical-visits/MedicalProviderSlotsDialog";
import { MedicalEmployeeInvitationsDialog } from "@/components/medical-visits/MedicalEmployeeInvitationsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format, isBefore, addDays, startOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const initialFilters = {
  search: "",
  visitType: "all",
  fitnessStatus: "all",
  status: "all",
  deadlineStatus: "all"
};

const REQUEST_PAGE_SIZE = 10;
const visitPageSizeOptions = [10, 25, 50];

const requestStatusFilterOptions = [
  { value: "all", label: "Toutes" },
  { value: "draft", label: "Brouillon" },
  { value: "awaiting_provider_response", label: "En attente du médecin" },
  { value: "slots_received", label: "Créneaux reçus" },
  { value: "assignments_ready", label: "Affectation prête" },
  { value: "employees_planned", label: "Employés planifiés" },
  { value: "closed", label: "Terminées/annulées" },
];

type MedicalVisitRequestSummary = {
  id: string;
  visitType: MedicalVisitType;
  providerType: "doctor" | "medical_center";
  providerName: string;
  providerEmail: string;
  medicalCenter: string | null;
  desiredStartDate: string;
  desiredEndDate: string;
  urgency: "normal" | "urgent" | "critical";
  constraints: string | null;
  status: string;
  participantCount: number;
  createdAt: string | null;
  updatedAt?: string | null;
  providerRequestSentAt?: string | null;
  providerRequestSentBy?: string | null;
  providerRequestSentByName?: string | null;
  providerRequestSentByDisplayName?: string | null;
  providerRequestSentRecipient?: string | null;
  providerRequestSentSubject?: string | null;
  providerRequestSendCount?: number;
  providerResponseRecordedAt?: string | null;
  providerResponseRecordedBy?: string | null;
  providerResponseRecordedByName?: string | null;
  slotCount?: number;
  assignedParticipantCount?: number;
  unassignedParticipantCount?: number;
  individualVisitsCreatedAt?: string | null;
  individualVisitsCreatedBy?: string | null;
  individualVisitsCreatedByName?: string | null;
  individualVisitsCount?: number;
  employeeInvitationsLastSentAt?: string | null;
  employeeInvitationsLastSentBy?: string | null;
  employeeInvitationsLastSentByName?: string | null;
  employeeInvitationAttemptCount?: number;
  employeeNotificationSentCount?: number;
  employeeEmailSentCount?: number;
  employeeManualContactCount?: number;
  employeeInvitationEligibleCount?: number;
  employeeInvitationSkippedCount?: number;
  employeeInvitationFailureCount?: number;
};

type MedicalVisitRequestParticipantDetail = {
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeDisplayNameSnapshot: string;
  assignedSlotId: string | null;
  assignedStartTime: string | null;
  assignedEndTime: string | null;
  resultingMedicalVisitId: string | null;
  resultingMedicalVisitStatus: "not_created" | "created" | "incoherent";
};

type MedicalVisitProviderSlotDetail = {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string | null;
  location: string;
};

type MaterializationResultSummary = {
  createdCount: number;
  existingCount: number;
  materializedAt: string;
  materializedByName: string;
};

function getRequestPriority(request: MedicalVisitRequestSummary) {
  if (request.status === "draft" || request.status === "slots_received" || request.status === "assignments_ready") return 1;
  if (request.status === "awaiting_provider_response" || request.status === "provider_request_sent") return 2;
  if (request.status === "employees_planned") return 3;
  if (request.status === "completed" || request.status === "cancelled") return 4;
  return 5;
}

function getRequestUpdatedTime(request: MedicalVisitRequestSummary) {
  return Date.parse(request.updatedAt || request.employeeInvitationsLastSentAt || request.individualVisitsCreatedAt || request.providerResponseRecordedAt || request.providerRequestSentAt || request.createdAt || "") || 0;
}

function getRequestCurrentStep(request: MedicalVisitRequestSummary) {
  if (request.status === "draft") return "Préparer l'e-mail au médecin";
  if (request.status === "awaiting_provider_response" || request.status === "provider_request_sent") return "Attente réponse médecin";
  if (request.status === "slots_received") return "Affecter les collaborateurs";
  if (request.status === "assignments_ready") return "Créer les visites individuelles";
  if (request.status === "employees_planned") return (request.employeeInvitationAttemptCount || 0) > 0 ? "Convocations collaborateurs" : "Notifier les collaborateurs";
  if (request.status === "completed") return "Terminée";
  if (request.status === "cancelled") return "Annulée";
  return "Suivi de la demande";
}

function requestStatusMatchesFilter(request: MedicalVisitRequestSummary, filter: string) {
  if (filter === "all") return true;
  if (filter === "closed") return request.status === "completed" || request.status === "cancelled";
  if (filter === "awaiting_provider_response") return request.status === "awaiting_provider_response" || request.status === "provider_request_sent";
  return request.status === filter;
}

function getRequestAccentClass(status: string) {
  if (status === "draft") return "border-slate-200 bg-white";
  if (status === "awaiting_provider_response" || status === "provider_request_sent") return "border-blue-100 bg-white";
  if (status === "slots_received") return "border-cyan-100 bg-white";
  if (status === "assignments_ready") return "border-amber-100 bg-white";
  if (status === "employees_planned") return "border-indigo-100 bg-white";
  if (status === "completed") return "border-emerald-100 bg-white";
  if (status === "cancelled") return "border-red-100 bg-white";
  return "border-slate-200 bg-white";
}

function getRequestStatusBadgeClass(status: string) {
  if (status === "draft") return "border-slate-200 bg-slate-100 text-slate-700";
  if (status === "awaiting_provider_response" || status === "provider_request_sent") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "slots_received") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "assignments_ready") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "employees_planned") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getRequestHeaderAccentClass(status: string) {
  if (status === "draft") return "bg-slate-300";
  if (status === "awaiting_provider_response" || status === "provider_request_sent") return "bg-blue-400";
  if (status === "slots_received") return "bg-cyan-400";
  if (status === "assignments_ready") return "bg-amber-400";
  if (status === "employees_planned") return "bg-indigo-400";
  if (status === "completed") return "bg-emerald-400";
  if (status === "cancelled") return "bg-red-300";
  return "bg-slate-300";
}

function buildPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
    .reduce<Array<number | "ellipsis">>((acc, page) => {
      const previous = acc[acc.length - 1];
      if (typeof previous === "number" && page - previous > 1) acc.push("ellipsis");
      acc.push(page);
      return acc;
    }, []);
}

export default function MedicalVisitsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  // UI State
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isResultMode, setIsResultMode] = useState(false);
  const [isRequestDialogVisible, setIsRequestDialogVisible] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [providerEmailRequestId, setProviderEmailRequestId] = useState<string | null>(null);
  const [providerSlotsRequestId, setProviderSlotsRequestId] = useState<string | null>(null);
  const [employeeInvitationsRequestId, setEmployeeInvitationsRequestId] = useState<string | null>(null);
  const [materializingRequest, setMaterializingRequest] = useState<MedicalVisitRequestSummary | null>(null);
  const [materializationParticipants, setMaterializationParticipants] = useState<MedicalVisitRequestParticipantDetail[]>([]);
  const [materializationSlots, setMaterializationSlots] = useState<MedicalVisitProviderSlotDetail[]>([]);
  const [loadingMaterializationDetails, setLoadingMaterializationDetails] = useState(false);
  const [isMaterializing, setIsMaterializing] = useState(false);
  const [materializationResult, setMaterializationResult] = useState<MaterializationResultSummary | null>(null);
  const [groupedRequests, setGroupedRequests] = useState<MedicalVisitRequestSummary[]>([]);
  const [loadingGroupedRequests, setLoadingGroupedRequests] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("all");
  const [visibleRequestCount, setVisibleRequestCount] = useState(REQUEST_PAGE_SIZE);
  const [filters, setFilters] = useState(initialFilters);
  const [visitPage, setVisitPage] = useState(1);
  const [visitPageSize, setVisitPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  // Late Attachment State
  const [uploadingRequest, setUploadingRequest] = useState<MedicalVisit | null>(null);
  const [certificateUploadMode, setCertificateUploadMode] = useState<"attach" | "replace">("attach");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Queries
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;
  const canRead = hasPermission("medicalVisits.read");
  const canCreate = hasPermission("medicalVisits.create");
  const canUpdateMedicalVisits = hasPermission("medicalVisits.update");
  const canReadEmployees = hasPermission("employees.read");
  const canReadDocuments = hasPermission("documents.read");
  const canUploadDocuments = hasPermission("documents.upload");
  const canAttachCertificate = canUpdateMedicalVisits && canUploadDocuments;
  
  const visitsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canRead) return null;
    return query(collection(db, `entities/${entityId}/medicalVisits`), orderBy("visitDate", "desc")) as Query<MedicalVisit>;
  }, [db, entityId, permissionsReady, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canRead || !canReadEmployees) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, permissionsReady, canRead, canReadEmployees]);

  const { data: visits, loading: loadingVisits } = useCollection<MedicalVisit>(visitsQuery, "medical-visits.registry");
  const { data: employees, loading: loadingEmployees, error: employeesError } = useCollection<Employee>(employeesQuery, "medical-visits.employees_lookup");

  const loadGroupedRequests = useCallback(async () => {
    if (!user || !entityId || !permissionsReady || !canRead) {
      setGroupedRequests([]);
      return;
    }
    setLoadingGroupedRequests(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await getMedicalVisitRequestsAction({ idToken, entityId });
      if (!result.success) throw new Error(result.error);
      setGroupedRequests(result.requests as MedicalVisitRequestSummary[]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Demandes groupées indisponibles." });
    } finally {
      setLoadingGroupedRequests(false);
    }
  }, [canRead, entityId, permissionsReady, toast, user]);

  useEffect(() => {
    loadGroupedRequests();
  }, [loadGroupedRequests]);

  const employeeDirectorySuccessfullyLoaded =
    canReadEmployees &&
    !!employeesQuery &&
    !loadingEmployees &&
    !employeesError;

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const activeEmployees = useMemo(() => {
    if (!employees) return [];
    return employees
      .filter(e => {
        const s = String(e.status || "").toLowerCase();
        return s === 'active' || s === 'actif' || s === 'active_contract';
      })
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [employees]);

  // Filter Logic
  const filteredVisits = useMemo(() => {
    if (!visits) return [];
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return visits.filter(v => {
      const emp = employeesMap.get(v.employeeId);
      const searchTarget = `${v.doctorName} ${v.medicalCenter || ""} ${emp?.displayName || ""} ${emp?.employeeCode || ""}`.toLowerCase();
      
      if (filters.search && !searchTarget.includes(filters.search.toLowerCase())) return false;
      if (filters.visitType !== "all" && v.visitType !== filters.visitType) return false;
      if (filters.fitnessStatus !== "all" && v.fitnessStatus !== filters.fitnessStatus) return false;
      if (filters.status !== "all" && v.status !== filters.status) return false;

      if (filters.deadlineStatus !== "all" && v.nextVisitDate) {
        const nextDate = parseISO(v.nextVisitDate);
        if (filters.deadlineStatus === "expired" && !isBefore(nextDate, today)) return false;
        if (filters.deadlineStatus === "upcoming" && !(isBefore(nextDate, thirtyDaysOut) && !isBefore(nextDate, today))) return false;
        if (filters.deadlineStatus === "ok" && isBefore(nextDate, thirtyDaysOut)) return false;
      } else if (filters.deadlineStatus !== "all" && !v.nextVisitDate) {
        return false;
      }

      return true;
    });
  }, [visits, filters, employeesMap]);

  const sortedFilteredVisits = useMemo(() => {
    return [...filteredVisits].sort((a, b) => {
      const dateA = `${a.visitDate || ""}T${a.visitStartTime || "00:00"}`;
      const dateB = `${b.visitDate || ""}T${b.visitStartTime || "00:00"}`;
      return dateB.localeCompare(dateA);
    });
  }, [filteredVisits]);

  const totalVisitPages = Math.max(1, Math.ceil(sortedFilteredVisits.length / visitPageSize));
  const safeVisitPage = Math.min(visitPage, totalVisitPages);
  const visitRangeStart = sortedFilteredVisits.length === 0 ? 0 : (safeVisitPage - 1) * visitPageSize + 1;
  const visitRangeEnd = Math.min(safeVisitPage * visitPageSize, sortedFilteredVisits.length);
  const paginatedVisits = useMemo(() => {
    const start = (safeVisitPage - 1) * visitPageSize;
    return sortedFilteredVisits.slice(start, start + visitPageSize);
  }, [safeVisitPage, sortedFilteredVisits, visitPageSize]);
  const paginationPages = useMemo(() => buildPaginationPages(safeVisitPage, totalVisitPages), [safeVisitPage, totalVisitPages]);

  useEffect(() => {
    setVisitPage(1);
  }, [filters.search, filters.visitType, filters.fitnessStatus, filters.status, filters.deadlineStatus, visitPageSize]);

  useEffect(() => {
    if (visitPage > totalVisitPages) {
      setVisitPage(totalVisitPages);
    }
  }, [totalVisitPages, visitPage]);

  const filteredGroupedRequests = useMemo(() => {
    const normalizedSearch = requestSearch.trim().toLowerCase();
    return [...groupedRequests]
      .filter((request) => {
        if (!requestStatusMatchesFilter(request, requestStatusFilter)) return false;
        if (!normalizedSearch) return true;
        const searchTarget = [
          MEDICAL_VISIT_TYPE_LABELS[request.visitType],
          request.providerName,
          request.medicalCenter,
          MEDICAL_VISIT_REQUEST_STATUS_LABELS[request.status as keyof typeof MEDICAL_VISIT_REQUEST_STATUS_LABELS],
          request.providerEmail,
          request.constraints,
        ].filter(Boolean).join(" ").toLowerCase();
        return searchTarget.includes(normalizedSearch);
      })
      .sort((a, b) => getRequestPriority(a) - getRequestPriority(b) || getRequestUpdatedTime(b) - getRequestUpdatedTime(a));
  }, [groupedRequests, requestSearch, requestStatusFilter]);

  const visibleGroupedRequests = useMemo(
    () => filteredGroupedRequests.slice(0, visibleRequestCount),
    [filteredGroupedRequests, visibleRequestCount]
  );

  useEffect(() => {
    setVisibleRequestCount(REQUEST_PAGE_SIZE);
  }, [requestSearch, requestStatusFilter]);

  useEffect(() => {
    if (expandedRequestId && !groupedRequests.some((request) => request.id === expandedRequestId)) {
      setExpandedRequestId(null);
    }
  }, [expandedRequestId, groupedRequests]);

  const handleEdit = (v: MedicalVisit) => {
    setEditingId(v.id);
    setIsResultMode(false);
    setIsDialogVisible(true);
  };

  const handleEnterResult = (v: MedicalVisit) => {
    setEditingId(v.id);
    setIsResultMode(true);
    setIsDialogVisible(true);
  };

  const handleOpenCertificate = async (visit: MedicalVisit, disposition: "view" | "download") => {
    if (!user || !entityId || !visit.documentId || !canReadDocuments) return;
    const loadingKey = `${visit.id}:${disposition}`;
    setViewingDocId(loadingKey);
    try {
      const idToken = await user.getIdToken(true);
      const result = await getMedicalCertificateUrlAction({
        idToken,
        entityId,
        visitId: visit.id,
        disposition,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Impossible d'ouvrir le document." });
    } finally {
      setViewingDocId(null);
    }
  };

  const handleExecuteUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !uploadingRequest || !uploadFile) return;
    if (!canAttachCertificate) {
      toast({
        variant: "destructive",
        title: "Action indisponible",
        description: "L’ajout d’un certificat médical nécessite l’autorisation de charger des documents.",
      });
      setUploadFile(null);
      setUploadingRequest(null);
      return;
    }

    setIsUploading(true);
    try {
      const idToken = await user.getIdToken(true);
      const formData = new FormData();
      formData.set("file", uploadFile);
      const result = certificateUploadMode === "replace"
        ? await replaceMedicalCertificateAction({ idToken, entityId, visitId: uploadingRequest.id }, formData)
        : await attachMedicalCertificateAction({ idToken, entityId, visitId: uploadingRequest.id }, formData);
      if (!result.success) {
        throw new Error(result.error);
      }
      
      toast({
        title: certificateUploadMode === "replace" ? "Certificat remplacé" : "Document rattaché",
        description: certificateUploadMode === "replace"
          ? "Le nouveau certificat médical est lié à la visite."
          : "Le certificat médical a été lié à la visite.",
      });
      setUploadingRequest(null);
      setUploadFile(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Échec de l'envoi", description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenMaterializationDialog = async (request: MedicalVisitRequestSummary) => {
    if (!user || !entityId || !canRead) return;
    setMaterializingRequest(request);
    setMaterializationParticipants([]);
    setMaterializationSlots([]);
    setMaterializationResult(null);
    setLoadingMaterializationDetails(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await getMedicalVisitRequestDetailsAction({ idToken, entityId, requestId: request.id });
      if (!result.success) throw new Error(result.error);
      setMaterializationParticipants(result.participants as MedicalVisitRequestParticipantDetail[]);
      setMaterializationSlots(result.slots as MedicalVisitProviderSlotDetail[]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Détail de la demande indisponible." });
      setMaterializingRequest(null);
    } finally {
      setLoadingMaterializationDetails(false);
    }
  };

  const handleMaterializeRequest = async () => {
    if (!user || !entityId || !materializingRequest || isMaterializing) return;
    setIsMaterializing(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await materializeMedicalVisitsFromRequestAction({
        idToken,
        entityId,
        requestId: materializingRequest.id,
      });
      if (!result.success) throw new Error(result.error);
      setMaterializationResult({
        createdCount: result.createdCount,
        existingCount: result.existingCount,
        materializedAt: result.materializedAt,
        materializedByName: result.materializedByName,
      });
      await loadGroupedRequests();
      setMaterializingRequest(null);
      setMaterializationParticipants([]);
      setMaterializationSlots([]);
      setMaterializationResult(null);
      const totalVisits = result.createdCount + result.existingCount;
      toast({
        title: `${totalVisits} ${totalVisits === 1 ? "visite individuelle créée" : "visites individuelles créées"}.`,
        description: result.existingCount > 0
          ? `${result.createdCount} nouvelle(s), ${result.existingCount} déjà existante(s).`
          : "Les visites sont visibles dans le tableau des visites médicales.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Création des visites impossible." });
    } finally {
      setIsMaterializing(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await archiveMedicalVisitAction({ idToken, entityId, visitId: id });
      if (!result.success) {
        throw new Error(result.error);
      }
      toast({ title: "Visite archivée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-primary tracking-tight">Visites médicales / Sorveglianza sanitaria</h1>
          <p className="text-muted-foreground text-sm font-medium">Gestion des visites médicales et de l'aptitude au travail.</p>
        </div>
        {canCreate && (
          <div className="flex flex-col items-start md:items-end gap-2">
            <Button
              onClick={() => {
                if (!canReadEmployees) return;
                setEditingRequestId(null);
                setIsRequestDialogVisible(true);
              }}
              disabled={!canReadEmployees}
              className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold"
            >
              <Plus className="w-4 h-4" /> Nouvelle demande de visites médicales
            </Button>
            <p className="max-w-sm text-xs font-medium text-muted-foreground text-left md:text-right">
              Sélectionnez un ou plusieurs employés et le médecin ou centre médical.
            </p>
            {false && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={!canReadEmployees}
                  className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold"
                >
                  <Plus className="w-4 h-4" /> Nouvelle
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl">
                <DropdownMenuItem
                  onClick={() => {
                    setEditingRequestId(null);
                    setIsRequestDialogVisible(true);
                  }}
                  className="flex-col items-start gap-1 p-3"
                >
                  <span className="flex items-center gap-2 font-black">
                    <Users className="h-4 w-4" /> Demande groupée
                  </span>
                  <span className="text-xs text-muted-foreground">Organiser des visites pour plusieurs employés</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setEditingRequestId(null);
                    setIsRequestDialogVisible(true);
                  }}
                  className="flex-col items-start gap-1 p-3"
                >
                  <span className="flex items-center gap-2 font-black">
                    <Users className="h-4 w-4" /> Demande de visites médicales
                  </span>
                  <span className="text-xs text-muted-foreground">Sélectionner un ou plusieurs employés</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
            {false && (<>
            <Button
              onClick={() => {
                if (!canReadEmployees) return;
                setEditingRequestId(null);
                setIsRequestDialogVisible(true);
              }}
              disabled={!canReadEmployees}
              className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold"
            >
              <Users className="w-4 h-4" /> Nouvelle demande de visites médicales
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!canReadEmployees) return;
                setEditingRequestId(null);
                setIsRequestDialogVisible(true);
              }}
              disabled={!canReadEmployees}
              className="gap-2 rounded-xl font-bold"
            >
              <Users className="w-4 h-4" /> Nouvelle demande de visites médicales
            </Button>
            </>)}
            {!canReadEmployees && (
              <p className="max-w-xs text-[10px] font-medium text-muted-foreground text-left md:text-right">
                La création d’une visite médicale nécessite l’autorisation de consulter les employés.
              </p>
            )}
          </div>
        )}
      </header>

      {/* Stats / KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total visites" value={visits?.length || 0} icon={Stethoscope} color="blue" />
         <StatCard title="Résultats en attente" value={visits?.filter(v => v.fitnessStatus === 'pending_result').length || 0} icon={Clock} color="orange" />
         <StatCard title="Échéances critiques" value={visits?.filter(v => v.nextVisitDate && isBefore(parseISO(v.nextVisitDate), addDays(startOfDay(new Date()), 30))).length || 0} icon={AlertTriangle} color="red" />
         <StatCard title="Aptes (Idonei)" value={visits?.filter(v => v.fitnessStatus === 'fit').length || 0} icon={CheckCircle2} color="green" />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-primary">Demandes de visites médicales</h2>
            <p className="text-sm text-muted-foreground">Demandes adressées au médecin ou centre pour un ou plusieurs employés.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={loadGroupedRequests} disabled={loadingGroupedRequests} className="gap-2 self-start sm:self-auto">
            {loadingGroupedRequests ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Actualiser
          </Button>
        </div>

        <Card className="rounded-[2rem] border-primary/10 bg-white shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  placeholder="Rechercher une demande, un médecin, un centre..."
                  className="rounded-xl pl-10"
                />
              </div>
              <Select value={requestStatusFilter} onValueChange={setRequestStatusFilter}>
                <SelectTrigger className="w-full rounded-xl lg:w-[240px]">
                  <SelectValue placeholder="Statut de demande" />
                </SelectTrigger>
                <SelectContent>
                  {requestStatusFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 text-xs font-bold text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>{filteredGroupedRequests.length} demande{filteredGroupedRequests.length > 1 ? "s" : ""} trouvée{filteredGroupedRequests.length > 1 ? "s" : ""}</p>
              <p>Filtres des demandes groupées — séparés du tableau des visites individuelles.</p>
            </div>
          </CardContent>
        </Card>

        {loadingGroupedRequests ? (
          <Card className="rounded-[2rem] border-primary/10 p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          </Card>
        ) : groupedRequests.length === 0 ? (
          <Card className="rounded-[2rem] border-dashed border-primary/20 bg-muted/20 p-8 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-bold text-muted-foreground">Aucune demande groupée enregistrée.</p>
          </Card>
        ) : filteredGroupedRequests.length === 0 ? (
          <Card className="rounded-[2rem] border-dashed border-primary/20 bg-muted/20 p-8 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-bold text-muted-foreground">Aucune demande ne correspond aux filtres.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {visibleGroupedRequests.map((request) => {
              const isExpanded = expandedRequestId === request.id;
              const periodLabel = `${format(parseISO(request.desiredStartDate), "dd/MM/yyyy")}–${format(parseISO(request.desiredEndDate), "dd/MM/yyyy")}`;
              const currentStep = getRequestCurrentStep(request);
              return (
              <Card key={request.id} className={cn("overflow-hidden rounded-[2rem] border shadow-sm transition-colors", getRequestAccentClass(request.status))}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                  className="flex w-full flex-col gap-3 p-4 text-left transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center sm:justify-between sm:p-5"
                >
                  <div className="flex min-w-0 gap-3">
                    <span aria-hidden="true" className={cn("mt-1 h-12 w-1 rounded-full", getRequestHeaderAccentClass(request.status))} />
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("rounded-full border px-3 py-1 font-black", getRequestStatusBadgeClass(request.status))}>
                        {MEDICAL_VISIT_REQUEST_STATUS_LABELS[request.status as keyof typeof MEDICAL_VISIT_REQUEST_STATUS_LABELS] || "Brouillon"}
                      </Badge>
                      <h3 className="min-w-0 text-base font-black text-primary sm:text-lg">
                        {MEDICAL_VISIT_TYPE_LABELS[request.visitType]}
                      </h3>
                    </div>
                    <div className="flex flex-col gap-1 text-sm font-bold text-slate-700 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                      <span className="truncate">{request.providerName || request.medicalCenter || "Prestataire non renseigné"}</span>
                      <span className="hidden text-muted-foreground sm:inline">·</span>
                      <span>{request.participantCount} {request.participantCount === 1 ? "collaborateur" : "collaborateurs"}</span>
                      <span className="hidden text-muted-foreground sm:inline">·</span>
                      <span>{periodLabel}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
                      <span>Étape actuelle : {currentStep}</span>
                      {(request.employeeInvitationAttemptCount || 0) > 0 && (
                        <span>{request.employeeEmailSentCount || 0} e-mails · {request.employeeNotificationSentCount || 0} notifications</span>
                      )}
                      {(request.slotCount || 0) > 0 && (
                        <span>{request.slotCount} {(request.slotCount || 0) === 1 ? "créneau" : "créneaux"}</span>
                      )}
                    </div>
                  </div>
                  </div>
                  <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                </button>

                {isExpanded && (
                <CardContent className="space-y-4 border-t bg-white/80 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Badge variant="outline" className={cn("mb-2 rounded-full border px-3 py-1 font-black", getRequestStatusBadgeClass(request.status))}>
                        {MEDICAL_VISIT_REQUEST_STATUS_LABELS[request.status as keyof typeof MEDICAL_VISIT_REQUEST_STATUS_LABELS] || "Brouillon"}
                      </Badge>
                      <h3 className="truncate text-base font-black text-primary">{MEDICAL_VISIT_TYPE_LABELS[request.visitType]}</h3>
                      <p className="text-sm font-bold text-slate-700">{request.providerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {MEDICAL_VISIT_PROVIDER_TYPE_LABELS[request.providerType]} · {request.medicalCenter || "Centre non renseigné"}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-lg font-black text-primary">{request.participantCount}</p>
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">
                        {request.participantCount === 1 ? "collaborateur" : "collaborateurs"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <p className="font-black uppercase text-muted-foreground">Période souhaitée</p>
                      <p className="font-bold">{format(parseISO(request.desiredStartDate), "dd/MM/yyyy")} – {format(parseISO(request.desiredEndDate), "dd/MM/yyyy")}</p>
                    </div>
                    <div>
                      <p className="font-black uppercase text-muted-foreground">Urgence</p>
                      <p className="font-bold">{MEDICAL_VISIT_REQUEST_URGENCY_LABELS[request.urgency]}</p>
                    </div>
                    <div>
                      <p className="font-black uppercase text-muted-foreground">Créée le</p>
                      <p className="font-bold">{request.createdAt ? format(parseISO(request.createdAt), "dd/MM/yyyy") : "—"}</p>
                    </div>
                    <div>
                      <p className="font-black uppercase text-muted-foreground">Prochaines étapes</p>
                      <p className="font-bold text-muted-foreground">Demande au médecin · Créneaux · Planification</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      { label: "Participants et médecin", done: true },
                      { label: "Demande au médecin", done: !!request.providerRequestSentAt || ["awaiting_provider_response", "slots_received", "assignments_ready", "employees_planned", "completed"].includes(request.status) },
                      { label: "Créneaux reçus", done: (request.slotCount || 0) > 0 || ["slots_received", "assignments_ready", "employees_planned", "completed"].includes(request.status) },
                      { label: "Affectation", done: request.status === "assignments_ready" || ["employees_planned", "completed"].includes(request.status) },
                      { label: "Planification", done: ["employees_planned", "completed"].includes(request.status) },
                      { label: "Suivi individuel", done: false },
                    ].map((step, index) => (
                      <div
                        key={step.label}
                        className={cn(
                          "rounded-xl border px-2 py-2 font-black uppercase leading-tight",
                          step.done ? "border-primary/20 bg-primary/10 text-primary" : "border-muted bg-muted/30 text-muted-foreground"
                        )}
                      >
                        {index + 1}. {step.label}
                      </div>
                    ))}
                  </div>

                  {request.providerRequestSentAt && (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                      <p className="font-black">En attente de réponse du médecin</p>
                      <p>Destinataire : {request.providerRequestSentRecipient || request.providerEmail}</p>
                      <p>Envoyé le : {format(parseISO(request.providerRequestSentAt), "dd/MM/yyyy HH:mm")}</p>
                      <p>Envoyé par : {request.providerRequestSentByDisplayName || request.providerRequestSentByName || request.providerRequestSentBy || "—"}</p>
                      <p>Nombre d'envois : {request.providerRequestSendCount || 1}</p>
                    </div>
                  )}

                  {(request.slotCount || request.providerResponseRecordedAt) && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
                      <p className="font-black">{request.slotCount || 0} {(request.slotCount || 0) === 1 ? "créneau reçu" : "créneaux reçus"}</p>
                      <p>{request.assignedParticipantCount || 0} {(request.assignedParticipantCount || 0) === 1 ? "collaborateur affecté" : "collaborateurs affectés"}</p>
                      <p>{request.unassignedParticipantCount || 0} {(request.unassignedParticipantCount || 0) === 1 ? "collaborateur sans créneau" : "collaborateurs sans créneau"}</p>
                      {request.providerResponseRecordedAt && (
                        <p>Réponse enregistrée le : {format(parseISO(request.providerResponseRecordedAt), "dd/MM/yyyy HH:mm")}</p>
                      )}
                      {request.providerResponseRecordedByName && (
                        <p>Enregistrée par : {request.providerResponseRecordedByName}</p>
                      )}
                    </div>
                  )}

                  {(request.individualVisitsCreatedAt || request.status === "employees_planned") && (
                    <div className="rounded-2xl border border-primary/10 bg-primary/5 p-3 text-xs text-primary">
                      <p className="font-black">Visites individuelles créées</p>
                      <p>{request.individualVisitsCount || request.participantCount} {(request.individualVisitsCount || request.participantCount) === 1 ? "visite individuelle" : "visites individuelles"}</p>
                      {request.individualVisitsCreatedAt && (
                        <p>Créées le : {format(parseISO(request.individualVisitsCreatedAt), "dd/MM/yyyy HH:mm")}</p>
                      )}
                      {request.individualVisitsCreatedByName && (
                        <p>Créées par : {request.individualVisitsCreatedByName}</p>
                      )}
                      <p className="mt-1 font-bold text-muted-foreground">
                        La planification source est verrouillée. Les modifications futures se font sur chaque visite individuelle.
                      </p>
                    </div>
                  )}

                  {(request.employeeInvitationsLastSentAt || (request.employeeInvitationAttemptCount || 0) > 0) && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
                      <p className="font-black">Convocations collaborateurs</p>
                      <p>{request.employeeInvitationEligibleCount || 0} visite{(request.employeeInvitationEligibleCount || 0) > 1 ? "s" : ""} éligible{(request.employeeInvitationEligibleCount || 0) > 1 ? "s" : ""}</p>
                      <p>{request.participantCount} {(request.participantCount || 0) === 1 ? "convocation traitée" : "convocations traitées"}</p>
                      <p>{request.employeeEmailSentCount || 0} e-mail{(request.employeeEmailSentCount || 0) > 1 ? "s" : ""} envoyé{(request.employeeEmailSentCount || 0) > 1 ? "s" : ""}</p>
                      <p>{request.employeeNotificationSentCount || 0} notification{(request.employeeNotificationSentCount || 0) > 1 ? "s" : ""} créée{(request.employeeNotificationSentCount || 0) > 1 ? "s" : ""}</p>
                      <p>{request.employeeManualContactCount || 0} contact{(request.employeeManualContactCount || 0) > 1 ? "s" : ""} manuel{(request.employeeManualContactCount || 0) > 1 ? "s" : ""} requis</p>
                      <p>{request.employeeInvitationSkippedCount || 0} visite{(request.employeeInvitationSkippedCount || 0) > 1 ? "s" : ""} ignorée{(request.employeeInvitationSkippedCount || 0) > 1 ? "s" : ""}</p>
                      <p>{request.employeeInvitationFailureCount || 0} échec{(request.employeeInvitationFailureCount || 0) > 1 ? "s" : ""} retryable{(request.employeeInvitationFailureCount || 0) > 1 ? "s" : ""}</p>
                      {request.employeeInvitationsLastSentAt && (
                        <p>Dernier envoi : {format(parseISO(request.employeeInvitationsLastSentAt), "dd/MM/yyyy HH:mm")}</p>
                      )}
                      {request.employeeInvitationsLastSentByName && (
                        <p>Envoyé par : {request.employeeInvitationsLastSentByName}</p>
                      )}
                    </div>
                  )}

                  {request.status === "draft" && canUpdateMedicalVisits && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => {
                          setEditingRequestId(request.id);
                          setIsRequestDialogVisible(true);
                        }}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Modifier la demande
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderEmailRequestId(request.id)}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Préparer l'e-mail au médecin
                      </Button>
                    </div>
                  )}
                  {request.status === "awaiting_provider_response" && canUpdateMedicalVisits && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderEmailRequestId(request.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Voir l'e-mail envoyé
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderEmailRequestId(request.id)}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Renvoyer l'e-mail
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderSlotsRequestId(request.id)}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        Enregistrer la réponse du médecin
                      </Button>
                    </div>
                  )}
                  {["slots_received", "assignments_ready"].includes(request.status) && canUpdateMedicalVisits && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderSlotsRequestId(request.id)}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        Gérer les créneaux et affectations
                      </Button>
                      {request.status === "assignments_ready" && canCreate && (
                        <Button
                          size="sm"
                          className="rounded-xl font-bold"
                          onClick={() => handleOpenMaterializationDialog(request)}
                        >
                          <FileCheck className="mr-2 h-4 w-4" />
                          {"Créer les visites individuelles"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setProviderEmailRequestId(request.id)}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Renvoyer l'e-mail
                      </Button>
                    </div>
                  )}
                  {request.status === "employees_planned" && canUpdateMedicalVisits && (request.individualVisitsCount || 0) >= request.participantCount && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        size="sm"
                        className="rounded-xl font-bold"
                        onClick={() => setEmployeeInvitationsRequestId(request.id)}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        {(request.employeeInvitationAttemptCount || 0) > 0 ? "Renvoyer les invitations" : "Notifier les collaborateurs"}
                      </Button>
                    </div>
                  )}
                </CardContent>
                )}
              </Card>
              );
            })}
            {visibleGroupedRequests.length < filteredGroupedRequests.length && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={() => setVisibleRequestCount((count) => count + REQUEST_PAGE_SIZE)}
                >
                  Afficher plus
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-primary/10 pt-8">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-primary">Visites médicales individuelles</h2>
          <p className="text-sm text-muted-foreground">Suivi opérationnel des rendez-vous créés pour chaque collaborateur.</p>
        </div>
        {/* Filters */}
        <div className="rounded-[2rem] border border-primary/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10 rounded-xl"
              placeholder="Rechercher collaborateur, médecin..."
              value={filters.search}
              onChange={(e) => setFilters(p => ({...p, search: e.target.value}))}
            />
          </div>
          
          <Select value={filters.visitType} onValueChange={(v) => setFilters(p => ({...p, visitType: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Type de visite" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {Object.entries(MEDICAL_VISIT_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.deadlineStatus} onValueChange={(v) => setFilters(p => ({...p, deadlineStatus: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Échéance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les échéances</SelectItem>
              <SelectItem value="expired">Échue</SelectItem>
              <SelectItem value="upcoming">À échéance proche (30j)</SelectItem>
              <SelectItem value="ok">À jour</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
            <SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="scheduled">Planifiée</SelectItem>
              <SelectItem value="completed">Terminée</SelectItem>
              <SelectItem value="pending_result">En attente de résultat</SelectItem>
              <SelectItem value="cancelled">Annulée</SelectItem>
              <SelectItem value="archived">Archivée</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" onClick={() => setFilters(initialFilters)} className="text-muted-foreground text-xs font-bold uppercase">
             <X className="w-3.5 h-3.5 mr-1" /> Réinitialiser
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-3 text-xs font-bold text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {sortedFilteredVisits.length === 0
              ? "0 visite trouvée"
              : `Affichage de ${visitRangeStart} à ${visitRangeEnd} sur ${sortedFilteredVisits.length} visite${sortedFilteredVisits.length > 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-2">
            <span>Par page</span>
            <Select value={String(visitPageSize)} onValueChange={(value) => setVisitPageSize(Number(value))}>
              <SelectTrigger className="h-9 w-[90px] rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visitPageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        </div>

        {/* Table */}
        <Card className="hidden overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] md:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 border-b bg-secondary/95 backdrop-blur supports-[backdrop-filter]:bg-secondary/80">
              <TableRow>
                <TableHead className="pl-6 font-black uppercase tracking-widest text-primary">Employé</TableHead>
                <TableHead className="font-black uppercase tracking-widest text-primary">Type & Date</TableHead>
                <TableHead>Jugement d'aptitude</TableHead>
                <TableHead>Certificat (GED)</TableHead>
                <TableHead>Médecin</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingVisits ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : sortedFilteredVisits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune visite trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedVisits.map((v) => {
                  const emp = employeesMap.get(v.employeeId);
                  const collaboratorName = emp?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
                  const collaboratorCode = emp?.employeeCode || (employeeDirectorySuccessfullyLoaded ? v.employeeId.slice(0, 8) : "—");
                  const visitDate = parseISO(v.visitDate);
                  const isPast = isBefore(visitDate, startOfDay(new Date()));
                  const isMissingResult = isPast && v.fitnessStatus === 'pending_result' && v.status !== 'cancelled' && v.status !== 'archived';

                  return (
                    <TableRow key={v.id} className="align-middle transition-colors hover:bg-muted/50">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{collaboratorName}</span>
                           <span className="text-[10px] text-muted-foreground uppercase font-mono">{collaboratorCode}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-bold text-primary">{MEDICAL_VISIT_TYPE_LABELS[v.visitType]}</span>
                           <span className="text-[10px] text-muted-foreground">{format(visitDate, "dd/MM/yyyy")}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                         {getFitnessBadge(v.fitnessStatus, isMissingResult)}
                         {(v.prescriptions || v.restrictions) && (
                            <div className="flex gap-1 mt-1">
                               <Badge variant="outline" className="text-[8px] h-3 px-1 border-orange-200 text-orange-600 bg-orange-50 uppercase font-black">Prescriptions</Badge>
                            </div>
                         )}
                      </TableCell>
                      <TableCell>
                         {v.documentId ? (
                           canReadDocuments ? (
                             <button
                               onClick={() => handleOpenCertificate(v, "view")}
                               disabled={!!viewingDocId}
                               className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase hover:underline disabled:opacity-50 group"
                             >
                               <FileCheck className="w-3.5 h-3.5" />
                               Certificat joint
                               {viewingDocId === `${v.id}:view` ? (
                                 <Loader2 className="w-2.5 h-2.5 animate-spin ml-1" />
                               ) : (
                                 <Eye className="w-2.5 h-2.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                               )}
                             </button>
                           ) : (
                             <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase">
                               <FileCheck className="w-3.5 h-3.5 opacity-30" /> Certificat joint
                             </div>
                           )
                         ) : (
                           <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase">
                             <Paperclip className="w-3.5 h-3.5 opacity-30" /> Non joint
                           </div>
                         )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-medium text-slate-700">{v.doctorName}</span>
                           <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{v.medicalCenter || "Centre non renseigné"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                         {v.nextVisitDate ? (
                           <div className="flex flex-col">
                              <span className={cn("text-xs font-black", getDeadlineColor(v.nextVisitDate))}>
                                 {format(parseISO(v.nextVisitDate), "dd/MM/yyyy")}
                              </span>
                              {isExpired(v.nextVisitDate) && <span className="text-[8px] font-bold text-red-600 uppercase">Échue</span>}
                           </div>
                         ) : v.status === "scheduled" || v.status === "pending_result" ? (
                           <span className="text-xs font-bold text-muted-foreground">À définir après résultat</span>
                         ) : v.status === "completed" ? (
                           <span className="text-xs font-bold text-amber-700">Non renseignée</span>
                         ) : (
                           <span className="text-xs text-muted-foreground">Non applicable</span>
                         )}
                      </TableCell>
                      <TableCell>
                         {getStatusBadge(v.status, isMissingResult)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <DropdownMenu modal={false}>
                           <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-48">
                              {v.documentId && canReadDocuments && (
                                <DropdownMenuItem onClick={() => handleOpenCertificate(v, "view")} className="gap-2 font-bold text-primary" disabled={!!viewingDocId}>
                                  <Eye className="w-4 h-4" /> Voir certificat
                                </DropdownMenuItem>
                              )}
                              {v.documentId && canReadDocuments && (
                                <DropdownMenuItem onClick={() => handleOpenCertificate(v, "download")} className="gap-2 font-bold text-primary" disabled={!!viewingDocId}>
                                  <Download className="w-4 h-4" /> Télécharger certificat
                                </DropdownMenuItem>
                              )}
                              {v.documentId && canAttachCertificate && v.status !== "archived" && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setCertificateUploadMode("replace");
                                    setUploadingRequest(v);
                                  }}
                                  className="gap-2 font-bold text-primary"
                                  disabled={isUploading}
                                >
                                  <RefreshCcw className="w-4 h-4" /> Remplacer le certificat
                                </DropdownMenuItem>
                              )}
                              {!v.documentId && !isMissingResult && v.fitnessStatus !== 'pending_result' && canAttachCertificate && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setCertificateUploadMode("attach");
                                    setUploadingRequest(v);
                                  }}
                                  className="gap-2 font-bold text-primary"
                                >
                                   <Upload className="w-4 h-4" /> Joindre certificat
                                </DropdownMenuItem>
                              )}
                              {v.fitnessStatus === 'pending_result' && !isTerminal(v.status) && (
                                <DropdownMenuItem onClick={() => handleEnterResult(v)} className="gap-2 font-bold text-primary">
                                   <FileSignature className="w-4 h-4" /> Saisir le résultat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(v)} className="gap-2">
                                 <Edit className="w-4 h-4" /> Modifier
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleArchive(v.id)} className="gap-2 text-destructive">
                                 <Archive className="w-4 h-4" /> Archiver
                              </DropdownMenuItem>
                           </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </Card>
        <div className="space-y-3 md:hidden">
          {loadingVisits ? (
            <Card className="rounded-[2rem] border-primary/10 p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            </Card>
          ) : sortedFilteredVisits.length === 0 ? (
            <Card className="rounded-[2rem] border-dashed border-primary/20 bg-muted/20 p-8 text-center">
              <ListFilter className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-bold text-muted-foreground">Aucune visite trouvée.</p>
            </Card>
          ) : (
            paginatedVisits.map((v) => {
              const emp = employeesMap.get(v.employeeId);
              const collaboratorName = emp?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
              const collaboratorCode = emp?.employeeCode || (employeeDirectorySuccessfullyLoaded ? v.employeeId.slice(0, 8) : "—");
              const visitDate = parseISO(v.visitDate);
              const isPast = isBefore(visitDate, startOfDay(new Date()));
              const isMissingResult = isPast && v.fitnessStatus === "pending_result" && v.status !== "cancelled" && v.status !== "archived";

              return (
                <Card key={v.id} className="rounded-[2rem] border-primary/10 bg-white shadow-sm">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-primary">{collaboratorName}</p>
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground">{collaboratorCode}</p>
                      </div>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {v.documentId && canReadDocuments && (
                            <DropdownMenuItem onClick={() => handleOpenCertificate(v, "view")} className="gap-2 font-bold text-primary" disabled={!!viewingDocId}>
                              <Eye className="w-4 h-4" /> Voir certificat
                            </DropdownMenuItem>
                          )}
                          {v.documentId && canReadDocuments && (
                            <DropdownMenuItem onClick={() => handleOpenCertificate(v, "download")} className="gap-2 font-bold text-primary" disabled={!!viewingDocId}>
                              <Download className="w-4 h-4" /> Télécharger certificat
                            </DropdownMenuItem>
                          )}
                          {v.documentId && canAttachCertificate && v.status !== "archived" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setCertificateUploadMode("replace");
                                setUploadingRequest(v);
                              }}
                              className="gap-2 font-bold text-primary"
                              disabled={isUploading}
                            >
                              <RefreshCcw className="w-4 h-4" /> Remplacer le certificat
                            </DropdownMenuItem>
                          )}
                          {!v.documentId && !isMissingResult && v.fitnessStatus !== "pending_result" && canAttachCertificate && (
                            <DropdownMenuItem
                              onClick={() => {
                                setCertificateUploadMode("attach");
                                setUploadingRequest(v);
                              }}
                              className="gap-2 font-bold text-primary"
                            >
                              <Upload className="w-4 h-4" /> Joindre certificat
                            </DropdownMenuItem>
                          )}
                          {v.fitnessStatus === "pending_result" && !isTerminal(v.status) && (
                            <DropdownMenuItem onClick={() => handleEnterResult(v)} className="gap-2 font-bold text-primary">
                              <FileSignature className="w-4 h-4" /> Saisir le résultat
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleEdit(v)} className="gap-2">
                            <Edit className="w-4 h-4" /> Modifier
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleArchive(v.id)} className="gap-2 text-destructive">
                            <Archive className="w-4 h-4" /> Archiver
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-sm">
                      <div className="rounded-2xl bg-muted/30 p-3">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">Type & date</p>
                        <p className="font-bold text-primary">{MEDICAL_VISIT_TYPE_LABELS[v.visitType]}</p>
                        <p className="text-xs font-bold text-muted-foreground">{format(visitDate, "dd/MM/yyyy")}</p>
                      </div>
                      <div className="rounded-2xl bg-muted/30 p-3">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">Médecin / centre</p>
                        <p className="font-bold text-slate-800">{v.doctorName}</p>
                        <p className="break-words text-xs font-bold text-muted-foreground">{v.medicalCenter || "Centre non renseigné"}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                      <div className="space-y-1">
                        <p className="font-black uppercase text-muted-foreground">Jugement</p>
                        {getFitnessBadge(v.fitnessStatus, isMissingResult)}
                      </div>
                      <div className="space-y-1">
                        <p className="font-black uppercase text-muted-foreground">Statut</p>
                        {getStatusBadge(v.status, isMissingResult)}
                      </div>
                      <div className="space-y-1">
                        <p className="font-black uppercase text-muted-foreground">Échéance</p>
                        {v.nextVisitDate ? (
                          <p className={cn("font-black", getDeadlineColor(v.nextVisitDate))}>{format(parseISO(v.nextVisitDate), "dd/MM/yyyy")}</p>
                        ) : v.status === "scheduled" || v.status === "pending_result" ? (
                          <p className="font-bold text-muted-foreground">À définir après résultat</p>
                        ) : v.status === "completed" ? (
                          <p className="font-bold text-amber-700">Non renseignée</p>
                        ) : (
                          <p className="text-muted-foreground">Non applicable</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="font-black uppercase text-muted-foreground">Certificat</p>
                        <p className={cn("font-bold", v.documentId ? "text-green-700" : "text-muted-foreground")}>
                          {v.documentId ? "Certificat joint" : "Non joint"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {sortedFilteredVisits.length > 0 && (
          <div className="flex flex-col gap-3 rounded-[2rem] border border-primary/10 bg-white p-4 text-sm shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <p className="font-bold text-muted-foreground">
              {visitRangeStart}–{visitRangeEnd} sur {sortedFilteredVisits.length} visite{sortedFilteredVisits.length > 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setVisitPage(1)} disabled={safeVisitPage === 1}>
                Première
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setVisitPage((page) => Math.max(1, page - 1))} disabled={safeVisitPage === 1}>
                Précédente
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {paginationPages.map((page, index) => page === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={page}
                    type="button"
                    variant={page === safeVisitPage ? "default" : "outline"}
                    size="sm"
                    className="h-9 w-9 rounded-xl p-0"
                    aria-label={`Page ${page}`}
                    aria-current={page === safeVisitPage ? "page" : undefined}
                    onClick={() => setVisitPage(page)}
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setVisitPage((page) => Math.min(totalVisitPages, page + 1))} disabled={safeVisitPage === totalVisitPages}>
                Suivante
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setVisitPage(totalVisitPages)} disabled={safeVisitPage === totalVisitPages}>
                Dernière
              </Button>
            </div>
          </div>
        )}
      </section>

      <MedicalVisitRequestDialog
        open={isRequestDialogVisible}
        onOpenChange={(open) => {
          setIsRequestDialogVisible(open);
          if (!open) setEditingRequestId(null);
        }}
        entityId={entityId}
        requestId={editingRequestId}
        employees={activeEmployees}
        onSaved={loadGroupedRequests}
      />

      <MedicalProviderEmailDialog
        open={!!providerEmailRequestId}
        onOpenChange={(open) => {
          if (!open) setProviderEmailRequestId(null);
        }}
        entityId={entityId}
        requestId={providerEmailRequestId}
        onSent={loadGroupedRequests}
      />

      <MedicalProviderSlotsDialog
        open={!!providerSlotsRequestId}
        onOpenChange={(open) => {
          if (!open) setProviderSlotsRequestId(null);
        }}
        entityId={entityId}
        requestId={providerSlotsRequestId}
        onSaved={loadGroupedRequests}
      />

      <MedicalEmployeeInvitationsDialog
        open={!!employeeInvitationsRequestId}
        onOpenChange={(open) => {
          if (!open) setEmployeeInvitationsRequestId(null);
        }}
        entityId={entityId}
        requestId={employeeInvitationsRequestId}
        onSent={loadGroupedRequests}
      />

      <Dialog open={!!materializingRequest} onOpenChange={(open) => {
        if (!open && !isMaterializing) {
          setMaterializingRequest(null);
          setMaterializationParticipants([]);
          setMaterializationSlots([]);
          setMaterializationResult(null);
        }
      }}>
        <DialogContent className="sm:max-w-[760px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-black text-primary">
              <FileCheck className="h-6 w-6" />
              Créer les visites individuelles
            </DialogTitle>
            <DialogDescription>
              Chaque collaborateur recevra une visite médicale indépendante. Aucun e-mail ni notification salarié ne sera envoyé dans ce batch.
            </DialogDescription>
          </DialogHeader>

          {loadingMaterializationDetails ? (
            <div className="flex items-center justify-center rounded-2xl border bg-muted/20 p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border bg-muted/20 p-3">
                  <p className="text-xs font-black uppercase text-muted-foreground">Collaborateurs</p>
                  <p className="text-lg font-black text-primary">{materializationParticipants.length}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-3">
                  <p className="text-xs font-black uppercase text-muted-foreground">Créneaux médecin</p>
                  <p className="text-lg font-black text-primary">{materializationSlots.length}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-3">
                  <p className="text-xs font-black uppercase text-muted-foreground">Demande</p>
                  <p className="truncate text-sm font-black text-primary">{materializingRequest?.providerName || "—"}</p>
                </div>
              </div>

              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {materializationParticipants.map((participant) => {
                  const slot = materializationSlots.find((item) => item.slotId === participant.assignedSlotId);
                  const visitStatus =
                    participant.resultingMedicalVisitStatus === "created"
                      ? "Créée"
                      : participant.resultingMedicalVisitStatus === "incoherent"
                        ? "Introuvable/incohérente"
                        : "Non créée";
                  return (
                    <div key={participant.employeeId} className="rounded-2xl border p-3 text-xs">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-primary">{participant.employeeDisplayNameSnapshot}</p>
                          <p className="font-bold text-muted-foreground">{participant.employeeCodeSnapshot}</p>
                        </div>
                        <Badge variant={participant.resultingMedicalVisitStatus === "created" ? "secondary" : "outline"} className="self-start rounded-full font-black">
                          {visitStatus}
                        </Badge>
                      </div>
                      <p className="mt-2 font-bold text-muted-foreground">
                        Rendez-vous : {slot ? `${format(parseISO(slot.date), "dd/MM/yyyy")} · ${participant.assignedStartTime || "—"}–${participant.assignedEndTime || "—"} · ${slot.location}` : "Créneau introuvable"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {materializationResult && (
                <div className="rounded-2xl border border-green-100 bg-green-50 p-3 text-xs text-green-800">
                  <p className="font-black">Visites individuelles créées</p>
                  <p>{materializationResult.createdCount} création(s) · {materializationResult.existingCount} déjà existante(s)</p>
                  <p>Créées le : {format(parseISO(materializationResult.materializedAt), "dd/MM/yyyy HH:mm")}</p>
                  <p>Créées par : {materializationResult.materializedByName}</p>
                  <p className="mt-1 font-bold">Elles sont visibles dans le tableau des visites médicales existant.</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setMaterializingRequest(null)} disabled={isMaterializing}>
              Fermer
            </Button>
            <Button
              type="button"
              onClick={handleMaterializeRequest}
              disabled={isMaterializing || loadingMaterializationDetails || !!materializationResult}
              className="rounded-xl font-black"
            >
              {isMaterializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer la création
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MedicalVisitDialog 
        open={isDialogVisible} 
        onOpenChange={(open) => {
          setIsDialogVisible(open);
          if (!open) {
            setEditingId(null);
            setIsResultMode(false);
          }
        }}
        entityId={entityId}
        visitId={editingId}
        resultMode={isResultMode}
        employees={activeEmployees}
        canUpdateMedicalVisits={canUpdateMedicalVisits}
        canReadDocuments={canReadDocuments}
        canUploadDocuments={canUploadDocuments}
      />

      {/* Late Attachment Dialog */}
      <Dialog open={!!uploadingRequest && canAttachCertificate} onOpenChange={(open) => {
        if (!open) {
          setUploadingRequest(null);
          setUploadFile(null);
          setCertificateUploadMode("attach");
        }
      }}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              {certificateUploadMode === "replace" ? <RefreshCcw className="w-6 h-6" /> : <Paperclip className="w-6 h-6" />}
              {certificateUploadMode === "replace" ? "Remplacer le certificat médical" : "Joindre certificat médical"}
            </DialogTitle>
            <DialogDescription>
              Lier le certificat d'aptitude pour la visite du {uploadingRequest && format(parseISO(uploadingRequest.visitDate), "dd/MM/yyyy")}.
            </DialogDescription>
            {certificateUploadMode === "replace" && (
              <p className="text-xs font-bold text-primary">
                Remplacer le certificat actuel par un nouveau fichier.
              </p>
            )}
          </DialogHeader>

          <form onSubmit={handleExecuteUpload} className="space-y-6 py-4">
             <div className="space-y-4">
                {certificateUploadMode === "replace" && (
                  <div className="flex items-center gap-2 rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-xs font-bold text-green-700">
                    <FileCheck className="h-4 w-4" />
                    Certificat actuel joint
                  </div>
                )}
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-8 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                  uploadFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                )}>
                   <Input 
                     type="file" 
                     accept=".pdf,.png,.jpg,.jpeg" 
                     className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                     onChange={(e) => {
                       if (!canAttachCertificate) {
                         e.target.value = "";
                         setUploadFile(null);
                         return;
                       }
                       const file = e.target.files?.[0];
                       if (file && file.size > 10 * 1024 * 1024) {
                         toast({ variant: "destructive", title: "Fichier trop volumineux", description: "La taille max est de 10 Mo." });
                         e.target.value = "";
                         return;
                       }
                       setUploadFile(file || null);
                     }}
                     required
                   />
                   {uploadFile ? (
                      <>
                        <div className="bg-green-100 p-2 rounded-xl text-green-600 mb-1"><FileCheck className="w-5 h-5" /></div>
                        <p className="text-xs font-bold text-green-800">{uploadFile.name}</p>
                      </>
                   ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-300 mb-1" />
                        <p className="text-xs font-bold text-slate-600">Cliquez pour choisir le certificat</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">PDF, PNG, JPG (10 Mo max)</p>
                      </>
                   )}
                </div>
             </div>

             <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="ghost" onClick={() => setUploadingRequest(null)} disabled={isUploading}>Annuler</Button>
                <Button 
                  type="submit" 
                  disabled={isUploading || !uploadFile || !canAttachCertificate}
                  className="rounded-xl px-8 font-black shadow-lg"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : (
                    certificateUploadMode === "replace" ? <RefreshCcw className="w-4 h-4 mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />
                  )}
                  {certificateUploadMode === "replace" ? "Remplacer le certificat" : "Lancer l'importation"}
                </Button>
             </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    green: "bg-green-50 text-green-600 border-green-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };
  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl group bg-white hover:shadow-md transition-all">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border transition-colors", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{title}</p>
          <p className="text-2xl font-black text-primary leading-none mt-1">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getFitnessBadge(status: MedicalFitnessStatus, isMissingResult: boolean) {
  if (isMissingResult) return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] animate-pulse">RÉSULTAT MANQUANT</Badge>;

  switch (status) {
    case 'fit': return <Badge className="bg-green-600 text-white border-none text-[10px]">{FITNESS_STATUS_LABELS.fit}</Badge>;
    case 'fit_with_prescriptions': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{FITNESS_STATUS_LABELS.fit_with_prescriptions}</Badge>;
    case 'temporarily_unfit': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px]">{FITNESS_STATUS_LABELS.temporarily_unfit}</Badge>;
    case 'unfit': return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">{FITNESS_STATUS_LABELS.unfit}</Badge>;
    case 'pending_result': return <Badge variant="outline" className="bg-slate-50 text-slate-400 border-slate-200 text-[10px]">{FITNESS_STATUS_LABELS.pending_result}</Badge>;
    default: return null;
  }
}

function getStatusBadge(status: MedicalVisitStatus, isMissingResult: boolean) {
  if (isMissingResult) return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">EN ATTENTE JUGEMENT</Badge>;

  switch (status) {
    case 'scheduled': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Planifiée</Badge>;
    case 'completed': return <Badge className="bg-slate-900 text-white border-none text-[10px]">Terminée</Badge>;
    case 'pending_result': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">En attente de résultat</Badge>;
    case 'cancelled': return <Badge variant="outline" className="text-muted-foreground text-[10px]">Annulée</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 text-[10px]">Archivée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function isExpired(date: string) {
  return isBefore(parseISO(date), startOfDay(new Date()));
}

function isTerminal(status: MedicalVisitStatus) {
  return status === 'completed' || status === 'cancelled' || status === 'archived';
}

function getDeadlineColor(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  const thirtyDays = addDays(today, 30);

  if (isBefore(d, today)) return "text-red-600";
  if (isBefore(d, thirtyDays)) return "text-orange-600";
  return "text-slate-600";
}
