'use client';

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Briefcase, Building2, FileSignature,
  Info, Euro, Clock, History, 
  ShieldCheck, 
  FileText, AlertTriangle, FolderOpen, 
  Download, Eye, Lock,
  ChevronDown, RefreshCcw,
  Plus, 
  LayoutDashboard,
  Stethoscope, Shield, Edit, MoreVertical,
  ChevronRight,
  Search,
  ArrowRight,
  UserPlus,
  Globe,
  GraduationCap,
  Send,
  ClipboardList,
  Fingerprint,
  Calendar,
  Mail,
  Phone,
  MapPin,
  ChevronUp,
  XCircle,
  FileCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Tabs, TabsContent, TabsList, TabsTrigger 
} from "@/components/ui/tabs";
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFirebase, useDoc, useUser, useCollection, useAuth } from "@/firebase";
import { doc, DocumentReference, query, collection, where, Query, limit, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Person } from "@/types/person";
import { EmploymentOffer } from "@/types/employment-offer";
import { Candidate } from "@/types/candidate";
import { EmploymentRequest } from "@/types/employment-request";
import { HRDocument, DOCUMENT_TYPE_LABELS, STATUS_LABELS } from "@/types/hr-document";
import { 
  MedicalVisit, 
  MEDICAL_VISIT_TYPE_LABELS,
  FITNESS_STATUS_LABELS 
} from "@/types/medical-visit";
import { Training, TRAINING_TYPE_LABELS } from "@/types/training";
import { SafetyDpiAssignment, SAFETY_DPI_STATUS_LABELS } from "@/types/safety-dpi";
import { getDocumentDownloadUrl } from "@/services/document.service";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { format, isBefore, addDays, startOfDay, differenceInDays, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { PersonTimeline } from "@/components/persons/PersonTimeline";
import { inviteEmployeeToEmployeeSpace } from "@/services/employee-account.service";
import { PreHireDossier } from "@/types/pre-hire-dossier";
import React from "react";

/**
 * Robust date parser for mixed formats.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    return null;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d;
  }
  return null;
}

function formatDateSafe(val: any, formatStr: string = "dd/MM/yyyy"): string {
  const date = parseSafeDate(val);
  if (!date) return "-";
  return format(date, formatStr, { locale: fr });
}

/**
 * Renders the contract lifecycle context for a document.
 */
function renderContractContext(doc: HRDocument, employee?: Employee, onlyText = false) {
  const isContractDoc = ['signed_contract', 'generated_contract_pdf', 'unilav_receipt', 'cpi_receipt'].includes(doc.documentType);
  if (!isContractDoc && doc.relatedModule !== 'contracts') return null;
  if (!doc.contractId) return null;

  const isCoreContract = ['signed_contract', 'generated_contract_pdf'].includes(doc.documentType);
  let label = doc.contractType || "Contrat";
  let color = "bg-slate-50 text-slate-500 border-slate-200";

  if (employee) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = parseSafeDate(doc.contractStartDate);
    const isFuture = (startDate && startDate > today) || employee.pendingContractId === doc.contractId;

    if (employee.activeContractId === doc.contractId) {
      label = isCoreContract ? "Contrat actif" : "Lié au contrat actif";
      color = "bg-blue-50 text-blue-700 border-blue-200";
    } else if (isFuture) {
      label = isCoreContract ? "Contrat à venir" : "Lié au contrat à venir";
      color = "bg-teal-50 text-teal-700 border-teal-100";
    } else {
      label = isCoreContract ? "Contrat précédent" : "Lié au contrat précédent";
      color = "bg-slate-50 text-slate-500 border-slate-200";
    }
  }

  if (onlyText) return label;

  return (
    <Badge variant="outline" className={cn("text-[8px] h-4 px-1.5 font-black uppercase", color)}>
       {label}
    </Badge>
  );
}

/**
 * Renders a deadline badge for medical visits.
 */
function getMedicalDeadlineBadge(visit: MedicalVisit) {
  const visitDate = parseISO(visit.visitDate);
  const isPast = isBefore(visitDate, startOfDay(new Date()));

  if (visit.fitnessStatus === 'pending_result') {
    return (
      <Badge variant="outline" className={cn("text-[10px] font-black uppercase", isPast ? "bg-red-50 text-red-700 border-red-200 animate-pulse" : "bg-orange-50 text-orange-700 border-orange-200")}>
        {isPast ? "Résultat médical en attente" : "En attente de jugement"}
      </Badge>
    );
  }

  const expiryDate = parseSafeDate(visit.nextVisitDate);
  if (!expiryDate) return null;

  const today = startOfDay(new Date());
  const thirtyDaysOut = addDays(today, 30);

  if (isBefore(expiryDate, today)) {
    return (
      <Badge className="bg-red-600 text-white border-none text-[10px] font-black uppercase animate-pulse">
        Échue
      </Badge>
    );
  }

  if (isBefore(expiryDate, thirtyDaysOut)) {
    return (
      <Badge variant="secondary" className="bg-orange-500 text-white border-none text-[10px] font-black uppercase">
        À échéance proche
      </Badge>
    );
  }

  return (
    <Badge className="bg-green-600 text-white border-none text-[10px] font-black uppercase">
      À jour
    </Badge>
  );
}

/**
 * Renders a compliance badge for training based on expiry logic.
 */
function getTrainingDeadlineBadge(training: Training) {
  const expiryDate = parseSafeDate(training.expiryDate);
  const today = startOfDay(new Date());
  const thirtyDaysOut = addDays(today, 30);

  if (training.status === 'planned') {
    return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-black uppercase">Planifiée</Badge>;
  }

  if (!expiryDate) {
    return <Badge className="bg-slate-900 text-white border-none text-[10px] font-black uppercase">Terminée</Badge>;
  }

  if (isBefore(expiryDate, today)) {
    return <Badge className="bg-red-600 text-white border-none text-[10px] font-black uppercase animate-pulse">Expirée</Badge>;
  }

  if (isBefore(expiryDate, thirtyDaysOut)) {
    return <Badge variant="secondary" className="bg-orange-500 text-white border-none text-[10px] font-black uppercase">À renouveler</Badge>;
  }

  return <Badge className="bg-green-600 text-white border-none text-[10px] font-black uppercase">À jour</Badge>;
}

/**
 * Renders a compliance badge for safety assignments.
 */
function getSafetyDeadlineBadge(assignment: SafetyDpiAssignment) {
  const today = startOfDay(new Date());
  const threshold = addDays(today, 30);
  const nextDate = parseSafeDate(assignment.plannedReplacementDate);

  if (assignment.status !== 'assigned') {
    return <Badge variant="outline" className="text-[10px] font-black uppercase bg-slate-50">{SAFETY_DPI_STATUS_LABELS[assignment.status]}</Badge>;
  }

  if (!nextDate) return <Badge className="bg-green-600 text-white border-none text-[10px] font-black uppercase">À jour</Badge>;

  if (isBefore(nextDate, today)) {
    return <Badge className="bg-red-600 text-white border-none text-[10px] font-black uppercase animate-pulse">En retard</Badge>;
  }

  if (isBefore(nextDate, threshold)) {
    return <Badge variant="secondary" className="bg-orange-500 text-white border-none text-[10px] font-black uppercase">À remplacer bientôt</Badge>;
  }

  return <Badge className="bg-green-600 text-white border-none text-[10px] font-black uppercase">À jour</Badge>;
}

export default function Employee360HubPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const employeeId = params?.employeeId as string;
  
  const { db, auth } = useFirebase();
  const authInstance = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, entity, membership } = useActiveMembership(entityId);

  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // --- 1. STRICT PERMISSION READINESS ---
  const permissionsReady = 
    !membershipLoading && 
    !!membership && 
    membership.entityId === entityId;

  const activePermissions = membership?.permissions || [];

  const canReadDocs = permissionsReady && activePermissions.includes("documents.read");
  const canReadContracts = permissionsReady && activePermissions.includes("contracts.read");
  const canReadCPI = permissionsReady && activePermissions.includes("employmentRequests.read");
  const canReadPersons = permissionsReady && activePermissions.includes("persons.read");
  const canReadCandidates = permissionsReady && activePermissions.includes("candidates.read");
  const canReadMedical = permissionsReady && activePermissions.includes("medicalVisits.read");
  const canReadTraining = permissionsReady && activePermissions.includes("training.read");
  const canReadSafety = permissionsReady && activePermissions.includes("safety.read");

  // --- 2. Aggregate Queries ---
  
  const employeeRef = useMemo(() => 
    db && entityId && employeeId && permissionsReady ? (doc(db, `entities/${entityId}/employees`, employeeId) as DocumentReference<Employee>) : null,
  [db, entityId, employeeId, permissionsReady]);
  const { data: employee, loading: loadingEmployee } = useDoc<Employee>(employeeRef, "employee360.core");

  const personRef = useMemo(() => 
    db && entityId && employee?.personId && canReadPersons ? (doc(db, `entities/${entityId}/persons`, employee.personId) as DocumentReference<Person>) : null,
  [db, entityId, employee?.personId, canReadPersons]);
  const { data: person } = useDoc<Person>(personRef, "employee360.person");

  const candidateRef = useMemo(() => 
    db && entityId && employee?.sourceCandidateId && canReadCandidates ? (doc(db, `entities/${entityId}/candidates`, employee.sourceCandidateId) as DocumentReference<Candidate>) : null,
  [db, entityId, employee?.sourceCandidateId, canReadCandidates]);
  const { data: candidate } = useDoc<Candidate>(candidateRef, "employee360.candidate");

  const offerRef = useMemo(() => 
    db && entityId && employee?.sourceOfferId && (canReadContracts || canReadCandidates) ? (doc(db, `entities/${entityId}/employmentOffers`, employee.sourceOfferId) as DocumentReference<EmploymentOffer>) : null,
  [db, entityId, employee?.sourceOfferId, canReadContracts, canReadCandidates]);
  const { data: offer } = useDoc<EmploymentOffer>(offerRef, "employee360.offer");

  const dossierQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !employee) return null;

    // 1. Try by Offer ID (Standard recruited employee)
    if (employee.sourceOfferId) {
      return query(
        collection(db, `entities/${entityId}/preHireDossiers`),
        where("employmentOfferId", "==", employee.sourceOfferId)
      ) as Query<PreHireDossier>;
    }

    // 2. Fallback for direct intake (Historical)
    const isHistorical = employee.source === 'historical_import' || employee.source === 'direct_hr_creation';
    if (isHistorical && employee.employeeId) {
      return query(
        collection(db, `entities/${entityId}/preHireDossiers`),
        where("employeeId", "==", employee.employeeId)
      ) as Query<PreHireDossier>;
    }

    return null;
  }, [db, entityId, employee, permissionsReady]);

  const { data: dossiers } = useCollection<PreHireDossier>(dossierQuery, "employee360.dossiers");
  const dossier = dossiers?.[0];

  const cpiRef = useMemo(() => 
    db && entityId && employee?.sourceOfferId && canReadCPI ? (doc(db, `entities/${entityId}/employmentRequests`, `unilav_${employee.sourceOfferId}`) as DocumentReference<any>) : null,
  [db, entityId, employee?.sourceOfferId, canReadCPI]);
  const { data: cpi } = useDoc<EmploymentRequest>(cpiRef, "employee360.employmentRequest");

  const communicationsQuery = useMemo(() => {
    const isReady = db && entityId && employee?.sourceOfferId && canReadCPI && permissionsReady;
    if (!isReady) return null;
    return query(collection(db, `entities/${entityId}/mandatoryCommunications`), where("employmentOfferId", "==", employee.sourceOfferId)) as Query<any>;
  }, [db, entityId, employee?.sourceOfferId, canReadCPI, permissionsReady]);
  const { data: communications } = useCollection<any>(communicationsQuery, "employee360.communications");

  // --- 2A. Contracts Sub-Queries ---
  const contractsByEmployeeQuery = useMemo(() => {
    const isReady = !!db && !!entityId && !!employeeId && permissionsReady && canReadContracts && !!employee;
    
    if (!isReady) return null;
    return query(
      collection(db, `entities/${entityId}/contracts`),
      where("employeeId", "==", employeeId)
    ) as Query<Contract>;
  }, [db, entityId, employeeId, permissionsReady, canReadContracts, employee]);

  const { data: contractsByEmp } = useCollection<Contract>(contractsByEmployeeQuery, "employee360.contracts.byEmployeeId");

  const allContracts = useMemo(() => {
    const map = new Map<string, Contract>();
    contractsByEmp.forEach(c => map.set(c.contractId, c));
    return Array.from(map.values()).sort((a, b) => {
       const da = parseSafeDate(a.createdAt)?.getTime() || 0;
       const db = parseSafeDate(b.createdAt)?.getTime() || 0;
       return db - da;
    });
  }, [contractsByEmp]);

  const activeContract = useMemo(() => allContracts?.find(c => c.status === 'active'), [allContracts]);
  const contractHistory = useMemo(() => allContracts?.filter(c => c.status !== 'active') || [], [allContracts]);

  // --- 2B. Documents Sub-Queries ---
  const docsByEmployeeQuery = useMemo(() => {
    const isReady = !!db && !!entityId && !!employeeId && permissionsReady && canReadDocs && !!employee;
    
    if (!isReady) return null;
    return query(
      collection(db, `entities/${entityId}/documents`),
      where("employeeId", "==", employeeId)
    ) as Query<HRDocument>;
  }, [db, entityId, employeeId, permissionsReady, canReadDocs, employee]);

  const docsByPersonQuery = useMemo(() => {
    const isReady = !!db && !!entityId && !!employee?.personId && permissionsReady && canReadDocs;
    if (!isReady) return null;
    return query(
      collection(db, `entities/${entityId}/documents`),
      where("personId", "==", employee.personId)
    ) as Query<HRDocument>;
  }, [db, entityId, employee?.personId, permissionsReady, canReadDocs]);

  const docsByCandidateQuery = useMemo(() => {
    const isReady = !!db && !!entityId && !!employee?.sourceCandidateId && permissionsReady && canReadDocs;
    if (!isReady) return null;
    return query(
      collection(db, `entities/${entityId}/documents`),
      where("personId", "==", employee.personId)
    ) as Query<HRDocument>;
  }, [db, entityId, employee?.sourceCandidateId, permissionsReady, canReadDocs]);

  const { data: docsByEmp } = useCollection<HRDocument>(docsByEmployeeQuery, "employee360.documents.byEmployeeId");
  const { data: docsByPers } = useCollection<HRDocument>(docsByPersonQuery, "employee360.documents.byPersonIdFallback");
  const { data: docsByCand } = useCollection<HRDocument>(docsByCandidateQuery, "employee360.documents.byCandidateIdFallback");

  const allDocs = useMemo(() => {
    const map = new Map<string, HRDocument>();
    docsByEmp.forEach(d => map.set(d.id, d));
    docsByPers.forEach(d => { if (!map.has(d.id)) map.set(d.id, d); });
    docsByCand.forEach(d => { if (!map.has(d.id)) map.set(d.id, d); });
    return Array.from(map.values()).sort((a, b) => {
       const da = parseSafeDate(a.uploadedAt || a.createdAt || 0)?.getTime() || 0;
       const db = parseSafeDate(b.uploadedAt || b.createdAt || 0)?.getTime() || 0;
       return db - da;
    });
  }, [docsByEmp, docsByPers, docsByCand]);

  // --- 2C. Medical Visits Sub-Query ---
  // Optimized: Removed Firestore orderBy and limit to avoid index requirement
  const medicalVisitsQuery = useMemo(() => {
    if (!db || !entityId || !employeeId || !canReadMedical) return null;
    return query(
      collection(db, `entities/${entityId}/medicalVisits`),
      where("employeeId", "==", employeeId)
    ) as Query<MedicalVisit>;
  }, [db, entityId, employeeId, canReadMedical]);

  const { data: medicalVisits, loading: loadingVisits } = useCollection<MedicalVisit>(medicalVisitsQuery, "employee360.medicalVisits");
  
  // Client-side sorting for the latest visit
  const latestMedicalVisit = useMemo(() => {
    if (!medicalVisits || medicalVisits.length === 0) return null;
    return [...medicalVisits].sort((a, b) => {
      const dateA = parseSafeDate(a.visitDate)?.getTime() || 0;
      const dateB = parseSafeDate(b.visitDate)?.getTime() || 0;
      return dateB - dateA;
    })[0];
  }, [medicalVisits]);

  // --- 2D. Training Sub-Query ---
  // Optimized: Removed Firestore orderBy to avoid index requirement
  const trainingsQuery = useMemo(() => {
    if (!db || !entityId || !employeeId || !canReadTraining) return null;
    return query(
      collection(db, `entities/${entityId}/trainings`),
      where("employeeId", "==", employeeId)
    ) as Query<Training>;
  }, [db, entityId, employeeId, canReadTraining]);

  const { data: trainings, loading: loadingTrainings } = useCollection<Training>(trainingsQuery, "employee360.trainings");

  /**
   * Determine the featured training to display in the 360 summary.
   * Priority: Expired > Expiring Soon (30d) > Planned > Latest Completed.
   */
  const featuredTraining = useMemo(() => {
    if (!trainings || trainings.length === 0) return null;
    
    const today = startOfDay(new Date());
    const threshold = addDays(today, 30);

    const sorted = [...trainings].sort((a, b) => {
      const getPriority = (t: Training) => {
        const expiry = parseSafeDate(t.expiryDate);
        if (expiry && isBefore(expiry, today)) return 0; // Expired
        if (expiry && isBefore(expiry, threshold)) return 1; // Expiring soon
        if (t.status === 'planned') return 2; // Planned
        return 3; // Latest completed
      };
      
      const prioA = getPriority(a);
      const prioB = getPriority(b);
      
      if (prioA !== prioB) return prioA - prioB;
      
      // Secondary: most recent course date
      const dateA = parseSafeDate(a.courseDate)?.getTime() || 0;
      const dateB = parseSafeDate(b.courseDate)?.getTime() || 0;
      return dateB - dateA;
    });
    
    return sorted[0];
  }, [trainings]);

  // --- 2E. Safety Assignments Sub-Query ---
  // Optimized: Removed Firestore orderBy to avoid index requirement
  const safetyQuery = useMemo(() => {
    if (!db || !entityId || !employeeId || !canReadSafety) return null;
    return query(
      collection(db, `entities/${entityId}/safetyDpiAssignments`),
      where("employeeId", "==", employeeId)
    ) as Query<SafetyDpiAssignment>;
  }, [db, entityId, employeeId, canReadSafety]);

  const { data: safetyAssignments, loading: loadingSafety } = useCollection<SafetyDpiAssignment>(safetyQuery, "employee360.safety");

  const featuredSafetyAssignment = useMemo(() => {
    if (!safetyAssignments || safetyAssignments.length === 0) return null;
    
    const today = startOfDay(new Date());
    const threshold = addDays(today, 30);

    const sorted = [...safetyAssignments].sort((a, b) => {
      const getPriority = (s: SafetyDpiAssignment) => {
        const nextDate = parseSafeDate(s.plannedReplacementDate);
        if (s.status === 'assigned') {
          if (nextDate && isBefore(nextDate, today)) return 0; // Overdue
          if (nextDate && isBefore(nextDate, threshold)) return 1; // Due soon
          return 2; // Active
        }
        return 3; // Others (replaced, returned...)
      };
      
      const prioA = getPriority(a);
      const prioB = getPriority(b);
      
      if (prioA !== prioB) return prioA - prioB;
      
      // Secondary: recency of delivery
      const dateA = parseSafeDate(a.deliveryDate)?.getTime() || 0;
      const dateB = parseSafeDate(b.deliveryDate)?.getTime() || 0;
      return dateB - dateA;
    });
    
    return sorted[0];
  }, [safetyAssignments]);

  // Detected if a historical UniLav receipt document exists for the overview card
  const hasHistoricalUniLav = useMemo(() => {
    return allDocs?.some(d => (d.documentType === 'unilav_receipt' || d.documentType === 'cpi_receipt') && d.status === 'valid');
  }, [allDocs]);

  const historicalUniLavDoc = useMemo(() => {
    return allDocs?.find(d => (d.documentType === 'unilav_receipt' || d.documentType === 'cpi_receipt') && d.status === 'valid');
  }, [allDocs]);

  // --- Handlers ---
  const handleOpenDoc = async (storagePath: string, id: string) => {
    setLoadingActionId(id);
    try {
      const url = await getDocumentDownloadUrl(storagePath);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible d'ouvrir le document." });
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleInviteToEspaceEmploye = async () => {
    if (!membership || !employee) return;
    setInviting(true);
    try {
      const result = await inviteEmployeeToEmployeeSpace({
        entityId,
        employeeId,
        actorUid: membership.uid
      });
      
      if (result.success) {
        toast({ 
          title: "Invitation envoyée", 
          description: result.simulated ? "Simulé (SMTP non configuré)" : "L'email a été transmis au collaborateur." 
        });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur invitation", description: err.message });
    } finally {
      setInviting(false);
    }
  };

  // --- Safe Initials Logic ---
  const initials = useMemo(() => {
    if (!employee) return "??";
    const f = employee.firstName?.[0] || "";
    const l = employee.lastName?.[0] || "";
    return `${f}${l}`.toUpperCase() || "??";
  }, [employee]);

  // Main Loading Guards
  if (membershipLoading || !permissionsReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Vérification de la session...</p>
      </div>
    );
  }

  if (loadingEmployee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Chargement du dossier...</p>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><User className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Employé introuvable</h2>
        <p className="text-muted-foreground mt-2">Le document n'existe pas ou a été supprimé.</p>
        <Button onClick={() => router.push(`/entity/${entityId}/employees`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const cpiValue = !canReadCPI ? "Accès restreint" : (hasHistoricalUniLav ? "Reçu UniLav importé" : (cpi ? (STATUS_LABELS_CPI[cpi.status] || cpi.status) : "Non requis"));
  const cpiSubtitle = !canReadCPI ? "Permission requise" : (hasHistoricalUniLav ? "Valide" : (cpi?.protocolCode ? `Prot: ${cpi.protocolCode}` : "En attente"));

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      {/* Navigation */}
      <div className="mb-6 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/entity/${entityId}/employees`)}
          className="gap-2 rounded-xl font-bold text-primary hover:bg-primary/5"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux employés
        </Button>
      </div>

      {/* 360 Header */}
      <header className="flex items-center gap-6 mb-8 border-b pb-8">
        <div className="relative">
           <div className="bg-primary text-white w-20 h-20 rounded-[2rem] flex items-center justify-center text-3xl font-black shadow-xl shadow-primary/20">
             {initials}
           </div>
           <div className="absolute -bottom-1 -right-1 ring-4 ring-background rounded-full">
              {getStatusBadge(employee.status)}
           </div>
        </div>
        <div>
          <h1 className="text-4xl font-black text-primary tracking-tight">{employee.displayName}</h1>
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground uppercase tracking-widest mt-2">
            <span className="flex items-center gap-1.5 bg-secondary/40 px-2 py-1 rounded-lg"><Fingerprint className="w-3.5 h-3.5" /> {employee.employeeCode}</span>
            <span className="flex items-center gap-1.5 bg-secondary/40 px-2 py-1 rounded-lg"><Briefcase className="w-3.5 h-3.5" /> {employee.jobTitle}</span>
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Embauché le {formatDateSafe(employee.hireDate)}</span>
          </div>
        </div>
      </header>

      <Tabs defaultValue="overview" className="space-y-8">
        <TabsList className="bg-white border p-1 h-12 rounded-2xl shadow-sm w-full sm:w-auto overflow-x-auto justify-start no-scrollbar">
          <TabsTrigger value="overview" className="rounded-xl font-bold px-6 gap-2"><LayoutDashboard className="w-4 h-4" /> 360°</TabsTrigger>
          <TabsTrigger value="career" className="rounded-xl font-bold px-6 gap-2"><FileSignature className="w-4 h-4" /> Carrière & Contrats</TabsTrigger>
          <TabsTrigger value="recruitment" className="rounded-xl font-bold px-6 gap-2"><Search className="w-4 h-4" /> Recrutement</TabsTrigger>
          <TabsTrigger value="compliance" className="rounded-xl font-bold px-6 gap-2"><ShieldCheck className="w-4 h-4" /> Dossier RH</TabsTrigger>
          <TabsTrigger value="documents" className="rounded-xl font-bold px-6 gap-2">
             <FolderOpen className="w-4 h-4" /> GED
             {allDocs && allDocs.length > 0 && <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px]">{allDocs.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-xl font-bold px-6 gap-2"><History className="w-4 h-4" /> Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <OverviewCard 
                title="Contrat Actif" 
                value={!canReadContracts ? "Accès restreint" : (activeContract ? activeContract.contractType : "Aucun contrat actif")} 
                subtitle={!canReadContracts ? "Permission requise" : (activeContract ? `Depuis le ${formatDateSafe(activeContract.startDate)}` : "Dossier incomplet")}
                icon={FileText}
                color="blue"
              />
              <OverviewCard 
                title="Status CPI / UniLav" 
                value={cpiValue} 
                subtitle={cpiSubtitle}
                icon={ShieldCheck}
                color="orange"
                status={hasHistoricalUniLav ? 'completed' : cpi?.status}
              />
              <OverviewCard 
                title="Documents GED" 
                value={!canReadDocs ? "—" : (allDocs?.length || 0)} 
                subtitle={!canReadDocs ? "Accès restreint" : "Fichiers archivés"}
                icon={FolderOpen}
                color="indigo"
              />
              <OverviewCard 
                title="Dernière mutation" 
                value={formatDateSafe(employee.updatedAt)} 
                subtitle="Mise à jour dossier"
                icon={RefreshCcw}
                color="teal"
              />
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-2 border-primary/5 rounded-[2.5rem] shadow-xl shadow-primary/5 overflow-hidden">
                 <CardHeader className="bg-primary/5 border-b py-6 px-8">
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                       <User className="w-4 h-4" /> Résumé du profil
                    </CardTitle>
                 </CardHeader>
                 <CardContent className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <DetailItem label="Email professionnel" value={employee.email} icon={Mail} />
                    <DetailItem label="Téléphone" value={employee.phone} icon={Phone} />
                    <DetailItem label="Département" value={employee.departmentName} icon={Building2} />
                    <DetailItem label="Site de rattachement" value={employee.worksiteName} icon={MapPin} />
                    <DetailItem label="Identifiant Fiscal" value={employee.taxCode} icon={Fingerprint} className="font-mono uppercase" />
                    <DetailItem label="Poste source" value={employee.jobTitle} icon={Briefcase} />
                 </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="border-primary/5 rounded-[2.5rem] bg-secondary/5 overflow-hidden">
                  <CardHeader className="py-6 px-8">
                      <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <Globe className="w-4 h-4" /> Espace Employé
                      </CardTitle>
                  </CardHeader>
                  <CardContent className="px-8 pb-8 space-y-4">
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase text-muted-foreground opacity-60">Statut du compte</p>
                        <div className="flex items-center gap-2">
                           {renderAccountStatus(employee.accountStatus)}
                        </div>
                      </div>
                      
                      {employee.accountStatus === 'invited' && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-1">
                           <p className="text-[9px] font-black text-blue-700 uppercase">Invitation envoyée</p>
                           <p className="text-[10px] text-blue-600 font-medium">Le {formatDateSafe(employee.invitedAt)}</p>
                        </div>
                      )}

                      {(!employee.accountStatus || employee.accountStatus === 'no_account') && (
                        <div className="space-y-3 pt-2">
                           <p className="text-[10px] text-muted-foreground leading-relaxed">
                              Invitez ce collaborateur à activer son espace personnel pour poser ses congés et consulter ses documents.
                           </p>
                           <Button 
                             onClick={handleInviteToEspaceEmploye} 
                             disabled={inviting || !employee.email} 
                             className="w-full rounded-xl font-bold gap-2 shadow-lg shadow-primary/10"
                           >
                              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              Inviter à l'Espace Employé
                           </Button>
                           {!employee.email && <p className="text-[9px] text-red-500 font-bold text-center uppercase">Email requis pour l'invitation</p>}
                        </div>
                      )}
                  </CardContent>
                </Card>

                <Card className="border-primary/5 rounded-[2.5rem] bg-secondary/5 overflow-hidden">
                  <CardHeader className="py-6 px-8">
                      <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Prochaines échéances
                      </CardTitle>
                  </CardHeader>
                  <CardContent className="px-8 pb-8 space-y-4">
                      {!canReadContracts ? (
                        <p className="text-xs italic text-muted-foreground">Accès restreint aux dates contractuelles.</p>
                      ) : activeContract?.endDate ? (
                        <div className="p-4 bg-white rounded-2xl border shadow-sm flex items-center gap-3">
                            <div className="bg-orange-100 p-2 rounded-xl text-orange-600"><Calendar className="w-4 h-4" /></div>
                            <div>
                              <p className="text-[10px] font-black uppercase text-muted-foreground">Fin de contrat CDD</p>
                              <p className="text-sm font-bold text-slate-800">{formatDateSafe(activeContract.endDate)}</p>
                            </div>
                        </div>
                      ) : (
                        <p className="text-xs italic text-muted-foreground">Aucune échéance contractuelle proche.</p>
                      )}
                      <Separator className="opacity-50" />
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Modules conformité</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs opacity-40 grayscale pointer-events-none">
                            <span className="flex items-center gap-2"><Shield className="w-3.5 h-3.5" /> Sécurité / DPI</span>
                            <Badge variant="outline" className="text-[8px]">À venir</Badge>
                        </div>
                      </div>
                  </CardContent>
                </Card>
              </div>
           </div>
        </TabsContent>

        <TabsContent value="career" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
           {!canReadContracts ? (
             <AccessDeniedSection permission="contracts.read" />
           ) : (
             <>
               <div className="space-y-4">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1">Engagement Actif</h3>
                  {activeContract ? (
                    <Card className="border-primary/20 bg-primary/95 text-white rounded-[2.5rem] shadow-2xl shadow-primary/20 overflow-hidden">
                       <CardContent className="p-10">
                          <div className="flex flex-col md:flex-row justify-between gap-10">
                             <div className="space-y-6 flex-1">
                                <div className="space-y-1">
                                   <div className="flex items-center gap-2">
                                      <FileSignature className="w-5 h-5 text-accent" />
                                      <h4 className="text-2xl font-black">{activeContract.contractType}</h4>
                                   </div>
                                   <p className="text-white/60 font-medium text-sm">{activeContract.ccnlName} • Niveau {activeContract.levelCode}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-8">
                                   <DetailItemWhite label="Début" value={formatDateSafe(activeContract.startDate)} icon={Calendar} />
                                   <DetailItemWhite label="Fin" value={formatDateSafe(activeContract.endDate)} icon={Clock} />
                                   <DetailItemWhite label="Temps de travail" value={`${activeContract.weeklyHours}h / semaine`} icon={Clock} />
                                   <DetailItemWhite label="Lieu" value={activeContract.worksiteName} icon={MapPin} />
                                </div>
                             </div>
                             <div className="md:w-px md:bg-white/10" />
                             <div className="md:w-64 space-y-6 text-right md:text-left">
                                <div className="space-y-1">
                                   <p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Rémunération Brute</p>
                                   <p className="text-3xl font-black">€ {activeContract.grossAnnual?.toLocaleString('fr-FR')}</p>
                                   <p className="text-xs text-white/40">{activeContract.monthlyPayments} mensualités</p>
                                </div>
                                <Button asChild variant="outline" className="w-full bg-white/10 border-white/20 hover:bg-white/20 text-white font-bold rounded-xl gap-2">
                                   <Link href={`/entity/${entityId}/contracts/${activeContract.contractId}`}>
                                      <Eye className="w-4 h-4" /> Voir document complet
                                   </Link>
                                </Button>
                             </div>
                          </div>
                       </CardContent>
                    </Card>
                  ) : (
                    <Card className="border-dashed border-2 py-12 rounded-[2rem] bg-secondary/5">
                       <div className="text-center space-y-3">
                          <AlertTriangle className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                          <p className="text-sm font-bold text-muted-foreground">Aucun contrat actif pour le moment.</p>
                       </div>
                    </Card>
                  )}
               </div>

               <div className="space-y-4">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1">Historique des avenants & contrats</h3>
                  <Card className="border-primary/5 rounded-[2rem] overflow-hidden shadow-xl shadow-primary/5 bg-white">
                     <Table>
                        <TableHeader className="bg-secondary/20">
                           <TableRow>
                              <TableHead className="text-[10px] font-black uppercase">Statut</TableHead>
                              <TableHead className="text-[10px] font-black uppercase">Type</TableHead>
                              <TableHead className="text-[10px] font-black uppercase">Periodo</TableHead>
                              <TableHead className="text-[10px] font-black uppercase text-right">Actions</TableHead>
                           </TableRow>
                        </TableHeader>
                        <TableBody>
                           {!contractHistory || contractHistory.length === 0 ? (
                             <TableRow><TableCell colSpan={4} className="text-center py-10 text-xs italic text-muted-foreground">Aucun historique contractuel.</TableCell></TableRow>
                           ) : (
                             contractHistory.map(c => (
                               <TableRow key={c.contractId} className="hover:bg-muted/50 transition-colors">
                                  <TableCell>{getContractStatusBadge(c.status)}</TableCell>
                                  <TableCell>
                                     <p className="font-bold text-xs">{c.contractType}</p>
                                     <p className="text-[9px] text-muted-foreground uppercase">{c.ccnlName} • {c.levelCode}</p>
                                  </TableCell>
                                  <TableCell className="text-xs font-medium">
                                     {formatDateSafe(c.startDate)} <ArrowRight className="w-3 h-3 inline mx-1 opacity-30" /> {formatDateSafe(c.endDate)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                     <Button variant="ghost" size="sm" asChild className="h-8 rounded-lg font-bold">
                                        <Link href={`/entity/${entityId}/contracts/${c.contractId}`}>Détails</Link>
                                     </Button>
                                  </TableCell>
                               </TableRow>
                             ))
                           )}
                        </TableBody>
                     </Table>
                  </Card>
               </div>
             </>
           )}
        </TabsContent>

        <TabsContent value="recruitment" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card className="border-primary/5 rounded-[2.5rem] shadow-xl shadow-primary/5 overflow-hidden bg-white">
                 <CardHeader className="bg-primary/5 border-b py-5 px-8">
                    <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                       <Search className="w-4 h-4" /> Origine du recrutement
                    </CardTitle>
                 </CardHeader>
                 <CardContent className="p-8 space-y-8">
                    {!candidate && !offer ? (
                      <div className="flex flex-col items-center py-6 text-center space-y-3">
                         <div className="bg-secondary/30 p-4 rounded-full"><UserPlus className="w-8 h-8 text-muted-foreground/40" /></div>
                         <div>
                            <p className="text-sm font-bold text-primary">Saisie directe</p>
                            <p className="text-xs text-muted-foreground">Ce collaborateur a été créé manuellement dans le registre.</p>
                         </div>
                      </div>
                    ) : (
                      <>
                        {candidate && (
                          <div className="space-y-4">
                             <div className="flex items-center justify-between">
                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Snapshot Candidat</p>
                                <Badge variant="outline" className="bg-slate-50 text-[9px] uppercase font-black border-primary/10">Converti</Badge>
                             </div>
                             <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                   <div className="bg-white p-2.5 rounded-xl shadow-sm"><User className="w-5 h-5 text-primary/40" /></div>
                                   <div>
                                      <p className="text-sm font-bold text-slate-900">{candidate.displayName}</p>
                                      <p className="text-[10px] text-muted-foreground font-medium">{candidate.email}</p>
                                   </div>
                                </div>
                                <p className="text-[10px] font-bold text-muted-foreground text-right italic">Soumis le {formatDateSafe(candidate.createdAt)}</p>
                             </div>
                          </div>
                        )}
                        
                        {offer && (
                          <div className="space-y-4">
                             <div className="flex items-center justify-between">
                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Proposition initiale</p>
                                <Badge className="bg-green-600 text-white border-none text-[8px]">Acceptée</Badge>
                             </div>
                             <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                                <DetailMini label="Type contrat" value={offer.contractType} />
                                <DetailMini label="RAL initiale" value={`€ ${offer.proposedGrossAnnual?.toLocaleString('fr-FR')}`} />
                                <Button variant="outline" size="sm" asChild className="col-span-full h-9 rounded-xl font-bold bg-white mt-2">
                                   <Link href={`/entity/${entityId}/employment-offers/${offer.offerId}`}>Voir proposition source</Link>
                                </Button>
                             </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Fallback for Historical Dossier visibility */}
                    {!candidate && !offer && dossier && (
                      <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center justify-between">
                           <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Dossier RH de reprise</p>
                           <Badge variant="outline" className="bg-slate-50 text-[9px] uppercase font-black border-primary/10">Importé</Badge>
                        </div>
                        <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                           <div className="flex items-center gap-4">
                              <div className="bg-white p-2.5 rounded-xl shadow-sm"><ClipboardList className="w-5 h-5 text-primary/40" /></div>
                              <div>
                                 <p className="text-sm font-bold text-slate-800">{dossier.title || "Dossier de reprise"}</p>
                                 <p className="text-[10px] text-muted-foreground font-medium uppercase">Statut: {dossier.status.replace(/_/g, ' ')}</p>
                              </div>
                           </div>
                           <p className="text-[10px] font-bold text-muted-foreground text-right italic">Initié le {formatDateSafe(dossier.createdAt)}</p>
                        </div>
                      </div>
                    )}
                 </CardContent>
              </Card>

              {!canReadCPI ? (
                <AccessDeniedSection permission="employmentRequests.read" />
              ) : (
                <Card className="border-primary/5 rounded-[2.5rem] shadow-xl shadow-primary/5 overflow-hidden bg-white">
                  <CardHeader className="bg-secondary/10 border-b py-5 px-8">
                      <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                        <Globe className="w-4 h-4" /> Dossier Compliance (UniLav)
                      </CardTitle>
                  </CardHeader>
                  <CardContent className="p-8 space-y-6">
                      {cpi ? (
                        <>
                          <div className="flex items-center justify-between">
                             <div className="space-y-1">
                                <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Statut communication</p>
                                <p className="font-bold text-primary">{STATUS_LABELS_CPI[cpi.status] || cpi.status}</p>
                             </div>
                             <Badge variant="outline" className="h-6 px-3 bg-green-50 text-green-700 border-green-200">
                                {cpi.status === 'completed' ? 'Validé' : 'En cours'}
                             </Badge>
                          </div>
                          
                          <div className="space-y-4 pt-2">
                             <div className="grid grid-cols-2 gap-6 p-5 bg-slate-50/50 rounded-2xl border border-slate-100">
                                <div className="space-y-1">
                                   <p className="text-[9px] font-black uppercase text-muted-foreground">Protocole</p>
                                   <p className="text-xs font-mono font-bold text-slate-800">{cpi.protocolCode || "Non enregistré"}</p>
                                </div>
                                <div className="space-y-1">
                                   <p className="text-[9px] font-black uppercase text-muted-foreground">Date validation</p>
                                   <p className="text-xs font-bold text-slate-800">{formatDateSafe(cpi.cpiCommunicationDate)}</p>
                                </div>
                             </div>

                             {cpi.receiptDocumentId && canReadDocs && (
                                <Button variant="secondary" className="w-full h-11 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10 gap-2" onClick={() => {
                                   const docItem = allDocs?.find(d => d.id === cpi.receiptDocumentId);
                                   if (docItem) handleOpenDoc(docItem.storagePath, docItem.id);
                                }}>
                                   <Download className="w-4 h-4" /> Consulter le reçu PDF UniLav
                                </Button>
                             )}

                             <Button asChild variant="outline" className="w-full h-11 rounded-xl font-bold border-dashed border-2 gap-2 hover:bg-slate-50">
                                <Link href={`/entity/${entityId}/employment-requests/${cpi.id}`}>
                                   Accéder au dossier CPI <ChevronRight className="w-4 h-4" />
                                </Link>
                             </Button>
                          </div>
                        </>
                      ) : (historicalUniLavDoc ? (
                        <>
                          <div className="flex items-center justify-between">
                             <div className="space-y-1">
                                <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Document GED</p>
                                <p className="font-bold text-primary">UniLav historique / Importé</p>
                             </div>
                             <Badge variant="outline" className="h-6 px-3 bg-green-50 text-green-700 border-green-200">
                                Validé
                             </Badge>
                          </div>
                          
                          <div className="space-y-4 pt-2">
                             <div className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 flex items-center gap-4">
                                <div className="bg-white p-2.5 rounded-xl shadow-sm text-primary/40"><FileText className="w-5 h-5" /></div>
                                <div className="min-w-0 flex-1">
                                   <p className="text-sm font-bold text-slate-800 truncate">{historicalUniLavDoc.title}</p>
                                   <p className="text-[10px] text-muted-foreground">Importé le {formatDateSafe(historicalUniLavDoc.uploadedAt)}</p>
                                </div>
                             </div>

                             {canReadDocs && (
                                <Button variant="secondary" className="w-full h-11 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10 gap-2" onClick={() => handleOpenDoc(historicalUniLavDoc.storagePath, historicalUniLavDoc.id)}>
                                   <Download className="w-4 h-4" /> Consulter le reçu importé
                                </Button>
                             )}

                             <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-start gap-2">
                                <Info className="w-3.5 h-3.5 text-blue-600 mt-0.5" />
                                <p className="text-[10px] text-blue-800 leading-tight">
                                   Ce document a été rattaché manuellement ou importé lors de la reprise du dossier. Aucun flux de communication CPI n'est associé à ce record.
                                </p>
                             </div>
                          </div>
                        </>
                      ) : (
                        <div className="py-12 flex flex-col items-center text-center space-y-4 opacity-60">
                           <AlertTriangle className="w-10 h-10 text-muted-foreground/30" />
                           <div className="space-y-1">
                              <p className="text-sm font-bold">Aucun dossier UniLav lié</p>
                              <p className="text-[10px] text-muted-foreground max-w-[220px]">
                                Ce recrutement a été effectué hors plateforme ou avant l'activation du module CPI.
                              </p>
                           </div>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}
           </div>
        </TabsContent>

        <TabsContent value="compliance" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Medical Visits Card */}
              {loadingVisits ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex items-center justify-center min-h-[220px]">
                   <Loader2 className="w-6 h-6 animate-spin text-primary/20" />
                </Card>
              ) : latestMedicalVisit ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex flex-col group hover:shadow-md transition-all">
                   <div className="flex items-start justify-between mb-4">
                      <div className="bg-primary/5 p-3 rounded-2xl text-primary"><Stethoscope className="w-6 h-6" /></div>
                      {getMedicalDeadlineBadge(latestMedicalVisit)}
                   </div>
                   <div className="space-y-4 flex-1">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Dernière visite</p>
                         <div className="flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-primary/40" />
                            <span className="text-sm font-bold text-slate-800">{formatDateSafe(latestMedicalVisit.visitDate)}</span>
                         </div>
                         <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-bold uppercase border-primary/10 mt-1">
                           {MEDICAL_VISIT_TYPE_LABELS[latestMedicalVisit.visitType]}
                         </Badge>
                      </div>

                      <div className="space-y-1">
                         <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Jugement d'aptitude</p>
                         <p className="text-xs font-black text-primary bg-primary/5 px-2 py-1 rounded-lg w-fit">
                            {FITNESS_STATUS_LABELS[latestMedicalVisit.fitnessStatus]}
                         </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Échéance</p>
                            <p className="text-xs font-bold text-slate-700">{latestMedicalVisit.nextVisitDate ? formatDateSafe(latestMedicalVisit.nextVisitDate) : "À définir"}</p>
                         </div>
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Médecin</p>
                            <p className="text-xs font-bold text-slate-700 truncate" title={latestMedicalVisit.doctorName}>{latestMedicalVisit.doctorName || "—"}</p>
                         </div>
                      </div>
                   </div>
                   <Button variant="ghost" size="sm" asChild className="mt-6 w-full rounded-xl text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 gap-2">
                      <Link href={`/entity/${entityId}/medical-visits?search=${encodeURIComponent(employee.displayName)}`}>
                         Dossier complet <ChevronRight className="w-4 h-4" />
                      </Link>
                   </Button>
                </Card>
              ) : (
                <Card className="p-6 rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/30 flex flex-col items-center justify-center text-center space-y-3 min-h-[220px]">
                   <div className="bg-white p-3 rounded-2xl shadow-sm text-slate-300"><Stethoscope className="w-6 h-6" /></div>
                   <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-500">Aucune visite médicale</p>
                      <p className="text-[10px] text-slate-400">En attente de planification</p>
                   </div>
                   {hasPermission("medicalVisits.create") && (
                     <Button variant="outline" size="sm" asChild className="h-7 rounded-lg text-[9px] font-black uppercase bg-white">
                        <Link href={`/entity/${entityId}/medical-visits`}>Planifier</Link>
                     </Button>
                   )}
                </Card>
              )}

              {/* Training Summary Card */}
              {loadingTrainings ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex items-center justify-center min-h-[220px]">
                   <Loader2 className="w-6 h-6 animate-spin text-primary/20" />
                </Card>
              ) : featuredTraining ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex flex-col group hover:shadow-md transition-all">
                   <div className="flex items-start justify-between mb-4">
                      <div className="bg-primary/5 p-3 rounded-2xl text-primary"><GraduationCap className="w-6 h-6" /></div>
                      {getTrainingDeadlineBadge(featuredTraining)}
                   </div>
                   <div className="space-y-4 flex-1">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Formation prioritaire</p>
                         <h4 className="text-sm font-bold text-slate-800 line-clamp-1" title={featuredTraining.title}>{featuredTraining.title}</h4>
                         <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-bold uppercase border-primary/10 mt-1">
                           {TRAINING_TYPE_LABELS[featuredTraining.trainingType]}
                         </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Session</p>
                            <p className="text-xs font-bold text-slate-700">{formatDateSafe(featuredTraining.courseDate)}</p>
                         </div>
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Recyclage</p>
                            <p className="text-xs font-bold text-slate-700">{featuredTraining.expiryDate ? formatDateSafe(featuredTraining.expiryDate) : "Permanent"}</p>
                         </div>
                      </div>
                      
                      {featuredTraining.provider && (
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Organisme</p>
                            <p className="text-xs font-medium text-slate-500 truncate" title={featuredTraining.provider}>{featuredTraining.provider}</p>
                         </div>
                      )}
                   </div>
                   <Button variant="ghost" size="sm" asChild className="mt-6 w-full rounded-xl text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 gap-2">
                      <Link href={`/entity/${entityId}/training?search=${encodeURIComponent(employee.displayName)}`}>
                         Dossier formations <ChevronRight className="w-4 h-4" />
                      </Link>
                   </Button>
                </Card>
              ) : (
                <Card className="p-6 rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/30 flex flex-col items-center justify-center text-center space-y-3 min-h-[220px]">
                   <div className="bg-white p-3 rounded-2xl shadow-sm text-slate-300"><GraduationCap className="w-6 h-6" /></div>
                   <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-500">Aucune formation</p>
                      <p className="text-[10px] text-slate-400">Dossier formation vide</p>
                   </div>
                   {hasPermission("training.create") && (
                     <Button variant="outline" size="sm" asChild className="h-7 rounded-lg text-[9px] font-black uppercase bg-white">
                        <Link href={`/entity/${entityId}/training`}>Ajouter</Link>
                     </Button>
                   )}
                </Card>
              )}

              {/* Safety Assignment Card */}
              {loadingSafety ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex items-center justify-center min-h-[220px]">
                   <Loader2 className="w-6 h-6 animate-spin text-primary/20" />
                </Card>
              ) : !canReadSafety ? (
                <AccessDeniedSection permission="safety.read" />
              ) : featuredSafetyAssignment ? (
                <Card className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex flex-col group hover:shadow-md transition-all">
                   <div className="flex items-start justify-between mb-4">
                      <div className="bg-primary/5 p-3 rounded-2xl text-primary"><Shield className="w-6 h-6" /></div>
                      {getSafetyDeadlineBadge(featuredSafetyAssignment)}
                   </div>
                   <div className="space-y-4 flex-1">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Équipement de sécurité</p>
                         <h4 className="text-sm font-bold text-slate-800 line-clamp-1" title={featuredSafetyAssignment.dpiName}>{featuredSafetyAssignment.dpiName}</h4>
                         <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-bold uppercase border-primary/10 mt-1">
                           {featuredSafetyAssignment.riskType}
                         </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Remise</p>
                            <p className="text-xs font-bold text-slate-700">{formatDateSafe(featuredSafetyAssignment.deliveryDate)}</p>
                         </div>
                         <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Remplacement</p>
                            <p className="text-xs font-bold text-slate-700">{featuredSafetyAssignment.plannedReplacementDate ? formatDateSafe(featuredSafetyAssignment.plannedReplacementDate) : "Permanent"}</p>
                         </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase text-muted-foreground">PV :</span>
                        {featuredSafetyAssignment.reportDocumentId ? (
                          <span className="text-[9px] font-bold text-green-600 uppercase flex items-center gap-1"><FileCheck className="w-3 h-3" /> Signé</span>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 uppercase italic">Non joint</span>
                        )}
                      </div>
                   </div>
                   <Button variant="ghost" size="sm" asChild className="mt-6 w-full rounded-xl text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 gap-2">
                      <Link href={`/entity/${entityId}/safety?search=${encodeURIComponent(employee.displayName)}`}>
                         Dossier EPI/DPI <ChevronRight className="w-4 h-4" />
                      </Link>
                   </Button>
                </Card>
              ) : (
                <Card className="p-6 rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/30 flex flex-col items-center justify-center text-center space-y-3 min-h-[220px]">
                   <div className="bg-white p-3 rounded-2xl shadow-sm text-slate-300"><Shield className="w-6 h-6" /></div>
                   <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-500">Aucun EPI/DPI remis</p>
                      <p className="text-[10px] text-slate-400">Registre de sécurité vide</p>
                   </div>
                   {hasPermission("safety.create") && (
                     <Button variant="outline" size="sm" asChild className="h-7 rounded-lg text-[9px] font-black uppercase bg-white">
                        <Link href={`/entity/${entityId}/safety`}>Assigner</Link>
                     </Button>
                   )}
                </Card>
              )}
           </div>
           
           <Card className="border-dashed border-2 bg-secondary/5 rounded-[2.5rem] py-12">
              <div className="text-center max-sm mx-auto space-y-3">
                 <Info className="w-10 h-10 text-muted-foreground/20 mx-auto" />
                 <h3 className="font-bold text-primary">Dossier de Compliance</h3>
                 <p className="text-xs text-muted-foreground leading-relaxed">
                   Les modules de suivi réglementaire (Aptitude médicale, formation sécurité, remise des DPI) sont désormais partiellement intégrés.
                 </p>
              </div>
           </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-0 animate-in fade-in slide-in-from-bottom-2">
           {!canReadDocs ? (
             <AccessDeniedSection permission="documents.read" />
           ) : (
             <Card className="rounded-[2rem] border-primary/5 shadow-xl shadow-primary/5 overflow-hidden bg-white">
                <DocumentsTable 
                  docs={allDocs || []} 
                  loadingId={loadingActionId} 
                  onOpen={handleOpenDoc}
                  employee={employee}
                />
             </Card>
           )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-0 animate-in fade-in slide-in-from-bottom-2">
           <div className="max-w-3xl auto py-8">
              {!permissionsReady ? (
                 <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
              ) : !canReadPersons ? (
                <AccessDeniedSection permission="persons.read" />
              ) : (
                <PersonTimeline entityId={entityId} personId={employee.personId} />
              )}
           </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewCard({ title, value, subtitle, icon: Icon, color, status }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
    teal: "bg-teal-50 text-teal-700 border-teal-100"
  };

  return (
    <Card className="border-primary/5 shadow-sm rounded-[2rem] bg-white group hover:shadow-md transition-all">
      <CardContent className="p-6">
         <div className="flex items-start justify-between mb-4">
            <div className={cn("p-3 rounded-2xl border", colors[color])}>
               <Icon className="w-5 h-5" />
            </div>
         </div>
         <div className="space-y-1">
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{title}</p>
            <p className="text-sm font-black text-primary truncate leading-none py-1">{value}</p>
            <p className="text-[10px] font-bold text-slate-400">{subtitle}</p>
         </div>
      </CardContent>
    </Card>
  );
}

function DetailItem({ label, value, icon: Icon, className }: { label: string, value: any, icon?: any, className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/30" />}
         <span className="truncate">{value || "Non renseigné"}</span>
      </div>
    </div>
  );
}

function DetailItemWhite({ label, value, icon: Icon }: { label: string, value: any, icon?: any }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black uppercase text-white/40 tracking-widest">{label}</p>
      <div className="flex items-center gap-2 text-xs font-black">
         {Icon && <Icon className="w-3.5 h-3.5 opacity-40" />}
         <span className="truncate">{value || "-"}</span>
      </div>
    </div>
  );
}

function DetailMini({ label, value }: { label: string, value: any }) {
   return (
      <div className="space-y-0.5">
         <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
         <p className="text-xs font-bold text-slate-800 truncate">{value || "-"}</p>
      </div>
   );
}

function CompliancePlaceholderCard({ title, icon: Icon }: { title: string, icon: any }) {
   return (
      <div className="p-6 rounded-[2rem] border border-primary/5 bg-white shadow-sm flex flex-col items-center justify-center gap-3 grayscale opacity-50 cursor-not-allowed">
         <div className="bg-secondary p-3 rounded-2xl"><Icon className="w-5 h-5 text-muted-foreground" /></div>
         <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{title}</p>
         <Badge variant="secondary" className="text-[8px] font-black uppercase bg-slate-100">À venir</Badge>
      </div>
   );
}

function AccessDeniedSection({ permission }: { permission: string }) {
   return (
      <div className="p-12 rounded-[2rem] bg-red-50/50 border border-red-100 border-dashed flex flex-col items-center justify-center text-center space-y-3">
         <Lock className="w-10 h-10 text-red-200" />
         <div>
            <p className="text-sm font-black text-red-800 uppercase tracking-widest">Accès restreint</p>
            <p className="text-xs text-red-600/70 font-medium">Vous n'avez pas la permission <code className="bg-red-100 px-1 rounded">{permission}</code> requise.</p>
         </div>
      </div>
   );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white font-black text-[10px] h-6 px-3">ACTIF</Badge>;
    case 'suspended': return <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200 font-black text-[10px] h-6 px-3">SUSPENDU</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 font-black text-[10px] h-6 px-3">TERMINE</Badge>;
    default: return <Badge variant="outline" className="font-black text-[10px] h-6 px-3">{status.toUpperCase()}</Badge>;
  }
}

function renderAccountStatus(status?: string) {
  switch (status) {
    case 'active': return <Badge className="bg-green-600 text-white font-bold h-6 border-none">Compte actif</Badge>;
    case 'invited': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 font-bold h-6 border-blue-100">Invité</Badge>;
    case 'disabled': return <Badge variant="destructive" className="font-bold h-6">Désactivé</Badge>;
    default: return <Badge variant="outline" className="text-muted-foreground font-medium h-6">Sans accès</Badge>;
  }
}

function getContractStatusBadge(status: string) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="text-[8px] h-4 bg-slate-100 text-slate-500 uppercase font-black px-2">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="text-[8px] h-4 bg-orange-50 text-orange-600 border-orange-200 uppercase font-black px-2">Signature</Badge>;
    case 'pending_activation': return <Badge variant="secondary" className="text-[8px] h-4 bg-indigo-50 text-indigo-700 border-indigo-200 uppercase font-black px-2">Activation</Badge>;
    case 'active': return <Badge className="text-[8px] h-4 bg-green-500 text-white border-none uppercase font-black px-2">Actif</Badge>;
    case 'renewed': return <Badge variant="secondary" className="text-[8px] h-4 bg-blue-50 text-blue-700 border-blue-200 uppercase font-black px-2">Renouvelé</Badge>;
    case 'expired': return <Badge variant="outline" className="text-[8px] h-4 bg-slate-100 text-slate-500 uppercase font-black px-2">Expiré</Badge>;
    case 'terminated': return <Badge variant="destructive" className="text-[8px] h-4 bg-red-50 text-red-700 border-red-200 uppercase font-black px-2">Terminé</Badge>;
    default: return <Badge variant="outline" className="text-[8px] h-4 uppercase font-black px-2">{status}</Badge>;
  }
}

const STATUS_LABELS_CPI: Record<string, string> = {
  draft: "Brouillon",
  sent_to_consultant: "Envoyé consultant",
  communication_done: "Communication faite",
  completed: "Dossier clôturé",
  cancelled: "Annulé"
};

function DocumentsTable({ docs, loadingId, onOpen, employee }: { docs: HRDocument[], loadingId: string | null, onOpen: any, employee?: Employee }) {
  const params = useParams();
  const entityId = params?.entityId as string;

  return (
    <Table>
      <TableHeader className="bg-secondary/10">
        <TableRow>
          <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8">Document</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Type</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Échéance</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Statut</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Ajouté le</TableHead>
          <TableHead className="text-right pr-8 text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!docs || docs.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground italic text-xs">Aucun document rattaché.</TableCell></TableRow>
        ) : (
          docs.map(d => {
            const isLoading = loadingId === d.id;
            const isContractDoc = ['signed_contract', 'generated_contract_pdf', 'unilav_receipt', 'cpi_receipt'].includes(d.documentType) || d.relatedModule === 'contracts';
            
            const contractLabel = renderContractContext(d, employee, true) as string | null;
            const subtitle = contractLabel || d.employeeDisplayName || "Général";

            const rawExpiry = d.expiresAt || (d as any).expirationDate || (d as any).dueDate || (d as any).deadline;
            const expiryDate = parseSafeDate(rawExpiry);
            const isExpired = expiryDate && isBefore(expiryDate, startOfDay(new Date()));
            const isExpiringSoon = expiryDate && !isExpired && differenceInDays(expiryDate, startOfDay(new Date())) <= 60;

            return (
              <TableRow key={d.id} className="hover:bg-muted/50 transition-colors group">
                <TableCell className="pl-8 py-4">
                  <div className="flex items-center gap-2">
                     <div className="font-bold text-slate-800 text-sm truncate max-w-[250px]">{d.title}</div>
                     {renderContractContext(d, employee)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                     <div className="text-[9px] text-muted-foreground font-mono truncate max-w-[150px]">{d.fileName}</div>
                     <span className="text-slate-200 text-[8px]">•</span>
                     <div className="text-[9px] text-muted-foreground font-medium">{subtitle}</div>
                  </div>
                </TableCell>
                <TableCell>
                   <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-black uppercase text-muted-foreground/60">{DOCUMENT_TYPE_LABELS[d.documentType] || d.documentType}</span>
                      {d.contractStartDate && (
                         <span className="text-[9px] font-bold text-muted-foreground/50 italic">
                           Période: {formatDateSafe(d.contractStartDate)} {d.contractEndDate ? `- ${formatDateSafe(d.contractEndDate)}` : ''}
                         </span>
                      )}
                   </div>
                </TableCell>
                <TableCell>
                   {expiryDate ? (
                     <div className={cn("text-xs font-black", isExpired ? "text-red-600" : "text-orange-600" : "text-slate-600")}>
                        {formatDateSafe(rawExpiry)}
                        {isExpired && <AlertTriangle className="w-3 h-3 inline ml-1 align-text-bottom" />}
                     </div>
                   ) : (
                     <span className="text-[10px] text-muted-foreground/30">—</span>
                   )}
                </TableCell>
                <TableCell>
                   <Badge variant="outline" className={cn("text-[8px] uppercase font-black h-4", d.status === 'valid' ? "bg-green-50 text-green-700" : "bg-slate-50")}>
                     {STATUS_LABELS[d.status] || d.status}
                   </Badge>
                </TableCell>
                <TableCell className="text-[10px] font-medium text-slate-500">
                   {formatDateSafe(d.uploadedAt || d.createdAt)}
                </TableCell>
                <TableCell className="text-right pr-8">
                   <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isContractDoc && d.contractId && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" asChild title="Gérer le contrat">
                           <Link href={`/entity/${entityId}/contracts/${d.contractId}`}>
                              <Briefcase className="w-4 h-4" />
                           </Link>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onOpen(d.storagePath, d.id)} disabled={!!loadingId} title="Ouvrir">
                         {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                   </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
