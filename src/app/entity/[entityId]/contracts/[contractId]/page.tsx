"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, 
  Briefcase, Building2, FileSignature,
  Euro, Clock, History as LucideHistory, 
  Scale, Fingerprint, Calendar, FileText,
  MapPin, CheckCircle2, Ban, Archive, 
  RefreshCcw, RefreshCw, ScrollText, Globe,
  Edit, Save, X, AlertTriangle, ExternalLink,
  Upload, FileCode, Download, Eye,
  ChevronRight, FileCheck,
  Plus, ShieldCheck, Mail, Send,
  MoreVertical,
  RotateCcw,
  XCircle,
  Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc, useUser, useCollection, useAuth } from "@/firebase";
import { doc, DocumentReference, collection, query, where, Query, limit } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Person } from "@/types/person";
import { EmploymentOffer } from "@/types/employment-offer";
import { HRDocument, DOCUMENT_TYPE_LABELS, STATUS_LABELS } from "@/types/hr-document";
import { EmploymentRequest } from "@/types/employment-request";
import { getDocumentDownloadUrl, uploadHRDocument } from "@/services/document.service";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  sendContractToSignature, 
  activateContractAction, 
  terminateContractAction, 
  archiveContractAction,
  rollbackToDraft,
  updateContract,
  recordSignedDocumentReference,
  prepareContractRenewalAction,
  executeContractTransitionTransaction,
  recordContractSentToEmployee
} from "@/services/contract.service";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { format, isBefore, startOfDay, addDays } from "date-fns";
import { fr } from "date-fns/locale";
import { getLevelsForCcnlAction } from "@/app/actions/ccnl-actions";
import { sendContractToEmployeeAction } from "@/services/email.service";

const TERMINATION_REASONS = [
  { value: "resignation", label: "Démission" },
  { value: "dismissal", label: "Licenciement" },
  { value: "probation_failed", label: "Fin / échec période d’essai" },
  { value: "mutual_agreement", label: "Rupture conventionnelle" },
  { value: "fixed_term_end", label: "Fin de contrat à durée déterminée" },
  { value: "retirement", label: "Retraite" },
  { value: "other", label: "Autre" }
];

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
    return isNaN(d.getTime()) ? null : d;
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

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const contractId = params?.contractId as string;
  
  const { db, storage } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, entity, membership } = useActiveMembership(entityId);

  const [processing, setProcessing] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<Contract>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isValidationDialogOpen, setIsValidationDialogOpen] = useState(false);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  // Registry & Selection States
  const [activeLevels, setActiveLevels] = useState<any[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);

  // Renewal State
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false);
  const [renewalForm, setRenewalForm] = useState({
    newStartDate: "",
    newEndDate: "",
    renewalReason: ""
  });

  // Signed Doc Ref State
  const [isSignedDocModalOpen, setIsSignedDocModalOpen] = useState(false);
  const [signedDocForm, setSignedDocForm] = useState({ title: "", url: "", reference: "" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Termination State
  const [isTerminationModalOpen, setIsTerminationModalOpen] = useState(false);
  const [terminationForm, setTerminationForm] = useState({
    actualEndDate: new Date().toISOString().split('T')[0],
    terminationReason: "",
    terminationNotes: ""
  });
  const [terminationFile, setTerminationFile] = useState<File | null>(null);

  // 1. Core Data
  const contractRef = useMemo(() => 
    db && entityId && contractId ? (doc(db, `entities/${entityId}/contracts`, contractId) as DocumentReference<Contract>) : null,
  [db, entityId, contractId]);
  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  const isRenewalOverlap = useMemo(() => {
    if (!contract?.endDate || !renewalForm.newStartDate) return false;
    const oldEnd = parseSafeDate(contract.endDate);
    const newStart = parseSafeDate(renewalForm.newStartDate);
    return !!(oldEnd && newStart && newStart <= oldEnd);
  }, [contract?.endDate, renewalForm.newStartDate]);

  // 2. Registry Documents
  const canReadDocs = hasPermission("documents.read");
  const docsQuery = useMemo(() => {
    if (!db || !entityId || !contractId || !canReadDocs) return null;
    return query(
      collection(db, `entities/${entityId}/documents`), 
      where("contractId", "==", contractId)
    ) as Query<HRDocument>;
  }, [db, entityId, contractId, canReadDocs]);

  const { data: contractDocs } = useCollection<HRDocument>(docsQuery);

  // 3. Compliance Query (Proroga Tracking)
  const isRenewalContract = !!(contract?.isRenewal || contract?.previousContractId);
  const cpiQuery = useMemo(() => {
    if (!db || !entityId || !contractId || !isRenewalContract || !hasPermission("employmentRequests.read")) return null;
    return query(
      collection(db, `entities/${entityId}/employmentRequests`),
      where("contractId", "==", contractId),
      where("type", "==", "unilav_proroga"),
      limit(1)
    ) as Query<EmploymentRequest>;
  }, [db, entityId, contractId, isRenewalContract, hasPermission]);

  const { data: cpiItems } = useCollection<EmploymentRequest>(cpiQuery);
  const renewalCpi = cpiItems?.[0];

  // Grouped Documents for Display
  const groupedDocs = useMemo(() => {
    if (!contractDocs) return { signed: null, latestGenerated: null, history: [], termination: [], others: [] };

    const sorted = [...contractDocs].sort((a, b) => {
      const dateA = parseSafeDate(a.generatedAt || a.uploadedAt || a.createdAt)?.getTime() || 0;
      const dateB = parseSafeDate(b.generatedAt || b.uploadedAt || b.createdAt)?.getTime() || 0;
      return dateB - dateA;
    });

    const bundles = {
      signed: null as HRDocument | null,
      latestGenerated: null as HRDocument | null,
      history: [] as HRDocument[],
      termination: [] as HRDocument[],
      others: [] as HRDocument[]
    };

    sorted.forEach(docItem => {
      if (docItem.documentType === 'signed_contract' || (docItem.documentType as string) === 'contract') {
        if (!bundles.signed) bundles.signed = docItem;
        else bundles.others.push(docItem);
      } else if (docItem.documentType === 'generated_contract_pdf') {
        if (!bundles.latestGenerated) bundles.latestGenerated = docItem;
        else bundles.history.push(docItem);
      } else if (docItem.documentType === 'termination_document') {
        bundles.termination.push(docItem);
      } else {
        bundles.others.push(docItem);
      }
    });

    return bundles;
  }, [contractDocs]);

  // 4. Source Documents for fallbacks
  const employeeRef = useMemo(() => 
    db && contract?.employeeId ? doc(db, `entities/${entityId}/employees`, contract.employeeId) as DocumentReference<Employee> : null,
  [db, entityId, contract?.employeeId]);
  const { data: employee } = useDoc<Employee>(employeeRef);

  const personRef = useMemo(() => 
    db && entityId && contract?.personId ? doc(db, `entities/${entityId}/persons`, contract.personId) as DocumentReference<Person> : null,
  [db, entityId, contract?.personId]);
  const { data: person } = useDoc<Person>(personRef);

  const offerRef = useMemo(() => 
    db && entityId && contract?.sourceOfferId ? doc(db, `entities/${entityId}/employmentOffers`, contract.sourceOfferId) as DocumentReference<EmploymentOffer> : null,
  [db, entityId, contract?.sourceOfferId]);
  const { data: offer } = useDoc<EmploymentOffer>(offerRef);

  const communicationsQuery = useMemo(() => 
    db && contract?.sourceOfferId ? query(collection(db, `entities/${entityId}/mandatoryCommunications`), where("employmentOfferId", "==", contract.sourceOfferId)) as Query<any> : null,
  [db, entityId, contract?.sourceOfferId]);
  const { data: communications } = useCollection<any>(communicationsQuery);
  const mandatoryCommunication = communications?.find(c => c.type === "UNILAV_ASSUNZIONE");

  // Load masters for editing
  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId || !isEditing || contract?.status !== 'draft') return null;
    return query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active")) as Query<any>;
  }, [db, entityId, isEditing, contract?.status]);
  const { data: activeCcnls } = useCollection<any>(ccnlsQuery);

  // --- Derived State & Workflow Guards ---
  const canUpdate = hasPermission("contracts.update");
  const isDraft = contract?.status === 'draft';
  const isPendingSignature = contract?.status === 'pending_signature';
  const isPendingActivation = contract?.status === 'pending_activation';
  const isActive = contract?.status === 'active';
  const isTerminated = contract?.status === 'terminated';
  const isRenewed = contract?.status === 'renewed';
  const isImported = !!(contract?.source === 'direct_hr_creation' || contract?.source === 'historical_import');
  
  const today = startOfDay(new Date());
  const contractStartDate = parseSafeDate(contract?.startDate);
  const isStartDateReached = contractStartDate ? !isBefore(today, contractStartDate) : false;

  const hasSignedDoc = !!(
    contract?.signedDocumentId || 
    contract?.signedDocumentUrl || 
    contract?.signedDocumentTitle || 
    contract?.signedDocumentFileName ||
    contract?.signedDocumentStoragePath
  );

  const pdfDate = parseSafeDate(contract?.generatedPdfAt);
  const contentDate = parseSafeDate(contract?.contentUpdatedAt);
  const isPdfObsolete = !!(pdfDate && contentDate && isBefore(pdfDate, contentDate));

  const contractExpiryDate = parseSafeDate(contract?.endDate);
  const isContractExpired = !!(isActive && contractExpiryDate && isBefore(contractExpiryDate, today));
  const isContractExpiringSoon = !!(isActive && contractExpiryDate && !isContractExpired && isBefore(contractExpiryDate, addDays(today, 30)));

  const isFixedTermCDD = ['Tempo determinato', 'fixed_term', 'CDD'].includes(contract?.contractType || '');
  const canShowRenewButton = !!(isFixedTermCDD && 
    ['active', 'terminated', 'suspended', 'pending_signature', 'pending_activation', 'expired'].includes(contract?.status || '') && 
    !contract?.renewedByContractId && 
    !contract?.pendingRenewalContractId && 
    canUpdate);

  const canSendToEmployee = !!(!isEditing && !isImported && (isPendingSignature || isPendingActivation) && !!contract?.generatedPdfStoragePath && !isPdfObsolete);

  // Activation Guard Logic
  const activationBlockers = useMemo(() => {
    const list: { label: string; type: 'error' | 'warning' | 'info' }[] = [];
    if (!contract || isImported) return list;

    if (!contract.generatedPdfStoragePath) {
      list.push({ label: "PDF du contrat non généré", type: 'error' });
    } else if (isPdfObsolete) {
      list.push({ label: "Le document est obsolète. Veuillez régénérer le PDF.", type: 'error' });
    }

    if (!hasSignedDoc) {
      list.push({ label: "Signature du salarié manquante", type: 'error' });
    }

    // --- UniLav Proroga Guard (Italy Compliance) ---
    if (isRenewalContract && isFixedTermCDD) {
       const cpiStatus = renewalCpi?.status;
       const isCpiDone = cpiStatus === 'completed' || cpiStatus === 'communication_done';
       if (!isCpiDone) {
          list.push({ label: "Communication UniLav/CPI de proroga non complétée.", type: 'error' });
       }
    }

    if (!contract.sentToEmployeeAt) {
      list.push({ label: "Contrat non encore envoyé au salarié par email", type: 'info' });
    }

    return list;
  }, [contract, isPdfObsolete, hasSignedDoc, isImported, isRenewalContract, isFixedTermCDD, renewalCpi]);

  const canActivateNow = activationBlockers.filter(b => b.type === 'error').length === 0;

  // Load levels securely when CCNL changes during editing
  useEffect(() => {
    async function fetchLevels() {
      const ccnlId = formData.ccnlId;
      if (!ccnlId || !entityId || !user) {
        setActiveLevels([]);
        return;
      }

      setLoadingLevels(true);
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error("Auth token missing");
        
        const levels = await getLevelsForCcnlAction(entityId, ccnlId, idToken);
        setActiveLevels(levels);

        if (!formData.ccnlId && formData.ccnlName && activeCcnls) {
           const match = activeCcnls.find((c: any) => c.name === formData.ccnlName);
           if (match) setFormData(p => ({...p, ccnlId: match.ccnlId}));
        }
      } catch (err: any) {
        console.error("Error fetching levels:", err);
      } finally {
        setLoadingLevels(false);
      }
    }

    if (isEditing && contract?.status === 'draft') {
       fetchLevels();
    }
  }, [formData.ccnlId, isEditing, contract?.status, entityId, user, activeCcnls, auth.currentUser]);

  const getEffectiveValue = (field: keyof Contract, fallback?: any) => {
    const val = contract?.[field];
    if (val !== undefined && val !== null && val !== "") return val;
    return fallback;
  };

  const effectiveData = useMemo(() => {
    if (!contract) return {} as any;

    const companyAddress = entity ? `${entity.adresseSiegeSocial || ""}, ${entity.codePostal || ""} ${entity.ville || ""} (${entity.province || ""})` : "";
    const employeeAddress = person ? `${person.address || ""}, ${person.postalCode || ""} ${person.city || ""} (${person.province || ""})` : "";

    return {
      entityLegalName: getEffectiveValue('entityLegalName', entity?.raisonSociale || entity?.legalName),
      entityName: getEffectiveValue('entityName', entity?.nomEntreprise || entity?.name),
      entityVatNumber: getEffectiveValue('entityVatNumber', entity?.numeroTVA),
      companyAddressSnapshot: getEffectiveValue('companyAddressSnapshot', companyAddress),
      legalRepresentativeName: getEffectiveValue('legalRepresentativeName', entity?.referentEntreprise),
      
      employeeDisplayName: getEffectiveValue('employeeDisplayName', employee?.displayName || person?.displayName),
      employeeCode: getEffectiveValue('employeeCode', employee?.employeeCode),
      taxCode: getEffectiveValue('taxCode', employee?.taxCode || person?.codiceFiscale),
      employeeAddressSnapshot: getEffectiveValue('employeeAddressSnapshot', employeeAddress),
      dateOfBirth: getEffectiveValue('dateOfBirth', person?.dateOfBirth || (person as any)?.birthDate),
      placeOfBirth: getEffectiveValue('placeOfBirth', person?.placeOfBirth),

      jobTitleName: getEffectiveValue('jobTitleName', offer?.jobTitleName || employee?.jobTitle),
      departmentName: getEffectiveValue('departmentName', offer?.departmentName || employee?.departmentName),
      jobTitleId: getEffectiveValue('jobTitleId' as any, (offer as any)?.jobTitleId || employee?.jobRoleId),
      departmentId: getEffectiveValue('departmentId' as any, offer?.departmentId || employee?.departmentId),
      worksiteName: getEffectiveValue('worksiteName', offer?.worksiteName || employee?.worksiteName),
      contractType: getEffectiveValue('contractType', offer?.contractType),
      startDate: getEffectiveValue('startDate', offer?.proposedStartDate || employee?.hireDate),
      endDate: getEffectiveValue('endDate', offer?.proposedEndDate),
      weeklyHours: getEffectiveValue('weeklyHours', offer?.weeklyHours),
      trialPeriodDays: getEffectiveValue('trialPeriodDays', offer?.trialPeriodDays),
      isPartTime: getEffectiveValue('isPartTime', offer?.workingTime?.toLowerCase().includes('part')),

      ccnlId: getEffectiveValue('ccnlId', offer?.ccnlId),
      ccnlName: getEffectiveValue('ccnlName', offer?.ccnlName),
      levelId: getEffectiveValue('levelId', offer?.levelId),
      levelCode: getEffectiveValue('levelCode', offer?.levelCode),
      levelLabel: getEffectiveValue('levelLabel', offer?.levelLabel),
      qualificationCategory: getEffectiveValue('qualificationCategory', offer?.qualificationLabel),

      grossMonthly: getEffectiveValue('grossMonthly', offer?.proposedGrossMonthly),
      grossAnnual: getEffectiveValue('grossGrossAnnual' as any, offer?.proposedGrossAnnual),
      monthlyPayments: getEffectiveValue('monthlyPayments', offer?.monthlyPayments || 13),

      uniLavProtocolNumber: getEffectiveValue('uniLavProtocolNumber', mandatoryCommunication?.protocolNumber),
      uniLavSubmissionDate: getEffectiveValue('uniLavSubmissionDate', mandatoryCommunication?.submittedAt ? 
        (mandatoryCommunication.submittedAt.seconds ? new Date(mandatoryCommunication.submittedAt.seconds * 1000).toISOString().split('T')[0] : mandatoryCommunication.submittedAt) : ""),
      uniLavReceiptUrl: getEffectiveValue('uniLavReceiptUrl', mandatoryCommunication?.receiptPdfUrl),
      missionsSnapshot: getEffectiveValue('missionsSnapshot', []),
      workingScheduleNotes: getEffectiveValue('workingScheduleNotes', ""),
      overtimeNote: getEffectiveValue('overtimeNote', ""),
    };
  }, [contract, entity, employee, person, offer, mandatoryCommunication]);

  useEffect(() => {
    if (contract && contract.endDate) {
      const nextDay = addDays(parseSafeDate(contract.endDate) || new Date(), 1);
      setRenewalForm(p => ({
        ...p,
        newStartDate: nextDay.toISOString().split('T')[0]
      }));
    }
  }, [contract]);

  const handleGeneratePdf = async () => {
    if (!user || !entityId || !contractId) return;
    setGeneratingPdf(true);
    try {
      // Step 1: Save all effective content snapshots before generation
      await updateContract(entityId, contractId, effectiveData, user.uid);

      // Step 2: Trigger PDF generation API
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/entities/${entityId}/contracts/${contractId}/generate-pdf`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Generation failed");
      
      toast({ title: "PDF Généré", description: `Version ${result.version} prête pour signature.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur PDF", description: err.message });
    } finally {
      setGeneratingPdf(false);
    }
  };

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

  const handleEnterEditMode = () => {
    if (contract) {
      setFormData({
        ...contract,
        ...effectiveData
      });
      setIsEditing(true);
    }
  };

  const handleCcnlChange = (id: string) => {
    if (id === "none_clear") {
       setFormData(p => ({...p, ccnlId: "", ccnlName: "", levelId: "", levelCode: "", levelLabel: ""}));
       return;
    }
    const ccnl = activeCcnls?.find((c: any) => c.ccnlId === id);
    setFormData(p => ({
      ...p,
      ccnlId: id,
      ccnlName: ccnl?.name || "",
      levelId: "",
      levelCode: "",
      levelLabel: "",
      monthlyPayments: ccnl?.monthlyPayments || p.monthlyPayments || 13
    }));
  };

  const handleLevelChange = (id: string) => {
    if (id === "none_clear") {
       setFormData(p => ({ ...p, levelId: "", levelCode: "", levelLabel: "", qualificationCategory: "" }));
       return;
    }
    const level = activeLevels?.find((l: any) => l.id === id);
    if (!level) return;

    setFormData(p => {
       const monthly = level.minimumGrossMonthly || 0;
       const payments = p.monthlyPayments || 13;
       return {
         ...p,
         levelId: id,
         levelCode: level.levelCode || "",
         levelLabel: level.label || "",
         qualificationCategory: level.qualificationLabel || "",
         grossMonthly: monthly,
         grossAnnual: monthly * payments
       };
    });
  };

  const handleMonthlySalaryChange = (val: string) => {
    const amount = parseFloat(val) || 0;
    setFormData(p => ({
      ...p,
      proposedGrossMonthly: amount,
      proposedGrossAnnual: amount * (p.monthlyPayments || 13)
    }));
  };

  const formatDate = (val: any) => {
    if (!val) return "-";
    try {
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const [y, m, d] = val.split('-');
        return `${d}/${m}/${y}`;
      }
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      return "-";
    }
  };

  const formatDateTime = (val: any) => {
    if (!val) return "-";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleString('fr-FR', { 
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return "-";
    }
  };

  const getUserLabel = (uid: string | undefined) => {
    if (!uid) return "-";
    if (uid === "system" || uid === "candidate_portal" || uid === "server") return "Système";
    return "Utilisateur interne";
  };

  const validateContractForSignature = () => {
    const missing: string[] = [];
    const data = effectiveData;

    if (!data.employeeDisplayName) missing.push("Nom salarié manquant — à corriger depuis la fiche employé.");
    if (!data.taxCode) missing.push("Code fiscal manquant — à corriger depuis la fiche employé.");
    if (!data.contractType) missing.push("Type de contrat manquant — à corriger depuis la proposition source.");
    if (!data.startDate) missing.push("Date de début manquante — à corriger depuis la proposition source.");
    if (!data.jobTitleName) missing.push("Intitulé du poste manquant — à corriger depuis la proposition source.");
    if (!data.worksiteName) missing.push("Site d'affectation manquant — à corriger depuis la proposition source.");
    if (!data.ccnlName) missing.push("Convention collective (CCNL) manquante — à corriger depuis la proposition source.");
    if (!data.weeklyHours) missing.push("Temps de travail manquant — à corriger depuis la proposition source.");
    if (!data.grossMonthly && !data.grossAnnual) missing.push("Rémunération manquante — à corriger depuis la proposition source.");

    if (!data.entityLegalName) missing.push("Raison sociale de l'employeur manquante — à compléter dans le contrat ou la fiche entreprise.");
    if (!data.companyAddressSnapshot) missing.push("Adresse du siège manquante — à compléter dans le contrat ou la fiche entreprise.");
    if (!data.employeeAddressSnapshot) missing.push("Adresse de résidence manquante — à compléter dans le contrat.");

    return missing;
  };

  const handleTransitionToSignature = async () => {
    if (!contract) return;

    const missing = validateContractForSignature();
    if (missing.length > 0) {
      setValidationErrors(missing);
      setIsValidationDialogOpen(true);
      return;
    }

    if (!contract.generatedPdfStoragePath) {
      setValidationErrors(["Veuillez générer le PDF du contrat avant de l’envoyer en signature."]);
      setIsValidationDialogOpen(true);
      return;
    }

    // Block if content is newer than PDF
    if (isPdfObsolete) {
      setValidationErrors(["Le contrat a été modifié après la génération du PDF. Veuillez régénérer le PDF."]);
      setIsValidationDialogOpen(true);
      return;
    }

    setProcessing(true);
    try {
      await sendContractToSignature(entityId, contractId, user!.uid);
      toast({ title: "Succès", description: "Contrat prêt pour signature." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleSendToEmployee = async () => {
    if (!user || !contract || !employee || !entityId) return;

    if (!employee.email) {
      toast({ variant: "destructive", title: "Email manquant", description: "Le salarié n'a pas d'adresse email configurée." });
      return;
    }

    if (!contract.generatedPdfStoragePath) {
      toast({ variant: "destructive", title: "Action bloquée", description: "Veuillez générer le PDF du contrat avant l’envoi." });
      return;
    }

    if (isPdfObsolete) {
      toast({ variant: "destructive", title: "Action bloquée", description: "Le PDF est obsolète. Veuillez régénérer le contrat avant l’envoi." });
      return;
    }

    setProcessing(true);
    try {
      const result = await sendContractToEmployeeAction({
        entityId,
        contractId,
        to: employee.email,
        employeeName: employee.displayName,
        companyName: entity?.nomEntreprise || "Notre Entreprise",
        jobTitle: contract.jobTitleName || "Poste",
        storagePath: contract.generatedPdfStoragePath
      });

      if (result.success) {
        await recordContractSentToEmployee(entityId, contractId, employee.email, user.uid);
        toast({ title: "Email envoyé", description: `Le contrat a été transmis à ${employee.email}.` });
      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Échec de l'envoi", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleTransition = async (action: () => Promise<any>, successMsg: string) => {
    if (!user || !contract) return;
    setProcessing(true);
    try {
      await action();
      toast({ title: "Succès", description: successMsg });
    } catch (err: any) {
      let msg = err.message || "Une erreur est survenue.";
      if (err.message === "ALREADY_HAS_ACTIVE_CONTRACT") {
        msg = "Un altro contratto attivo esiste già per questo collaboratore.";
      }
      if (err.message === "MISSING_SIGNED_DOCUMENT") {
        msg = "Veuillez enregistrer le contrat signé avant l'activation.";
      }
      toast({ variant: "destructive", title: "Erreur", description: msg });
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!user || !contract) return;
    setProcessing(true);

    if (isDraft) {
       const isFixedTerm = ['Tempo determinato', 'fixed_term', 'CDD'].includes(contract.contractType || '');
       if (isFixedTerm && !formData.endDate) {
          toast({ variant: "destructive", title: "Date manquante", description: "La date de fin est obligatoire pour un CDD." });
          setProcessing(false);
          return;
       }
       if (formData.startDate && formData.endDate) {
          const s = new Date(formData.startDate);
          const e = new Date(formData.endDate);
          if (e <= s) {
             toast({ variant: "destructive", title: "Dates invalides", description: "La date de fin doit être postérieure à la date de début." });
             setProcessing(false);
             return;
          }
       }
       if (formData.grossMonthly !== undefined && Number(formData.grossMonthly) < 0) {
          toast({ variant: "destructive", title: "Montant invalide", description: "Le salaire ne peut pas être négatif." });
          setProcessing(false);
          return;
       }
       if (formData.weeklyHours !== undefined && Number(formData.weeklyHours) < 0) {
          toast({ variant: "destructive", title: "Heures invalides", description: "Le temps de travail ne peut pas être négatif." });
          setProcessing(false);
          return;
       }
       if (formData.monthlyPayments !== undefined && Number(formData.monthlyPayments) <= 0) {
          toast({ variant: "destructive", title: "Mensualités invalides", description: "Le nombre de mensualités doit être positif." });
          setProcessing(false);
          return;
       }
    }

    try {
      const allowedKeys = [
        "entityLegalName", "entityVatNumber", "companyAddressSnapshot", 
        "legalRepresentativeName", "legalRepresentativeTitle",
        "employeeAddressSnapshot", "dateOfBirth", "placeOfBirth", "taxCode",
        "endDate", "trialPeriodDays", "trialPeriodUnit", "workingScheduleNotes",
        "qualificationCategory", "overtimeNote", "uniLavProtocolNumber", 
        "uniLavSubmissionDate", "uniLavReceiptUrl", "missionsSnapshot",
        "notes"
      ];

      if (isDraft) {
        allowedKeys.push(
          "startDate", "jobTitleName", "departmentName", "worksiteName",
          "ccnlId", "ccnlName", "levelId", "levelCode", "grossMonthly", "grossAnnual", "weeklyHours",
          "isPartTime", "monthlyPayments"
        );
      }

      const payload: any = {};
      allowedKeys.forEach(key => {
        if (formData[key as keyof Contract] !== undefined) {
          payload[key] = formData[key as keyof Contract];
        }
      });
      
      await updateContract(entityId, contractId, payload, user.uid);
      setIsEditing(false);
      toast({ title: "Modifications enregistrées" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveSignedDocRef = async () => {
    if (!user || !contract || !signedDocForm.title) return;
    
    setProcessing(true);
    try {
      let url = signedDocForm.url;
      let storagePath = null;
      let fileName = null;

      if (selectedFile && storage) {
        if (selectedFile.type !== "application/pdf") {
          throw new Error("Seuls les fichiers PDF sont acceptés.");
        }
        
        const timestamp = Date.now();
        const path = `entities/${entityId}/contracts/${contractId}/signed-contract/${timestamp}_${selectedFile.name}`;
        const fileRef = ref(storage, path);
        
        await uploadBytes(fileRef, selectedFile);
        url = await getDownloadURL(fileRef);
        storagePath = path;
        fileName = selectedFile.name;
      }

      await recordSignedDocumentReference(entityId, contractId, {
        title: signedDocForm.title,
        url,
        reference: signedDocForm.reference,
        fileName,
        storagePath,
        mimeType: selectedFile ? "application/pdf" : null
      }, user.uid);
      
      setIsSignedDocModalOpen(false);
      setSignedDocForm({ title: "", url: "", reference: "" });
      setSelectedFile(null);
      toast({ title: "Référence enregistrée", description: "Le document signé est maintenant lié au dossier." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleTerminateContract = async () => {
    if (!user || !contract || !contract.employeeId) return;
    if (!terminationForm.actualEndDate || !terminationForm.terminationReason) {
      toast({ variant: "destructive", title: "Champs manquants", description: "Veuillez renseigner la date et le motif." });
      return;
    }

    setProcessing(true);
    try {
      let documentId: string | undefined = undefined;

      if (terminationFile) {
        documentId = await uploadHRDocument(entityId, terminationFile, {
          title: "Document de clôture du contrat",
          documentType: "termination_document",
          personId: contract.personId,
          employeeId: contract.employeeId,
          contractId: contract.contractId,
          relatedModule: "contracts",
          relatedId: contract.contractId,
          status: "valid"
        }, user.uid, membership?.userDisplayName || "Utilisateur");
      }

      await terminateContractAction(
        entityId, 
        contractId, 
        contract.employeeId, 
        user.uid, 
        terminationForm,
        documentId
      );
      setIsTerminationModalOpen(false);
      setTerminationFile(null);
      toast({ title: "Contrat terminé", description: "Le contrat est maintenant clos." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateRenewal = async () => {
    if (!user || !entityId || !contractId) return;
    if (!renewalForm.newStartDate || !renewalForm.newEndDate) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez renseigner les dates du nouveau contrat." });
      return;
    }

    setProcessing(true);
    try {
      const result = await prepareContractRenewalAction(entityId, contractId, {
        newStartDate: renewalForm.newStartDate,
        newEndDate: renewalForm.newEndDate,
        renewalReason: renewalForm.renewalReason,
        actorUid: user.uid
      });

      toast({ title: "Brouillon de renouvellement créé" });
      setIsRenewalModalOpen(false);
      router.push(`/entity/${entityId}/contracts/${result.newContractId}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleUploadHistoricalContract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !contract) return;

    if (file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "Format invalide", description: "Veuillez uploader un fichier PDF." });
      return;
    }

    setProcessing(true);
    try {
      const docId = await uploadHRDocument(
        entityId, 
        file, 
        {
          title: "Contrat signé historique",
          documentType: "signed_contract",
          status: "valid",
          relatedModule: "contracts",
          relatedId: contractId,
          contractId: contractId,
          employeeId: contract.employeeId,
          personId: contract.personId,
          contractStartDate: contract.startDate,
          contractEndDate: contract.endDate || null,
          expiresAt: contract.endDate || null,
          preHireDossierId: contract.preHireDossierId || null,
          source: contract.source,
          isSensitive: true,
          isRequired: true
        },
        user.uid,
        membership?.userDisplayName || "Utilisateur"
      );

      toast({ title: "Document rattaché", description: "Le contrat signé a été ajouté au dossier historique." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleUploadHistoricalUniLav = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !contract) return;

    if (file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "Format invalide", description: "Veuillez envoyer un fichier PDF." });
      return;
    }

    setProcessing(true);
    try {
      const docId = await uploadHRDocument(
        entityId, 
        file, 
        {
          title: "Reçu UniLav historique",
          documentType: "unilav_receipt",
          status: "valid",
          relatedModule: "contracts",
          relatedId: contractId,
          contractId: contractId,
          employeeId: contract.employeeId,
          personId: contract.personId,
          contractStartDate: contract.startDate,
          contractEndDate: contract.endDate || null,
          preHireDossierId: contract.preHireDossierId || null,
          source: contract.source,
          isSensitive: true,
          isRequired: true
        },
        user.uid,
        membership?.userDisplayName || "Utilisateur"
      );

      toast({ title: "Document rattaché", description: "Le reçu UniLav historique a été ajouté au dossier." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  if (membershipLoading || loadingContract) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!contract) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><FileText className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Contrat introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/contracts`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const businessReference = contract.employeeCode || effectiveData.employeeCode || "Brouillon d'intégration";

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/contracts`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Détails du Contrat</h1>
              {getStatusBadge(contract.status as ContractStatus)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">Référence : {businessReference}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
           {isEditing ? (
             <>
               <Button variant="ghost" onClick={() => { setIsEditing(false); setFormData(contract); }} disabled={!!processing}>Annuler</Button>
               <Button onClick={handleSave} disabled={!!processing} className="gap-2 bg-green-600 text-white font-bold rounded-xl px-6">
                 {!!processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                 Enregistrer
               </Button>
             </>
           ) : (
             <>
                {isDraft && (
                  <Button variant="outline" onClick={handleEnterEditMode} className="gap-2 bg-white rounded-xl font-bold" disabled={!!processing}>
                    <Edit className="w-4 h-4" /> Éditer les informations
                  </Button>
                )}
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button variant="outline" size="icon" className="rounded-xl"><MoreVertical className="w-4 h-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                     <div className="px-2 py-1.5 text-[10px] font-black uppercase text-muted-foreground opacity-60">Actions de gestion</div>
                     {(isPendingSignature || isPendingActivation) && (
                       <DropdownMenuItem onClick={() => handleTransition(() => rollbackToDraft(entityId, contractId, user!.uid), "Retour au statut brouillon.")} disabled={!!processing} className="gap-2">
                         <RotateCcw className="w-4 h-4" /> Retour en brouillon
                       </DropdownMenuItem>
                     )}
                     {isActive && (
                       <DropdownMenuItem onClick={() => setIsTerminationModalOpen(true)} disabled={!!processing} className="gap-2 text-destructive font-bold">
                         <Ban className="w-4 h-4" /> Résilier / Terminer
                       </DropdownMenuItem>
                     )}
                     {canUpdate && (isDraft || isTerminated || isRenewed || isActive) && (
                        <DropdownMenuItem onClick={() => handleTransition(() => archiveContractAction(entityId, contractId, user!.uid), "Contrat archivé.")} disabled={!!processing} className="gap-2">
                           <Archive className="w-4 h-4" /> Archiver
                        </DropdownMenuItem>
                     )}
                  </DropdownMenuContent>
                </DropdownMenu>
             </>
           )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          
          {/* Alerts Area */}
          {!!isContractExpired && (
            <Alert variant="destructive" className="rounded-2xl border-none shadow-lg bg-red-600 text-white animate-in fade-in slide-in-from-top-2">
              <AlertTriangle className="h-5 w-5 text-white" />
              <div className="ml-2">
                <AlertTitle className="font-black uppercase text-xs tracking-widest">Contrat arrivé à échéance</AlertTitle>
                <AlertDescription className="text-sm opacity-90">
                  Le terme du contrat ({formatDateSafe(contract.endDate)}) est dépassé.
                </AlertDescription>
              </div>
            </Alert>
          )}
          
          {isTerminated && (
            <Card className="border-red-200 bg-red-50/10 rounded-[2rem] overflow-hidden shadow-sm mb-8">
               <CardHeader className="bg-red-50 border-b py-4 px-8 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-red-700 flex items-center gap-2">
                     <Ban className="w-4 h-4" /> Détails de la clôture
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                     <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-red-600/60 tracking-widest">Date de fin réelle</p>
                        <p className="text-sm font-bold text-slate-800">{formatDate(contract.actualEndDate)}</p>
                     </div>
                     <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-red-600/60 tracking-widest">Motif de fin</p>
                        <p className="text-sm font-bold text-slate-800">
                          {TERMINATION_REASONS.find(r => r.value === contract.terminationReason)?.label || contract.terminationReason || "Non renseigné"}
                        </p>
                     </div>
                  </div>
               </CardContent>
            </Card>
          )}

          {/* WORKFLOW SECTION 1: Document de travail (PDF) */}
          {!isImported && (isDraft || isPendingSignature || isPendingActivation) && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl transition-all", !contract.generatedPdfStoragePath ? "border-orange-100 bg-orange-50/5" : "border-primary/10")}>
              <CardHeader className="bg-primary/5 border-b py-5 px-8 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                    <FileCode className="w-4 h-4" /> 1. Document de travail (PDF)
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {!!isPdfObsolete ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[8px] font-black uppercase">PDF Obsolète</Badge>
                    ) : contract.generatedPdfStoragePath ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[8px] font-black uppercase">PDF à jour</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 text-slate-400 border-slate-200 text-[8px] font-black uppercase">Non généré</Badge>
                    )}
                  </div>
              </CardHeader>
              <CardContent className="p-8">
                  <div className="space-y-6">
                    {contract.generatedPdfStoragePath && (
                      <div className="flex items-center justify-between gap-6 p-4 bg-white rounded-2xl border shadow-sm group">
                        <div className="flex items-center gap-4 min-w-0">
                            <div className="bg-primary/5 p-3 rounded-2xl text-primary"><FileText className="w-5 h-5" /></div>
                            <div className="min-w-0">
                              <p className="text-sm font-black text-slate-800 truncate">{contract.generatedPdfFileName}</p>
                              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-0.5">V{contract.generatedPdfVersion} — {formatDateTime(contract.generatedPdfAt)}</p>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" asChild className="rounded-xl font-bold opacity-0 group-hover:opacity-100 transition-all">
                            <a href={contract.generatedPdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-1.5" /> Voir le PDF</a>
                        </Button>
                      </div>
                    )}

                    {!!isPdfObsolete && (
                      <Alert className="bg-orange-50 border-orange-200 rounded-xl">
                        <AlertTriangle className="h-4 w-4 text-orange-600" />
                        <AlertDescription className="text-xs font-bold text-orange-800">
                          Le contrat a été modifié. Le PDF actuel est obsolète. Veuillez régénérer le document.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="flex flex-wrap gap-3">
                       <Button onClick={handleGeneratePdf} disabled={!!(generatingPdf || isEditing)} className="h-11 rounded-xl font-black gap-2 px-6">
                          {!!generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                          {contract.generatedPdfStoragePath ? "Régénérer le PDF" : "Générer le PDF du contrat"}
                       </Button>

                       {isDraft && (
                         <Button 
                           onClick={handleTransitionToSignature}
                           disabled={!!(processing || generatingPdf || !contract.generatedPdfStoragePath || isPdfObsolete)}
                           variant="outline"
                           className="h-11 rounded-xl font-bold text-accent border-accent/20 hover:bg-accent/5 gap-2"
                         >
                           <FileSignature className="w-4 h-4" /> Prêt pour signature
                         </Button>
                       )}

                       {!!canSendToEmployee && (
                         <Button 
                           onClick={handleSendToEmployee}
                           variant="outline"
                           className="h-11 rounded-xl font-bold text-primary border-primary/20 hover:bg-primary/5 gap-2"
                           disabled={!!processing}
                         >
                           <Send className="w-4 h-4" /> Envoyer au salarié
                         </Button>
                       )}
                    </div>
                  </div>
              </CardContent>
            </Card>
          )}

          {/* WORKFLOW SECTION 2: Signature Placement */}
          {(isPendingSignature || isPendingActivation || (!isDraft && !isImported)) && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl transition-all", !!hasSignedDoc ? "border-green-100 bg-green-50/5" : "border-primary/10")}>
              <CardHeader className="bg-primary/5 border-b py-5 px-8 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                  <FileSignature className="w-4 h-4" /> 2. Signature du salarié
                </CardTitle>
                <div className="flex items-center gap-2">
                   {!!hasSignedDoc ? (
                     <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[8px] font-black uppercase">Document signé reçu</Badge>
                   ) : contract.sentToEmployeeAt ? (
                     <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[8px] font-black uppercase">Envoyé au salarié</Badge>
                   ) : (
                     <Badge variant="outline" className="bg-slate-100 text-slate-400 border-slate-200 text-[8px] font-black uppercase">Attente de signature</Badge>
                   )}
                </div>
              </CardHeader>
              <CardContent className="p-8">
                {!!hasSignedDoc ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-6 p-5 bg-white rounded-2xl border shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="bg-green-100 p-3 rounded-2xl text-green-600"><CheckCircle2 className="w-6 h-6" /></div>
                        <div>
                           <p className="text-sm font-black text-slate-800">{contract.signedDocumentTitle}</p>
                           <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">Reçu le {formatDateTime(contract.signedDocumentUploadedAt)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {contract.signedDocumentUrl && (
                          <Button variant="ghost" size="sm" asChild className="rounded-xl font-bold">
                            <a href={contract.signedDocumentUrl} target="_blank" rel="noopener noreferrer"><Eye className="w-4 h-4 mr-1.5" /> Voir</a>
                          </Button>
                        )}
                        {(isPendingSignature || isPendingActivation) && (
                          <Button variant="outline" size="sm" onClick={() => setIsSignedDocModalOpen(true)} className="rounded-xl font-bold border-dashed h-9" disabled={!!processing}>Remplacer le document</Button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-slate-50/50 border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center gap-4 text-center group hover:bg-slate-100 transition-all cursor-pointer" onClick={() => (isPendingSignature || isPendingActivation) && setIsSignedDocModalOpen(true)}>
                       <div className="bg-white p-4 rounded-2xl shadow-sm text-primary/30 group-hover:text-primary transition-colors"><Upload className="w-8 h-8" /></div>
                       <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-600">Téléverser le contrat signé</p>
                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Obligatoire pour l'activation finale</p>
                       </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* WORKFLOW SECTION 3: Finalisation & Activation */}
          {!isActive && !isTerminated && !isRenewed && (isPendingSignature || isPendingActivation) && (
             <Card className={cn("border-2 rounded-[2.5rem] shadow-2xl overflow-hidden transition-all", !!canActivateNow ? "border-green-500 ring-4 ring-green-50" : "border-primary/10 opacity-80")}>
                <CardHeader className={cn("py-6 px-8 border-b", !!canActivateNow ? "bg-green-600 text-white" : "bg-primary/90 text-white")}>
                   <div className="flex items-center gap-3">
                      <div className="bg-white/20 p-2.5 rounded-xl"><ShieldCheck className="w-6 h-6" /></div>
                      <CardTitle className="text-xl font-black">3. Finalisation & Activation</CardTitle>
                   </div>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                   {activationBlockers.length > 0 ? (
                      <div className="space-y-3">
                         <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Actions requises avant activation :</p>
                         <div className="space-y-2">
                            {activationBlockers.map((b, i) => (
                              <div key={i} className={cn("flex items-start gap-3 text-xs font-bold p-3 rounded-xl border", 
                                b.type === 'error' ? "text-red-600 bg-red-50 border-red-100" : "text-blue-700 bg-blue-50 border-blue-100")}>
                                 {b.type === 'error' ? <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
                                 <span>{b.label}</span>
                              </div>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-start gap-3 animate-in zoom-in-95">
                         <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
                         <p className="text-sm font-bold text-green-800 leading-tight">Le dossier est prêt. Le contrat est signé et le PDF est à jour. Vous pouvez désormais activer l'engagement.</p>
                      </div>
                   )}

                   {isRenewalContract && isPendingActivation ? (
                     isStartDateReached ? (
                       <Button onClick={() => handleTransition(() => executeContractTransitionTransaction(entityId, contractId, user!.uid), "Renouvellement activé.")} disabled={!!(processing || !canActivateNow)} className="w-full h-16 rounded-2xl text-lg font-black bg-primary text-white shadow-xl">
                          {!!processing ? <Loader2 className="w-6 h-6 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                          Activer le renouvellement maintenant
                       </Button>
                     ) : (
                        <div className="flex flex-col items-center gap-4 py-4">
                           <div className="bg-indigo-50 text-indigo-700 px-6 py-4 rounded-2xl border border-indigo-100 flex items-center gap-4 w-full">
                              <Clock className="w-8 h-8 opacity-40" />
                              <div>
                                 <p className="text-xs font-black uppercase tracking-widest">Activation automatique prévue</p>
                                 <p className="text-lg font-black">Le {formatDateSafe(contract.startDate)}</p>
                              </div>
                           </div>
                        </div>
                     )
                   ) : (
                     <Button 
                       onClick={() => handleTransition(() => activateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat activé.")}
                       disabled={!!(processing || !canActivateNow)}
                       className={cn("w-full h-16 rounded-2xl text-lg font-black shadow-xl transition-all", 
                         !!canActivateNow ? "bg-green-600 hover:bg-green-700 text-white" : "bg-slate-100 text-slate-300"
                       )}
                     >
                        {!!processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                        Confirmer signature et activer le contrat
                     </Button>
                   )}
                </CardContent>
             </Card>
          )}

          {/* Historical Import Special Card */}
          {isImported && isActive && (
            <Card className="border-primary/20 bg-primary/5 rounded-[2rem] overflow-hidden shadow-md">
               <CardContent className="p-8 flex items-start gap-5">
                  <div className="bg-primary text-white p-3 rounded-2xl shadow-lg shadow-primary/20"><ShieldCheck className="w-6 h-6" /></div>
                  <div className="space-y-1 flex-1">
                     <h3 className="text-lg font-black text-primary">Contrat importé / reprise historique</h3>
                     <p className="text-sm text-slate-600 leading-relaxed">
                        Ce contrat est déjà actif car il provient d’une reprise historique.
                     </p>
                     <div className="pt-6 flex flex-wrap gap-4">
                        <div className="relative">
                          <Button disabled={!!processing} className="gap-2 rounded-xl font-bold bg-white text-primary border border-primary/10">
                            <Upload className="w-4 h-4" /> Ajouter le contrat signé historique
                          </Button>
                          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf" onChange={handleUploadHistoricalContract} />
                        </div>
                        <div className="relative">
                          <Button disabled={!!processing} variant="outline" className="gap-2 rounded-xl font-bold bg-white text-primary border border-primary/10">
                            <FileText className="w-4 h-4" /> Ajouter reçu UniLav historique
                          </Button>
                          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf" onChange={handleUploadHistoricalUniLav} />
                        </div>
                     </div>
                  </div>
               </CardContent>
            </Card>
          )}

          {/* Standard Information Sections */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Employeur
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Raison Sociale" value={effectiveData.entityLegalName} editValue={formData.entityLegalName} isEditing={isEditing} id="entityLegalName" required onChange={(v: string) => setFormData(p => ({...p, entityLegalName: v}))} />
                   <DetailEditable label="Nom commercial" value={effectiveData.entityName} editValue={formData.entityName} isEditing={isEditing} id="entityName" onChange={(v: string) => setFormData(p => ({...p, entityName: v}))} />
                   <DetailEditable label="Numéro TVA / Code Fiscal" value={effectiveData.entityVatNumber} editValue={formData.entityVatNumber} isEditing={isEditing} id="entityVatNumber" onChange={(v: string) => setFormData(p => ({...p, entityVatNumber: v}))} />
                   <DetailEditable label="Représentant Légal" value={effectiveData.legalRepresentativeName} editValue={formData.legalRepresentativeName} isEditing={isEditing} id="legalRepresentativeName" onChange={(v: string) => setFormData(p => ({...p, legalRepresentativeName: v}))} />
                   <DetailEditable label="Adresse du Siège" value={effectiveData.companyAddressSnapshot} editValue={formData.companyAddressSnapshot} isEditing={isEditing} id="companyAddressSnapshot" required className="col-span-full" onChange={(v: string) => setFormData(p => ({...p, companyAddressSnapshot: v}))} />
                </div>
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Salarié
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Nom Complet" value={effectiveData.employeeDisplayName} editValue={formData.employeeDisplayName} isEditing={isEditing} id="employeeDisplayName" disabled required onChange={(v: string) => setFormData(p => ({...p, employeeDisplayName: v}))} />
                   <DetailEditable label="Code Fiscal / ID National" value={effectiveData.taxCode} editValue={formData.taxCode} isEditing={isEditing} id="taxCode" required disabled={!!effectiveData.taxCode} className="font-mono uppercase" onChange={(v: string) => setFormData(p => ({...p, taxCode: v}))} />
                   <DetailEditable label="Date de Naissance" value={effectiveData.dateOfBirth} editValue={formData.dateOfBirth} isEditing={isEditing} id="dateOfBirth" type="date" disabled={!!effectiveData.dateOfBirth} onChange={(v: string) => setFormData(p => ({...p, dateOfBirth: v}))} />
                   <DetailEditable label="Lieu de Naissance" value={effectiveData.placeOfBirth} editValue={formData.placeOfBirth} isEditing={isEditing} id="placeOfBirth" onChange={(v: string) => setFormData(p => ({...p, placeOfBirth: v}))} />
                   <DetailEditable label="Adresse de Résidence" value={effectiveData.employeeAddressSnapshot} editValue={formData.employeeAddressSnapshot} isEditing={isEditing} id="employeeAddressSnapshot" required className="col-span-full" onChange={(v: string) => setFormData(p => ({...p, employeeAddressSnapshot: v}))} />
                </div>
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Briefcase className="w-4 h-4" /> Poste & Lieu de Travail
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Intitulé du Poste" value={effectiveData.jobTitleName} editValue={formData.jobTitleName} isEditing={isEditing} id="jobTitleName" disabled={!isDraft} required icon={Briefcase} onChange={(v: string) => setFormData(p => ({...p, jobTitleName: v}))} />
                   <DetailEditable label="Département" value={effectiveData.departmentName} editValue={formData.departmentName} isEditing={isEditing} id="departmentName" disabled={!isDraft} icon={Building2} onChange={(v: string) => setFormData(p => ({...p, departmentName: v}))} />
                   <DetailEditable label="Site d'Affectation" value={effectiveData.worksiteName} editValue={formData.worksiteName} isEditing={isEditing} id="worksiteName" disabled={!isDraft} required icon={MapPin} className="col-span-full" onChange={(v: string) => setFormData(p => ({...p, worksiteName: v}))} />
                </div>
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <ScrollText className="w-4 h-4" /> Conditions & Classification
                </CardTitle>
                {!!canShowRenewButton && !isEditing && (
                  <Button variant="outline" size="sm" onClick={() => setIsRenewalModalOpen(true)} className="h-8 rounded-xl font-bold bg-white text-accent border-accent/20" disabled={!!processing}>
                    <RefreshCcw className="w-3.5 h-3.5 mr-2" /> Renouveler CDD
                  </Button>
                )}
             </CardHeader>
             <CardContent className="p-8 space-y-12">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Type de Contrat" value={effectiveData.contractType} editValue={formData.contractType} isEditing={isEditing} id="contractType" disabled required onChange={(v: string) => setFormData(p => ({...p, contractType: v}))} />
                   <DetailEditable label="Date de Début" value={effectiveData.startDate} editValue={formData.startDate} isEditing={isEditing} id="startDate" type="date" disabled={!isDraft} required icon={Calendar} onChange={(v: string) => setFormData(p => ({...p, startDate: v}))} />
                   <DetailEditable label="Date de Fin (Optionnel)" value={effectiveData.endDate} editValue={formData.endDate} isEditing={isEditing} id="endDate" type="date" disabled={!isDraft && effectiveData.contractType !== 'Tempo determinato'} icon={Calendar} onChange={(v: string) => setFormData(p => ({...p, endDate: v}))} />
                </div>
             </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <LucideHistory className="w-4 h-4" /> Historique & Audit
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <AuditRow label="Créé le" value={formatDateTime(contract.createdAt)} />
                <AuditRow label="Auteur" value={getUserLabel(contract.createdBy)} />
                {contract.sentToEmployeeAt && (
                   <div className="space-y-1 pt-2 border-t border-dashed">
                      <AuditRow label="Envoyé salarié" value={formatDateTime(contract.sentToEmployeeAt)} />
                      <p className="text-[8px] text-accent font-bold text-right truncate">{contract.sentToEmployeeEmail}</p>
                   </div>
                )}
                {contract.activatedAt && <AuditRow label="Activé le" value={formatDateTime(contract.activatedAt)} />}
                {contract.terminatedAt && <AuditRow label="Clôturé le" value={formatDateTime(contract.terminatedAt)} />}
                <Separator className="opacity-20" />
                <AuditRow label="Dernière modif." value={formatDateTime(contract.updatedAt)} />
             </CardContent>
          </Card>

          {/* Proroga Tracking Sidebar Card */}
          {isRenewalContract && renewalCpi && (
            <Card className="border-primary/5 rounded-[2rem] shadow-lg bg-white overflow-hidden animate-in fade-in slide-in-from-right-2">
               <CardHeader className="py-4 border-b bg-green-50/50">
                  <CardTitle className="text-[10px] font-black uppercase tracking-widest text-green-700 flex items-center gap-2">
                     <Globe className="w-4 h-4" /> Compliance Proroga
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-6 space-y-4">
                  <div className="space-y-1">
                     <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Statut UniLav</p>
                     {getStatusBadgeCpi(renewalCpi.status)}
                  </div>
                  <div className="space-y-1 pt-2 border-t border-dashed">
                     <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Protocole</p>
                     <p className="text-xs font-mono font-bold text-slate-800 truncate">{renewalCpi.protocolCode || "Non enregistré"}</p>
                  </div>
                  <Button asChild variant="secondary" className="w-full h-9 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary/10 text-xs gap-2">
                     <Link href={`/entity/${entityId}/employment-requests/${renewalCpi.id}`}>
                        Voir le dossier CPI <ChevronRight className="w-3.5 h-3.5" />
                     </Link>
                  </Button>
               </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Standard Dialogs */}
      <Dialog open={isValidationDialogOpen} onOpenChange={setIsValidationDialogOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" /> Dossier incomplet
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="max-h-[300px] rounded-xl border p-4 bg-slate-50">
               <ul className="space-y-2">
                  {validationErrors.map((err, i) => (
                    <li key={i} className="text-xs font-bold text-slate-700 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" /> {err}
                    </li>
                  ))}
               </ul>
            </ScrollArea>
          </div>
          <DialogFooter><Button onClick={() => setIsValidationDialogOpen(false)} className="w-full rounded-xl">Corriger</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modals: Renewal, SignedDoc, Termination */}
      <Dialog open={isRenewalModalOpen} onOpenChange={setIsRenewalModalOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader><DialogTitle className="text-xl font-black text-primary">Renouveler le contrat</DialogTitle></DialogHeader>
          <div className="py-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Début</Label>
                <Input type="date" value={renewalForm.newStartDate} onChange={(e) => setRenewalForm(p => ({...p, newStartDate: e.target.value}))} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Fin</Label>
                <Input type="date" value={renewalForm.newEndDate} onChange={(e) => setRenewalForm(p => ({...p, newEndDate: e.target.value}))} required className="h-11 rounded-xl" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black">Motif</Label>
              <Textarea value={renewalForm.renewalReason} onChange={(e) => setRenewalForm(p => ({...p, renewalReason: e.target.value}))} className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setIsRenewalModalOpen(false)}>Annuler</Button>
             <Button onClick={handleCreateRenewal} disabled={!!processing} className="rounded-xl px-8 font-black">Créer brouillon</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSignedDocModalOpen} onOpenChange={setIsSignedDocModalOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader><DialogTitle className="text-xl font-black text-primary">Enregistrer signature</DialogTitle></DialogHeader>
          <div className="py-6 space-y-6">
            <div className="space-y-2">
               <Label className="text-[10px] uppercase font-black">Titre du document</Label>
               <Input value={signedDocForm.title} onChange={(e) => setSignedDocForm(p => ({...p, title: e.target.value}))} placeholder="Contrat_Signé.pdf" className="rounded-xl h-11" />
            </div>
            <div className="space-y-2">
               <Label className="text-[10px] uppercase font-black">Fichier PDF</Label>
               <Input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="h-11 rounded-xl pt-2" />
            </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setIsSignedDocModalOpen(false)}>Annuler</Button>
             <Button onClick={handleSaveSignedDocRef} disabled={!!(processing || !signedDocForm.title)} className="rounded-xl px-8 font-black">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTerminationModalOpen} onOpenChange={setIsTerminationModalOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader><DialogTitle className="text-xl font-black text-red-600">Terminer le contrat</DialogTitle></DialogHeader>
          <div className="py-6 space-y-4">
             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Date de fin réelle</Label>
                <Input type="date" value={terminationForm.actualEndDate} onChange={(e) => setTerminationForm(p => ({...p, actualEndDate: e.target.value}))} className="h-11 rounded-xl" />
             </div>
             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Motif</Label>
                <Select value={terminationForm.terminationReason} onValueChange={(v: string) => setTerminationForm(p => ({...p, terminationReason: v}))}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{TERMINATION_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
             </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setIsTerminationModalOpen(false)}>Annuler</Button>
             <Button onClick={handleTerminateContract} disabled={!!processing} className="bg-red-600 text-white rounded-xl px-8 font-black">Confirmer clôture</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailEditable({ label, value, editValue, isEditing, id, type = "text", required = false, disabled = false, icon: Icon, className, onChange }: any) {
  const displayValue = value === undefined || value === null || value === "" ? "Non renseigné" : value;
  const isMissing = required && (value === undefined || value === null || value === "");

  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={cn("text-[10px] font-black uppercase tracking-tight mb-1 opacity-70", isMissing && "text-red-600 opacity-100")}>{label} {required && "*"}</Label>
      {isEditing ? (
        disabled ? <div className="h-10 px-3 bg-secondary/30 rounded-xl flex items-center text-xs font-bold text-muted-foreground border border-dashed cursor-not-allowed">{displayValue}</div> :
        <Input 
          id={id} 
          type={type} 
          value={editValue ?? ""} 
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} 
          className={cn("h-10 rounded-xl bg-white", isMissing && "border-red-300")} 
        />
      ) : (
        <div className={cn("flex items-center gap-2 text-sm font-bold", isMissing ? "text-red-400 italic" : "text-slate-800")}>
           {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />} {displayValue}
        </div>
      )}
    </div>
  );
}

function AuditRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
       <span className="text-muted-foreground font-medium">{label}</span>
       <span className="font-bold text-slate-700 text-right ml-2">{value}</span>
    </div>
  );
}

function getStatusBadge(status: ContractStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 uppercase font-black text-[9px] px-2">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase font-black text-[9px] px-2">Signature</Badge>;
    case 'pending_activation': return <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 uppercase font-black text-[9px] px-2">Activation</Badge>;
    case 'active': return <Badge className="bg-green-500 text-white border-none uppercase font-black text-[9px] px-2">Actif</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}

function getStatusBadgeCpi(status: string) {
  switch (status) {
    case 'completed': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 text-[8px] font-black uppercase">Validé</Badge>;
    case 'communication_done': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[8px] font-black uppercase">Fait</Badge>;
    default: return <Badge variant="outline" className="text-[8px] font-black uppercase">{status}</Badge>;
  }
}
