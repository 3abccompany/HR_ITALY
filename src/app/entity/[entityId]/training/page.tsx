"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { 
  GraduationCap, Plus, Search, Eye, Edit, Archive, 
  Loader2, Filter, X, ListFilter, Calendar, 
  AlertTriangle, CheckCircle2, Clock, User, 
  Building2, ArrowUpRight, ArrowRight, History, MoreVertical,
  RefreshCcw, FileSignature, XCircle, FileCheck, Paperclip, Upload,
  ShieldCheck, Mail, Send, Download, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query, doc, getDoc } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  Training, 
  TrainingType, 
  TrainingStatus,
  TrainingResultStatus,
  TrainingAttendanceResponseStatus,
  TrainingParticipant,
  TrainingSession,
  TrainingSessionStatus,
  TRAINING_TYPE_LABELS,
  TRAINING_STATUS_LABELS,
  TRAINING_RESULT_LABELS 
} from "@/types/training";
import {
  archiveTraining,
  updateTraining,
  saveTrainingSessionWithParticipants,
  getTrainingParticipants,
  submitTrainingSessionForApproval,
  approveTrainingSession,
  rejectTrainingSession,
} from "@/services/training.service";
import { uploadHRDocument, getDocumentDownloadUrl } from "@/services/document.service";
import { Employee } from "@/types/employee";
import { useToast } from "@/hooks/use-toast";
import { TrainingDialog } from "@/components/trainings/TrainingDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format, isBefore, addDays, startOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  deriveTrainingParticipantValidityState,
  formatTrainingValidityExpiryLabel,
  formatTrainingValidityStateLabel,
  type TrainingValidityState,
} from "@/services/training-validity.service";
import {
  attachTrainingParticipantCertificateAction,
  getTrainingParticipantCertificateUrlAction,
  getTrainingParticipantInvitationsPreviewAction,
  getTrainingTrainerAvailabilityRequestPreviewAction,
  getTrainingTrainerEmailPreviewAction,
  recordTrainingTrainerAvailabilityResponseAction,
  replaceTrainingParticipantCertificateAction,
  sendTrainingParticipantInvitationsAction,
  sendTrainingTrainerAvailabilityRequestAction,
  sendTrainingTrainerEmailAction,
  updateTrainingParticipantResultAction,
  updateTrainingSessionLifecycleAction,
} from "./actions";

const initialFilters = {
  search: "",
  trainingType: "all",
  status: "all",
  deadlineStatus: "all"
};

const initialSessionForm = {
  title: "",
  trainingType: "worker_general" as TrainingType,
  description: "",
  providerName: "",
  trainerType: "external" as "internal" | "external",
  trainerName: "",
  trainerEmail: "",
  internalTrainerEmployeeId: "",
  deliveryMode: "classroom" as "classroom" | "online" | "blended" | "on_the_job",
  location: "",
  startDate: new Date().toISOString().split("T")[0],
  endDate: "",
  startTime: "",
  endTime: "",
  durationHours: "",
  status: "draft" as TrainingSessionStatus,
  renewalMode: "" as "" | "none" | "periodic" | "event_triggered",
  renewalPeriodMonths: "",
  validityWarningDays: "60",
  renewalPolicyLabelSnapshot: "",
  renewalPolicyLegalNoteSnapshot: "",
};

const initialParticipantRegisterFilters = {
  search: "",
  sessionId: "all",
  participantStatus: "all",
  resultStatus: "all",
  validityStatus: "all",
};

const initialSessionListFilters = {
  search: "",
  trainingType: "all",
  status: "all",
  approvalStatus: "all",
  availabilityStatus: "all",
  dateCategory: "all",
};

const SESSION_PAGE_SIZE_OPTIONS = [10, 25, 50];

const TRAINING_CERTIFICATE_MAX_FILE_SIZE = 10 * 1024 * 1024;
const TRAINING_CERTIFICATE_ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];

type TrainingTrainerEmailPreview = {
  sessionId: string;
  to: string;
  subject: string;
  body: string;
  participantCount: number;
  lastSentAt?: string | null;
};

type TrainingTrainerAvailabilityPreview = {
  sessionId: string;
  to: string;
  subject: string;
  body: string;
};

type TrainingParticipantInvitationPreviewRow = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  accountLabel: string;
  emailLabel: string;
  plannedChannel: string;
};

type TrainingParticipantInvitationDeliveryRow = TrainingParticipantInvitationPreviewRow & {
  inApp: "sent" | "already_sent" | "failed" | "not_applicable" | "absent";
  email: "sent" | "already_sent" | "failed" | "not_applicable" | "absent";
  finalResult: "invitation_sent" | "email_only" | "manual_required" | "partial_failure" | "already_sent";
  error?: string | null;
};

type TrainingParticipantInvitationPreview = {
  sessionId: string;
  rows: TrainingParticipantInvitationPreviewRow[];
  results?: TrainingParticipantInvitationDeliveryRow[] | null;
};

type ParticipantRegisterRow = {
  id: string;
  entityId: string;
  sessionId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  sessionTitle: string;
  sessionDate: string;
  sessionStatus: TrainingSessionStatus;
  participant: TrainingParticipant;
  session: TrainingSession;
  validityState: TrainingValidityState;
};

type SessionLifecycleDialogState = {
  session: TrainingSession;
  targetStatus: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed">;
} | null;

type TrainingTrainerAvailabilityResponseDialogState = {
  session: TrainingSession;
} | null;

export default function TrainingsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db, auth } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  // UI State
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isResultMode, setIsResultMode] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [isSessionDialogOpen, setIsSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<TrainingSession | null>(null);
  const [sessionForm, setSessionForm] = useState(initialSessionForm);
  const [durationManuallyOverridden, setDurationManuallyOverridden] = useState(false);
  const skipNextDurationAutoCalculationRef = useRef(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantsBySessionId, setParticipantsBySessionId] = useState<Record<string, TrainingParticipant[]>>({});
  const [participantsReloadKey, setParticipantsReloadKey] = useState(0);
  const [loadingTrainingParticipants, setLoadingTrainingParticipants] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionActionLoadingId, setSessionActionLoadingId] = useState<string | null>(null);
  const [sessionLifecycleDialog, setSessionLifecycleDialog] = useState<SessionLifecycleDialogState>(null);
  const [trainerPreview, setTrainerPreview] = useState<TrainingTrainerEmailPreview | null>(null);
  const [availabilityPreview, setAvailabilityPreview] = useState<TrainingTrainerAvailabilityPreview | null>(null);
  const [participantInvitationPreview, setParticipantInvitationPreview] = useState<TrainingParticipantInvitationPreview | null>(null);
  const [availabilityResponseDialog, setAvailabilityResponseDialog] = useState<TrainingTrainerAvailabilityResponseDialogState>(null);
  const [availabilityResponseForm, setAvailabilityResponseForm] = useState<{ response: "available" | "unavailable"; responseNote: string }>({
    response: "available",
    responseNote: "",
  });
  const [previewLoadingSessionId, setPreviewLoadingSessionId] = useState<string | null>(null);
  const [trainerEmailSending, setTrainerEmailSending] = useState(false);
  const [availabilityEmailSending, setAvailabilityEmailSending] = useState(false);
  const [participantInvitationsSending, setParticipantInvitationsSending] = useState(false);
  const [availabilityResponseSaving, setAvailabilityResponseSaving] = useState(false);
  const [participantRegisterFilters, setParticipantRegisterFilters] = useState(initialParticipantRegisterFilters);
  const [participantRegisterPagination, setParticipantRegisterPagination] = useState({ page: 1, pageSize: 10 });
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionListFilters, setSessionListFilters] = useState(initialSessionListFilters);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(10);
  const [editingParticipantResult, setEditingParticipantResult] = useState<ParticipantRegisterRow | null>(null);
  const [participantResultForm, setParticipantResultForm] = useState<{
    participantStatus: TrainingParticipant["participantStatus"];
    resultStatus: TrainingResultStatus | "none";
    resultNotes: string;
  }>({
    participantStatus: "attended",
    resultStatus: "attended",
    resultNotes: "",
  });
  const [participantResultSaving, setParticipantResultSaving] = useState(false);
  const [certificateParticipant, setCertificateParticipant] = useState<ParticipantRegisterRow | null>(null);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [certificateSaving, setCertificateSaving] = useState(false);
  const [certificateActionLoadingId, setCertificateActionLoadingId] = useState<string | null>(null);

  // Late Attachment State
  const [uploadingRequest, setUploadingRequest] = useState<Training | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Queries
  const canRead = hasPermission("training.read");
  const canReadEmployees = hasPermission("employees.read");
  const canCreate = hasPermission("training.create");
  const canUpdate = hasPermission("training.update");
  const canApprove = hasPermission("training.approve");
  const canUploadDocuments = hasPermission("documents.upload");
  const canReadDocuments = hasPermission("documents.read");
  
  const trainingsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canRead) return null;
    return query(collection(db, `entities/${entityId}/trainings`), orderBy("updatedAt", "desc")) as Query<Training>;
  }, [db, entityId, permissionsReady, canRead]);

  const trainingSessionsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canRead) return null;
    return query(collection(db, `entities/${entityId}/trainingSessions`), orderBy("startDate", "desc")) as Query<TrainingSession>;
  }, [db, entityId, permissionsReady, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canRead || !canReadEmployees) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, permissionsReady, canRead, canReadEmployees]);

  const { data: trainings, loading: loadingTrainings } = useCollection<Training>(trainingsQuery, "trainings.registry");
  const { data: trainingSessions, loading: loadingTrainingSessions } = useCollection<TrainingSession>(trainingSessionsQuery, "training.sessions.registry");
  const { data: employees, loading: loadingEmployees, error: employeesError } = useCollection<Employee>(employeesQuery, "trainings.employees_lookup");
  const employeeDirectorySuccessfullyLoaded = canReadEmployees && !!employeesQuery && !loadingEmployees && !employeesError;

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

  const formatSessionTrainerDisplay = (session: TrainingSession) => {
    if (session.trainerType === "external") {
      return session.trainerName?.trim() || "Formateur non renseigné";
    }

    const internalTrainer = session.internalTrainerEmployeeId
      ? employeesMap.get(session.internalTrainerEmployeeId)
      : null;
    const internalTrainerName = internalTrainer ? getEmployeeDisplayName(internalTrainer) : "";
    return internalTrainerName?.trim() || "Formateur non renseigné";
  };

  const visibleSessionIds = useMemo(() => {
    return (trainingSessions || []).map((session) => session.id).filter(Boolean).sort();
  }, [trainingSessions]);
  const visibleSessionKey = visibleSessionIds.join("|");

  useEffect(() => {
    let cancelled = false;

    async function loadSessionParticipants() {
      if (!entityId || !permissionsReady || !canRead || visibleSessionIds.length === 0) {
        setParticipantsBySessionId({});
        setLoadingTrainingParticipants(false);
        return;
      }

      setLoadingTrainingParticipants(true);
      try {
        const entries = await Promise.all(
          visibleSessionIds.map(async (sessionId) => {
            const participants = await getTrainingParticipants(entityId, sessionId);
            return [sessionId, participants] as const;
          })
        );

        if (cancelled) return;
        setParticipantsBySessionId(Object.fromEntries(entries));
      } catch (err: any) {
        if (cancelled) return;
        console.error("[Training] Direct session participant load failed", {
          entityId,
          sessionIds: visibleSessionIds,
          error: err,
        });
        toast({
          variant: "destructive",
          title: "Participants indisponibles",
          description: err.message || "Impossible de charger les participants des sessions visibles.",
        });
        setParticipantsBySessionId({});
      } finally {
        if (!cancelled) setLoadingTrainingParticipants(false);
      }
    }

    loadSessionParticipants();

    return () => {
      cancelled = true;
    };
  }, [entityId, permissionsReady, canRead, visibleSessionKey, participantsReloadKey, toast]);

  const activeParticipantsBySessionId = useMemo(() => {
    const map = new Map<string, TrainingParticipant[]>();
    Object.values(participantsBySessionId)
      .flat()
      ?.filter((participant) => participant.entityId === entityId && participant.participantStatus !== "cancelled")
      .forEach((participant) => {
        const list = map.get(participant.sessionId) || [];
        list.push(participant);
        map.set(participant.sessionId, list);
      });

    map.forEach((list) => {
      list.sort((a, b) => (a.employeeDisplayNameSnapshot || "").localeCompare(b.employeeDisplayNameSnapshot || ""));
    });

    return map;
  }, [participantsBySessionId, entityId]);

  const canonicalTrainingKpis = useMemo(() => {
    const sessions = trainingSessions || [];
    return {
      total: sessions.length,
      planned: sessions.filter((session) => session.status === "scheduled").length,
      completed: sessions.filter((session) => session.status === "completed").length,
      participants: sessions.reduce((total, session) => {
        return total + (activeParticipantsBySessionId.get(session.id)?.length || 0);
      }, 0),
    };
  }, [trainingSessions, activeParticipantsBySessionId]);

  const trainingSessionSummaryKpis = useMemo(() => {
    const sessions = trainingSessions || [];
    const today = startOfDay(new Date());
    return {
      total: sessions.length,
      approvalPending: sessions.filter((session) => session.approvalStatus === "pending").length,
      awaitingResponse: sessions.filter((session) => (
        getTrainerAvailabilityStatus(session) === "awaiting_response"
        || (activeParticipantsBySessionId.get(session.id) || []).some((participant) => (participant.attendanceResponseStatus || "pending") === "pending")
      )).length,
      upcoming: sessions.filter((session) => {
        const date = parseDateOnly(session.startDate || "");
        return !!date && !isBefore(date, today) && !["completed", "cancelled", "archived"].includes(session.status);
      }).length,
      completed: sessions.filter((session) => session.status === "completed").length,
    };
  }, [trainingSessions, activeParticipantsBySessionId]);

  const filteredSortedTrainingSessions = useMemo(() => {
    const search = sessionListFilters.search.trim().toLowerCase();
    return [...(trainingSessions || [])]
      .filter((session) => {
        const participants = activeParticipantsBySessionId.get(session.id) || [];
        const participantNames = participants.map((participant) => (
          `${participant.employeeDisplayNameSnapshot || ""} ${participant.employeeCodeSnapshot || ""}`
        )).join(" ");
        const searchTarget = [
          session.title,
          TRAINING_TYPE_LABELS[session.trainingType],
          formatSessionTrainerDisplay(session),
          session.location,
          participantNames,
        ].filter(Boolean).join(" ").toLowerCase();

        if (search && !searchTarget.includes(search)) return false;
        if (sessionListFilters.trainingType !== "all" && session.trainingType !== sessionListFilters.trainingType) return false;
        if (sessionListFilters.status !== "all" && session.status !== sessionListFilters.status) return false;
        if (sessionListFilters.approvalStatus !== "all" && session.approvalStatus !== sessionListFilters.approvalStatus) return false;
        if (sessionListFilters.availabilityStatus !== "all" && getTrainerAvailabilityStatus(session) !== sessionListFilters.availabilityStatus) return false;
        if (sessionListFilters.dateCategory !== "all" && getSessionDateCategory(session) !== sessionListFilters.dateCategory) return false;
        return true;
      })
      .sort((a, b) => (
        getTrainingSessionOperationalPriority(a, activeParticipantsBySessionId.get(a.id) || [])
        - getTrainingSessionOperationalPriority(b, activeParticipantsBySessionId.get(b.id) || [])
        || getTrainingSessionDateSortValue(a) - getTrainingSessionDateSortValue(b)
        || getTrainingSessionUpdatedSortValue(b) - getTrainingSessionUpdatedSortValue(a)
      ));
  }, [activeParticipantsBySessionId, formatSessionTrainerDisplay, sessionListFilters, trainingSessions]);

  const totalSessionPages = Math.max(1, Math.ceil(filteredSortedTrainingSessions.length / sessionPageSize));
  const safeSessionPage = Math.min(sessionPage, totalSessionPages);
  const sessionRangeStart = filteredSortedTrainingSessions.length === 0 ? 0 : (safeSessionPage - 1) * sessionPageSize + 1;
  const sessionRangeEnd = Math.min(safeSessionPage * sessionPageSize, filteredSortedTrainingSessions.length);
  const paginatedTrainingSessions = useMemo(() => {
    const start = (safeSessionPage - 1) * sessionPageSize;
    return filteredSortedTrainingSessions.slice(start, start + sessionPageSize);
  }, [filteredSortedTrainingSessions, safeSessionPage, sessionPageSize]);
  const sessionPaginationPages = useMemo(() => buildCompactPaginationPages(safeSessionPage, totalSessionPages), [safeSessionPage, totalSessionPages]);

  useEffect(() => {
    setSessionPage(1);
  }, [
    sessionListFilters.search,
    sessionListFilters.trainingType,
    sessionListFilters.status,
    sessionListFilters.approvalStatus,
    sessionListFilters.availabilityStatus,
    sessionListFilters.dateCategory,
    sessionPageSize,
  ]);

  useEffect(() => {
    if (sessionPage > totalSessionPages) setSessionPage(totalSessionPages);
  }, [sessionPage, totalSessionPages]);

  useEffect(() => {
    if (expandedSessionId && !filteredSortedTrainingSessions.some((session) => session.id === expandedSessionId)) {
      setExpandedSessionId(null);
    }
  }, [expandedSessionId, filteredSortedTrainingSessions]);

  const participantRegisterRows = useMemo<ParticipantRegisterRow[]>(() => {
    return (trainingSessions || []).flatMap((session) => {
      const participants = activeParticipantsBySessionId.get(session.id) || [];
      return participants.map((participant) => ({
        id: `${session.id}:${participant.employeeId}`,
        entityId,
        sessionId: session.id,
        employeeId: participant.employeeId,
        employeeName: participant.employeeDisplayNameSnapshot || participant.employeeId,
        employeeCode: participant.employeeCodeSnapshot || "",
        sessionTitle: session.title,
        sessionDate: formatSessionDateRange(session),
        sessionStatus: session.status,
        participant,
        session,
        validityState: deriveTrainingParticipantValidityState(participant, session),
      }));
    }).sort((a, b) => (
      a.sessionTitle.localeCompare(b.sessionTitle)
      || a.employeeName.localeCompare(b.employeeName)
    ));
  }, [trainingSessions, activeParticipantsBySessionId, entityId]);

  const filteredParticipantRegisterRows = useMemo(() => {
    const search = participantRegisterFilters.search.trim().toLowerCase();
    return participantRegisterRows.filter((row) => {
      const resultStatus = row.participant.resultStatus || "none";
      const searchTarget = `${row.employeeName} ${row.employeeCode} ${row.sessionTitle}`.toLowerCase();
      if (search && !searchTarget.includes(search)) return false;
      if (participantRegisterFilters.sessionId !== "all" && row.sessionId !== participantRegisterFilters.sessionId) return false;
      if (participantRegisterFilters.participantStatus !== "all" && row.participant.participantStatus !== participantRegisterFilters.participantStatus) return false;
      if (participantRegisterFilters.resultStatus !== "all" && resultStatus !== participantRegisterFilters.resultStatus) return false;
      if (participantRegisterFilters.validityStatus !== "all" && row.validityState !== participantRegisterFilters.validityStatus) return false;
      return true;
    });
  }, [participantRegisterRows, participantRegisterFilters]);

  const participantValidityKpis = useMemo(() => {
    return participantRegisterRows.reduce((summary, row) => {
      if (row.validityState === "valid") summary.active += 1;
      if (row.validityState === "renewal_due") summary.renewalDue += 1;
      if (row.validityState === "expired") summary.expired += 1;
      if (row.validityState === "not_recorded") summary.notRecorded += 1;
      return summary;
    }, {
      active: 0,
      renewalDue: 0,
      expired: 0,
      notRecorded: 0,
    });
  }, [participantRegisterRows]);

  const participantRegisterTotalResults = filteredParticipantRegisterRows.length;
  const participantRegisterTotalPages = Math.max(1, Math.ceil(participantRegisterTotalResults / participantRegisterPagination.pageSize));
  const participantRegisterCurrentPage = Math.min(participantRegisterPagination.page, participantRegisterTotalPages);
  const paginatedParticipantRegisterRows = useMemo(() => {
    const start = (participantRegisterCurrentPage - 1) * participantRegisterPagination.pageSize;
    return filteredParticipantRegisterRows.slice(start, start + participantRegisterPagination.pageSize);
  }, [filteredParticipantRegisterRows, participantRegisterCurrentPage, participantRegisterPagination.pageSize]);
  const participantRegisterPaginationPages = useMemo(
    () => buildCompactPaginationPages(participantRegisterCurrentPage, participantRegisterTotalPages),
    [participantRegisterCurrentPage, participantRegisterTotalPages]
  );
  const participantRegisterRangeStart = participantRegisterTotalResults === 0
    ? 0
    : (participantRegisterCurrentPage - 1) * participantRegisterPagination.pageSize + 1;
  const participantRegisterRangeEnd = participantRegisterTotalResults === 0
    ? 0
    : Math.min(participantRegisterCurrentPage * participantRegisterPagination.pageSize, participantRegisterTotalResults);

  useEffect(() => {
    setParticipantRegisterPagination((current) => ({ ...current, page: 1 }));
  }, [
    participantRegisterFilters.search,
    participantRegisterFilters.sessionId,
    participantRegisterFilters.participantStatus,
    participantRegisterFilters.resultStatus,
    participantRegisterFilters.validityStatus,
    participantRegisterPagination.pageSize,
  ]);

  useEffect(() => {
    setParticipantRegisterPagination((current) => (
      current.page > participantRegisterTotalPages
        ? { ...current, page: participantRegisterTotalPages }
        : current
    ));
  }, [participantRegisterTotalPages]);

  const participantSearchValue = participantSearch.trim().toLowerCase();
  const selectedParticipantIdSet = useMemo(() => new Set(selectedParticipantIds), [selectedParticipantIds]);
  const selectableEmployees = useMemo(() => {
    return activeEmployees.filter((employee) => {
      if (!participantSearchValue) return true;
      const target = `${getEmployeeDisplayName(employee)} ${employee.employeeCode || ""}`.toLowerCase();
      return target.includes(participantSearchValue);
    });
  }, [activeEmployees, participantSearchValue]);

  // Filter Logic
  const filteredTrainings = useMemo(() => {
    if (!trainings) return [];
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    return trainings.filter(t => {
      const emp = employeesMap.get(t.employeeId);
      const searchTarget = `${t.title} ${t.provider || ""} ${emp?.displayName || ""} ${emp?.employeeCode || ""} ${t.batchId || ""}`.toLowerCase();
      
      if (filters.search && !searchTarget.includes(filters.search.toLowerCase())) return false;
      if (filters.trainingType !== "all" && t.trainingType !== filters.trainingType) return false;
      if (filters.status !== "all" && t.status !== filters.status) return false;

      if (filters.deadlineStatus !== "all" && t.expiryDate) {
        const expiry = parseISO(t.expiryDate);
        if (filters.deadlineStatus === "expired" && !isBefore(expiry, today)) return false;
        if (filters.deadlineStatus === "upcoming" && !(isBefore(expiry, thirtyDaysOut) && !isBefore(expiry, today))) return false;
        if (filters.deadlineStatus === "ok" && isBefore(expiry, thirtyDaysOut)) return false;
      } else if (filters.deadlineStatus !== "all" && !t.expiryDate) {
        return false;
      }

      return true;
    });
  }, [trainings, filters, employeesMap]);

  const openSessionDialog = (session?: TrainingSession | null) => {
    setEditingSession(session || null);
    setParticipantSearch("");
    if (session) {
      skipNextDurationAutoCalculationRef.current = true;
      setDurationManuallyOverridden(false);
      setSessionForm({
        title: session.title || "",
        trainingType: session.trainingType,
        description: session.description || "",
        providerName: session.providerName || "",
        trainerType: session.trainerType || "external",
        trainerName: session.trainerName || "",
        trainerEmail: session.trainerEmail || "",
        internalTrainerEmployeeId: session.internalTrainerEmployeeId || "",
        deliveryMode: session.deliveryMode || "classroom",
        location: session.location || "",
        startDate: session.startDate || new Date().toISOString().split("T")[0],
        endDate: session.endDate || "",
        startTime: session.startTime || "",
        endTime: session.endTime || "",
        durationHours: session.durationHours != null ? String(session.durationHours) : "",
        status: session.status || "draft",
        renewalMode: session.renewalMode || "",
        renewalPeriodMonths: session.renewalPeriodMonths != null ? String(session.renewalPeriodMonths) : "",
        validityWarningDays: session.validityWarningDays != null ? String(session.validityWarningDays) : "60",
        renewalPolicyLabelSnapshot: session.renewalPolicyLabelSnapshot || "",
        renewalPolicyLegalNoteSnapshot: session.renewalPolicyLegalNoteSnapshot || "",
      });
      setSelectedParticipantIds(
        (activeParticipantsBySessionId.get(session.id) || []).map((participant) => participant.employeeId)
      );
    } else {
      setDurationManuallyOverridden(false);
      setSessionForm(initialSessionForm);
      setSelectedParticipantIds([]);
    }
    setIsSessionDialogOpen(true);
  };

  useEffect(() => {
    if (!isSessionDialogOpen) return;
    if (skipNextDurationAutoCalculationRef.current) {
      skipNextDurationAutoCalculationRef.current = false;
      return;
    }
    if (durationManuallyOverridden) return;

    const calculatedDuration = calculateSessionDurationHours({
      startDate: sessionForm.startDate,
      endDate: sessionForm.endDate,
      startTime: sessionForm.startTime,
      endTime: sessionForm.endTime,
    });

    if (calculatedDuration == null || calculatedDuration <= 0) return;

    const formattedDuration = formatDurationHours(calculatedDuration);
    setSessionForm((current) => (
      current.durationHours === formattedDuration
        ? current
        : { ...current, durationHours: formattedDuration }
    ));
  }, [
    isSessionDialogOpen,
    durationManuallyOverridden,
    sessionForm.startDate,
    sessionForm.endDate,
    sessionForm.startTime,
    sessionForm.endTime,
  ]);

  const handleRecalculateDuration = () => {
    const calculatedDuration = calculateSessionDurationHours({
      startDate: sessionForm.startDate,
      endDate: sessionForm.endDate,
      startTime: sessionForm.startTime,
      endTime: sessionForm.endTime,
    });

    if (calculatedDuration == null || calculatedDuration <= 0) {
      toast({
        variant: "destructive",
        title: "Durée impossible à calculer",
        description: "Vérifiez les dates et les horaires de la formation.",
      });
      return;
    }

    setDurationManuallyOverridden(false);
    setSessionForm((current) => ({ ...current, durationHours: formatDurationHours(calculatedDuration) }));
  };

  const toggleSelectedParticipant = (employeeId: string, checked: boolean) => {
    setSelectedParticipantIds((current) => {
      if (checked) {
        return current.includes(employeeId) ? current : [...current, employeeId];
      }
      return current.filter((id) => id !== employeeId);
    });
  };

  const handleSaveSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!sessionForm.title.trim() || !sessionForm.startDate) {
      toast({ variant: "destructive", title: "Saisie incomplète", description: "Titre et date de début sont obligatoires." });
      return;
    }

    if (sessionForm.trainerType === "external" && sessionForm.trainerEmail && !isValidEmail(sessionForm.trainerEmail)) {
      toast({ variant: "destructive", title: "Email invalide", description: "Veuillez saisir un email formateur valide." });
      return;
    }

    if (sessionForm.endDate && isEndDateBeforeStartDate(sessionForm.startDate, sessionForm.endDate)) {
      toast({ variant: "destructive", title: "Dates invalides", description: "La date de fin ne peut pas précéder la date de début." });
      return;
    }

    if (sessionForm.startTime && sessionForm.endTime && !isEndTimeAfterStartTime(sessionForm.startTime, sessionForm.endTime)) {
      toast({ variant: "destructive", title: "Horaires invalides", description: "L'horaire de fin doit être postérieur à l'horaire de début. Les horaires de nuit ne sont pas pris en charge." });
      return;
    }

    const enteredDuration = sessionForm.durationHours ? Number(sessionForm.durationHours) : null;
    if (enteredDuration != null && (!Number.isFinite(enteredDuration) || enteredDuration <= 0)) {
      toast({ variant: "destructive", title: "Durée invalide", description: "La durée doit être supérieure à zéro." });
      return;
    }

    const calculatedDuration = calculateSessionDurationHours({
      startDate: sessionForm.startDate,
      endDate: sessionForm.endDate,
      startTime: sessionForm.startTime,
      endTime: sessionForm.endTime,
    });
    if (!durationManuallyOverridden && calculatedDuration != null && calculatedDuration <= 0) {
      toast({ variant: "destructive", title: "Durée invalide", description: "La durée calculée doit être supérieure à zéro." });
      return;
    }

    const renewalPeriodMonths = sessionForm.renewalPeriodMonths ? Number(sessionForm.renewalPeriodMonths) : null;
    const validityWarningDays = sessionForm.validityWarningDays ? Number(sessionForm.validityWarningDays) : null;

    if (sessionForm.renewalMode === "periodic") {
      if (renewalPeriodMonths == null || !Number.isInteger(renewalPeriodMonths) || renewalPeriodMonths <= 0) {
        toast({ variant: "destructive", title: "Renouvellement invalide", description: "La périodicité doit être un nombre entier de mois supérieur à zéro." });
        return;
      }
      if (validityWarningDays == null || !Number.isInteger(validityWarningDays) || validityWarningDays < 0) {
        toast({ variant: "destructive", title: "Alerte invalide", description: "Le délai d'alerte doit être un nombre entier de jours supérieur ou égal à zéro." });
        return;
      }
    }

    if (sessionForm.renewalMode === "event_triggered" && validityWarningDays != null && (!Number.isInteger(validityWarningDays) || validityWarningDays < 0)) {
      toast({ variant: "destructive", title: "Alerte invalide", description: "Le délai d'alerte doit être un nombre entier de jours supérieur ou égal à zéro." });
      return;
    }

    if (editingSession && loadingTrainingParticipants) {
      toast({ variant: "destructive", title: "Participants en cours de chargement", description: "Veuillez patienter avant d'enregistrer la session." });
      return;
    }

    setSessionSaving(true);
    try {
      const basePayload: Record<string, unknown> = {
        title: sessionForm.title.trim(),
        trainingType: sessionForm.trainingType,
        description: sessionForm.description.trim() || null,
        providerName: sessionForm.providerName.trim() || null,
        trainerType: sessionForm.trainerType,
        trainerName: sessionForm.trainerName.trim() || null,
        trainerEmail: sessionForm.trainerType === "external" ? sessionForm.trainerEmail.trim().toLowerCase() || null : null,
        internalTrainerEmployeeId: sessionForm.trainerType === "internal" ? sessionForm.internalTrainerEmployeeId || null : null,
        deliveryMode: sessionForm.deliveryMode,
        location: sessionForm.location.trim() || null,
        startDate: sessionForm.startDate,
        endDate: sessionForm.endDate || null,
        startTime: sessionForm.startTime || null,
        endTime: sessionForm.endTime || null,
        durationHours: sessionForm.durationHours ? Number(sessionForm.durationHours) : null,
      };

      if (sessionForm.renewalMode === "none") {
        Object.assign(basePayload, {
          renewalMode: "none",
          renewalRequired: false,
          renewalPeriodMonths: null,
          validityWarningDays: null,
          renewalPolicyLabelSnapshot: sessionForm.renewalPolicyLabelSnapshot.trim() || null,
          renewalPolicyLegalNoteSnapshot: sessionForm.renewalPolicyLegalNoteSnapshot.trim() || null,
        });
      } else if (sessionForm.renewalMode === "periodic") {
        Object.assign(basePayload, {
          renewalMode: "periodic",
          renewalRequired: true,
          renewalPeriodMonths,
          validityWarningDays,
          renewalPolicyLabelSnapshot: sessionForm.renewalPolicyLabelSnapshot.trim() || null,
          renewalPolicyLegalNoteSnapshot: sessionForm.renewalPolicyLegalNoteSnapshot.trim() || null,
        });
      } else if (sessionForm.renewalMode === "event_triggered") {
        Object.assign(basePayload, {
          renewalMode: "event_triggered",
          renewalRequired: true,
          renewalPeriodMonths: null,
          validityWarningDays: null,
          renewalPolicyLabelSnapshot: sessionForm.renewalPolicyLabelSnapshot.trim() || null,
          renewalPolicyLegalNoteSnapshot: sessionForm.renewalPolicyLegalNoteSnapshot.trim() || null,
        });
      }

      if (editingSession) {
        const savedParticipantIds = new Set(
          (activeParticipantsBySessionId.get(editingSession.id) || []).map((participant) => participant.employeeId)
        );
        const deselectedSavedCount = Array.from(savedParticipantIds)
          .filter((employeeId) => !selectedParticipantIds.includes(employeeId))
          .length;
        const participantSync = await saveTrainingSessionWithParticipants(
          entityId,
          editingSession.id,
          basePayload,
          selectedParticipantIds,
          user.uid
        );
        toast({
          title: "Formation mise à jour",
          description: deselectedSavedCount > 0
            ? "Les nouveaux participants ont été ajoutés. Le retrait d'un participant déjà enregistré sera disponible dans une prochaine étape."
            : `${participantSync.created.length} participant(s) ajouté(s).`,
        });
      } else {
        await saveTrainingSessionWithParticipants(entityId, null, basePayload, selectedParticipantIds, user.uid);
        toast({ title: "Formation créée", description: "La formation est créée en brouillon." });
      }
      setParticipantsReloadKey((current) => current + 1);
      setIsSessionDialogOpen(false);
      setEditingSession(null);
      setSelectedParticipantIds([]);
      setParticipantSearch("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur session", description: err.message || "Impossible d'enregistrer la session." });
    } finally {
      setSessionSaving(false);
    }
  };

  const handleSubmitApproval = async (session: TrainingSession) => {
    if (!user) return;
    setSessionActionLoadingId(session.id);
    try {
      await submitTrainingSessionForApproval(entityId, session.id, user.uid);
      toast({ title: "Session soumise pour approbation" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Soumission impossible", description: err.message });
    } finally {
      setSessionActionLoadingId(null);
    }
  };

  const handleApproveSession = async (session: TrainingSession) => {
    if (!user) return;
    setSessionActionLoadingId(session.id);
    try {
      await approveTrainingSession(entityId, session.id, user.uid);
      toast({ title: "Session approuvée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Approbation impossible", description: err.message });
    } finally {
      setSessionActionLoadingId(null);
    }
  };

  const handleRejectSession = async (session: TrainingSession) => {
    if (!user) return;
    setSessionActionLoadingId(session.id);
    try {
      await rejectTrainingSession(entityId, session.id, "Rejeté depuis la carte de session.", user.uid);
      toast({ title: "Session rejetée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Rejet impossible", description: err.message });
    } finally {
      setSessionActionLoadingId(null);
    }
  };

  const handleConfirmLifecycleTransition = async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser || !sessionLifecycleDialog) return;

    const { session, targetStatus } = sessionLifecycleDialog;
    const missingFields = targetStatus === "scheduled" ? getMissingSchedulingFields(session) : [];
    if (missingFields.length > 0) return;

    setSessionActionLoadingId(session.id);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await updateTrainingSessionLifecycleAction({
        idToken,
        entityId,
        sessionId: session.id,
        targetStatus,
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: getLifecycleSuccessMessage(targetStatus) });
      setSessionLifecycleDialog(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Transition impossible", description: err.message });
    } finally {
      setSessionActionLoadingId(null);
    }
  };

  const handlePreviewAvailabilityRequest = async (session: TrainingSession) => {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      toast({ variant: "destructive", title: "Session expirée", description: "Veuillez vous reconnecter." });
      return;
    }

    setPreviewLoadingSessionId(session.id);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await getTrainingTrainerAvailabilityRequestPreviewAction({ entityId, sessionId: session.id, idToken });
      if (!result.success) throw new Error(result.error);
      setAvailabilityPreview({
        sessionId: session.id,
        to: result.to,
        subject: result.subject,
        body: result.body,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Prévisualisation impossible", description: err.message });
    } finally {
      setPreviewLoadingSessionId(null);
    }
  };

  const handleSendAvailabilityRequest = async () => {
    const currentUser = auth?.currentUser;
    if (!availabilityPreview || !currentUser) return;
    setAvailabilityEmailSending(true);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await sendTrainingTrainerAvailabilityRequestAction({
        entityId,
        sessionId: availabilityPreview.sessionId,
        idToken,
        subjectOverride: availabilityPreview.subject,
        bodyOverride: availabilityPreview.body,
      });
      if (!result.success) throw new Error(result.error);
      toast({
        title: "Demande envoyée",
        description: result.warning || "La demande de disponibilité a été envoyée au formateur.",
      });
      setAvailabilityPreview(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Envoi impossible", description: err.message });
    } finally {
      setAvailabilityEmailSending(false);
    }
  };

  const openAvailabilityResponseDialog = (session: TrainingSession) => {
    setAvailabilityResponseDialog({ session });
    setAvailabilityResponseForm({
      response: session.trainerAvailabilityStatus === "unavailable" ? "unavailable" : "available",
      responseNote: session.trainerAvailabilityResponseNote || "",
    });
  };

  const handleSaveAvailabilityResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUser = auth?.currentUser;
    if (!currentUser || !availabilityResponseDialog) return;

    setAvailabilityResponseSaving(true);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await recordTrainingTrainerAvailabilityResponseAction({
        entityId,
        sessionId: availabilityResponseDialog.session.id,
        idToken,
        response: availabilityResponseForm.response,
        responseNote: availabilityResponseForm.responseNote,
      });
      if (!result.success) throw new Error(result.error);
      toast({ title: "Réponse enregistrée" });
      setAvailabilityResponseDialog(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Réponse impossible", description: err.message });
    } finally {
      setAvailabilityResponseSaving(false);
    }
  };

  const handlePreviewTrainerEmail = async (session: TrainingSession) => {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      toast({ variant: "destructive", title: "Session expirée", description: "Veuillez vous reconnecter." });
      return;
    }

    setPreviewLoadingSessionId(session.id);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await getTrainingTrainerEmailPreviewAction({ entityId, sessionId: session.id, idToken });
      if (!result.success) throw new Error(result.error);
      setTrainerPreview({
        sessionId: session.id,
        to: result.to,
        subject: result.subject,
        body: result.body,
        participantCount: result.participantCount,
        lastSentAt: result.lastSentAt,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Prévisualisation impossible", description: err.message });
    } finally {
      setPreviewLoadingSessionId(null);
    }
  };

  const handleSendTrainerEmail = async () => {
    const currentUser = auth?.currentUser;
    if (!trainerPreview || !currentUser) return;
    setTrainerEmailSending(true);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await sendTrainingTrainerEmailAction({
        entityId,
        sessionId: trainerPreview.sessionId,
        idToken,
        subjectOverride: trainerPreview.subject,
        bodyOverride: trainerPreview.body,
      });
      if (!result.success) throw new Error(result.error);
      toast({
        title: "Email envoyé au formateur",
        description: result.warning || "Le formateur externe a été notifié.",
      });
      setTrainerPreview(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Envoi impossible", description: err.message });
    } finally {
      setTrainerEmailSending(false);
    }
  };

  const handlePreviewParticipantInvitations = async (session: TrainingSession) => {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      toast({ variant: "destructive", title: "Session expirée", description: "Veuillez vous reconnecter." });
      return;
    }

    setPreviewLoadingSessionId(session.id);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await getTrainingParticipantInvitationsPreviewAction({ entityId, sessionId: session.id, idToken });
      if (!result.success) throw new Error(result.error);
      setParticipantInvitationPreview({
        sessionId: session.id,
        rows: result.rows,
        results: null,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Prévisualisation impossible", description: err.message });
    } finally {
      setPreviewLoadingSessionId(null);
    }
  };

  const handleSendParticipantInvitations = async () => {
    const currentUser = auth?.currentUser;
    if (!participantInvitationPreview || !currentUser) return;

    setParticipantInvitationsSending(true);
    try {
      const idToken = await currentUser.getIdToken(true);
      const result = await sendTrainingParticipantInvitationsAction({
        entityId,
        sessionId: participantInvitationPreview.sessionId,
        idToken,
      });
      if (!result.success) throw new Error(result.error);
      setParticipantInvitationPreview((preview) => preview ? { ...preview, results: result.rows } : preview);
      toast({
        title: "Participants notifiés",
        description: result.warning || "Le traitement des convocations est terminé.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Notification impossible", description: err.message });
    } finally {
      setParticipantInvitationsSending(false);
    }
  };

  const openParticipantResultDialog = (row: ParticipantRegisterRow) => {
    const fallbackResult = row.participant.participantStatus === "absent"
      ? "not_attended"
      : row.participant.participantStatus === "cancelled"
        ? "not_required"
        : row.participant.resultStatus || "none";

    setEditingParticipantResult(row);
    setParticipantResultForm({
      participantStatus: row.participant.participantStatus,
      resultStatus: fallbackResult,
      resultNotes: row.participant.resultNotes || "",
    });
  };

  const handleParticipantStatusChange = (participantStatus: TrainingParticipant["participantStatus"]) => {
    setParticipantResultForm((current) => {
      if (participantStatus === "absent") {
        return { ...current, participantStatus, resultStatus: "not_attended" };
      }
      if (participantStatus === "cancelled") {
        return { ...current, participantStatus, resultStatus: "not_required" };
      }
      if (participantStatus === "planned") {
        return { ...current, participantStatus, resultStatus: "none" };
      }
      if (participantStatus === "not_completed" && !["failed", "not_required"].includes(current.resultStatus)) {
        return { ...current, participantStatus, resultStatus: "failed" };
      }
      if (participantStatus === "completed" && current.resultStatus === "none") {
        return { ...current, participantStatus, resultStatus: "passed" };
      }
      if (participantStatus === "attended" && current.resultStatus === "none") {
        return { ...current, participantStatus, resultStatus: "attended" };
      }
      return { ...current, participantStatus };
    });
  };

  const handleSaveParticipantResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingParticipantResult) return;

    if (!["scheduled", "in_progress", "completed"].includes(editingParticipantResult.sessionStatus)) {
      toast({
        variant: "destructive",
        title: "Saisie impossible",
        description: "Les résultats sont disponibles uniquement pour une session planifiée, en cours ou terminée.",
      });
      return;
    }

    setParticipantResultSaving(true);
    try {
      const currentUser = auth?.currentUser;
      if (!currentUser) {
        throw new Error("Utilisateur non authentifié.");
      }
      const idToken = await currentUser.getIdToken(true);
      const result = await updateTrainingParticipantResultAction({
        entityId,
        sessionId: editingParticipantResult.sessionId,
        employeeId: editingParticipantResult.employeeId,
        idToken,
          participantStatus: participantResultForm.participantStatus,
          resultStatus: participantResultForm.resultStatus === "none" ? null : participantResultForm.resultStatus,
          resultNotes: participantResultForm.resultNotes,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      toast({ title: "Résultat enregistré", description: "Le suivi du participant a été mis à jour." });
      setParticipantsReloadKey((current) => current + 1);
      setEditingParticipantResult(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Résultat impossible", description: err.message || "Impossible d'enregistrer le résultat." });
    } finally {
      setParticipantResultSaving(false);
    }
  };

  const handleEdit = (t: Training) => {
    setEditingId(t.id);
    setIsResultMode(false);
    setIsDialogVisible(true);
  };

  const handleEnterResult = (t: Training) => {
    setEditingId(t.id);
    setIsResultMode(true);
    setIsDialogVisible(true);
  };

  const handleViewCertificate = async (docId: string) => {
    if (!db || !entityId || !docId) return;
    setViewingDocId(docId);
    try {
      const docSnap = await getDoc(doc(db, `entities/${entityId}/documents`, docId));
      if (docSnap.exists()) {
        const url = await getDocumentDownloadUrl(docSnap.data().storagePath);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("Document introuvable dans le registre GED.");
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message || "Impossible d'ouvrir le document." });
    } finally {
      setViewingDocId(null);
    }
  };

  const handleExecuteUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !uploadingRequest || !uploadFile) return;

    setIsUploading(true);
    try {
      const emp = employeesMap.get(uploadingRequest.employeeId);
      const docId = await uploadHRDocument(
        entityId,
        uploadFile,
        {
          title: `Attestation formation - ${emp?.displayName || 'Employé'} - ${uploadingRequest.title}`,
          documentType: "training_certificate",
          employeeId: uploadingRequest.employeeId,
          personId: uploadingRequest.personId || null,
          relatedModule: "trainings",
          relatedId: uploadingRequest.id,
          isSensitive: false,
          status: "valid"
        },
        user.uid,
        membership?.userDisplayName || "Utilisateur"
      );

      await updateTraining(entityId, uploadingRequest.id, { certificateDocumentId: docId }, user.uid);
      
      toast({ title: "Attestation jointe", description: "Le document a été lié à la formation." });
      setUploadingRequest(null);
      setUploadFile(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Échec de l'envoi", description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  const validateCertificateFile = (file: File | null) => {
    if (!file) return "Fichier d'attestation requis.";
    if (!TRAINING_CERTIFICATE_ALLOWED_TYPES.includes(file.type)) {
      return "Format de fichier non supporté. Veuillez utiliser PDF, PNG ou JPEG.";
    }
    if (file.size > TRAINING_CERTIFICATE_MAX_FILE_SIZE) {
      return "La taille max est de 10 Mo.";
    }
    return null;
  };

  const openParticipantCertificateDialog = (row: ParticipantRegisterRow) => {
    setCertificateParticipant(row);
    setCertificateFile(null);
    setCertificateError(null);
  };

  const handleParticipantCertificateFileChange = (file: File | null) => {
    const error = validateCertificateFile(file);
    setCertificateFile(error ? null : file);
    setCertificateError(error);
  };

  const handleParticipantCertificateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !certificateParticipant) return;

    const validationError = validateCertificateFile(certificateFile);
    if (validationError || !certificateFile) {
      setCertificateError(validationError);
      return;
    }

    setCertificateSaving(true);
    setCertificateError(null);
    try {
      const idToken = await user.getIdToken(true);
      const formData = new FormData();
      formData.set("file", certificateFile);
      const existingDocumentId = certificateParticipant.participant.certificateDocumentId;
      const result = existingDocumentId
        ? await replaceTrainingParticipantCertificateAction({
            idToken,
            entityId,
            sessionId: certificateParticipant.sessionId,
            employeeId: certificateParticipant.employeeId,
            documentId: existingDocumentId,
          }, formData)
        : await attachTrainingParticipantCertificateAction({
            idToken,
            entityId,
            sessionId: certificateParticipant.sessionId,
            employeeId: certificateParticipant.employeeId,
          }, formData);

      if (!result.success) {
        throw new Error(result.error);
      }

      toast({
        title: existingDocumentId ? "Attestation remplacée" : "Attestation jointe",
        description: "Le document GED est lié au participant.",
      });
      setParticipantsReloadKey((current) => current + 1);
      setCertificateParticipant(null);
      setCertificateFile(null);
    } catch (err: any) {
      setCertificateError(err.message || "Impossible d'enregistrer l'attestation.");
      toast({ variant: "destructive", title: "Attestation impossible", description: err.message || "Impossible d'enregistrer l'attestation." });
    } finally {
      setCertificateSaving(false);
    }
  };

  const handleParticipantCertificateUrl = async (row: ParticipantRegisterRow, download = false) => {
    if (!user || !row.participant.certificateDocumentId) return;
    const actionId = `${row.id}:${download ? "download" : "view"}`;
    setCertificateActionLoadingId(actionId);
    try {
      const idToken = await user.getIdToken(true);
      const result = await getTrainingParticipantCertificateUrlAction({
        idToken,
        entityId,
        sessionId: row.sessionId,
        employeeId: row.employeeId,
        documentId: row.participant.certificateDocumentId,
        download,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Document indisponible", description: err.message || "Impossible d'ouvrir l'attestation." });
    } finally {
      setCertificateActionLoadingId(null);
    }
  };

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await archiveTraining(entityId, id, user.uid);
      toast({ title: "Formation archivée" });
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
          <h1 className="text-3xl font-black text-primary tracking-tight">Registre des Formations</h1>
          <p className="text-muted-foreground text-sm font-medium">Gestion de la formation obligatoire et continue.</p>
        </div>
        {canCreate && (
          <div className="flex flex-col items-start md:items-end gap-2">
            <Button
              onClick={() => openSessionDialog(null)}
              disabled={!canReadEmployees}
              className="gap-2 rounded-xl shadow-lg shadow-primary/10 font-bold"
            >
              <Plus className="w-4 h-4" /> Nouvelle formation
            </Button>
            {!canReadEmployees && (
              <p className="text-[10px] font-bold text-muted-foreground max-w-xs text-left md:text-right">
                La création d’une formation nécessite l’autorisation de consulter les employés.
              </p>
            )}
          </div>
        )}
      </header>

      {/* Stats / KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard title="Total formations" value={canonicalTrainingKpis.total} icon={GraduationCap} color="blue" />
         <StatCard title="Planifiées" value={canonicalTrainingKpis.planned} icon={Clock} color="orange" />
         <StatCard title="Terminées" value={canonicalTrainingKpis.completed} icon={CheckCircle2} color="green" />
         <StatCard title="Participants inscrits" value={canonicalTrainingKpis.participants} icon={User} color="indigo" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
         <StatCard title="Validités actives" value={participantValidityKpis.active} icon={ShieldCheck} color="green" />
         <StatCard title="À renouveler" value={participantValidityKpis.renewalDue} icon={AlertTriangle} color="orange" />
         <StatCard title="Expirées" value={participantValidityKpis.expired} icon={XCircle} color="red" />
         <StatCard title="Non renseignées" value={participantValidityKpis.notRecorded} icon={Clock} color="blue" />
      </div>

      <Card className="overflow-hidden rounded-[2rem] border-primary/10 bg-slate-50/70 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-5 border-b border-primary/10 bg-gradient-to-br from-primary/[0.06] via-slate-50 to-white">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-black text-primary flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-accent" /> Sessions de formation
              </CardTitle>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                Créez une formation, sélectionnez les participants, puis gérez l'approbation et l'envoi au formateur.
              </p>
            </div>
            <div className="rounded-2xl border border-primary/10 bg-white/80 px-4 py-2 text-xs font-bold text-muted-foreground shadow-sm md:text-right">
              {filteredSortedTrainingSessions.length === 0
                ? "0 session trouvée"
                : `Affichage de ${sessionRangeStart} à ${sessionRangeEnd} sur ${filteredSortedTrainingSessions.length} session${filteredSortedTrainingSessions.length > 1 ? "s" : ""}`}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-2xl border border-blue-100 bg-white/90 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase text-muted-foreground">Total des sessions</p>
              <p className="text-xl font-black text-primary">{trainingSessionSummaryKpis.total}</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase text-amber-800">À valider</p>
              <p className="text-xl font-black text-amber-800">{trainingSessionSummaryKpis.approvalPending}</p>
            </div>
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase text-cyan-800">En attente de réponse</p>
              <p className="text-xl font-black text-cyan-800">{trainingSessionSummaryKpis.awaitingResponse}</p>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase text-indigo-800">À venir</p>
              <p className="text-xl font-black text-indigo-800">{trainingSessionSummaryKpis.upcoming}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase text-emerald-800">Terminées</p>
              <p className="text-xl font-black text-emerald-800">{trainingSessionSummaryKpis.completed}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-[1.75rem] border border-primary/10 bg-white/75 p-3 shadow-sm xl:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(150px,auto))_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl border-primary/10 bg-white pl-10 text-xs font-bold shadow-sm"
                placeholder="Rechercher titre, formateur, participant, lieu..."
                value={sessionListFilters.search}
                onChange={(e) => setSessionListFilters((p) => ({ ...p, search: e.target.value }))}
              />
            </div>
            <Select value={sessionListFilters.trainingType} onValueChange={(value) => setSessionListFilters((p) => ({ ...p, trainingType: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sessionListFilters.status} onValueChange={(value) => setSessionListFilters((p) => ({ ...p, status: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                {(["draft", "scheduled", "in_progress", "completed", "cancelled", "archived"] as TrainingSessionStatus[]).map((status) => (
                  <SelectItem key={status} value={status}>{getSessionStatusLabel(status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sessionListFilters.approvalStatus} onValueChange={(value) => setSessionListFilters((p) => ({ ...p, approvalStatus: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Approbation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Approbation</SelectItem>
                {(["not_submitted", "pending", "approved", "rejected"] as TrainingSession["approvalStatus"][]).map((status) => (
                  <SelectItem key={status} value={status}>{getApprovalStatusLabel(status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sessionListFilters.availabilityStatus} onValueChange={(value) => setSessionListFilters((p) => ({ ...p, availabilityStatus: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Disponibilité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Disponibilité</SelectItem>
                {(["not_required", "not_contacted", "awaiting_response", "available", "unavailable", "historically_bypassed"] as ReturnType<typeof getTrainerAvailabilityStatus>[]).map((status) => (
                  <SelectItem key={status} value={status}>{getTrainerAvailabilityLabelFromStatus(status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sessionListFilters.dateCategory} onValueChange={(value) => setSessionListFilters((p) => ({ ...p, dateCategory: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes dates</SelectItem>
                <SelectItem value="upcoming">À venir</SelectItem>
                <SelectItem value="today">Aujourd'hui</SelectItem>
                <SelectItem value="past">Passées</SelectItem>
                <SelectItem value="undated">Sans date</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-xl text-xs font-black text-primary hover:bg-primary/5"
              onClick={() => {
                setSessionListFilters(initialSessionListFilters);
                setSessionPage(1);
              }}
            >
              Réinitialiser
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingTrainingSessions ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/30" /></div>
          ) : !trainingSessions || trainingSessions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-xs font-bold uppercase tracking-widest">Aucune session de formation créée.</p>
            </div>
          ) : filteredSortedTrainingSessions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Search className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-xs font-bold uppercase tracking-widest">Aucune session ne correspond aux filtres.</p>
            </div>
          ) : (
            <div className="space-y-3 bg-slate-50/70 p-4">
              {paginatedTrainingSessions.map((session) => {
                const isExternal = session.trainerType === "external";
                const canSendTrainerEmail = isExternal
                  && !!session.trainerName?.trim()
                  && isValidEmail(session.trainerEmail || "")
                  && session.approvalStatus === "approved"
                  && session.status === "scheduled";
                const isActionLoading = sessionActionLoadingId === session.id;
                const participants = activeParticipantsBySessionId.get(session.id) || [];
                const attendanceResponseCounts = getAttendanceResponseCounts(participants);
                const availabilityStatus = getTrainerAvailabilityStatus(session);
                const availabilitySnapshotCurrent = isTrainerAvailabilitySnapshotCurrent(session);
                const lifecycleAction = getLifecycleAction(session);
                const isExpanded = expandedSessionId === session.id;
                const nextAction = getTrainingSessionNextAction(session, participants, canApprove);
                return (
                  <div key={session.id} className="overflow-hidden rounded-[2rem] border border-primary/10 bg-white shadow-md shadow-slate-200/60">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
                      className="flex w-full flex-col gap-3 border-b border-transparent bg-gradient-to-r from-white via-slate-50/80 to-white p-4 text-left transition-colors hover:from-slate-50 hover:to-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center sm:justify-between sm:p-5"
                    >
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {getTrainingSessionStatusBadge(session.status)}
                          <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black text-slate-700">{TRAINING_TYPE_LABELS[session.trainingType]}</Badge>
                          {getTrainingApprovalStatusBadge(session.approvalStatus)}
                          <h3 className="min-w-0 text-lg font-black leading-tight text-primary sm:text-xl">{session.title}</h3>
                        </div>
                        <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-bold text-slate-700 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatSessionDateRange(session)}</span>
                          <span className="hidden text-muted-foreground sm:inline">·</span>
                          <span>{formatSessionCardTimeRange(session) || formatSessionDayCount(session) || "Horaire non renseigné"}</span>
                          {session.location && <><span className="hidden text-muted-foreground sm:inline">·</span><span className="break-words">{session.location}</span></>}
                          <span className="hidden text-muted-foreground sm:inline">·</span>
                          <span>{formatSessionTrainerDisplay(session)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                          <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">{participants.length} {participants.length === 1 ? "participant" : "participants"}</span>
                          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">{attendanceResponseCounts.confirmed} confirmé{attendanceResponseCounts.confirmed > 1 ? "s" : ""}</span>
                          <span className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-red-700">{attendanceResponseCounts.declined} indisponible{attendanceResponseCounts.declined > 1 ? "s" : ""}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-600">{attendanceResponseCounts.pending} sans réponse</span>
                        </div>
                        <p className="inline-flex w-fit rounded-full border border-primary/10 bg-primary/5 px-3 py-1.5 text-xs font-black text-primary">Prochaine action : {nextAction}</p>
                      </div>
                      <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                    </button>

                    {isExpanded && (
                      <div className="space-y-5 border-t border-primary/10 bg-gradient-to-br from-slate-50 via-white to-primary/[0.02] p-5">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
                          <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-white/85 p-4 shadow-sm">
                            <div>
                              <h4 className="text-sm font-black text-primary">Détails de la session</h4>
                              <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                  <p className="font-black uppercase text-muted-foreground">Calendrier</p>
                                  <p className="font-bold text-slate-800">{formatSessionCardSchedule(session)}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                  <p className="font-black uppercase text-muted-foreground">Lieu</p>
                                  <p className="font-bold text-slate-800">{session.location || "Lieu non renseigné"}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                  <p className="font-black uppercase text-muted-foreground">Formateur</p>
                                  <p className="font-bold text-slate-800">{formatSessionTrainerDisplay(session)}</p>
                                  <p className="text-muted-foreground">{session.trainerType === "external" ? "Externe" : "Interne"}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                  <p className="font-black uppercase text-muted-foreground">Disponibilité</p>
                                  <p className="font-bold text-slate-800">{getTrainerAvailabilityLabel(session)}</p>
                                </div>
                              </div>
                            </div>
                            <div>
                              <h4 className="text-sm font-black text-primary">Workflow</h4>
                              <TrainingWorkflowStepper session={session} />
                            </div>
                            {session.trainerType === "external" && session.approvalStatus === "approved" && session.status === "draft" && session.trainerAvailabilityStatus === "available" && !availabilitySnapshotCurrent && (
                              <p className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-[11px] font-bold text-orange-700">
                                Les informations de la session ont changé. Une nouvelle confirmation du formateur est nécessaire.
                              </p>
                            )}
                          </div>
                          <div className="space-y-3 rounded-[1.75rem] border border-primary/10 bg-white/90 p-4 shadow-sm">
                            <h4 className="text-sm font-black text-primary">Participants</h4>
                            <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] p-3">
                              <p className="text-xs font-black text-primary">{participants.length} {participants.length === 1 ? "participant" : "participants"}</p>
                              {participants.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {participants.map((participant) => (
                                    <Badge key={participant.employeeId} variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[10px] font-bold shadow-sm">
                                      {participant.employeeDisplayNameSnapshot || participant.employeeCodeSnapshot || participant.employeeId}
                                      <span className="ml-1 text-muted-foreground">· {getAttendanceResponseLabel(participant.attendanceResponseStatus)}</span>
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs font-bold text-muted-foreground">Aucun participant actif.</p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 rounded-[1.5rem] border border-primary/10 bg-white/80 p-3 shadow-sm">
                      {canUpdate && (session.approvalStatus === "not_submitted" || session.approvalStatus === "rejected") && (
                        <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold" disabled={isActionLoading} onClick={() => handleSubmitApproval(session)}>
                          {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                          Soumettre pour approbation
                        </Button>
                      )}
                      {session.approvalStatus === "pending" && !canApprove && (
                        <Badge variant="outline" className="rounded-xl px-3 py-2 text-xs font-black text-orange-700 border-orange-200">
                          En attente d'approbation
                        </Badge>
                      )}
                      {canApprove && session.approvalStatus === "pending" && (
                        <>
                          <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold text-green-700 border-green-200" disabled={isActionLoading} onClick={() => handleApproveSession(session)}>
                            {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                            Approuver
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold text-red-700 border-red-200" disabled={isActionLoading} onClick={() => handleRejectSession(session)}>
                            {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                            Rejeter
                          </Button>
                        </>
                      )}
                      {canUpdate && session.trainerType === "external" && session.approvalStatus === "approved" && session.status === "draft" && (
                        <>
                          {availabilityStatus === "not_contacted" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl text-xs font-bold text-primary border-primary/20"
                              disabled={previewLoadingSessionId === session.id}
                              onClick={() => handlePreviewAvailabilityRequest(session)}
                            >
                              {previewLoadingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Mail className="w-3 h-3 mr-2" />}
                              Envoyer la demande de disponibilité
                            </Button>
                          )}
                          {availabilityStatus === "awaiting_response" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl text-xs font-bold text-orange-700 border-orange-200"
                              onClick={() => openAvailabilityResponseDialog(session)}
                            >
                              Enregistrer la réponse
                            </Button>
                          )}
                          {(availabilityStatus === "unavailable" || (availabilityStatus === "available" && !availabilitySnapshotCurrent)) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl text-xs font-bold text-primary border-primary/20"
                              disabled={previewLoadingSessionId === session.id}
                              onClick={() => handlePreviewAvailabilityRequest(session)}
                            >
                              {previewLoadingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Mail className="w-3 h-3 mr-2" />}
                              Renvoyer la demande
                            </Button>
                          )}
                        </>
                      )}
                      {canUpdate && lifecycleAction && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs font-bold text-primary border-primary/20"
                          disabled={isActionLoading}
                          onClick={() => setSessionLifecycleDialog({ session, targetStatus: lifecycleAction.targetStatus })}
                        >
                          {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                          {lifecycleAction.label}
                        </Button>
                      )}
                      {canUpdate && session.status === "scheduled" && participants.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs font-bold text-primary border-primary/20"
                          disabled={previewLoadingSessionId === session.id || participantInvitationsSending}
                          onClick={() => handlePreviewParticipantInvitations(session)}
                        >
                          {previewLoadingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Send className="w-3 h-3 mr-2" />}
                          Notifier les participants
                        </Button>
                      )}
                      {canUpdate && isExternal && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="rounded-xl text-xs font-bold gap-2"
                          disabled={!canSendTrainerEmail || previewLoadingSessionId === session.id}
                          onClick={() => handlePreviewTrainerEmail(session)}
                        >
                          {previewLoadingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                          {session.trainerEmailSentAt ? "Prévisualiser / envoyer de nouveau" : "Prévisualiser / envoyer la confirmation"}
                        </Button>
                      )}
                      {canUpdate && (
                        <Button size="sm" variant="ghost" className="rounded-xl text-xs font-bold gap-2" disabled={loadingTrainingParticipants} onClick={() => openSessionDialog(session)}>
                          <Edit className="w-3 h-3" /> Modifier
                        </Button>
                      )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredSortedTrainingSessions.length > 0 && (
                <div className="flex flex-col gap-3 rounded-[2rem] border border-primary/10 bg-gradient-to-r from-white via-slate-50 to-white p-4 text-sm shadow-sm lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-bold text-muted-foreground">
                      {sessionRangeStart}–{sessionRangeEnd} sur {filteredSortedTrainingSessions.length} session{filteredSortedTrainingSessions.length > 1 ? "s" : ""}
                    </p>
                    <Select value={String(sessionPageSize)} onValueChange={(value) => setSessionPageSize(Number(value))}>
                      <SelectTrigger className="h-9 w-[140px] rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_PAGE_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="rounded-xl bg-white" onClick={() => setSessionPage(1)} disabled={safeSessionPage === 1}>
                      Première
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl bg-white" onClick={() => setSessionPage((page) => Math.max(1, page - 1))} disabled={safeSessionPage === 1}>
                      Précédente
                    </Button>
                    <div className="flex flex-wrap items-center gap-1">
                      {sessionPaginationPages.map((page, index) => page === "ellipsis" ? (
                        <span key={`session-ellipsis-${index}`} className="px-2 text-muted-foreground">…</span>
                      ) : (
                        <Button
                          key={page}
                          type="button"
                          variant={page === safeSessionPage ? "default" : "outline"}
                          size="sm"
                          className="h-9 w-9 rounded-xl p-0"
                          aria-label={`Page ${page}`}
                          aria-current={page === safeSessionPage ? "page" : undefined}
                          onClick={() => setSessionPage(page)}
                        >
                          {page}
                        </Button>
                      ))}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl bg-white" onClick={() => setSessionPage((page) => Math.min(totalSessionPages, page + 1))} disabled={safeSessionPage === totalSessionPages}>
                      Suivante
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl bg-white" onClick={() => setSessionPage(totalSessionPages)} disabled={safeSessionPage === totalSessionPages}>
                      Dernière
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
        <CardHeader className="space-y-5 bg-gradient-to-br from-primary/[0.04] via-slate-50 to-white border-b">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-black text-primary flex items-center gap-2">
                <ListFilter className="w-5 h-5 text-accent" /> Suivi des participants
              </CardTitle>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                Une ligne par participant de session, avec participation, résultat individuel et attestation.
              </p>
            </div>
            <div className="rounded-2xl border border-primary/10 bg-white/80 px-4 py-2 text-xs font-bold text-muted-foreground shadow-sm md:text-right">
              {participantRegisterTotalResults} participation{participantRegisterTotalResults === 1 ? "" : "s"} trouvée{participantRegisterTotalResults === 1 ? "" : "s"}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-[1.75rem] border border-primary/10 bg-white/75 p-3 shadow-sm xl:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(150px,auto))_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl border-primary/10 bg-white pl-10 text-xs font-bold shadow-sm"
                placeholder="Rechercher employé, matricule, formation..."
                value={participantRegisterFilters.search}
                onChange={(e) => setParticipantRegisterFilters((p) => ({ ...p, search: e.target.value }))}
              />
            </div>
            <Select value={participantRegisterFilters.sessionId} onValueChange={(value) => setParticipantRegisterFilters((p) => ({ ...p, sessionId: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Formation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les formations</SelectItem>
                {(trainingSessions || []).map((session) => (
                  <SelectItem key={session.id} value={session.id}>{session.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={participantRegisterFilters.participantStatus} onValueChange={(value) => setParticipantRegisterFilters((p) => ({ ...p, participantStatus: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Participation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes participations</SelectItem>
                <SelectItem value="planned">Planifiée</SelectItem>
                <SelectItem value="attended">Présent</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="completed">Terminée</SelectItem>
                <SelectItem value="not_completed">Non terminée</SelectItem>
                <SelectItem value="cancelled">Annulée</SelectItem>
              </SelectContent>
            </Select>
            <Select value={participantRegisterFilters.resultStatus} onValueChange={(value) => setParticipantRegisterFilters((p) => ({ ...p, resultStatus: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Résultat" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les résultats</SelectItem>
                <SelectItem value="none">À renseigner</SelectItem>
                <SelectItem value="passed">Réussi</SelectItem>
                <SelectItem value="failed">Échoué</SelectItem>
                <SelectItem value="attended">Participation validée</SelectItem>
                <SelectItem value="not_attended">Non présenté</SelectItem>
                <SelectItem value="not_required">Non requis</SelectItem>
              </SelectContent>
            </Select>
            <Select value={participantRegisterFilters.validityStatus} onValueChange={(value) => setParticipantRegisterFilters((p) => ({ ...p, validityStatus: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm"><SelectValue placeholder="Validité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les validités</SelectItem>
                <SelectItem value="valid">Valide</SelectItem>
                <SelectItem value="renewal_due">À renouveler</SelectItem>
                <SelectItem value="expired">Expirée</SelectItem>
                <SelectItem value="renewed">Renouvelée</SelectItem>
                <SelectItem value="non_applicable">Sans renouvellement</SelectItem>
                <SelectItem value="not_recorded">Validité non renseignée</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-xl text-xs font-black text-primary hover:bg-primary/5"
              onClick={() => setParticipantRegisterFilters(initialParticipantRegisterFilters)}
            >
              Réinitialiser
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
        <Table className="min-w-[1320px]">
          <TableHeader className="bg-secondary/20">
            <TableRow>
              <TableHead className="pl-6">Employé</TableHead>
              <TableHead>Matricule</TableHead>
              <TableHead>Formation</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Participation</TableHead>
              <TableHead>Résultat</TableHead>
              <TableHead>Validité</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead>Confirmation employé</TableHead>
              <TableHead>Attestation</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingTrainingSessions || loadingTrainingParticipants ? (
              <TableRow><TableCell colSpan={11} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
            ) : filteredParticipantRegisterRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <ListFilter className="h-10 w-10 opacity-20" />
                    <p className="font-bold text-sm uppercase tracking-widest">Aucun participant trouvé.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedParticipantRegisterRows.map((row) => {
                const hasResult = !!row.participant.resultStatus;
                const canEditResult = canUpdate && ["scheduled", "in_progress", "completed"].includes(row.sessionStatus);
                const hasCertificate = !!row.participant.certificateDocumentId;
                const canManageCertificate = canUpdate && canUploadDocuments;
                const canReadCertificate = canRead && canReadDocuments;
                return (
                  <TableRow key={row.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="pl-6 font-bold text-slate-900">{row.employeeName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.employeeCode || "—"}</TableCell>
                    <TableCell className="text-xs font-bold text-primary max-w-[220px] truncate" title={row.sessionTitle}>{row.sessionTitle}</TableCell>
                    <TableCell className="text-xs font-medium">{row.sessionDate}</TableCell>
                    <TableCell>{getParticipantStatusBadge(row.participant.participantStatus)}</TableCell>
                    <TableCell>{getParticipantResultBadge(row.participant.resultStatus)}</TableCell>
                    <TableCell>{getParticipantValidityBadge(row.validityState)}</TableCell>
                    <TableCell className="text-xs font-semibold text-slate-600 whitespace-nowrap">{getParticipantValidityExpiryLabel(row)}</TableCell>
                    <TableCell>{getAttendanceResponseBadge(row.participant.attendanceResponseStatus)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        {hasCertificate ? (
                          <span className="inline-flex items-center gap-1.5 text-green-700 font-bold text-[10px] uppercase"><FileCheck className="w-3.5 h-3.5" /> Jointe</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase"><Paperclip className="w-3.5 h-3.5 opacity-40" /> Non jointe</span>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {!hasCertificate && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!canManageCertificate}
                              onClick={() => openParticipantCertificateDialog(row)}
                              className="h-7 rounded-lg text-[10px] font-bold gap-1.5"
                            >
                              <Upload className="w-3.5 h-3.5" /> Joindre
                            </Button>
                          )}
                          {hasCertificate && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-label="Visualiser l’attestation"
                                title="Visualiser l’attestation"
                                disabled={!canReadCertificate || certificateActionLoadingId === `${row.id}:view`}
                                onClick={() => handleParticipantCertificateUrl(row, false)}
                                className="h-7 w-7 rounded-lg p-0"
                              >
                                {certificateActionLoadingId === `${row.id}:view` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-label="Télécharger l’attestation"
                                title="Télécharger l’attestation"
                                disabled={!canReadCertificate || certificateActionLoadingId === `${row.id}:download`}
                                onClick={() => handleParticipantCertificateUrl(row, true)}
                                className="h-7 w-7 rounded-lg p-0"
                              >
                                {certificateActionLoadingId === `${row.id}:download` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!canManageCertificate}
                                onClick={() => openParticipantCertificateDialog(row)}
                                className="h-7 rounded-lg text-[10px] font-bold gap-1.5"
                              >
                                <RefreshCcw className="w-3.5 h-3.5" /> Remplacer
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canEditResult}
                        onClick={() => openParticipantResultDialog(row)}
                        className="rounded-xl text-xs font-bold"
                      >
                        {hasResult ? "Modifier le résultat" : "Saisir le résultat"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
        {participantRegisterTotalResults > 0 && (
          <div className="flex flex-col gap-3 border-t border-primary/10 bg-gradient-to-r from-white via-slate-50 to-white px-6 py-4 text-sm shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-bold text-muted-foreground">
                {participantRegisterRangeStart}–{participantRegisterRangeEnd} sur {participantRegisterTotalResults} participation{participantRegisterTotalResults === 1 ? "" : "s"}
              </p>
              <Select
                value={String(participantRegisterPagination.pageSize)}
                onValueChange={(value) => setParticipantRegisterPagination((current) => ({
                  ...current,
                  page: 1,
                  pageSize: Number(value),
                }))}
              >
                <SelectTrigger className="h-9 w-[140px] rounded-xl border-primary/10 bg-white text-xs font-bold shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={String(pageSize)}>{pageSize} / page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl bg-white"
                disabled={participantRegisterCurrentPage <= 1}
                onClick={() => setParticipantRegisterPagination((current) => ({ ...current, page: 1 }))}
              >
                Première
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl bg-white"
                disabled={participantRegisterCurrentPage <= 1}
                onClick={() => setParticipantRegisterPagination((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1),
                }))}
              >
                Précédente
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {participantRegisterPaginationPages.map((page, index) => page === "ellipsis" ? (
                  <span key={`participant-ellipsis-${index}`} className="px-2 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={page}
                    type="button"
                    variant={page === participantRegisterCurrentPage ? "default" : "outline"}
                    size="sm"
                    className="h-9 w-9 rounded-xl p-0"
                    aria-label={`Page ${page}`}
                    aria-current={page === participantRegisterCurrentPage ? "page" : undefined}
                    onClick={() => setParticipantRegisterPagination((current) => ({ ...current, page }))}
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl bg-white"
                disabled={participantRegisterCurrentPage >= participantRegisterTotalPages}
                onClick={() => setParticipantRegisterPagination((current) => ({
                  ...current,
                  page: Math.min(participantRegisterTotalPages, current.page + 1),
                }))}
              >
                Suivante
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl bg-white"
                disabled={participantRegisterCurrentPage >= participantRegisterTotalPages}
                onClick={() => setParticipantRegisterPagination((current) => ({ ...current, page: participantRegisterTotalPages }))}
              >
                Dernière
              </Button>
            </div>
          </div>
        )}
      </Card>

      {(trainings?.length || 0) > 0 && (
      <details className="space-y-4 group">
        <summary className="cursor-pointer list-none rounded-2xl border border-primary/10 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-black text-primary">
              <History className="w-5 h-5 text-accent" /> Archives des anciennes formations ({trainings?.length || 0})
            </div>
            <Badge variant="outline" className="text-[10px] font-black">Archives</Badge>
          </div>
        </summary>
      <div className="space-y-4 mt-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              className="pl-10 rounded-xl" 
              placeholder="Rechercher intitulé, collaborateur, session..." 
              value={filters.search}
              onChange={(e) => setFilters(p => ({...p, search: e.target.value}))}
            />
          </div>
          
          <Select value={filters.trainingType} onValueChange={(v) => setFilters(p => ({...p, trainingType: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {Object.entries(TRAINING_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.deadlineStatus} onValueChange={(v) => setFilters(p => ({...p, deadlineStatus: v}))}>
            <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Échéance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les échéances</SelectItem>
              <SelectItem value="expired">Expirée</SelectItem>
              <SelectItem value="upcoming">Proche (30j)</SelectItem>
              <SelectItem value="ok">À jour</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
            <SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(TRAINING_STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button variant="ghost" onClick={() => setFilters(initialFilters)} className="text-muted-foreground text-xs font-bold uppercase">
             <X className="w-3.5 h-3.5 mr-1" /> Réinitialiser
          </Button>
        </div>

        {/* Table */}
        <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem]">
          <CardHeader className="bg-secondary/10 border-b">
            <CardTitle className="text-lg font-black text-primary flex items-center gap-2">
              <History className="w-5 h-5 text-accent" /> Historique des formations individuelles
            </CardTitle>
            <p className="text-xs text-muted-foreground font-medium">
              Anciennes formations par collaborateur, conservées en lecture et suivi. Ces lignes ne sont pas les participants des sessions ci-dessus.
            </p>
          </CardHeader>
          <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader className="bg-secondary/20">
              <TableRow>
                <TableHead className="pl-6">Employé</TableHead>
                <TableHead>Type & Intitulé</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Attestation (GED)</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingTrainings ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredTrainings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-20 text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <ListFilter className="h-10 w-10 opacity-20" />
                      <p className="font-bold text-sm uppercase tracking-widest">Aucune formation trouvée.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTrainings.map((t) => {
                  const emp = employeesMap.get(t.employeeId);
                  const collaboratorName = emp?.displayName || (employeeDirectorySuccessfullyLoaded ? "Employé inconnu" : "Collaborateur non renseigné");
                  const collaboratorCode = emp?.employeeCode || (employeeDirectorySuccessfullyLoaded ? t.employeeId.slice(0, 8) : "—");
                  const expiryDate = t.expiryDate ? parseISO(t.expiryDate) : null;
                  const today = startOfDay(new Date());
                  const isExpiredStatus = expiryDate && isBefore(expiryDate, today);

                  return (
                    <TableRow key={t.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900">{collaboratorName}</span>
                           <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground uppercase font-mono">{collaboratorCode}</span>
                              {t.batchId && (
                                <Badge variant="outline" className="text-[8px] h-3 px-1 border-primary/10 bg-primary/5 text-primary/60 font-black uppercase">Session</Badge>
                              )}
                           </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <span className="text-xs font-bold text-primary truncate max-w-[180px]" title={t.title}>{t.title}</span>
                           <span className="text-[9px] text-muted-foreground uppercase">{TRAINING_TYPE_LABELS[t.trainingType]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                           <div className="flex items-center gap-1.5 text-xs font-medium">
                              <Calendar className="w-3 h-3 text-primary/40" />
                              <span>{formatDate(t.startDate || t.courseDate)}</span>
                              {t.endDate && t.endDate !== t.startDate && (
                                <>
                                  <ArrowRight className="w-3 h-3 opacity-30" />
                                  <span>{formatDate(t.endDate)}</span>
                                </>
                              )}
                              {t.daysCount && t.daysCount > 1 && (
                                <Badge variant="secondary" className="ml-1.5 text-[8px] h-3.5 px-1 bg-primary/5 text-primary/60 border-none font-black">
                                  {t.daysCount} j
                                </Badge>
                              )}
                           </div>
                           {t.durationHours && <span className="text-[9px] font-black text-primary/60 uppercase">{t.durationHours} h validées</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                         {t.certificateDocumentId ? (
                           <button 
                             onClick={() => handleViewCertificate(t.certificateDocumentId!)} 
                             disabled={!!viewingDocId}
                             className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase hover:underline disabled:opacity-50 group"
                           >
                             <FileCheck className="w-3.5 h-3.5" /> 
                             Attestation jointe
                             {viewingDocId === t.certificateDocumentId ? (
                               <Loader2 className="w-2.5 h-2.5 animate-spin ml-1" />
                             ) : (
                               <Eye className="w-2.5 h-2.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                             )}
                           </button>
                         ) : (
                           <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase">
                             <Paperclip className="w-3.5 h-3.5 opacity-30" /> Non jointe
                           </div>
                         )}
                      </TableCell>
                      <TableCell>
                         {t.resultStatus && t.resultStatus !== 'not_required' ? (
                           <div className="flex items-center gap-1.5">
                             {t.resultStatus === 'passed' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                             <span className={cn("text-[10px] font-black uppercase", t.resultStatus === 'passed' ? "text-green-700" : "text-red-700")}>
                                {TRAINING_RESULT_LABELS[t.resultStatus]}
                             </span>
                           </div>
                         ) : <span className="text-[10px] text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell>
                         {t.expiryDate ? (
                           <div className="flex flex-col">
                              <span className={cn("text-xs font-black", getDeadlineColor(t.expiryDate))}>
                                 {formatDate(t.expiryDate)}
                              </span>
                              {isExpiredStatus && <span className="text-[8px] font-bold text-red-600 uppercase">Expirée</span>}
                           </div>
                         ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                         {getStatusBadge(t.status)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <DropdownMenu modal={false}>
                           <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-52">
                              {t.certificateDocumentId && (
                                <DropdownMenuItem onClick={() => handleViewCertificate(t.certificateDocumentId!)} className="gap-2 font-bold text-primary" disabled={!!viewingDocId}>
                                  <Eye className="w-4 h-4" /> Voir attestation
                                </DropdownMenuItem>
                              )}
                              {!t.certificateDocumentId && t.status === 'completed' && (
                                <DropdownMenuItem onClick={() => setUploadingRequest(t)} className="gap-2 font-bold text-primary">
                                   <Upload className="w-4 h-4" /> Joindre attestation
                                </DropdownMenuItem>
                              )}
                              {t.status !== 'completed' && t.status !== 'failed' && (
                                <DropdownMenuItem onClick={() => handleEnterResult(t)} className="gap-2 font-bold text-primary">
                                   <FileSignature className="w-4 h-4" /> Saisir le résultat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(t)} className="gap-2">
                                 <Edit className="w-4 h-4" /> Modifier détails
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleArchive(t.id)} className="gap-2 text-destructive">
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
          </div>
        </Card>
      </div>
      </details>
      )}

      <TrainingDialog 
        open={isDialogVisible} 
        onOpenChange={(open) => {
          setIsDialogVisible(open);
          if (!open) {
            setEditingId(null);
            setIsResultMode(false);
          }
        }}
        entityId={entityId}
        trainingId={editingId}
        resultMode={isResultMode}
        employees={activeEmployees}
      />

      <Dialog open={!!sessionLifecycleDialog} onOpenChange={(open) => {
        if (!open && !sessionActionLoadingId) setSessionLifecycleDialog(null);
      }}>
        <DialogContent className="sm:max-w-[520px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">
              {sessionLifecycleDialog ? getLifecycleDialogTitle(sessionLifecycleDialog.targetStatus) : "Changer le statut"}
            </DialogTitle>
            <DialogDescription>
              Cette action met à jour uniquement le statut opérationnel de la session. Aucun email n'est envoyé automatiquement.
            </DialogDescription>
          </DialogHeader>

          {sessionLifecycleDialog && (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Formation</p>
                  <p className="font-bold text-primary">{sessionLifecycleDialog.session.title}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</p>
                  <p className="font-medium">{formatSessionDateRange(sessionLifecycleDialog.session)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Horaire</p>
                  <p className="font-medium">{formatSessionTimeRange(sessionLifecycleDialog.session)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Lieu</p>
                  <p className="font-medium">{sessionLifecycleDialog.session.location || "Non renseigné"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Formateur</p>
                  <p className="font-medium">{formatSessionTrainerDisplay(sessionLifecycleDialog.session)}</p>
                </div>
              </div>

              {sessionLifecycleDialog.targetStatus === "scheduled" && getMissingSchedulingFields(sessionLifecycleDialog.session).length > 0 && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 space-y-3">
                  <p className="text-xs font-black text-orange-800 uppercase tracking-widest">Planification incomplète</p>
                  <ul className="list-disc pl-5 text-xs font-semibold text-orange-800 space-y-1">
                    {getMissingSchedulingFields(sessionLifecycleDialog.session).map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs font-bold bg-white"
                    onClick={() => {
                      const session = sessionLifecycleDialog.session;
                      setSessionLifecycleDialog(null);
                      openSessionDialog(session);
                    }}
                  >
                    Ouvrir le formulaire de modification
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSessionLifecycleDialog(null)} disabled={!!sessionActionLoadingId}>
              Annuler
            </Button>
            <Button
              type="button"
              className="rounded-xl font-black"
              onClick={handleConfirmLifecycleTransition}
              disabled={
                !sessionLifecycleDialog
                || !!sessionActionLoadingId
                || (sessionLifecycleDialog.targetStatus === "scheduled" && getMissingSchedulingFields(sessionLifecycleDialog.session).length > 0)
              }
            >
              {sessionActionLoadingId ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingParticipantResult} onOpenChange={(open) => {
        if (!open && !participantResultSaving) setEditingParticipantResult(null);
      }}>
        <DialogContent className="sm:max-w-[560px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Résultat de formation</DialogTitle>
            <DialogDescription>
              Mettez à jour uniquement la participation et le résultat individuel de ce collaborateur.
            </DialogDescription>
          </DialogHeader>

          {editingParticipantResult && (
            <form onSubmit={handleSaveParticipantResult} className="space-y-5">
              <div className="rounded-2xl border bg-slate-50/70 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Employé</p>
                  <p className="font-bold text-primary">{editingParticipantResult.employeeName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Matricule</p>
                  <p className="font-mono text-xs">{editingParticipantResult.employeeCode || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Formation</p>
                  <p className="font-bold">{editingParticipantResult.sessionTitle}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</p>
                  <p className="font-medium">{editingParticipantResult.sessionDate}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Participation</Label>
                  <Select
                    value={participantResultForm.participantStatus}
                    onValueChange={(value) => handleParticipantStatusChange(value as TrainingParticipant["participantStatus"])}
                  >
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planifiée</SelectItem>
                      <SelectItem value="attended">Présent</SelectItem>
                      <SelectItem value="absent">Absent</SelectItem>
                      <SelectItem value="completed">Terminée</SelectItem>
                      <SelectItem value="not_completed">Non terminée</SelectItem>
                      <SelectItem value="cancelled">Annulée</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Résultat</Label>
                  <Select
                    value={participantResultForm.resultStatus}
                    onValueChange={(value) => setParticipantResultForm((p) => ({ ...p, resultStatus: value as TrainingResultStatus | "none" }))}
                    disabled={["absent", "cancelled", "planned"].includes(participantResultForm.participantStatus)}
                  >
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">À renseigner</SelectItem>
                      <SelectItem value="passed">Réussi</SelectItem>
                      <SelectItem value="failed">Échoué</SelectItem>
                      <SelectItem value="attended">Participation validée</SelectItem>
                      <SelectItem value="not_attended">Non présenté</SelectItem>
                      <SelectItem value="not_required">Non requis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes facultatives</Label>
                <Textarea
                  value={participantResultForm.resultNotes}
                  onChange={(e) => setParticipantResultForm((p) => ({ ...p, resultNotes: e.target.value }))}
                  className="rounded-xl min-h-[110px]"
                  placeholder="Commentaires RH, observation de présence, évaluation..."
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditingParticipantResult(null)} disabled={participantResultSaving}>
                  Annuler
                </Button>
                <Button type="submit" disabled={participantResultSaving} className="rounded-xl font-black">
                  {participantResultSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isSessionDialogOpen} onOpenChange={(open) => {
        if (!open && !sessionSaving) {
          setIsSessionDialogOpen(false);
          setEditingSession(null);
          setSessionForm(initialSessionForm);
          setSelectedParticipantIds([]);
          setParticipantSearch("");
        }
      }}>
        <DialogContent className="sm:max-w-[720px] flex flex-col h-[100dvh] max-h-[100dvh] md:h-auto md:max-h-[90vh] overflow-hidden p-0 rounded-[2rem]">
          <DialogHeader className="p-8 pb-4 shrink-0">
            <DialogTitle className="text-xl font-black text-primary">
              {editingSession ? "Modifier la formation" : "Nouvelle formation"}
            </DialogTitle>
            <DialogDescription>
              Renseignez les informations de la session et sélectionnez les participants concernés.
            </DialogDescription>
          </DialogHeader>

          <form id="training-session-form" onSubmit={handleSaveSession} className="flex-1 min-h-0 overflow-y-auto px-8 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Intitulé *</Label>
                <Input
                  value={sessionForm.title}
                  onChange={(e) => setSessionForm((p) => ({ ...p, title: e.target.value }))}
                  className="rounded-xl"
                  placeholder="Ex. Formation sécurité incendie"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Type de formation</Label>
                <Select
                  value={sessionForm.trainingType}
                  onValueChange={(value) => setSessionForm((p) => ({ ...p, trainingType: value as TrainingType }))}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Statut session</Label>
                <Select
                  value={sessionForm.status}
                  disabled
                  onValueChange={(value) => setSessionForm((p) => ({ ...p, status: value as TrainingSessionStatus }))}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Brouillon</SelectItem>
                    <SelectItem value="scheduled">Planifiée</SelectItem>
                    <SelectItem value="in_progress">En cours</SelectItem>
                    <SelectItem value="completed">Terminée</SelectItem>
                    <SelectItem value="cancelled">Annulée</SelectItem>
                    <SelectItem value="archived">Archivée</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Date de début *</Label>
                <Input
                  type="date"
                  value={sessionForm.startDate}
                  onChange={(e) => setSessionForm((p) => ({ ...p, startDate: e.target.value }))}
                  className="rounded-xl"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Date de fin</Label>
                <Input
                  type="date"
                  value={sessionForm.endDate}
                  onChange={(e) => setSessionForm((p) => ({ ...p, endDate: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Horaire début</Label>
                <Input
                  type="time"
                  value={sessionForm.startTime}
                  onChange={(e) => setSessionForm((p) => ({ ...p, startTime: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Horaire fin</Label>
                <Input
                  type="time"
                  value={sessionForm.endTime}
                  onChange={(e) => setSessionForm((p) => ({ ...p, endTime: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Durée (heures)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={sessionForm.durationHours}
                  onChange={(e) => {
                    setDurationManuallyOverridden(true);
                    setSessionForm((p) => ({ ...p, durationHours: e.target.value }));
                  }}
                  className="rounded-xl"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    {durationManuallyOverridden ? "Durée modifiée manuellement." : "Calcul automatique depuis les dates et horaires."}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px] font-black"
                    onClick={handleRecalculateDuration}
                  >
                    Recalculer automatiquement
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Mode</Label>
                <Select
                  value={sessionForm.deliveryMode}
                  onValueChange={(value) => setSessionForm((p) => ({ ...p, deliveryMode: value as typeof initialSessionForm.deliveryMode }))}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classroom">Présentiel</SelectItem>
                    <SelectItem value="online">En ligne</SelectItem>
                    <SelectItem value="blended">Mixte</SelectItem>
                    <SelectItem value="on_the_job">Sur poste</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Lieu</Label>
                <Input
                  value={sessionForm.location}
                  onChange={(e) => setSessionForm((p) => ({ ...p, location: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Organisme / centre</Label>
                <Input
                  value={sessionForm.providerName}
                  onChange={(e) => setSessionForm((p) => ({ ...p, providerName: e.target.value }))}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Type de formateur</Label>
                <Select
                  value={sessionForm.trainerType}
                  onValueChange={(value) => setSessionForm((p) => ({
                    ...p,
                    trainerType: value as "internal" | "external",
                    trainerEmail: value === "internal" ? "" : p.trainerEmail,
                    internalTrainerEmployeeId: value === "external" ? "" : p.internalTrainerEmployeeId,
                  }))}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Interne</SelectItem>
                    <SelectItem value="external">Externe</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sessionForm.trainerType === "external" ? (
                <>
                  <div className="space-y-2">
                    <Label>Nom du formateur</Label>
                    <Input
                      value={sessionForm.trainerName}
                      onChange={(e) => setSessionForm((p) => ({ ...p, trainerName: e.target.value }))}
                      className="rounded-xl"
                      placeholder="Nom du formateur externe"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Email du formateur</Label>
                    <Input
                      type="email"
                      value={sessionForm.trainerEmail}
                      onChange={(e) => setSessionForm((p) => ({ ...p, trainerEmail: e.target.value }))}
                      className="rounded-xl"
                      placeholder="formateur@example.com"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2 md:col-span-2">
                  <Label>Formateur interne</Label>
                  <Select
                    value={sessionForm.internalTrainerEmployeeId || "none"}
                    onValueChange={(value) => setSessionForm((p) => ({ ...p, internalTrainerEmployeeId: value === "none" ? "" : value }))}
                  >
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sélectionner un collaborateur" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Non sélectionné</SelectItem>
                      {activeEmployees.map((employee) => (
                        <SelectItem key={employee.employeeId} value={employee.employeeId}>
                          {employee.displayName || employee.employeeId}{employee.employeeCode ? ` – ${employee.employeeCode}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-4 md:col-span-2 rounded-2xl border border-primary/10 bg-slate-50/70 p-4">
                <div>
                  <Label className="text-sm font-black text-primary">Validité et renouvellement</Label>
                  {!sessionForm.renewalMode && (
                    <p className="text-[11px] text-amber-700 font-bold mt-1">Politique non renseignée</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Renouvellement</Label>
                    <Select
                      value={sessionForm.renewalMode || "unset"}
                      onValueChange={(value) => setSessionForm((p) => ({
                        ...p,
                        renewalMode: value === "unset" ? "" : value as typeof initialSessionForm.renewalMode,
                        renewalPeriodMonths: value === "periodic" ? p.renewalPeriodMonths : "",
                        validityWarningDays: value === "periodic" ? p.validityWarningDays || "60" : "",
                      }))}
                    >
                      <SelectTrigger className="rounded-xl bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Politique non renseignée</SelectItem>
                        <SelectItem value="none">Sans renouvellement</SelectItem>
                        <SelectItem value="periodic">Renouvellement périodique</SelectItem>
                        <SelectItem value="event_triggered">Renouvellement sur événement</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {sessionForm.renewalMode === "periodic" && (
                    <>
                      <div className="space-y-2">
                        <Label>Périodicité en mois</Label>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={sessionForm.renewalPeriodMonths}
                          onChange={(e) => setSessionForm((p) => ({ ...p, renewalPeriodMonths: e.target.value }))}
                          className="rounded-xl bg-white"
                          placeholder="Ex. 12, 24, 60"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Alerte avant échéance en jours</Label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={sessionForm.validityWarningDays}
                          onChange={(e) => setSessionForm((p) => ({ ...p, validityWarningDays: e.target.value }))}
                          className="rounded-xl bg-white"
                        />
                      </div>
                    </>
                  )}

                  {sessionForm.renewalMode === "event_triggered" && (
                    <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                      <p className="text-xs font-bold text-blue-800">
                        Aucune échéance automatique. Le renouvellement sera déclenché manuellement lors d’un changement de poste, de matériel, de risque ou d’une décision RH.
                      </p>
                    </div>
                  )}

                  {sessionForm.renewalMode === "none" && (
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-bold text-slate-600">Cette formation ne nécessite pas de renouvellement.</p>
                    </div>
                  )}

                  {!!sessionForm.renewalMode && (
                    <>
                      <div className="space-y-2">
                        <Label>Libellé de politique</Label>
                        <Input
                          value={sessionForm.renewalPolicyLabelSnapshot}
                          onChange={(e) => setSessionForm((p) => ({ ...p, renewalPolicyLabelSnapshot: e.target.value }))}
                          className="rounded-xl bg-white"
                          placeholder="Ex. Formation incendie 5 ans"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Note légale / référence</Label>
                        <Textarea
                          value={sessionForm.renewalPolicyLegalNoteSnapshot}
                          onChange={(e) => setSessionForm((p) => ({ ...p, renewalPolicyLegalNoteSnapshot: e.target.value }))}
                          className="rounded-xl min-h-[80px] bg-white"
                          placeholder="Référence ou commentaire facultatif..."
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3 md:col-span-2 rounded-2xl border border-primary/10 bg-slate-50/70 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <Label className="text-sm font-black text-primary">Participants</Label>
                    <p className="text-[11px] text-muted-foreground font-medium">
                      {selectedParticipantIds.length} participant{selectedParticipantIds.length > 1 ? "s" : ""} sélectionné{selectedParticipantIds.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  {selectedParticipantIds.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs font-bold"
                      onClick={() => setSelectedParticipantIds([])}
                    >
                      Tout désélectionner
                    </Button>
                  )}
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    className="pl-10 rounded-xl bg-white"
                    placeholder="Rechercher par nom ou matricule..."
                    disabled={loadingEmployees}
                  />
                </div>

                <div className="max-h-56 overflow-y-auto rounded-xl border bg-white">
                  {loadingEmployees ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground font-bold">
                      <Loader2 className="w-4 h-4 animate-spin" /> Chargement des collaborateurs...
                    </div>
                  ) : selectableEmployees.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground font-bold uppercase tracking-widest">
                      Aucun collaborateur actif trouvé.
                    </div>
                  ) : (
                    selectableEmployees.map((employee) => {
                      const employeeId = employee.employeeId;
                      const checked = selectedParticipantIdSet.has(employeeId);
                      return (
                        <label
                          key={employeeId}
                          className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-primary/5 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleSelectedParticipant(employeeId, value === true)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-slate-900 truncate">{getEmployeeDisplayName(employee)}</span>
                            <span className="block text-[11px] text-muted-foreground font-mono">
                              {employee.employeeCode || "Matricule non renseigné"}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={sessionForm.description}
                  onChange={(e) => setSessionForm((p) => ({ ...p, description: e.target.value }))}
                  className="rounded-xl min-h-[90px]"
                />
              </div>
            </div>
          </form>

          <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsSessionDialogOpen(false)} disabled={sessionSaving}>
              Annuler
            </Button>
            <Button form="training-session-form" type="submit" disabled={sessionSaving} className="rounded-xl font-black">
              {sessionSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!trainerPreview} onOpenChange={(open) => {
        if (!open && !trainerEmailSending) setTrainerPreview(null);
      }}>
        <DialogContent className="sm:max-w-[680px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <Mail className="w-5 h-5" /> Prévisualiser / envoyer au formateur
            </DialogTitle>
            <DialogDescription>
              Le destinataire provient de la session enregistrée. Aucun email n’est envoyé avant confirmation.
            </DialogDescription>
          </DialogHeader>

          {trainerPreview && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>À</Label>
                <Input value={trainerPreview.to} readOnly className="rounded-xl bg-slate-50 font-medium" />
              </div>
              <div className="space-y-2">
                <Label>Objet</Label>
                <Input
                  value={trainerPreview.subject}
                  onChange={(e) => setTrainerPreview((p) => p ? { ...p, subject: e.target.value } : p)}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={trainerPreview.body}
                  onChange={(e) => setTrainerPreview((p) => p ? { ...p, body: e.target.value } : p)}
                  className="rounded-xl min-h-[260px] font-mono text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest">
                Participants inclus : {trainerPreview.participantCount}
                {trainerPreview.lastSentAt ? " · Un envoi précédent est enregistré" : ""}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setTrainerPreview(null)} disabled={trainerEmailSending}>
              Annuler
            </Button>
            <Button type="button" onClick={handleSendTrainerEmail} disabled={trainerEmailSending || !trainerPreview?.subject.trim() || !trainerPreview?.body.trim()} className="rounded-xl font-black gap-2">
              {trainerEmailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!participantInvitationPreview} onOpenChange={(open) => {
        if (!open && !participantInvitationsSending) setParticipantInvitationPreview(null);
      }}>
        <DialogContent className="sm:max-w-[820px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <Send className="w-5 h-5" /> Notifier les participants
            </DialogTitle>
            <DialogDescription>
              Vérifiez les canaux prévus pour chaque participant. Aucun envoi automatique n’est déclenché par la planification.
            </DialogDescription>
          </DialogHeader>

          {participantInvitationPreview && (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>Employé</TableHead>
                      <TableHead>Compte</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Canal prévu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {participantInvitationPreview.rows.map((row) => (
                      <TableRow key={row.employeeId}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-bold text-primary">{row.employeeName}</span>
                            {row.employeeCode && <span className="text-[10px] font-mono text-muted-foreground">{row.employeeCode}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-bold">{row.accountLabel}</TableCell>
                        <TableCell className="text-xs font-medium">{row.emailLabel}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-black">{row.plannedChannel}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {participantInvitationPreview.results && (
                <div className="rounded-2xl border border-primary/10 bg-primary/[0.02] p-4 space-y-3">
                  <p className="text-xs font-black uppercase tracking-widest text-primary">Résultat d’envoi</p>
                  <div className="rounded-xl border bg-white overflow-x-auto">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/80">
                          <TableHead>Employé</TableHead>
                          <TableHead>Notification in-app</TableHead>
                          <TableHead>E-mail</TableHead>
                          <TableHead>Résultat final</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {participantInvitationPreview.results.map((row) => (
                          <TableRow key={row.employeeId}>
                            <TableCell className="font-bold text-primary">{row.employeeName}</TableCell>
                            <TableCell>{formatInvitationChannelStatus(row.inApp)}</TableCell>
                            <TableCell>{formatInvitationChannelStatus(row.email)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-black">{formatInvitationFinalStatus(row.finalResult)}</span>
                                {row.error && <span className="text-[10px] font-semibold text-red-600">{row.error}</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setParticipantInvitationPreview(null)} disabled={participantInvitationsSending}>
              Fermer
            </Button>
            <Button
              type="button"
              onClick={handleSendParticipantInvitations}
              disabled={participantInvitationsSending || !participantInvitationPreview || !!participantInvitationPreview.results}
              className="rounded-xl font-black gap-2"
            >
              {participantInvitationsSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer les convocations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!availabilityPreview} onOpenChange={(open) => {
        if (!open && !availabilityEmailSending) setAvailabilityPreview(null);
      }}>
        <DialogContent className="sm:max-w-[680px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <Mail className="w-5 h-5" /> Demande de disponibilité
            </DialogTitle>
            <DialogDescription>
              Le destinataire provient de la session enregistrée. Aucun email n’est envoyé avant confirmation.
            </DialogDescription>
          </DialogHeader>

          {availabilityPreview && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>À</Label>
                <Input value={availabilityPreview.to} readOnly className="rounded-xl bg-slate-50 font-medium" />
              </div>
              <div className="space-y-2">
                <Label>Objet</Label>
                <Input
                  value={availabilityPreview.subject}
                  onChange={(e) => setAvailabilityPreview((p) => p ? { ...p, subject: e.target.value } : p)}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={availabilityPreview.body}
                  onChange={(e) => setAvailabilityPreview((p) => p ? { ...p, body: e.target.value } : p)}
                  className="rounded-xl min-h-[240px] font-mono text-sm"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAvailabilityPreview(null)} disabled={availabilityEmailSending}>
              Annuler
            </Button>
            <Button type="button" onClick={handleSendAvailabilityRequest} disabled={availabilityEmailSending || !availabilityPreview?.subject.trim() || !availabilityPreview?.body.trim()} className="rounded-xl font-black gap-2">
              {availabilityEmailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!availabilityResponseDialog} onOpenChange={(open) => {
        if (!open && !availabilityResponseSaving) setAvailabilityResponseDialog(null);
      }}>
        <DialogContent className="sm:max-w-[520px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Réponse du formateur</DialogTitle>
            <DialogDescription>
              Enregistrez la disponibilité reçue du formateur externe. Aucun email n’est envoyé.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAvailabilityResponse} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Réponse</Label>
              <Select
                value={availabilityResponseForm.response}
                onValueChange={(value) => setAvailabilityResponseForm((current) => ({ ...current, response: value as "available" | "unavailable" }))}
              >
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Disponible</SelectItem>
                  <SelectItem value="unavailable">Indisponible</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Note / commentaire</Label>
              <Textarea
                value={availabilityResponseForm.responseNote}
                onChange={(e) => setAvailabilityResponseForm((current) => ({ ...current, responseNote: e.target.value }))}
                className="rounded-xl min-h-[110px]"
                placeholder="Commentaire facultatif..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAvailabilityResponseDialog(null)} disabled={availabilityResponseSaving}>
                Annuler
              </Button>
              <Button type="submit" disabled={availabilityResponseSaving} className="rounded-xl font-black">
                {availabilityResponseSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Participant Certificate Attachment Dialog */}
      <Dialog open={!!certificateParticipant} onOpenChange={(open) => {
        if (!open && !certificateSaving) {
          setCertificateParticipant(null);
          setCertificateFile(null);
          setCertificateError(null);
        }
      }}>
        <DialogContent className="sm:max-w-[480px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <Paperclip className="w-6 h-6" />
              {certificateParticipant?.participant.certificateDocumentId ? "Remplacer l'attestation" : "Joindre l'attestation"}
            </DialogTitle>
            <DialogDescription>
              {certificateParticipant && (
                <>
                  Participant : <span className="font-bold">{certificateParticipant.employeeName}</span>
                  {" · "}
                  Formation : <span className="font-bold">{certificateParticipant.sessionTitle}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleParticipantCertificateSubmit} className="space-y-6 py-4">
            <div className="space-y-3">
              <Label className="text-xs font-black uppercase tracking-widest">Fichier d'attestation</Label>
              <div className={cn(
                "border-2 border-dashed rounded-2xl p-8 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                certificateFile ? "bg-green-50 border-green-200" : certificateError ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
              )}>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={(event) => handleParticipantCertificateFileChange(event.target.files?.[0] || null)}
                  disabled={certificateSaving}
                  required
                />
                {certificateFile ? (
                  <>
                    <div className="bg-green-100 p-2 rounded-xl text-green-600 mb-1"><FileCheck className="w-5 h-5" /></div>
                    <p className="text-xs font-bold text-green-800 break-all">{certificateFile.name}</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-slate-300 mb-1" />
                    <p className="text-xs font-bold text-slate-600">Cliquez pour choisir l'attestation</p>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">PDF, PNG, JPG (10 Mo max)</p>
                  </>
                )}
              </div>
              {certificateError && <p className="text-xs font-bold text-red-600">{certificateError}</p>}
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setCertificateParticipant(null)} disabled={certificateSaving}>Annuler</Button>
              <Button type="submit" disabled={certificateSaving || !certificateFile} className="rounded-xl px-8 font-black shadow-lg gap-2">
                {certificateSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {certificateParticipant?.participant.certificateDocumentId ? "Remplacer" : "Joindre"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Late Attachment Dialog */}
      <Dialog open={!!uploadingRequest} onOpenChange={(open) => !open && setUploadingRequest(null)}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <Paperclip className="w-6 h-6" /> Joindre attestation
            </DialogTitle>
            <DialogDescription>
              Lier le certificat de formation pour : <span className="font-bold">{uploadingRequest?.title}</span>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleExecuteUpload} className="space-y-6 py-4">
             <div className="space-y-4">
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-8 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                  uploadFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                )}>
                   <input 
                     type="file" 
                     accept=".pdf,.png,.jpg,.jpeg" 
                     className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                     onChange={(e) => {
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
                        <p className="text-xs font-bold text-slate-600">Cliquez pour choisir l'attestation</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">PDF, PNG, JPG (10 Mo max)</p>
                      </>
                   )}
                </div>
             </div>

             <DialogFooter className="pt-4 border-t">
                <Button type="button" variant="ghost" onClick={() => setUploadingRequest(null)} disabled={isUploading}>Annuler</Button>
                <Button 
                  type="submit" 
                  disabled={isUploading || !uploadFile}
                  className="rounded-xl px-8 font-black shadow-lg"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Lancer l'importation
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

function buildCompactPaginationPages(currentPage: number, totalPages: number) {
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

function getTrainingSessionStatusBadge(status: TrainingSessionStatus) {
  const classes: Record<TrainingSessionStatus, string> = {
    draft: "border-slate-300 bg-slate-100 text-slate-800 shadow-sm",
    scheduled: "border-indigo-200 bg-indigo-50 text-indigo-800 shadow-sm",
    in_progress: "border-violet-200 bg-violet-50 text-violet-800 shadow-sm",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm",
    cancelled: "border-red-200 bg-red-50 text-red-800 shadow-sm",
    archived: "border-slate-200 bg-slate-50 text-slate-600 shadow-sm",
  };
  return (
    <Badge variant="outline" className={cn("rounded-full border px-3 py-1 text-[10px] font-black", classes[status] || "border-slate-200 bg-slate-50 text-slate-700")}>
      {getSessionStatusLabel(status)}
    </Badge>
  );
}

function getTrainingApprovalStatusBadge(status: TrainingSession["approvalStatus"]) {
  const classes: Record<TrainingSession["approvalStatus"], string> = {
    not_submitted: "border-slate-200 bg-white text-slate-700 shadow-sm",
    pending: "border-amber-200 bg-amber-50 text-amber-900 shadow-sm",
    approved: "border-blue-200 bg-blue-50 text-blue-800 shadow-sm",
    rejected: "border-red-200 bg-red-50 text-red-800 shadow-sm",
  };
  return (
    <Badge variant="outline" className={cn("rounded-full border px-3 py-1 text-[10px] font-black", classes[status] || "border-slate-200 bg-slate-50 text-slate-700")}>
      {getApprovalStatusLabel(status)}
    </Badge>
  );
}

function getAttendanceResponseLabel(status?: TrainingAttendanceResponseStatus | null) {
  const labels: Record<TrainingAttendanceResponseStatus, string> = {
    pending: "sans réponse",
    confirmed: "confirmé",
    declined: "indisponible",
  };
  return labels[status || "pending"];
}

function getTrainerAvailabilityLabelFromStatus(status: ReturnType<typeof getTrainerAvailabilityStatus>) {
  const labels: Record<ReturnType<typeof getTrainerAvailabilityStatus>, string> = {
    not_required: "Non requise",
    not_contacted: "Demande non envoyée",
    awaiting_response: "En attente de réponse",
    available: "Formateur disponible",
    unavailable: "Formateur indisponible",
    historically_bypassed: "Historique",
  };
  return labels[status];
}

function getSessionDateCategory(session: TrainingSession) {
  if (!session.startDate) return "undated";
  const date = parseDateOnly(session.startDate);
  if (!date) return "undated";
  const today = startOfDay(new Date());
  if (date.getTime() === today.getTime()) return "today";
  return isBefore(date, today) ? "past" : "upcoming";
}

function getTrainingSessionOperationalPriority(session: TrainingSession, participants: TrainingParticipant[]) {
  const availabilityStatus = getTrainerAvailabilityStatus(session);
  const hasPendingParticipants = participants.some((participant) => (participant.attendanceResponseStatus || "pending") === "pending");
  if (session.approvalStatus === "not_submitted" || session.approvalStatus === "rejected") return 1;
  if (session.approvalStatus === "pending") return 2;
  if (availabilityStatus === "awaiting_response" || hasPendingParticipants) return 3;
  if (session.status === "scheduled") return 4;
  if (session.status === "in_progress") return 5;
  if (session.status === "completed" || session.status === "cancelled" || session.status === "archived") return 6;
  return 7;
}

function getTrainingSessionDateSortValue(session: TrainingSession) {
  const date = parseDateOnly(session.startDate || "");
  return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function getTrainingSessionUpdatedSortValue(session: TrainingSession) {
  const value = (session as any).updatedAt || (session as any).createdAt;
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function getTrainingSessionNextAction(session: TrainingSession, participants: TrainingParticipant[], canApprove: boolean) {
  const availabilityStatus = getTrainerAvailabilityStatus(session);
  const availabilitySnapshotCurrent = isTrainerAvailabilitySnapshotCurrent(session);
  const lifecycleAction = getLifecycleAction(session);
  if (session.approvalStatus === "not_submitted" || session.approvalStatus === "rejected") return "Soumettre pour approbation";
  if (session.approvalStatus === "pending") return canApprove ? "Approuver ou rejeter" : "En attente d'approbation";
  if (session.trainerType === "external" && session.approvalStatus === "approved" && session.status === "draft") {
    if (availabilityStatus === "not_contacted") return "Envoyer la demande de disponibilité";
    if (availabilityStatus === "awaiting_response") return "Enregistrer la réponse du formateur";
    if (availabilityStatus === "unavailable" || (availabilityStatus === "available" && !availabilitySnapshotCurrent)) return "Renvoyer la demande de disponibilité";
  }
  if (lifecycleAction) return lifecycleAction.label;
  if (session.status === "scheduled" && participants.length > 0) return "Notifier les participants";
  if (session.status === "completed") return "Clôturée";
  if (session.status === "cancelled" || session.status === "archived") return getSessionStatusLabel(session.status);
  return "Suivi de la session";
}

function TrainingWorkflowStepper({ session }: { session: TrainingSession }) {
  const availabilityStatus = getTrainerAvailabilityStatus(session);
  const approvalState =
    session.approvalStatus === "rejected" ? "blocked"
    : session.approvalStatus === "approved" ? "done"
    : session.approvalStatus === "pending" ? "active"
    : "future";
  const availabilityState =
    availabilityStatus === "not_required" ? "skipped"
    : availabilityStatus === "unavailable" ? "blocked"
    : availabilityStatus === "awaiting_response" ? "active"
    : availabilityStatus === "available" || availabilityStatus === "historically_bypassed" || ["scheduled", "in_progress", "completed"].includes(session.status) ? "done"
    : session.approvalStatus === "approved" ? "active"
    : "future";
  const planningState =
    ["scheduled", "in_progress", "completed"].includes(session.status) ? "done"
    : session.approvalStatus === "approved" && (session.trainerType !== "external" || availabilityStatus === "available") ? "active"
    : "future";
  const progressState =
    session.status === "completed" ? "done"
    : session.status === "in_progress" ? "active"
    : "future";
  const closureState =
    session.status === "completed" ? "done"
    : session.status === "in_progress" ? "active"
    : "future";

  const steps = [
    { label: "Approbation", state: approvalState, detail: getApprovalStatusLabel(session.approvalStatus) },
    { label: "Disponibilité", state: availabilityState, detail: getTrainerAvailabilityLabel(session) },
    { label: "Planification", state: planningState, detail: session.status === "draft" ? "À planifier" : getSessionStatusLabel(session.status) },
    { label: "Déroulement", state: progressState, detail: session.status === "in_progress" ? "En cours" : session.status === "completed" ? "Réalisée" : "À venir" },
    { label: "Clôture", state: closureState, detail: session.status === "completed" ? "Terminée" : "À venir" },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {steps.map((step) => (
        <span
          key={step.label}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-2xl border px-3 py-2 text-[10px] font-black uppercase tracking-tight shadow-sm",
            step.state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-800",
            step.state === "active" && "border-blue-300 bg-blue-50 text-blue-900 ring-2 ring-blue-100",
            step.state === "blocked" && "border-red-200 bg-red-50 text-red-800",
            step.state === "skipped" && "border-slate-200 bg-slate-50 text-slate-500",
            step.state === "future" && "border-slate-200 bg-white/80 text-slate-500 opacity-80"
          )}
          title={step.detail}
        >
          {step.state === "done" ? <CheckCircle2 className="w-3 h-3" /> : step.state === "blocked" ? <XCircle className="w-3 h-3" /> : step.state === "active" ? <Clock className="w-3 h-3" /> : null}
          {step.label}
        </span>
      ))}
    </div>
  );
}

function getStatusBadge(status: TrainingStatus) {
  switch (status) {
    case 'planned': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Planifiée</Badge>;
    case 'in_progress': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">En cours</Badge>;
    case 'completed': return <Badge className="bg-green-600 text-white border-none text-[10px]">Terminée</Badge>;
    case 'failed': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px]">Non validée</Badge>;
    case 'expired': return <Badge variant="destructive" className="bg-red-600 text-white border-none text-[10px]">Expirée</Badge>;
    case 'cancelled': return <Badge variant="outline" className="text-muted-foreground text-[10px]">Annulée</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 text-[10px]">Archivée</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy", { locale: fr });
  } catch (e) {
    return dateStr;
  }
}

function getEmployeeDisplayName(employee: Employee) {
  if (employee.displayName?.trim()) return employee.displayName.trim();
  const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim();
  return fullName || employee.employeeId;
}

function formatParticipantPreview(participants: TrainingParticipant[]) {
  const names = participants.map((participant) => (
    participant.employeeDisplayNameSnapshot || participant.employeeCodeSnapshot || participant.employeeId
  ));

  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} + ${names.length - 2} autres`;
}

function getAttendanceResponseCounts(participants: TrainingParticipant[]) {
  return participants.reduce((summary, participant) => {
    if (participant.attendanceResponseStatus === "confirmed") summary.confirmed += 1;
    else if (participant.attendanceResponseStatus === "declined") summary.declined += 1;
    else summary.pending += 1;
    return summary;
  }, {
    confirmed: 0,
    declined: 0,
    pending: 0,
  });
}

function getAttendanceResponseBadge(status?: TrainingAttendanceResponseStatus | null) {
  const normalized: TrainingAttendanceResponseStatus = status || "pending";
  const labels: Record<TrainingAttendanceResponseStatus, string> = {
    pending: "En attente de réponse",
    confirmed: "Présence confirmée",
    declined: "Indisponible",
  };
  const classes: Record<TrainingAttendanceResponseStatus, string> = {
    pending: "bg-slate-50 text-slate-600 border-slate-200",
    confirmed: "bg-green-50 text-green-700 border-green-200",
    declined: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={cn("text-[10px] font-black whitespace-nowrap", classes[normalized])}>
      {labels[normalized]}
    </Badge>
  );
}

function formatSessionDateRange(session: TrainingSession) {
  if (session.endDate && session.endDate !== session.startDate) {
    return `${formatDate(session.startDate)} – ${formatDate(session.endDate)}`;
  }
  return formatDate(session.startDate);
}

function formatSessionCardSchedule(session: TrainingSession) {
  const parts = [session.startDate ? formatSessionDateRange(session) : null];
  const dayCount = formatSessionDayCount(session);
  const timeRange = formatSessionCardTimeRange(session);

  if (dayCount) parts.push(dayCount);
  if (timeRange) parts.push(timeRange);

  return parts.filter(Boolean).join(" · ") || "Date non renseignée";
}

function formatSessionDayCount(session: TrainingSession) {
  const dayCount = calculateSessionInclusiveDayCount(session.startDate, session.endDate || session.startDate);
  if (!dayCount) return null;
  return `${dayCount} ${dayCount === 1 ? "jour" : "jours"}`;
}

function formatSessionCardTimeRange(session: TrainingSession) {
  if (session.startTime && session.endTime) return `${session.startTime}–${session.endTime}`;
  if (session.startTime) return `Début ${session.startTime}`;
  if (session.endTime) return `Fin ${session.endTime}`;
  return null;
}

function formatSessionTimeRange(session: TrainingSession) {
  if (session.startTime && session.endTime) return `${session.startTime} – ${session.endTime}`;
  if (session.startTime) return `Début ${session.startTime}`;
  if (session.endTime) return `Fin ${session.endTime}`;
  return "Non renseigné";
}

function getMissingSchedulingFields(session: TrainingSession) {
  const missing: string[] = [];
  if (!session.startDate) missing.push("Date");
  if (!session.startTime || !session.endTime) missing.push("Horaire");
  if (session.startTime && session.endTime && !isEndTimeAfterStartTime(session.startTime, session.endTime)) {
    missing.push("Horaire de fin postérieur au début");
  }
  if (!session.location?.trim()) missing.push("Lieu");
  if (session.trainerType === "external") {
    if (!session.trainerName?.trim()) missing.push("Nom du formateur");
    if (!session.trainerEmail?.trim()) missing.push("Email du formateur");
  } else if (!session.internalTrainerEmployeeId?.trim()) {
    missing.push("Formateur interne");
  }
  return missing;
}

function getTrainerAvailabilityStatus(session: TrainingSession): "not_required" | "not_contacted" | "awaiting_response" | "available" | "unavailable" | "historically_bypassed" {
  if (session.trainerType !== "external") return "not_required";
  if (["scheduled", "in_progress", "completed", "cancelled", "archived"].includes(session.status) && !session.trainerAvailabilityStatus) {
    return "historically_bypassed";
  }
  return session.trainerAvailabilityStatus || "not_contacted";
}

function getTrainerAvailabilityLabel(session: TrainingSession) {
  const status = getTrainerAvailabilityStatus(session);
  const labels: Record<ReturnType<typeof getTrainerAvailabilityStatus>, string> = {
    not_required: "Non requise",
    not_contacted: "Demande non envoyée",
    awaiting_response: "En attente de réponse",
    available: "Formateur disponible",
    unavailable: "Formateur indisponible",
    historically_bypassed: "Historique",
  };
  return labels[status];
}

function buildTrainingAvailabilitySnapshot(session: TrainingSession) {
  return {
    trainerEmail: (session.trainerEmail || "").trim().toLowerCase() || null,
    startDate: session.startDate || null,
    endDate: session.endDate || null,
    startTime: session.startTime || null,
    endTime: session.endTime || null,
    location: session.location || null,
  };
}

function isTrainerAvailabilitySnapshotCurrent(session: TrainingSession) {
  if (session.trainerType !== "external") return true;
  const requestedFor = session.trainerAvailabilityRequestedFor;
  if (!requestedFor) return false;
  const current = buildTrainingAvailabilitySnapshot(session);
  return (
    (requestedFor.trainerEmail || "").trim().toLowerCase() === current.trainerEmail
    && (requestedFor.startDate || null) === current.startDate
    && (requestedFor.endDate || null) === current.endDate
    && (requestedFor.startTime || null) === current.startTime
    && (requestedFor.endTime || null) === current.endTime
    && (requestedFor.location || null) === current.location
  );
}

function getLifecycleAction(session: TrainingSession): { label: string; targetStatus: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed"> } | null {
  if (session.approvalStatus === "approved" && session.status === "draft") {
    if (session.trainerType === "external" && (getTrainerAvailabilityStatus(session) !== "available" || !isTrainerAvailabilitySnapshotCurrent(session))) {
      return null;
    }
    return { label: "Planifier la session", targetStatus: "scheduled" };
  }
  if (session.status === "scheduled") {
    return { label: "Démarrer la session", targetStatus: "in_progress" };
  }
  if (session.status === "in_progress") {
    return { label: "Terminer la session", targetStatus: "completed" };
  }
  return null;
}

function getLifecycleDialogTitle(status: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed">) {
  if (status === "scheduled") return "Planifier la session";
  if (status === "in_progress") return "Démarrer la session";
  return "Terminer la session";
}

function getLifecycleSuccessMessage(status: Extract<TrainingSessionStatus, "scheduled" | "in_progress" | "completed">) {
  if (status === "scheduled") return "Session planifiée";
  if (status === "in_progress") return "Session démarrée";
  return "Session terminée";
}

function getParticipantStatusLabel(status: TrainingParticipant["participantStatus"]) {
  const labels: Record<TrainingParticipant["participantStatus"], string> = {
    planned: "Planifiée",
    attended: "Présent",
    absent: "Absent",
    completed: "Terminée",
    not_completed: "Non terminée",
    cancelled: "Annulée",
  };
  return labels[status] || status;
}

function getParticipantStatusBadge(status: TrainingParticipant["participantStatus"]) {
  const classes: Record<TrainingParticipant["participantStatus"], string> = {
    planned: "bg-blue-50 text-blue-700 border-blue-200",
    attended: "bg-green-50 text-green-700 border-green-200",
    absent: "bg-red-50 text-red-700 border-red-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    not_completed: "bg-orange-50 text-orange-700 border-orange-200",
    cancelled: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return <Badge variant="outline" className={cn("text-[10px] font-black", classes[status])}>{getParticipantStatusLabel(status)}</Badge>;
}

function getParticipantResultLabel(status?: TrainingResultStatus | null) {
  if (!status) return "À renseigner";
  const labels: Record<TrainingResultStatus, string> = {
    passed: "Réussi",
    failed: "Échoué",
    attended: "Participation validée",
    not_attended: "Non présenté",
    not_required: "Non requis",
  };
  return labels[status] || status;
}

function getParticipantResultBadge(status?: TrainingResultStatus | null) {
  if (!status) return <span className="text-[10px] font-bold text-muted-foreground italic">À renseigner</span>;
  const classes: Record<TrainingResultStatus, string> = {
    passed: "bg-green-50 text-green-700 border-green-200",
    failed: "bg-red-50 text-red-700 border-red-200",
    attended: "bg-blue-50 text-blue-700 border-blue-200",
    not_attended: "bg-orange-50 text-orange-700 border-orange-200",
    not_required: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return <Badge variant="outline" className={cn("text-[10px] font-black", classes[status])}>{getParticipantResultLabel(status)}</Badge>;
}

function getParticipantValidityBadge(state: TrainingValidityState) {
  const classes: Record<TrainingValidityState, string> = {
    non_applicable: "bg-slate-50 text-slate-500 border-slate-200",
    pending_result: "bg-blue-50 text-blue-700 border-blue-200",
    awaiting_final_validation: "bg-indigo-50 text-indigo-700 border-indigo-200",
    not_acquired: "bg-red-50 text-red-700 border-red-200",
    policy_missing: "bg-amber-50 text-amber-700 border-amber-200",
    not_recorded: "bg-amber-50 text-amber-700 border-amber-200",
    valid: "bg-green-50 text-green-700 border-green-200",
    renewal_due: "bg-orange-50 text-orange-700 border-orange-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    renewed: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return <Badge variant="outline" className={cn("text-[10px] font-black", classes[state])}>{formatTrainingValidityStateLabel(state)}</Badge>;
}

function getParticipantValidityExpiryLabel(row: ParticipantRegisterRow) {
  return formatTrainingValidityExpiryLabel({
    participant: row.participant,
    state: row.validityState,
    sessionPolicy: row.session,
    formatDate,
  });
}

function formatInvitationChannelStatus(status: TrainingParticipantInvitationDeliveryRow["inApp"]) {
  const labels: Record<TrainingParticipantInvitationDeliveryRow["inApp"], string> = {
    sent: "Envoyée",
    already_sent: "Déjà envoyée",
    failed: "Échec",
    not_applicable: "Non applicable",
    absent: "Absent",
  };
  return <span className="text-xs font-bold">{labels[status]}</span>;
}

function formatInvitationFinalStatus(status: TrainingParticipantInvitationDeliveryRow["finalResult"]) {
  const labels: Record<TrainingParticipantInvitationDeliveryRow["finalResult"], string> = {
    invitation_sent: "Convocation envoyée",
    email_only: "E-mail uniquement",
    manual_required: "Contact manuel requis",
    partial_failure: "Envoi partiel",
    already_sent: "Déjà envoyée",
  };
  return labels[status];
}

function getDeadlineColor(date: string) {
  const d = parseISO(date);
  const today = startOfDay(new Date());
  const thirtyDays = addDays(today, 30);

  if (isBefore(d, today)) return "text-red-600";
  if (isBefore(d, thirtyDays)) return "text-orange-600";
  return "text-slate-600";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseDateOnly(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function parseTimeToMinutes(value: string) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function isEndDateBeforeStartDate(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return false;
  return end.getTime() < start.getTime();
}

function isEndTimeAfterStartTime(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return true;
  return end > start;
}

function calculateSessionInclusiveDayCount(startDate?: string, endDate?: string) {
  const start = parseDateOnly(startDate || "");
  const end = parseDateOnly(endDate || startDate || "");
  if (!start || !end) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const inclusiveDayCount = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  return Number.isFinite(inclusiveDayCount) && inclusiveDayCount > 0 ? inclusiveDayCount : null;
}

function calculateSessionDurationHours({
  startDate,
  endDate,
  startTime,
  endTime,
}: {
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}) {
  const inclusiveDayCount = calculateSessionInclusiveDayCount(startDate, endDate || startDate);
  const startMinutes = parseTimeToMinutes(startTime || "");
  const endMinutes = parseTimeToMinutes(endTime || "");

  if (inclusiveDayCount == null || startMinutes == null || endMinutes == null) return null;

  const dailyMinutes = endMinutes - startMinutes;

  if (dailyMinutes <= 0) return 0;

  return (inclusiveDayCount * dailyMinutes) / 60;
}

function formatDurationHours(value: number) {
  return Number(value.toFixed(2)).toString();
}

function getSessionStatusLabel(status: TrainingSessionStatus) {
  const labels: Record<TrainingSessionStatus, string> = {
    draft: "Brouillon",
    scheduled: "Planifiée",
    in_progress: "En cours",
    completed: "Terminée",
    cancelled: "Annulée",
    archived: "Archivée",
  };
  return labels[status] || status;
}

function getApprovalStatusLabel(status: TrainingSession["approvalStatus"]) {
  const labels: Record<TrainingSession["approvalStatus"], string> = {
    not_submitted: "Non soumise",
    pending: "En attente d’approbation",
    approved: "Approuvée",
    rejected: "Rejetée",
  };
  return labels[status] || status;
}

function FilterDropdown({ label, value, onValueChange, options }: { label: string, value: string, onValueChange: (v: string) => void, options: { label: string, value: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("h-10 w-auto min-w-[150px] text-xs font-medium bg-background border-primary/10", value !== 'all' && "border-primary ring-1 ring-primary/10")}>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{label}:</span>
          <SelectValue placeholder="Tous" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous ({label})</SelectItem>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
