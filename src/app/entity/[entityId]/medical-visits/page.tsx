"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { 
  Stethoscope, Plus, Search, Eye, Edit, Archive, Mail,
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, Users,
  Building2, ArrowUpRight, History, MoreVertical,
  RefreshCcw, FileSignature, FileText, Paperclip,
  FileCheck, Upload, ShieldCheck, Download
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
  getMedicalVisitRequestsAction,
  getMedicalCertificateUrlAction,
  replaceMedicalCertificateAction,
} from "@/app/entity/[entityId]/medical-visits/actions";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { MedicalVisitDialog } from "@/components/medical-visits/MedicalVisitDialog";
import { MedicalVisitRequestDialog } from "@/components/medical-visits/MedicalVisitRequestDialog";
import { MedicalProviderEmailDialog } from "@/components/medical-visits/MedicalProviderEmailDialog";
import { MedicalProviderSlotsDialog } from "@/components/medical-visits/MedicalProviderSlotsDialog";
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
};

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
  const [groupedRequests, setGroupedRequests] = useState<MedicalVisitRequestSummary[]>([]);
  const [loadingGroupedRequests, setLoadingGroupedRequests] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
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

        {loadingGroupedRequests ? (
          <Card className="rounded-[2rem] border-primary/10 p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          </Card>
        ) : groupedRequests.length === 0 ? (
          <Card className="rounded-[2rem] border-dashed border-primary/20 bg-muted/20 p-8 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-bold text-muted-foreground">Aucune demande groupée enregistrée.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {groupedRequests.map((request) => (
              <Card key={request.id} className="rounded-[2rem] border-primary/10 shadow-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="mb-2 rounded-full font-black">
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
                      { label: "Planification", done: false },
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-4">
        {/* Filters */}
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

        {/* Table */}
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
          <Table>
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead className="pl-6">Employé</TableHead>
                <TableHead>Type & Date</TableHead>
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
              ) : filteredVisits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune visite trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredVisits.map((v) => {
                  const emp = employeesMap.get(v.employeeId);
                  const collaboratorName = emp?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
                  const collaboratorCode = emp?.employeeCode || (employeeDirectorySuccessfullyLoaded ? v.employeeId.slice(0, 8) : "—");
                  const visitDate = parseISO(v.visitDate);
                  const isPast = isBefore(visitDate, startOfDay(new Date()));
                  const isMissingResult = isPast && v.fitnessStatus === 'pending_result' && v.status !== 'cancelled' && v.status !== 'archived';

                  return (
                    <TableRow key={v.id} className="hover:bg-muted/50 transition-colors">
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
                         ) : <span className="text-muted-foreground text-xs">—</span>}
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
      </div>

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
