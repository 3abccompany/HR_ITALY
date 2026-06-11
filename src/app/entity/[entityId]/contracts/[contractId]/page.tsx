"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Briefcase, Building2, FileSignature,
  Info, Euro, Clock, History, 
  Scale, Fingerprint, Calendar, FileText,
  MapPin, CheckCircle2, Ban, Archive, 
  RefreshCcw, ScrollText, Globe,
  Edit, Save, X, AlertTriangle, ExternalLink,
  Upload, FileCode, Download, Eye, FileBadge,
  ChevronDown, FolderOpen, FileCheck,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFirebase, useDoc, useUser, useCollection, useAuth } from "@/firebase";
import { doc, DocumentReference, collection, query, where, Query } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { Person } from "@/types/person";
import { EmploymentOffer } from "@/types/employment-offer";
import { HRDocument, DOCUMENT_TYPE_LABELS, STATUS_LABELS } from "@/types/hr-document";
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
  recordSignedDocumentReference
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
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from "@/components/ui/collapsible";
import { format, isBefore, startOfDay, differenceInDays, addDays } from "date-fns";
import { fr } from "date-fns/locale";

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

  // 3. Source Documents for fallbacks
  const employeeRef = useMemo(() => 
    db && contract?.employeeId ? doc(db, `entities/${entityId}/employees`, contract.employeeId) as DocumentReference<Employee> : null,
  [db, entityId, contract?.employeeId]);
  const { data: employee } = useDoc<Employee>(employeeRef);

  const personRef = useMemo(() => 
    db && contract?.personId ? doc(db, `entities/${entityId}/persons`, contract.personId) as DocumentReference<Person> : null,
  [db, entityId, contract?.personId]);
  const { data: person } = useDoc<Person>(personRef);

  const offerRef = useMemo(() => 
    db && contract?.sourceOfferId ? doc(db, `entities/${entityId}/employmentOffers`, contract.sourceOfferId) as DocumentReference<EmploymentOffer> : null,
  [db, entityId, contract?.sourceOfferId]);
  const { data: offer } = useDoc<EmploymentOffer>(offerRef);

  const communicationsQuery = useMemo(() => 
    db && contract?.sourceOfferId ? query(collection(db, `entities/${entityId}/mandatoryCommunications`), where("employmentOfferId", "==", contract.sourceOfferId)) as Query<any> : null,
  [db, entityId, contract?.sourceOfferId]);
  const { data: communications } = useCollection<any>(communicationsQuery);
  const mandatoryCommunication = communications?.find(c => c.type === "UNILAV_ASSUNZIONE");

  // Helper to build effective values with fallbacks
  const getEffectiveValue = (field: keyof Contract, fallback?: any) => {
    const val = contract?.[field];
    if (val !== undefined && val !== null && val !== "") return val;
    return fallback;
  };

  // Pre-fill Logic for Display & Edit
  const effectiveData = useMemo(() => {
    if (!contract) return {} as any;

    const companyAddress = entity ? `${entity.adresseSiegeSocial || ""}, ${entity.codePostal || ""} ${entity.ville || ""} (${entity.province || ""})` : "";
    const employeeAddress = person ? `${person.address || ""}, ${person.postalCode || ""} ${person.city || ""} (${person.province || ""})` : "";

    return {
      // Employer
      entityLegalName: getEffectiveValue('entityLegalName', entity?.raisonSociale || entity?.legalName),
      entityName: getEffectiveValue('entityName', entity?.nomEntreprise || entity?.name),
      entityVatNumber: getEffectiveValue('entityVatNumber', entity?.numeroTVA),
      companyAddressSnapshot: getEffectiveValue('companyAddressSnapshot', companyAddress),
      legalRepresentativeName: getEffectiveValue('legalRepresentativeName', entity?.referentEntreprise),
      
      // Employee
      employeeDisplayName: getEffectiveValue('employeeDisplayName', employee?.displayName || person?.displayName),
      employeeCode: getEffectiveValue('employeeCode', employee?.employeeCode),
      taxCode: getEffectiveValue('taxCode', employee?.taxCode || person?.codiceFiscale),
      employeeAddressSnapshot: getEffectiveValue('employeeAddressSnapshot', employeeAddress),
      dateOfBirth: getEffectiveValue('dateOfBirth', person?.dateOfBirth || (person as any)?.birthDate),
      placeOfBirth: getEffectiveValue('placeOfBirth', person?.placeOfBirth),

      // Job & Terms
      jobTitleName: getEffectiveValue('jobTitleName', offer?.jobTitleName || employee?.jobTitle),
      departmentName: getEffectiveValue('departmentName', offer?.departmentName || employee?.departmentName),
      worksiteName: getEffectiveValue('worksiteName', offer?.worksiteName || employee?.worksiteName),
      contractType: getEffectiveValue('contractType', offer?.contractType),
      startDate: getEffectiveValue('startDate', offer?.proposedStartDate || employee?.hireDate),
      endDate: getEffectiveValue('endDate', offer?.proposedEndDate),
      weeklyHours: getEffectiveValue('weeklyHours', offer?.weeklyHours),
      trialPeriodDays: getEffectiveValue('trialPeriodDays', offer?.trialPeriodDays),
      isPartTime: getEffectiveValue('isPartTime', offer?.workingTime?.toLowerCase().includes('part')),

      // Classification
      ccnlName: getEffectiveValue('ccnlName', offer?.ccnlName),
      levelCode: getEffectiveValue('levelCode', offer?.levelCode),
      levelLabel: getEffectiveValue('levelLabel', offer?.levelLabel),
      qualificationCategory: getEffectiveValue('qualificationCategory', offer?.qualificationLabel),

      // Salary
      grossMonthly: getEffectiveValue('grossMonthly', offer?.proposedGrossMonthly),
      grossAnnual: getEffectiveValue('grossAnnual', offer?.proposedGrossAnnual),
      monthlyPayments: getEffectiveValue('monthlyPayments', offer?.monthlyPayments || 13),

      // Compliance
      uniLavProtocolNumber: getEffectiveValue('uniLavProtocolNumber', mandatoryCommunication?.protocolNumber),
      uniLavSubmissionDate: getEffectiveValue('uniLavSubmissionDate', mandatoryCommunication?.submittedAt ? 
        (mandatoryCommunication.submittedAt.seconds ? new Date(mandatoryCommunication.submittedAt.seconds * 1000).toISOString().split('T')[0] : mandatoryCommunication.submittedAt) : ""),
      uniLavReceiptUrl: getEffectiveValue('uniLavReceiptUrl', mandatoryCommunication?.receiptPdfUrl),
      missionsSnapshot: getEffectiveValue('missionsSnapshot', []),
      workingScheduleNotes: getEffectiveValue('workingScheduleNotes', ""),
      overtimeNote: getEffectiveValue('overtimeNote', ""),
    };
  }, [contract, entity, employee, person, offer, mandatoryCommunication]);

  // Handle PDF Generation
  const handleGeneratePdf = async () => {
    if (!user || !entityId || !contractId) return;
    setGeneratingPdf(true);
    try {
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

  // Sync formData with best available data when entering edit mode
  const handleEnterEditMode = () => {
    if (contract) {
      setFormData({
        ...contract,
        ...effectiveData
      });
      setIsEditing(true);
    }
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

    // Check Source-controlled mandatory fields
    if (!data.employeeDisplayName) missing.push("Nom salarié manquant — à corriger depuis la fiche employé.");
    if (!data.taxCode) missing.push("Code fiscal manquant — à corriger depuis la fiche employé.");
    if (!data.contractType) missing.push("Type de contrat manquant — à corriger depuis la proposition source.");
    if (!data.startDate) missing.push("Date de début manquante — à corriger depuis la proposition source.");
    if (!data.jobTitleName) missing.push("Intitulé du poste manquant — à corriger depuis la proposition source.");
    if (!data.worksiteName) missing.push("Site d'affectation manquant — à corriger depuis la proposition source.");
    if (!data.ccnlName) missing.push("Convention collective (CCNL) manquante — à corriger depuis la proposition source.");
    if (!data.weeklyHours) missing.push("Temps de travail manquant — à corriger depuis la proposition source.");
    if (!data.grossMonthly && !data.grossAnnual) missing.push("Rémunération manquante — à corriger depuis la proposition source.");

    // Check Completion fields
    if (!data.entityLegalName) missing.push("Raison sociale de l'employeur manquante — à compléter dans le contrat ou la fiche entreprise.");
    if (!data.companyAddressSnapshot) missing.push("Adresse du siège manquante — à compléter dans le contrat ou la fiche entreprise.");
    if (!data.employeeAddressSnapshot) missing.push("Adresse de résidence manquante — à compléter dans le contrat.");

    return missing;
  };

  const handleTransitionToSignature = async () => {
    const missing = validateContractForSignature();
    if (missing.length > 0) {
      setValidationErrors(missing);
      setIsValidationDialogOpen(true);
      return;
    }

    // PDF Check - Rely on Storage Path as the URL is temporary and can expire
    if (!contract?.generatedPdfStoragePath) {
      setValidationErrors(["Veuillez générer le PDF du contrat avant de l’envoyer en signature."]);
      setIsValidationDialogOpen(true);
      return;
    }

    // Outdated Check (Content vs PDF)
    const pdfDate = parseSafeDate(contract?.generatedPdfAt);
    const contentDate = parseSafeDate(contract?.contentUpdatedAt);

    if (pdfDate && contentDate && isBefore(pdfDate, contentDate)) {
      setValidationErrors(["Le contrat a été modifié après la génération du PDF. Veuillez régénérer le PDF."]);
      setIsValidationDialogOpen(true);
      return;
    }

    // Persist any effective values (fallbacks) to the contract document before transitioning
    if (contract) {
      setProcessing(true);
      try {
        await updateContract(entityId, contractId, effectiveData, user!.uid);
        await sendContractToSignature(entityId, contractId, user!.uid);
        toast({ title: "Succès", description: "Contrat prêt pour signature." });
      } catch (err: any) {
        toast({ variant: "destructive", title: "Erreur", description: err.message });
      } finally {
        setProcessing(false);
      }
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
        msg = "Un autre contrat actif existe déjà pour cet employé.";
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
    try {
      // Build restricted update payload for legal completion only
      const allowedKeys = [
        "entityLegalName", "entityVatNumber", "companyAddressSnapshot", 
        "legalRepresentativeName", "legalRepresentativeTitle",
        "employeeAddressSnapshot", "dateOfBirth", "placeOfBirth", "taxCode",
        "endDate", "trialPeriodDays", "trialPeriodUnit", "workingScheduleNotes",
        "qualificationCategory", "overtimeNote", "uniLavProtocolNumber", 
        "uniLavSubmissionDate", "uniLavReceiptUrl", "missionsSnapshot"
      ];

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
  const canUpdate = hasPermission("contracts.update");
  const isDraft = contract?.status === 'draft';
  const isPendingSignature = contract?.status === 'pending_signature';
  const isActive = contract?.status === 'active';
  const isTerminated = contract?.status === 'terminated';
  
  const hasSignedDoc = !!(
    contract.signedDocumentId || 
    contract.signedDocumentUrl || 
    contract.signedDocumentTitle || 
    contract.signedDocumentFileName ||
    contract.signedDocumentStoragePath
  );

  const pdfDate = parseSafeDate(contract?.generatedPdfAt);
  const contentDate = parseSafeDate(contract?.contentUpdatedAt);
  const isPdfOutdated = Boolean(pdfDate && contentDate && isBefore(pdfDate, contentDate));

  // Expiry Logic
  const contractExpiryDate = parseSafeDate(contract?.endDate);
  const today = startOfDay(new Date());
  const isContractExpired = isActive && contractExpiryDate && isBefore(contractExpiryDate, today);
  const isContractExpiringSoon = isActive && contractExpiryDate && !isContractExpired && isBefore(contractExpiryDate, addDays(today, 30));

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/contracts`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Modèle de Contrat</h1>
              {getStatusBadge(contract.status as ContractStatus)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">Référence : {businessReference}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
           {isDraft && !isEditing && (
             <Button variant="outline" onClick={handleEnterEditMode} className="gap-2 bg-white rounded-xl font-bold">
                <Edit className="w-4 h-4" /> Éditer les informations
             </Button>
           )}

           {isEditing && (
             <>
               <Button variant="ghost" onClick={() => { setIsEditing(false); setFormData(contract); }} disabled={processing}>Annuler</Button>
               <Button onClick={handleSave} disabled={processing} className="gap-2 bg-green-600 text-white font-bold rounded-xl">
                 {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                 Enregistrer
               </Button>
             </>
           )}

           {!isEditing && canUpdate && isDraft && (
             <Button 
               onClick={handleTransitionToSignature}
               disabled={processing || generatingPdf}
               className="gap-2 bg-accent text-white font-bold rounded-xl"
             >
               {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
               Prêt pour signature
             </Button>
           )}

           {!isEditing && canUpdate && isPendingSignature && (
             <>
               <Button variant="outline" onClick={() => handleTransition(() => rollbackToDraft(entityId, contractId, user!.uid), "Retour au statut brouillon.")} disabled={processing} className="gap-2 bg-white rounded-xl">
                 <RefreshCcw className="w-4 h-4" /> Brouillon
               </Button>
               <Button 
                onClick={() => handleTransition(() => activateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat activé avec succès.")} 
                disabled={processing || !contract.employeeId} 
                className={cn("gap-2 text-white font-black rounded-xl", hasSignedDoc ? "bg-primary" : "bg-slate-300 opacity-70")}
               >
                 {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                 Confirmer signature et activer
               </Button>
             </>
           )}

           {!isEditing && canUpdate && isActive && (
             <Button variant="destructive" onClick={() => setIsTerminationModalOpen(true)} disabled={processing} className="gap-2 font-bold rounded-xl">
               <Ban className="w-4 h-4" /> Résilier / Terminer
             </Button>
           )}

           {!isEditing && canUpdate && (isDraft || isTerminated) && (
             <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => handleTransition(() => archiveContractAction(entityId, contractId, user!.uid), "Contrat archivé.")} disabled={processing}>
               <Archive className="w-4 h-4" />
             </Button>
           )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          
          {/* Expiry Banners */}
          {isContractExpired && (
            <Alert variant="destructive" className="rounded-2xl border-none shadow-lg bg-red-600 text-white animate-in fade-in slide-in-from-top-2">
              <AlertTriangle className="h-5 w-5 text-white" />
              <div className="ml-2">
                <AlertTitle className="font-black uppercase text-xs tracking-widest">Contrat arrivé à échéance</AlertTitle>
                <AlertDescription className="text-sm opacity-90">
                  Le terme du contrat ({formatDateSafe(contract.endDate)}) est dépassé. Veuillez régulariser la situation (renouvellement ou solde de tout compte).
                </AlertDescription>
              </div>
            </Alert>
          )}
          {isContractExpiringSoon && (
            <Alert className="rounded-2xl border-orange-200 bg-orange-50 shadow-md animate-in fade-in slide-in-from-top-2">
              <Clock className="h-5 w-5 text-orange-600" />
              <div className="ml-2">
                <AlertTitle className="font-bold text-orange-800">Échéance proche</AlertTitle>
                <AlertDescription className="text-sm text-orange-700">
                  Ce contrat arrive à échéance le <span className="font-bold">{formatDateSafe(contract.endDate)}</span> (dans {differenceInDays(contractExpiryDate!, today)} jours).
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Termination Info if terminated */}
          {isTerminated && (
            <Card className="border-red-200 bg-red-50/10 rounded-[2rem] overflow-hidden shadow-sm">
               <CardHeader className="bg-red-50 border-b py-4 px-8 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-red-700 flex items-center gap-2">
                     <Ban className="w-4 h-4" /> Détails de la clôture
                  </CardTitle>
                  {contract.terminationDocumentId && (
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="h-8 rounded-xl bg-white text-xs font-bold gap-2"
                       onClick={() => {
                         const foundDoc = contractDocs?.find(d => d.id === contract.terminationDocumentId);
                         if (foundDoc) handleOpenDoc(foundDoc.storagePath, foundDoc.id);
                         else toast({ variant: "destructive", title: "Erreur", description: "Le document est introuvable." });
                       }}
                       disabled={!!loadingActionId}
                     >
                       {loadingActionId === contract.terminationDocumentId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                       Consulter document de clôture
                     </Button>
                  )}
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
                     {contract.terminationNotes && (
                        <div className="col-span-full space-y-1">
                           <p className="text-[10px] font-black uppercase text-red-600/60 tracking-widest">Notes de clôture</p>
                           <p className="text-xs text-slate-600 bg-white p-4 rounded-xl border border-red-100">{contract.terminationNotes}</p>
                        </div>
                     )}
                  </div>
               </CardContent>
            </Card>
          )}

          {/* Generated PDF Section */}
          <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl", contract.generatedPdfStoragePath ? "border-primary/10" : "border-orange-100 bg-orange-50/5")}>
             <CardHeader className="bg-primary/5 border-b py-4 px-8 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <FileCode className="w-4 h-4" /> Document de travail (PDF)
                </CardTitle>
                {contract.generatedPdfStoragePath && (
                  <Badge variant="secondary" className="bg-white text-[9px] uppercase font-black text-primary border-primary/20">
                    PDF Généré V{contract.generatedPdfVersion}
                  </Badge>
                )}
             </CardHeader>
             <CardContent className="p-8">
                {!contract.generatedPdfStoragePath ? (
                   <div className="space-y-4">
                      <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
                         <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                         <div>
                            <p className="text-sm font-bold text-orange-800">PDF du contratto non généré</p>
                            <p className="text-xs text-orange-700">Vous devez générer la version préparée du contrat avant de pouvoir l'envoyer en signature.</p>
                         </div>
                      </div>
                      <Button onClick={handleGeneratePdf} disabled={generatingPdf || isEditing || isTerminated} className="w-full h-12 rounded-xl font-black gap-2">
                         {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
                         Générer le PDF du contratto
                      </Button>
                   </div>
                ) : (
                   <div className="space-y-6">
                      <div className="flex items-center justify-between gap-6 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                         <div className="flex items-center gap-4">
                            <div className="bg-primary text-white p-3 rounded-2xl shadow-lg shadow-primary/20"><FileText className="w-6 h-6" /></div>
                            <div>
                               <p className="text-sm font-black text-slate-800">{contract.generatedPdfFileName}</p>
                               <p className="text-[10px] text-muted-foreground font-bold uppercase mt-0.5">
                                 Généré le {formatDateTime(contract.generatedPdfAt)} par {getUserLabel(contract.generatedPdfBy)}
                               </p>
                            </div>
                         </div>
                         {contract.generatedPdfUrl && (
                           <Button variant="outline" size="sm" asChild className="rounded-xl font-bold bg-white gap-2 shadow-sm">
                              <a href={contract.generatedPdfUrl} target="_blank" rel="noopener noreferrer">
                                 <ExternalLink className="w-4 h-4" /> Consulter le PDF
                              </a>
                           </Button>
                         )}
                      </div>

                      {isPdfOutdated && !isTerminated && (
                        <Alert className="bg-orange-100/30 border-orange-200 rounded-2xl">
                           <AlertTriangle className="h-4 w-4 text-orange-600" />
                           <AlertTitle className="text-sm font-bold text-orange-800">PDF obsolète</AlertTitle>
                           <AlertDescription className="text-xs text-orange-700">
                             Des modifications ont été apportées au contrat après sa génération. Veuillez régénérer le document pour refléter les derniers termes.
                           </AlertDescription>
                        </Alert>
                      )}

                      {(isDraft || isPendingSignature) && (
                        <Button variant="outline" onClick={handleGeneratePdf} disabled={generatingPdf || isEditing} className="w-full h-11 border-primary/20 text-primary font-bold rounded-xl gap-2 hover:bg-primary/5">
                           {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                           {isPdfOutdated ? "Régénérer le PDF mis à jour" : "Régénérer une nouvelle version"}
                        </Button>
                      )}
                   </div>
                )}
             </CardContent>
          </Card>

          {/* Signed Document Section */}
          {(isPendingSignature || !isDraft) && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl", hasSignedDoc ? "border-green-100 bg-green-50/5" : "border-orange-100 bg-orange-50/5")}>
              <CardHeader className="py-4 border-b px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Document contractuel signé
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                {hasSignedDoc ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="bg-green-100 p-3 rounded-2xl text-green-600"><CheckCircle2 className="w-6 h-6" /></div>
                        <div>
                           <p className="text-sm font-black text-slate-800">{contract.signedDocumentTitle}</p>
                           {contract.signedDocumentFileName && (
                             <p className="text-[10px] font-bold text-accent uppercase flex items-center gap-1 mt-0.5">
                               <Upload className="w-2.5 h-2.5" /> {contract.signedDocumentFileName}
                             </p>
                           )}
                           <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                             Enregistré le {formatDate(contract.signedDocumentUploadedAt)} par {getUserLabel(contract.signedDocumentUploadedBy)}
                           </p>
                        </div>
                      </div>
                      {contract.signedDocumentUrl && (
                        <Button variant="outline" size="sm" asChild className="rounded-xl font-bold bg-white gap-2">
                          <a href={contract.signedDocumentUrl} target="_blank" rel="noopener noreferrer">
                             <ExternalLink className="w-4 h-4" /> Ouvrir le document
                          </a>
                        </Button>
                      )}
                    </div>
                    
                    {isPendingSignature && (
                       <Button 
                        variant="outline" 
                        onClick={() => {
                          setSignedDocForm({
                            title: contract.signedDocumentTitle || "",
                            url: contract.signedDocumentUrl || "",
                            reference: contract.signedDocumentId || ""
                          });
                          setIsSignedDocModalOpen(true);
                        }}
                        className="w-full h-11 border-dashed border-2 rounded-xl font-bold gap-2 hover:bg-slate-50"
                       >
                         <RefreshCcw className="w-4 h-4" /> Remplacer le document signé
                       </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <Alert className="bg-orange-100/30 border-orange-200 rounded-2xl">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <AlertTitle className="text-sm font-bold text-orange-800">Signature non enregistrée</AlertTitle>
                      <AlertDescription className="text-xs text-orange-700">
                        Veuillez enregistrer la référence du contrat signé avant de pouvoir procéder à l'activation.
                      </AlertDescription>
                    </Alert>
                    {isPendingSignature && (
                       <Button 
                         variant="outline" 
                         onClick={() => setIsSignedDocModalOpen(true)}
                         className="w-full h-12 border-orange-200 text-orange-700 hover:bg-orange-50 font-black rounded-xl border-dashed border-2 gap-2"
                       >
                         <FileSignature className="w-4 h-4" /> Enregistrer le contrat signé
                       </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Registry Documents History Section */}
          {canReadDocs && (
            <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
               <CardHeader className="bg-secondary/10 border-b py-4 px-8">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                     <FolderOpen className="w-4 h-4" /> Historique & Documents rattachés
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8">
                  {!contractDocs ? (
                    <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
                  ) : contractDocs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground italic">Aucun document lié à ce contrat.</div>
                  ) : (
                    <div className="space-y-8">
                       <DocumentGroup 
                         title="Contrat Signé" 
                         doc={groupedDocs.signed} 
                         onOpen={handleOpenDoc} 
                         loadingId={loadingActionId} 
                         icon={CheckCircle2}
                         colorClass="bg-green-50 text-green-600"
                       />
                       
                       <DocumentGroup 
                         title="Dernier PDF de travail" 
                         doc={groupedDocs.latestGenerated} 
                         history={groupedDocs.history}
                         onOpen={handleOpenDoc} 
                         loadingId={loadingActionId} 
                         icon={FileCode}
                         colorClass="bg-primary/5 text-primary"
                       />

                       {groupedDocs.termination.length > 0 && (
                         <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Documents de clôture</p>
                            <div className="grid gap-3">
                               {groupedDocs.termination.map(d => (
                                 <DocumentRow key={d.id} doc={d} onOpen={handleOpenDoc} onReplace={() => {}} loadingId={loadingActionId} compactVersion canReplace={false} />
                               ))}
                            </div>
                         </div>
                       )}

                       {groupedDocs.others.length > 0 && (
                         <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Autres documents liés</p>
                            <div className="grid gap-3">
                               {groupedDocs.others.map(d => (
                                 <DocumentRow key={d.id} doc={d} onOpen={handleOpenDoc} loadingId={loadingActionId} canReplace={false} onReplace={() => {}} />
                               ))}
                            </div>
                         </div>
                       )}
                    </div>
                  )}
               </CardContent>
            </Card>
          )}

          {/* Employer Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Employeur
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Raison Sociale" value={effectiveData.entityLegalName} editValue={formData.entityLegalName} isEditing={isEditing} id="entityLegalName" required onChange={(v) => setFormData(p => ({...p, entityLegalName: v}))} />
                   <DetailEditable label="Nom commercial" value={effectiveData.entityName} editValue={formData.entityName} isEditing={isEditing} id="entityName" onChange={(v) => setFormData(p => ({...p, entityName: v}))} />
                   <DetailEditable label="Numéro TVA / Code Fiscal" value={effectiveData.entityVatNumber} editValue={formData.entityVatNumber} isEditing={isEditing} id="entityVatNumber" onChange={(v) => setFormData(p => ({...p, entityVatNumber: v}))} />
                   <DetailEditable label="Représentant Légal" value={effectiveData.legalRepresentativeName} editValue={formData.legalRepresentativeName} isEditing={isEditing} id="legalRepresentativeName" onChange={(v) => setFormData(p => ({...p, legalRepresentativeName: v}))} />
                   <DetailEditable label="Adresse du Siège" value={effectiveData.companyAddressSnapshot} editValue={formData.companyAddressSnapshot} isEditing={isEditing} id="companyAddressSnapshot" required className="col-span-full" onChange={(v) => setFormData(p => ({...p, companyAddressSnapshot: v}))} />
                </div>
             </CardContent>
          </Card>

          {/* Employee Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Salarié
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Nom Complet" value={effectiveData.employeeDisplayName} editValue={formData.employeeDisplayName} isEditing={isEditing} id="employeeDisplayName" disabled required onChange={(v) => setFormData(p => ({...p, employeeDisplayName: v}))} />
                   <DetailEditable label="Code Fiscal / ID National" value={effectiveData.taxCode} editValue={formData.taxCode} isEditing={isEditing} id="taxCode" required disabled={!!effectiveData.taxCode} className="font-mono uppercase" onChange={(v) => setFormData(p => ({...p, taxCode: v}))} />
                   <DetailEditable label="Date de Naissance" value={effectiveData.dateOfBirth} editValue={formData.dateOfBirth} isEditing={isEditing} id="dateOfBirth" type="date" disabled={!!effectiveData.dateOfBirth} onChange={(v) => setFormData(p => ({...p, dateOfBirth: v}))} />
                   <DetailEditable label="Lieu de Naissance" value={effectiveData.placeOfBirth} editValue={formData.placeOfBirth} isEditing={isEditing} id="placeOfBirth" onChange={(v) => setFormData(p => ({...p, placeOfBirth: v}))} />
                   <DetailEditable label="Adresse de Résidence" value={effectiveData.employeeAddressSnapshot} editValue={formData.employeeAddressSnapshot} isEditing={isEditing} id="employeeAddressSnapshot" required className="col-span-full" onChange={(v) => setFormData(p => ({...p, employeeAddressSnapshot: v}))} />
                </div>
                {!isEditing && contract.employeeId && (
                  <div className="mt-8 pt-6 border-t flex gap-4">
                     <Link href={`/entity/${entityId}/employees/${contract.employeeId}`}>
                        <Button variant="outline" size="sm" className="h-9 rounded-xl font-bold gap-2 bg-white">
                           <UserCheck className="w-3.5 h-3.5" /> Voir Profil Employé
                        </Button>
                     </Link>
                  </div>
                )}
             </CardContent>
          </Card>

          {/* Job & workplace */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Briefcase className="w-4 h-4" /> Poste & Lieu de Travail
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Intitulé du Poste" value={effectiveData.jobTitleName} editValue={formData.jobTitleName} isEditing={isEditing} id="jobTitleName" disabled required icon={Briefcase} onChange={(v) => setFormData(p => ({...p, jobTitleName: v}))} />
                   <DetailEditable label="Département" value={effectiveData.departmentName} editValue={formData.departmentName} isEditing={isEditing} id="departmentName" disabled icon={Building2} onChange={(v) => setFormData(p => ({...p, departmentName: v}))} />
                   <DetailEditable label="Site d'Affectation" value={effectiveData.worksiteName} editValue={formData.worksiteName} isEditing={isEditing} id="worksiteName" disabled required icon={MapPin} className="col-span-full" onChange={(v) => setFormData(p => ({...p, worksiteName: v}))} />
                </div>
                {isEditing ? (
                  <div className="space-y-2 pt-4">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Missions Snapshot (Un par ligne)</Label>
                    <Textarea 
                      value={formData.missionsSnapshot?.join('\n') || ""} 
                      onChange={(e) => setFormData(p => ({...p, missionsSnapshot: e.target.value.split('\n').filter(Boolean)}))}
                      className="min-h-[120px] rounded-xl"
                    />
                  </div>
                ) : (
                  effectiveData.missionsSnapshot && effectiveData.missionsSnapshot.length > 0 && (
                    <div className="space-y-3 pt-6 border-t">
                       <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Missions & Responsabilités</p>
                       <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700">
                             {effectiveData.missionsSnapshot.map((m: string, i: number) => <li key={i}>{m}</li>)}
                          </ul>
                       </div>
                    </div>
                  )
                )}
             </CardContent>
          </Card>

          {/* Terms & Classification */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <ScrollText className="w-4 h-4" /> Conditions & Classification
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-12">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Type de Contrat" value={effectiveData.contractType} editValue={formData.contractType} isEditing={isEditing} id="contractType" disabled required onChange={(v) => setFormData(p => ({...p, contractType: v}))} />
                   <DetailEditable label="Date de Début" value={effectiveData.startDate} editValue={formData.startDate} isEditing={isEditing} id="startDate" type="date" disabled required icon={Calendar} onChange={(v) => setFormData(p => ({...p, startDate: v}))} />
                   <DetailEditable label="Date de Fin (Optionnel)" value={effectiveData.endDate} editValue={formData.endDate} isEditing={isEditing} id="endDate" type="date" disabled={effectiveData.contractType !== 'Tempo determinato'} icon={Calendar} onChange={(v) => setFormData(p => ({...p, endDate: v}))} />
                   <DetailEditable label="Période d'essai (jours)" value={effectiveData.trialPeriodDays} editValue={formData.trialPeriodDays} isEditing={isEditing} id="trialPeriodDays" type="number" onChange={(v) => setFormData(p => ({...p, trialPeriodDays: parseInt(v) || 0}))} />
                </div>
                
                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Temps de Travail Hebdo (h)" value={effectiveData.weeklyHours} editValue={formData.weeklyHours} isEditing={isEditing} id="weeklyHours" type="number" disabled required icon={Clock} onChange={(v) => setFormData(p => ({...p, weeklyHours: parseFloat(v) || 0}))} />
                   <DetailEditable label="Format Part-time ?" value={effectiveData.isPartTime ? "OUI" : "NON"} editValue={formData.isPartTime} isEditing={isEditing} id="isPartTime" type="checkbox" disabled onChange={(v) => setFormData(p => ({...p, isPartTime: !!v}))} />
                   <DetailEditable label="Notes Planning" value={effectiveData.workingScheduleNotes} editValue={formData.workingScheduleNotes} isEditing={isEditing} id="workingScheduleNotes" className="col-span-full" onChange={(v) => setFormData(p => ({...p, workingScheduleNotes: v}))} />
                </div>

                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Convention Collective (CCNL)" value={effectiveData.ccnlName} editValue={formData.ccnlName} isEditing={isEditing} id="ccnlName" disabled required onChange={(v) => setFormData(p => ({...p, worksiteName: v}))} />
                   <DetailEditable label="Niveau" value={effectiveData.levelCode} editValue={formData.levelCode} isEditing={isEditing} id="levelCode" disabled required onChange={(v) => setFormData(p => ({...p, levelCode: v}))} />
                   <DetailEditable label="Qualification" value={effectiveData.qualificationCategory} editValue={formData.qualificationCategory} isEditing={isEditing} id="qualificationCategory" onChange={(v) => setFormData(p => ({...p, qualificationCategory: v}))} />
                </div>
             </CardContent>
          </Card>

          {/* Remuneration */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Euro className="w-4 h-4" /> Rémunération
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Brut Mensuel (€)" value={effectiveData.grossMonthly} editValue={formData.grossMonthly} isEditing={isEditing} id="grossMonthly" type="number" disabled required onChange={(v) => setFormData(p => ({...p, grossMonthly: parseFloat(v) || 0}))} />
                   <DetailEditable label="Brut Annuel / RAL (€)" value={effectiveData.grossAnnual} editValue={formData.grossAnnual} isEditing={isEditing} id="grossAnnual" type="number" disabled onChange={(v) => setFormData(p => ({...p, grossAnnual: parseFloat(v) || 0}))} />
                   <DetailEditable label="Mensualités" value={effectiveData.monthlyPayments} editValue={formData.monthlyPayments} isEditing={isEditing} id="monthlyPayments" type="number" disabled onChange={(v) => setFormData(p => ({...p, monthlyPayments: parseInt(v) || 13}))} />
                </div>
                <DetailEditable label="Notes Variables / Heures Supp." value={effectiveData.overtimeNote} editValue={formData.overtimeNote} isEditing={isEditing} id="overtimeNote" className="mt-8" onChange={(v) => setFormData(p => ({...p, overtimeNote: v}))} />
             </CardContent>
          </Card>

          {/* Compliance */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Globe className="w-4 h-4" /> Compliance & UniLav
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Protocole UniLav" value={effectiveData.uniLavProtocolNumber} editValue={formData.uniLavProtocolNumber} isEditing={isEditing} id="uniLavProtocolNumber" onChange={(v) => setFormData(p => ({...p, uniLavProtocolNumber: v}))} />
                   <DetailEditable label="Date Soumission" value={effectiveData.uniLavSubmissionDate} editValue={formData.uniLavSubmissionDate} isEditing={isEditing} id="uniLavSubmissionDate" type="date" onChange={(v) => setFormData(p => ({...p, uniLavSubmissionDate: v}))} />
                </div>
             </CardContent>
          </Card>
        </div>

        {/* Audit Sidebar */}
        <div className="space-y-8">
          <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Historique & Audit
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <AuditRow label="Créé le" value={formatDateTime(contract.createdAt)} />
                <AuditRow label="Auteur" value={getUserLabel(contract.createdBy)} />
                <Separator className="opacity-20" />
                {contract.sentForSignatureAt && <AuditRow label="Envoyé sign. le" value={formatDateTime(contract.sentForSignatureAt)} />}
                {contract.signedAt && <AuditRow label="Signé le" value={formatDateTime(contract.signedAt)} />}
                {contract.activatedAt && <AuditRow label="Activé le" value={formatDateTime(contract.activatedAt)} />}
                {contract.terminatedAt && <AuditRow label="Clôturé le" value={formatDateTime(contract.terminatedAt)} />}
                <Separator className="opacity-20" />
                <AuditRow label="Dernière modif." value={formatDateTime(contract.updatedAt)} />
                <AuditRow label="Modifié par" value={getUserLabel(contract.updatedBy)} />
             </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isValidationDialogOpen} onOpenChange={setIsValidationDialogOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" /> Dossier contrat incomplet
            </DialogTitle>
            <DialogDescription>Certaines informations obligatoires sont manquantes pour l'envoi en signature.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="max-h-[300px] rounded-xl border p-4 bg-slate-50">
               <ul className="space-y-2">
                  {validationErrors.map((err, i) => (
                    <li key={i} className="text-xs font-bold text-slate-700 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                       {err}
                    </li>
                  ))}
               </ul>
            </ScrollArea>
          </div>
          <DialogFooter>
             <Button onClick={() => setIsValidationDialogOpen(false)} className="w-full rounded-xl">Corriger les informations</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signed Doc Modal */}
      <Dialog open={isSignedDocModalOpen} onOpenChange={setIsSignedDocModalOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Enregistrer le contrat signé</DialogTitle>
            <DialogDescription>Veuillez renseigner les détails du document physique ou numérique signé par les parties.</DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-6">
            <div className="space-y-2">
               <Label className="text-[10px] uppercase font-black text-muted-foreground">Titre du document (Requis)</Label>
               <input 
                 value={signedDocForm.title} 
                 onChange={(e) => setSignedDocForm(p => ({...p, title: e.target.value}))}
                 placeholder="Ex: Contrat_CDI_Dumont_Signe.pdf"
                 className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
               />
            </div>
            
            <div className="space-y-2">
               <Label className="text-[10px] uppercase font-black text-muted-foreground">Lien ou Référence (Optionnel)</Label>
               <input 
                 value={signedDocForm.url} 
                 onChange={(e) => setSignedDocForm(p => ({...p, url: e.target.value}))}
                 placeholder="https://..."
                 className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
               />
            </div>

            <div className="space-y-2">
               <Label className="text-[10px] uppercase font-black text-muted-foreground">Pièce jointe PDF (Optionnel)</Label>
               <div className="flex flex-col gap-2">
                  <Input 
                    type="file" 
                    accept=".pdf"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="h-12 rounded-xl pt-3"
                  />
                  <div className="text-[9px] text-muted-foreground italic pl-1 flex items-center gap-1">
                    <span className="bg-secondary p-0.5 rounded-full inline-flex">
                      <Info className="w-2.5 h-2.5" />
                    </span>
                    <span>PDF uniquement, max 10 Mo.</span>
                  </div>
               </div>
            </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setIsSignedDocModalOpen(false)} disabled={processing}>Annuler</Button>
             <Button onClick={handleSaveSignedDocRef} disabled={processing || !signedDocForm.title} className="bg-primary text-white font-black rounded-xl px-8">
               {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
               Enregistrer la référence
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Termination Modal */}
      <Dialog open={isTerminationModalOpen} onOpenChange={setIsTerminationModalOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-red-600 flex items-center gap-2">
              <Ban className="w-6 h-6" /> Terminer le contrat
            </DialogTitle>
            <DialogDescription>
              Cette action clôture le contrat actif. Le contrat restera disponible dans l’historique.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-6">
             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Date de fin réelle (Requis)</Label>
                <Input 
                  type="date"
                  value={terminationForm.actualEndDate} 
                  onChange={(e) => setTerminationForm(p => ({...p, actualEndDate: e.target.value}))}
                  className="h-12 rounded-xl"
                />
             </div>
             
             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Motif de fin (Requis)</Label>
                <Select 
                  value={terminationForm.terminationReason} 
                  onValueChange={(v) => setTerminationForm(p => ({...p, terminationReason: v}))}
                >
                  <SelectTrigger className="h-12 rounded-xl">
                    <SelectValue placeholder="Choisir un motif..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TERMINATION_REASONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>

             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Notes internes (Optionnel)</Label>
                <Textarea 
                  value={terminationForm.terminationNotes}
                  onChange={(e) => setTerminationForm(p => ({...p, terminationNotes: e.target.value}))}
                  placeholder="Observations sur la fin du contrat..."
                  className="min-h-[100px] rounded-xl"
                />
             </div>

             <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Document de clôture (Optionnel)</Label>
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-6 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                  terminationFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                )}>
                   <Input 
                     type="file" 
                     accept=".pdf,.png,.jpg,.jpeg,.webp" 
                     onChange={(e) => {
                       const file = e.target.files?.[0] || null;
                       if (file && file.size > 10 * 1024 * 1024) {
                         toast({ variant: "destructive", title: "Fichier trop volumineux", description: "Max 10Mo." });
                         e.target.value = "";
                         return;
                       }
                       setTerminationFile(file);
                     }}
                     className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                   />
                   {terminationFile ? (
                     <>
                        <div className="bg-green-100 p-2 rounded-xl text-green-600 mb-1"><FileCheck className="w-5 h-5" /></div>
                        <p className="text-xs font-bold text-green-800">{terminationFile.name}</p>
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); setTerminationFile(null); }}
                          className="text-[9px] text-red-500 font-black uppercase hover:underline"
                        >
                          Supprimer le fichier
                        </button>
                     </>
                   ) : (
                     <>
                        <Upload className="w-5 h-5 text-slate-300 mb-1" />
                        <p className="text-xs font-bold text-slate-600">Joindre lettre de démission, accord, etc.</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">PDF, Images (10 Mo max)</p>
                     </>
                   )}
                </div>
             </div>

             <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-red-800 leading-tight">
                  Attention : L'employé sera marqué comme n'ayant plus de contrat actif. Cette action est archivée et impactera les futurs pointages.
                </p>
             </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => { setIsTerminationModalOpen(false); setTerminationFile(null); }} disabled={processing}>Annuler</Button>
             <Button 
               onClick={handleTerminateContract} 
               disabled={processing || !terminationForm.actualEndDate || !terminationForm.terminationReason}
               className="bg-red-600 hover:bg-red-700 text-white font-black rounded-xl px-8"
             >
               {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
               Confirmer la clôture
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentGroup({ title, doc, history, icon: Icon, colorClass, onOpen, loadingId }: { 
  title: string, 
  doc: HRDocument | null, 
  history?: HRDocument[],
  icon: any,
  colorClass: string,
  onOpen: any,
  loadingId: string | null
}) {
  if (!doc && (!history || history.length === 0)) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn("w-3.5 h-3.5", colorClass)} />
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {doc && (
          <DocumentRow 
            doc={doc} 
            onOpen={onOpen} 
            onReplace={() => {}} 
            loadingId={loadingId} 
            isMain 
            canReplace={false}
            customLabel={doc.documentType === 'signed_contract' ? 'Contrat signé' : doc.documentType === 'termination_document' ? 'Document de clôture' : 'Dernier PDF généré'}
          />
        )}

        {history && history.length > 0 && (
          <div className="pl-4 sm:pl-8">
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-[9px] font-black uppercase tracking-widest gap-2 hover:bg-white">
                  <ChevronDown className="w-3 h-3" />
                  Versions précédentes ({history.length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2 animate-in fade-in slide-in-from-top-1">
                {history.map(d => (
                  <DocumentRow key={d.id} doc={d} onOpen={onOpen} onReplace={() => {}} loadingId={loadingId} compactVersion canReplace={false} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentRow({ 
  doc, 
  onOpen, 
  onReplace,
  loadingId, 
  isMain, 
  compactVersion, 
  customLabel,
  customBadge,
  canReplace
}: { 
  doc: HRDocument, 
  onOpen: any, 
  onReplace: (doc: HRDocument) => void,
  loadingId: string | null,
  isMain?: boolean,
  compactVersion?: boolean,
  customLabel?: string,
  customBadge?: React.ReactNode,
  canReplace: boolean
}) {
  const isLoading = loadingId === doc.id;
  const expiryDate = parseSafeDate(doc.expiresAt);
  const today = startOfDay(new Date());
  const isExpired = expiryDate && isBefore(expiryDate, today);
  const isExpiringSoon = expiryDate && !isExpired && differenceInDays(expiryDate, today) <= 30;

  return (
    <Card className={cn(
      "border-primary/5 hover:border-primary/20 transition-all shadow-sm rounded-2xl group overflow-hidden bg-white",
      isMain && "border-primary/20 shadow-md ring-1 ring-primary/5",
      compactVersion && "rounded-xl opacity-80"
    )}>
      <CardContent className={cn("p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4", compactVersion && "p-3")}>
        <div className="flex items-start gap-4">
          <div className={cn("bg-primary/5 p-3 rounded-xl text-primary shrink-0", compactVersion && "p-2")}>
            <FileText className={cn("w-5 h-5", compactVersion && "w-4 h-4")} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn("font-bold text-slate-900 truncate max-w-[200px] sm:max-w-md", compactVersion && "text-xs")}>{doc.title}</p>
              {customBadge}
              {doc.isSensitive && <Badge variant="destructive" className="h-4 text-[8px] uppercase font-black px-1.5 border-none">Sensible</Badge>}
              {doc.version > 1 && <Badge variant="outline" className="h-4 text-[8px] uppercase font-black border-primary/20">V{doc.version}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-black uppercase text-muted-foreground/60">
                {customLabel || DOCUMENT_TYPE_LABELS[doc.documentType]}
              </span>
              <span className="text-slate-200 text-[8px]">•</span>
              <span className="text-[9px] font-bold text-muted-foreground/50 italic">
                {formatDateSafe(doc.uploadedAt || doc.generatedAt || doc.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-6 pl-12 sm:pl-0">
           {expiryDate && (
             <div className="flex flex-col items-end">
                <p className="text-[8px] font-black uppercase text-muted-foreground tracking-tighter">Échéance</p>
                <div className="flex items-center gap-1.5">
                   <span className={cn("text-[10px] font-black", isExpired ? "text-red-600" : isExpiringSoon ? "text-orange-600" : "text-slate-600")}>
                     {formatDateSafe(doc.expiresAt)}
                   </span>
                   {isExpired ? (
                     <AlertTriangle className="w-3 h-3 text-red-500" />
                   ) : isExpiringSoon ? (
                     <Clock className="w-3 h-3 text-orange-500" />
                   ) : null}
                </div>
             </div>
           )}

           <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("text-[9px] uppercase font-black h-5 border-primary/10", 
                isExpired ? "bg-red-50 text-red-700 border-red-100" :
                isExpiringSoon ? "bg-orange-50 text-orange-700 border-orange-100" :
                doc.status === 'valid' ? "bg-green-50 text-green-700" : 
                doc.status === 'replaced' ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-400")}>
                {isExpired ? "Expiré" : isExpiringSoon ? "Échéance proche" : STATUS_LABELS[doc.status]}
              </Badge>
              
              <div className="flex gap-1">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className={cn("h-8 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary hover:text-white transition-all gap-2", compactVersion && "h-7 px-2 text-[10px]")}
                  onClick={() => onOpen(doc.storagePath, doc.id)}
                  disabled={!!loadingId}
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Consulter</span>
                </Button>

                {canReplace && isMain && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-xl font-bold border-primary/10 gap-2 hover:bg-secondary/50"
                    onClick={() => onReplace(doc)}
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Remplacer document</span>
                  </Button>
                )}
              </div>
           </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailEditable({ label, value, editValue, isEditing, id, type = "text", required = false, disabled = false, icon: Icon, className, onChange }: { 
  label: string, value: any, editValue?: any, isEditing: boolean, id: string, type?: string, required?: boolean, disabled?: boolean, icon?: any, className?: string, onChange: (v: any) => void 
}) {
  const displayValue = value === undefined || value === null || value === "" ? "Non renseigné" : value;
  const isMissing = required && (value === undefined || value === null || value === "");

  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={cn("text-[10px] font-black uppercase tracking-tight mb-1 opacity-70", isMissing && "text-red-600 opacity-100")}>
        {label} {required && "*"}
      </Label>
      {isEditing ? (
        <div className="space-y-1">
          {disabled ? (
            <div className="flex flex-col gap-1">
               <div className="h-10 px-3 bg-secondary/30 rounded-xl flex items-center text-xs font-bold text-muted-foreground border border-dashed cursor-not-allowed">
                 {displayValue}
               </div>
               <p className="text-[9px] font-bold text-orange-600 uppercase tracking-tighter pl-1">
                 À corriger depuis la fiche source.
               </p>
            </div>
          ) : type === "checkbox" ? (
            <div className="flex items-center h-10 px-3 border rounded-xl bg-white">
              <input type="checkbox" checked={!!editValue} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 text-primary" />
            </div>
          ) : (
            <Input 
              id={id} 
              type={type} 
              value={editValue ?? ""} 
              onChange={(e) => onChange(e.target.value)} 
              className={cn("h-10 rounded-xl bg-white", isMissing && "border-red-300 ring-red-100")} 
            />
          )}
        </div>
      ) : (
        <div className={cn("flex items-center gap-2 text-sm font-bold", isMissing ? "text-red-400 italic font-medium" : "text-slate-800")}>
           {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />}
           {displayValue}
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
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase font-black text-[9px] px-2">En signature</Badge>;
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white uppercase font-black text-[9px] px-2">Actif</Badge>;
    case 'renewed': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 uppercase font-black text-[9px] px-2">Renouvelé</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Terminé</Badge>;
    case 'suspended': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 uppercase font-black text-[9px] px-2">Suspendu</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground uppercase font-black text-[9px] px-2">Archivé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
