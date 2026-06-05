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
  Upload, FileCode, Send, XCircle, MessageSquare,
  ArrowRight, ClipboardList, UserPlus,
  AlertCircle,
  Eye,
  Download,
  ChevronRight
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
import { doc, DocumentReference, collection, query, where, Query, updateDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { PreHireDossier, PreHireDocument, PreHireDocumentStatus } from "@/types/pre-hire-dossier";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { updateEmploymentOffer, initiateOfferSend } from "@/services/employment-offer.service";
import { convertOfferToEmployeeAction } from "@/services/employee-conversion.service";
import { ensurePreHireDossier, sendDocumentRequestEmail, updateDocumentStatus } from "@/services/pre-hire-dossier.service";
import { getLevelsForCcnlAction } from "@/app/actions/ccnl-actions";
import { getDocumentDownloadUrl, uploadPreHireDocument } from "@/services/document.service";
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
import { fr } from "date-fns/locale";

const CONTRACT_TYPES = [
  "Tempo indeterminato",
  "Tempo determinato",
  "Apprendistato",
  "Stage / Tirocinio",
  "Altro"
];

const WORKING_TIME_OPTIONS = [
  "Tempo pieno (Full-time)",
  "Tempo parziale (Part-time)",
  "Intermittente / Chiamata"
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

export default function EditEmploymentOfferPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const offerId = params.offerId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, membership } = useActiveMembership(entityId);

  const offerRef = useMemo(() => db ? (doc(db, `entities/${entityId}/employmentOffers`, offerId) as DocumentReference<EmploymentOffer>) : null, [db, entityId, offerId]);
  const { data: offer, loading: loadingOffer } = useDoc<EmploymentOffer>(offerRef);

  // Pre-Hire Dossier Query
  const dossierQuery = useMemo(() => db && entityId && offerId ? query(collection(db, `entities/${entityId}/preHireDossiers`), where("employmentOfferId", "==", offerId)) as Query<PreHireDossier> : null, [db, entityId, offerId]);
  const { data: dossiers, loading: loadingDossiers } = useCollection<PreHireDossier>(dossierQuery);
  const dossier = dossiers?.[0];

  // Dossier Checklist Query
  const checklistQuery = useMemo(() => dossier ? query(collection(db!, `entities/${entityId}/preHireDossiers/${dossier.dossierId}/checklist`)) as Query<PreHireDocument> : null, [db, entityId, dossier]);
  const { data: checklist, loading: loadingChecklist } = useCollection<PreHireDocument>(checklistQuery);

  const mandatoryCommunicationQuery = useMemo(
    () =>
      db && entityId && offerId
        ? (query(
            collection(db, `entities/${entityId}/mandatoryCommunications`),
            where("employmentOfferId", "==", offerId)
          ) as Query<any>)
        : null,
    [db, entityId, offerId]
  );
  
  const { data: communications } = useCollection<any>(
    mandatoryCommunicationQuery
  );
  
  const mandatoryCommunication = communications?.find(
    (item: any) => item.type === "UNILAV_ASSUNZIONE"
  );

  // Master Data
  const ccnlsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active")) as Query<any> : null, [db, entityId]);
  const { data: activeCcnls } = useCollection<any>(ccnlsQuery);

  // Source Besoin RH for fallbacks
  const needRef = useMemo(() => db && offer?.recruitmentNeedId ? doc(db, `entities/${entityId}/recruitmentNeeds`, offer.recruitmentNeedId) as DocumentReference<RecruitmentNeed> : null, [db, entityId, offer?.recruitmentNeedId]);
  const { data: need } = useDoc<RecruitmentNeed>(needRef);

  const [formData, setFormData] = useState<Partial<EmploymentOffer>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
  const [rejectItem, setRejectItem] = useState<{ id: string, reason: string } | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  // New Upload States
  const [pendingUploadItem, setPendingUploadItem] = useState<PreHireDocument | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [pendingExpiresAt, setPendingExpiresAt] = useState("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploadingPreHireDocument, setIsUploadingPreHireDocument] = useState(false);

  // UniLav Form State
  const [uniLavData, setUniLavData] = useState({
    protocolNumber: "",
    submittedAt: "",
    receiptPdfUrl: ""
  });
  const [savingUniLav, setSavingUniLav] = useState(false);

  // Server-side fetching for levels to bypass rule limits
  const [activeLevels, setActiveLevels] = useState<any[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);

  useEffect(() => {
    async function fetchLevels() {
      const ccnlId = formData.ccnlId;
      if (!ccnlId || ccnlId === "none_clear" || !entityId || !user) {
        setActiveLevels([]);
        return;
      }

      setLoadingLevels(true);
      try {
        const idToken = await user.getIdToken();
        if (!idToken) throw new Error("Auth token missing");
        
        const levels = await getLevelsForCcnlAction(entityId, ccnlId, idToken);
        setActiveLevels(levels);
      } catch (err: any) {
        console.error("Error fetching levels:", err);
        toast({ variant: "destructive", title: "Erreur", description: "Impossible de charger les niveaux CCNL." });
      } finally {
        setLoadingLevels(false);
      }
    }

    if (user) {
      fetchLevels();
    }
  }, [formData.ccnlId, entityId, user, toast]);

  useEffect(() => {
    if (offer) {
      setFormData(offer);
    }
  }, [offer]);

  // Sync UniLav form state when doc loads
  useEffect(() => {
    if (mandatoryCommunication) {
      setUniLavData({
        protocolNumber: mandatoryCommunication.protocolNumber || "",
        submittedAt: mandatoryCommunication.submittedAt ? (mandatoryCommunication.submittedAt.seconds ? new Date(mandatoryCommunication.submittedAt.seconds * 1000).toISOString().split('T')[0] : mandatoryCommunication.submittedAt) : "",
        receiptPdfUrl: mandatoryCommunication.receiptPdfUrl || ""
      });
    }
  }, [mandatoryCommunication]);

  const handleCcnlChange = (ccnlId: string) => {
    if (ccnlId === "none_clear") {
      setFormData(p => ({
        ...p,
        ccnlId: "",
        ccnlName: "",
        cnelCode: "",
        levelId: "",
        levelCode: "",
        levelLabel: "",
        minGrossMonthly: 0,
        minGrossHourly: 0
      }));
      return;
    }

    const ccnl = activeCcnls?.find((c: any) => c.id === ccnlId);
    setFormData(p => ({
      ...p,
      ccnlId: ccnlId,
      ccnlName: ccnl?.name || "",
      cnelCode: ccnl?.cnelCode || "",
      monthlyPayments: ccnl?.monthlyPayments || 13,
      hourlyDivisor: ccnl?.hourlyDivisor || 173,
      levelId: "",
      levelCode: "",
      levelLabel: "",
      minGrossMonthly: 0,
      minGrossHourly: 0,
      proposedGrossMonthly: ccnl?.standardWeeklyHours ? 0 : p.proposedGrossMonthly
    }));
  };

  const handleLevelChange = (levelId: string) => {
    if (levelId === "none_clear") {
       setFormData(p => ({
         ...p,
         levelId: "",
         levelCode: "",
         levelLabel: "",
         qualificationLabel: "",
         minGrossMonthly: 0,
         minGrossHourly: 0
       }));
       return;
    }

    const level = activeLevels?.find(l => l.id === levelId);
    setFormData(p => {
      const monthly = level?.minimumGrossMonthly || 0;
      const payments = p.monthlyPayments || 13;
      return {
        ...p,
        levelId: levelId,
        levelCode: level?.levelCode || "",
        levelLabel: level?.label || "",
        qualificationLabel: level?.qualificationLabel || "",
        minGrossMonthly: monthly,
        minGrossHourly: level?.minimumGrossHourly || 0,
        proposedGrossMonthly: monthly,
        proposedGrossAnnual: monthly * payments
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

  const isFixedTerm = useMemo(() => {
    return formData.contractType !== "Tempo indeterminato";
  }, [formData.contractType]);

  const validateOfferData = () => {
    if (isFixedTerm && !formData.proposedEndDate) {
      return "La date de fin est obligatoire pour un contrat déterminé.";
    }
    if (formData.proposedEndDate && formData.proposedStartDate && formData.proposedEndDate < formData.proposedStartDate) {
      return "La date de fin ne peut pas être antérieure à la date de début.";
    }
    return null;
  };

  const handleSave = async (nextStatus?: EmploymentOfferStatus) => {
    if (!user || !entityId || !offerId) return;

    const error = validateOfferData();
    if (error) {
      toast({ variant: "destructive", title: "Action bloquée", description: error });
      return;
    }

    setSaving(true);
    try {
      await updateEmploymentOffer(entityId, offerId, { ...formData, status: nextStatus || offer?.status || 'draft' }, user.uid);
      toast({ title: "Enregistré" });
    } catch (err: any) {
      console.error("Save error:", err);
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleSend = async () => {
    if (!user || !entityId || !offerId) return;

    const error = validateOfferData();
    if (error) {
      toast({ variant: "destructive", title: "Action bloquée", description: error });
      return;
    }

    setSending(true);
    try {
      const result = await initiateOfferSend(entityId, offerId, user.uid);
      if (result && result.success) {
        toast({ title: "Envoyée" });
      } else {
        toast({ variant: "destructive", title: "Erreur", description: (result as any)?.error || "Impossible d'envoyer l'offre." });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSending(false); }
  };

  const handleConvert = async () => {
    if (!user || !entityId || !offerId) return;
    setConverting(true);
    try {
      const result = await convertOfferToEmployeeAction({ entityId, offerId, actorUid: user.uid });
      if (result.success) {
        toast({ title: "Embauche réussie !" });
        setIsConvertDialogOpen(false);
      } else {
        toast({ variant: "destructive", title: "Conversion bloquée", description: result.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setConverting(false); }
  };

  const handleInitDossier = async () => {
    if (!user || !offer) return;
    setSaving(true);
    try {
      await ensurePreHireDossier(entityId, offer, user.uid);
      toast({ title: "Dossier initialisé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSendDocRequest = async () => {
    if (!user || !dossier) return;
    setSaving(true);
    try {
      await sendDocumentRequestEmail(entityId, dossier.dossierId, user.uid);
      toast({ title: "Demande envoyée au candidat" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateDoc = async (itemId: string, status: PreHireDocumentStatus, reason?: string) => {
    if (!user || !dossier) return;
    try {
      await updateDocumentStatus(entityId, dossier.dossierId, itemId, status, user.uid, reason);
      toast({ title: "Document mis à jour" });
      setRejectItem(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  const handleUploadPreHireDoc = (item: PreHireDocument, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !offer || !dossier) return;

    setPendingUploadItem(item);
    setPendingUploadFile(file);
    setIsUploadDialogOpen(true);
    e.target.value = ""; // reset for same file re-selection if needed
  };

  const handleExecuteUpload = async () => {
    if (!pendingUploadItem || !pendingUploadFile || !user || !offer || !dossier) return;

    setIsUploadingPreHireDocument(true);
    setUploadingItem(pendingUploadItem.itemId);
    try {
      await uploadPreHireDocument({
        entityId,
        dossierId: dossier.dossierId,
        item: pendingUploadItem,
        file: pendingUploadFile,
        offer,
        actorUid: user.uid,
        actorName: membership?.userDisplayName,
        expiresAt: pendingExpiresAt || undefined
      });
      toast({ title: "Document téléversé", description: `${pendingUploadItem.label} a été ajouté au dossier.` });
      setIsUploadDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setIsUploadingPreHireDocument(false);
      setUploadingItem(null);
      setPendingUploadItem(null);
      setPendingUploadFile(null);
      setPendingExpiresAt("");
    }
  };

  const handleConsultDocument = async (item: PreHireDocument) => {
    const fileId = item.fileId;
    if (!fileId) {
      toast({ variant: "destructive", title: "Erreur", description: "Aucun fichier n'est associé à cette ligne." });
      return;
    }

    setLoadingFileId(item.itemId);
    try {
      // 1. Get document metadata from central registry
      const docRef = doc(db!, `entities/${entityId}/documents`, fileId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        throw new Error("Métadonnées du document introuvables.");
      }

      const docData = docSnap.data();
      const storagePath = docData.storagePath;

      if (!storagePath) {
        throw new Error("Lien de stockage manquant dans les métadonnées.");
      }

      // 2. Generate secure download URL
      const url = await getDocumentDownloadUrl(storagePath);
      window.open(url, "_blank");
    } catch (err: any) {
      console.error("[Consult PreHire Doc] Error:", err);
      toast({ variant: "destructive", title: "Action impossible", description: err.message || "Impossible d'ouvrir le document." });
    } finally {
      setLoadingFileId(null);
    }
  };

  const handleSaveUniLav = async () => {
    if (!user || !mandatoryCommunication) return;
    setSavingUniLav(true);
    try {
      const commRef = doc(db!, `entities/${entityId}/mandatoryCommunications`, mandatoryCommunication.id);
      const isComplete = uniLavData.protocolNumber && uniLavData.submittedAt && uniLavData.receiptPdfUrl;
      
      await updateDoc(commRef, {
        ...uniLavData,
        status: isComplete ? "receipt_received" : "draft",
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      toast({ title: "Données UniLav enregistrées" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSavingUniLav(false);
    }
  };

  const handleTestUniLav = async () => {
    if (!user || !mandatoryCommunication) return;
    setSavingUniLav(true);
    try {
      const commRef = doc(db!, `entities/${entityId}/mandatoryCommunications`, mandatoryCommunication.id);
      await updateDoc(commRef, {
        status: "receipt_received",
        protocolNumber: `TEST-UNILAV-${offerId}`,
        submittedAt: serverTimestamp(),
        receiptPdfUrl: "TEST_RECEIPT_NOT_APPLICABLE",
        testMode: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      toast({ title: "UniLav validé en mode TEST" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSavingUniLav(false);
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

  const getTimestampSeconds = (value?: any) => {
    return value?.seconds ?? value?._seconds ?? null;
  };

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!offer) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><FileText className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Proposition introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/employment-offers`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const isAccepted = offer.status === 'accepted';
  const isDeclined = offer.status === 'declined' || (offer.status as string).toLowerCase() === 'declined';
  const isConverted = offer.conversionStatus === 'converted';
  const isReadOnly = ["sent", "viewed", "accepted", "declined", "cancelled", "expired"].includes(offer.status) || isConverted;

  const isUniLavDone = Array.isArray(communications)
    ? communications.some(
        (c: any) => c?.status === "receipt_received" || c?.testMode === true
      )
    : false;

  const canConvert = dossier?.readyForConversion && isUniLavDone && !isConverted;

  const resolvedDepartment = formData.departmentName || need?.departmentName || "Non renseigné";
  const resolvedWorksite = formData.worksiteName || need?.worksiteName || need?.worksiteNameSnapshot || "Non renseigné";
  
  const sentAtSeconds = getTimestampSeconds(offer.sentAt);
  const viewedAtSeconds = getTimestampSeconds(offer.viewedAt);

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/employment-offers`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Modèle de Proposition</h1>
              {getStatusBadge(offer.status)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">ID : {offerId}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isReadOnly && (
            <>
              <Button variant="outline" onClick={() => handleSave()} disabled={saving} className="gap-2 bg-white font-bold"><Save className="w-4 h-4" /> Enregistrer brouillon</Button>
              {offer.status === 'draft' && <Button onClick={() => handleSave('internal_review')} disabled={saving} className="gap-2">Passer en validation <ArrowRight className="w-4 h-4" /></Button>}
              {offer.status === 'internal_review' && <Button onClick={() => handleSave('ready_to_send')} disabled={saving} className="gap-2 bg-accent text-white">Marquer comme prête <CheckCircle2 className="w-4 h-4" /></Button>}
              {offer.status === 'ready_to_send' && <Button onClick={handleSend} disabled={sending} className="gap-2 bg-primary text-white font-black"><Send className="w-4 h-4" /> Envoyer au candidat</Button>}
            </>
          )}
          {offer.status === 'sent' && <Button variant="outline" onClick={handleSend} disabled={sending} className="gap-2 bg-white"><RefreshCcw className="w-4 h-4" /> Renvoyer le lien</Button>}
        </div>
      </header>

      {isDeclined && (
        <Card className="border-red-200 bg-red-50/10 rounded-[2rem] overflow-hidden shadow-sm mb-8">
           <CardHeader className="bg-red-50 border-b py-4 px-8">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-red-700 flex items-center gap-2">
                 <XCircle className="w-4 h-4" /> Réponse du candidat : Proposition déclinée
              </CardTitle>
           </CardHeader>
           <CardContent className="p-8 space-y-6">
              <div className="space-y-2">
                 <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-red-600/40" />
                    <p className="text-[10px] font-black uppercase text-red-600/60 tracking-widest">Motif du refus</p>
                 </div>
                 <div className="text-sm font-bold text-slate-800 bg-white p-5 rounded-2xl border border-red-100 italic leading-relaxed">
                   "{offer.declinedReason || "Aucun motif renseigné."}"
                 </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                 <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-red-600/40 tracking-widest">Date de réponse</p>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                       <Clock className="w-3.5 h-3.5 opacity-40" />
                       {formatDateTime(offer.respondedAt)}
                    </div>
                 </div>
                 <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-red-600/40 tracking-widest">Coordonnées du candidat</p>
                    <div className="text-xs font-bold text-slate-700">
                       {offer.candidateDisplayName} • {offer.candidateEmail}
                    </div>
                 </div>
              </div>
           </CardContent>
        </Card>
      )}

      {["sent", "viewed", "accepted"].includes(offer.status) && (
        <div className="mb-8 rounded-[2rem] border border-blue-100 bg-blue-50/60 p-5 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-2xl bg-white flex items-center justify-center text-blue-500 shadow-sm">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Dernier envoi</p>
                <p className="text-sm font-black text-primary">{sentAtSeconds ? new Date(sentAtSeconds * 1000).toLocaleString("fr-FR") : "Non envoyé"}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-2xl bg-green-50 flex items-center justify-center text-green-600 shadow-sm">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-green-500">Première lecture</p>
                <p className="text-sm font-black text-primary">{viewedAtSeconds ? new Date(viewedAtSeconds * 1000).toLocaleString("fr-FR") : "Non consultée"}</p>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Nombre d’ouvertures</p>
                <p className="text-lg font-black text-primary">{offer.viewCount ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* Dossier Card (Accepted State) */}
          {(isAccepted || isConverted) && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl", dossier?.readyForConversion ? "border-green-100 bg-green-50/10" : "border-primary/10")}>
               <CardHeader className="bg-primary/5 border-b py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                    <ClipboardList className="w-4 h-4" /> Dossier d’embauche & Compliance
                  </CardTitle>
                  {dossier && <Badge variant="secondary" className="bg-white text-[9px] uppercase font-black">{(dossier.status as string).replace(/_/g, ' ')}</Badge>}
               </CardHeader>
               <CardContent className="p-8 space-y-6">
                  {loadingDossiers ? (
                    <div className="flex items-center justify-center py-12">
                       <Loader2 className="w-6 h-6 animate-spin text-primary/20" />
                    </div>
                  ) : !dossier ? (
                    isConverted ? (
                      <div className="flex flex-col items-center py-8 text-center space-y-3 opacity-60">
                        <Info className="w-8 h-8 text-slate-400" />
                        <div className="space-y-1">
                          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Dossier non disponible</p>
                          <p className="text-[10px] text-slate-400 max-w-[280px]">Dossier d’embauche non disponible for cette conversion existante.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center py-6 text-center space-y-4">
                         <AlertTriangle className="w-10 h-10 text-orange-400" />
                         <p className="text-sm font-medium text-slate-600">Le dossier de collecte n'est pas encore initialisé.</p>
                         <Button onClick={handleInitDossier} disabled={saving} className="gap-2"><Plus className="w-4 h-4" /> Initialiser le dossier</Button>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                         <div className="space-y-1">
                            <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">État documents</p>
                            <div className="flex items-center gap-2">
                               {dossier.readyForConversion ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5 text-orange-500" />}
                               <span className="font-bold text-slate-800">{dossier.readyForConversion ? "Documents validés" : "Documents en attente"}</span>
                            </div>
                         </div>
                         {!isConverted && (
                           <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={handleSendDocRequest} disabled={saving} className="gap-2">
                                 <Send className="w-3.5 h-3.5" /> Envoyer demande docs
                              </Button>
                           </div>
                         )}
                      </div>

                      <div className="space-y-3">
                         <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-1">Checklist documents obligatoires (Italie)</p>
                         <div className="grid gap-3">
                            {loadingChecklist ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : checklist?.map(item => {
                              const hasFile = !!(item.fileId);
                              
                              return (
                                <div key={item.itemId} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm group">
                                  <div className="flex items-center gap-3">
                                      <div className={cn("p-2 rounded-xl", 
                                        item.status === 'approved' ? "bg-green-100 text-green-600" : 
                                        item.status === 'rejected' ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400")}>
                                        <FileText className="w-4 h-4" />
                                      </div>
                                      <div>
                                        <p className="text-xs font-bold text-slate-700">{item.label}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <p className="text-[10px] text-muted-foreground uppercase">{item.status}</p>
                                            {item.expiresAt && (
                                              <span className="text-[9px] font-black text-slate-500 uppercase bg-slate-50 px-1 rounded-sm">
                                                Échéance : {formatDate(item.expiresAt)}
                                              </span>
                                            )}
                                            {!hasFile && (item.status === 'approved' || item.status === 'uploaded') && (
                                              <span className="text-[8px] font-black text-orange-500 uppercase bg-orange-50 px-1 rounded-sm">Lien absent</span>
                                            )}
                                        </div>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      {hasFile && (
                                        <Button 
                                          size="sm" 
                                          variant="outline" 
                                          className="h-8 rounded-lg text-[10px] font-black uppercase tracking-wider gap-1.5"
                                          onClick={() => handleConsultDocument(item)}
                                          disabled={loadingFileId === item.itemId || uploadingItem === item.itemId}
                                        >
                                          {loadingFileId === item.itemId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                                          Consulter
                                        </Button>
                                      )}

                                      {!isConverted && (
                                        <>
                                          {(item.status === 'missing' || item.status === 'rejected') && (
                                            <div className="relative">
                                              <Button 
                                                size="sm" 
                                                variant="outline" 
                                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-wider gap-1.5 border-dashed"
                                                disabled={uploadingItem === item.itemId}
                                              >
                                                {uploadingItem === item.itemId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                                Joindre fichier
                                              </Button>
                                              <input 
                                                type="file" 
                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                                                onChange={(e) => handleUploadPreHireDoc(item, e)}
                                                disabled={uploadingItem === item.itemId}
                                                accept=".pdf,.png,.jpg,.jpeg"
                                              />
                                            </div>
                                          )}

                                          <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdateDoc(item.itemId, 'approved')}><CheckCircle2 className="w-4 h-4" /></Button>
                                          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => setRejectItem({ id: item.itemId, reason: "" })}><XCircle className="w-4 h-4" /></Button>
                                        </>
                                      )}
                                  </div>
                                </div>
                              );
                            })}
                         </div>
                      </div>

                      {dossier.readyForConversion && !isConverted && (
                        <div className="bg-primary/5 p-5 rounded-2xl border border-primary/20 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2">
                           <div className="flex items-center gap-3 text-primary text-sm font-bold">
                              <CheckCircle2 className="w-5 h-5 text-green-600" />
                              <div className="space-y-0.5">
                                 <p>Documents validés.</p>
                                 <p className="text-[10px] uppercase opacity-70">Étape suivante : communication obligatoire Italie / UniLav.</p>
                              </div>
                           </div>
                           
                           {canConvert ? (
                             <Button onClick={() => setIsConvertDialogOpen(true)} className="bg-green-600 hover:bg-green-700 text-white font-black rounded-xl w-full sm:w-auto shadow-lg shadow-green-200">
                                <UserPlus className="w-4 h-4 mr-2" /> Convertir en employé
                             </Button>
                           ) : (
                             <div className="flex flex-col items-end gap-1">
                                <Button disabled className="rounded-xl opacity-40 bg-slate-300 w-full sm:w-auto">
                                  Convertir en employé
                                </Button>
                                <span className="text-[9px] font-bold text-orange-600 uppercase tracking-tighter">En attente du protocole UniLav/CPI</span>
                             </div>
                           )}
                        </div>
                      )}
                    </>
                  )}
               </CardContent>
            </Card>
          )}

          {isAccepted && (
            <Card className="border-primary/10 rounded-3xl shadow-lg overflow-hidden">
              <CardHeader className="py-4 border-b bg-secondary/10">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2 text-primary">
                    <FileText className="w-4 h-4" />
                    Communication obligatoire Italie / UniLav
                  </CardTitle>

                  {mandatoryCommunication && (
                    <Badge variant="secondary" className={cn("text-[9px] font-black uppercase", mandatoryCommunication.testMode ? "bg-orange-50 text-orange-700 border-orange-200" : "")}>
                      {mandatoryCommunication.testMode ? "MODE TEST" : mandatoryCommunication.status || "Brouillon"}
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {!mandatoryCommunication ? (
                  <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl text-xs font-bold text-orange-700 flex items-center gap-3">
                     <AlertCircle className="w-5 h-5" />
                     Communication UniLav/CPI non initialisée pour cette offre.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-secondary/30 border border-primary/5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Mode email consultant</p>
                        <p className="text-sm font-black text-primary">{mandatoryCommunication.emailMode || "draft_only"}</p>
                      </div>
                      <div className="p-4 rounded-2xl bg-secondary/30 border border-primary/5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Email consultant</p>
                        <p className="text-sm font-black text-primary">{mandatoryCommunication.consultantEmail || "Non configuré"}</p>
                      </div>
                    </div>

                    {/* UniLav Protocol Recording Form */}
                    {dossier?.readyForConversion && !isConverted && (
                      <div className="space-y-4 pt-4 border-t border-dashed">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-[10px] font-black uppercase text-primary tracking-widest">Enregistrement du protocole UniLav</p>
                          <Button asChild variant="outline" size="sm" className="h-7 text-[10px] font-black uppercase border-primary/10 gap-2">
                             <Link href={`/entity/${entityId}/employment-requests/unilav_${offerId}`}>
                                Gérer dans le module CPI foundation <ChevronRight className="w-3 h-3" />
                             </Link>
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-bold">Numéro de protocole</Label>
                            <Input 
                              value={uniLavData.protocolNumber} 
                              onChange={(e) => setUniLavData(p => ({...p, protocolNumber: e.target.value}))}
                              placeholder="Ex: 2024-XXXX-XXXX"
                              className="rounded-xl h-10 font-mono"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-bold">Date de soumission</Label>
                            <Input 
                              type="date" 
                              value={uniLavData.submittedAt} 
                              onChange={(e) => setUniLavData(p => ({...p, submittedAt: e.target.value}))}
                              className="rounded-xl h-10"
                            />
                          </div>
                          <div className="space-y-2 col-span-full">
                            <Label className="text-[9px] uppercase font-bold">Lien vers le reçu (PDF)</Label>
                            <Input 
                              value={uniLavData.receiptPdfUrl} 
                              onChange={(e) => setUniLavData(p => ({...p, receiptPdfUrl: e.target.value}))}
                              placeholder="https://cloud-storage.com/receipt.pdf"
                              className="rounded-xl h-10"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                           <Button 
                             onClick={handleSaveUniLav} 
                             disabled={savingUniLav} 
                             className="rounded-xl bg-primary text-white font-bold h-9 px-6"
                           >
                             {savingUniLav ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Save className="w-3 h-3 mr-2" />}
                             Enregistrer le protocole
                           </Button>
                        </div>
                        
                        <Separator className="my-4" />
                        
                        {/* Test Mode Area */}
                        <div className="bg-orange-50/50 p-4 rounded-2xl border border-orange-100 space-y-3">
                           <div className="flex items-center gap-2 text-orange-800 text-[10px] font-black uppercase tracking-wider">
                              <AlertCircle className="w-4 h-4" />
                              Mode TEST / Démonstration
                           </div>
                           <p className="text-[10px] text-orange-600 leading-tight">
                              Validation UniLav/CPI en mode test — non valable juridiquement. Utilisez ce bouton pour compléter le flux sans protocole réel.
                           </p>
                           <Button 
                             variant="outline" 
                             onClick={handleTestUniLav} 
                             disabled={savingUniLav}
                             className="w-full bg-white border-orange-200 text-orange-700 hover:bg-orange-50 font-bold rounded-xl h-10"
                           >
                             Valider UniLav/CPI en mode TEST
                           </Button>
                        </div>
                      </div>
                    )}

                    {isUniLavDone && (
                      <div className="p-4 bg-green-50 border border-green-100 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                           <p className="text-[9px] font-black text-green-700 uppercase tracking-widest">Confirmation UniLav</p>
                           <Badge className="bg-green-600 text-white border-none text-[8px]">VALIDÉ</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           <div>
                              <p className="text-[8px] uppercase font-bold text-muted-foreground">Protocole</p>
                              <p className="text-xs font-mono font-bold text-slate-800">{mandatoryCommunication.protocolNumber}</p>
                           </div>
                           <div>
                              <p className="text-[8px] uppercase font-bold text-muted-foreground">Date</p>
                              <p className="text-xs font-bold text-slate-800">
                                {mandatoryCommunication.submittedAt && new Date(getTimestampSeconds(mandatoryCommunication.submittedAt) * 1000).toLocaleDateString('fr-FR')}
                              </p>
                           </div>
                        </div>
                        {mandatoryCommunication.testMode && (
                          <div className="mt-2 pt-2 border-t border-green-100 flex items-center gap-2 text-[9px] font-black text-orange-600 uppercase">
                             <AlertCircle className="w-3 h-3" />
                             Validé en mode hors-ligne / test
                          </div>
                        )}
                      </div>
                    )}

                    {!isConverted && !isUniLavDone && (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl font-bold"
                        onClick={async () => {
                          const emailBody = mandatoryCommunication.emailBody || "";
                          if (!emailBody) {
                            toast({ title: "Email non disponible", variant: "destructive" });
                            return;
                          }
                          await navigator.clipboard.writeText(emailBody);
                          toast({ title: "Email copié", description: "Le texte de l’email consultant a été copié." });
                        }}
                      >
                        Copier email consultant
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {isConverted && (
            <div className="mb-8 p-6 bg-primary/5 border-2 border-primary/20 rounded-3xl flex items-center justify-between gap-6 shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
               <div className="flex items-center gap-4 text-primary font-black">
                  <div className="bg-primary text-white p-3 rounded-2xl"><CheckCircle2 className="w-6 h-6" /></div>
                  <div>
                    <p className="text-lg">Recrutement Finalisé</p>
                    <p className="text-[10px] uppercase font-black opacity-60">Dossier converti en employé.</p>
                  </div>
               </div>
               <Button asChild className="rounded-xl font-bold bg-primary text-white shadow-lg shadow-primary/20">
                  <Link href={`/entity/${entityId}/employees/${offer.employeeId}`}>Voir fiche employé</Link>
               </Button>
            </div>
          )}

          {/* Offer Editor Sections */}
          <Card className="border-primary/10 shadow-xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <User className="w-4 h-4" /> Candidat & Poste
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1 p-3 bg-secondary/20 rounded-2xl border">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Candidat</Label>
                  <p className="font-black text-primary">{offer.candidateDisplayName}</p>
                  <p className="text-xs text-muted-foreground">{offer.candidateEmail}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Poste proposé</Label>
                  <Input value={formData.jobTitleName || ""} onChange={(e) => setFormData(p => ({...p, jobTitleName: e.target.value}))} disabled={isReadOnly} className="h-10 font-bold text-primary border-primary/20 rounded-xl" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Département</Label>
                  <div className="h-10 px-4 rounded-xl border border-primary/10 bg-secondary/10 flex items-center text-sm font-bold text-slate-700">
                    <Building2 className="w-3.5 h-3.5 mr-2 text-primary/40" />
                    {resolvedDepartment}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Site d'affectation</Label>
                  <div className="h-10 px-4 rounded-xl border border-primary/10 bg-secondary/10 flex items-center text-sm font-bold text-slate-700">
                    <MapPin className="w-3.5 h-3.5 mr-2 text-primary/40" />
                    {resolvedWorksite}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                <FileSignature className="w-4 h-4" /> Conditions Contractuelles
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de contrat</Label>
                    <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))} disabled={isReadOnly}>
                      <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Sél. contrat..." /></SelectTrigger>
                      <SelectContent>
                        {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Temps de travail</Label>
                    <Select value={formData.workingTime} onValueChange={(v) => setFormData(p => ({...p, workingTime: v}))} disabled={isReadOnly}>
                      <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Sél. temps..." /></SelectTrigger>
                      <SelectContent>
                        {WORKING_TIME_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Date de début proposée</Label>
                    <Input type="date" value={formData.proposedStartDate || ""} onChange={(e) => setFormData(p => ({...p, proposedStartDate: e.target.value}))} disabled={isReadOnly} className="rounded-xl h-10" />
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Heures par semaine</Label>
                    <Input type="number" step="0.5" value={formData.weeklyHours || ""} onChange={(e) => setFormData(p => ({...p, weeklyHours: parseFloat(e.target.value)}))} disabled={isReadOnly} className="rounded-xl h-10" />
                 </div>
                 {isFixedTerm && (
                    <div className="space-y-2 col-span-full">
                      <Label className={cn("text-[10px] font-black uppercase tracking-widest", !formData.proposedEndDate && "text-red-50")}>
                        Date de fin proposée *
                      </Label>
                      <Input 
                        type="date" 
                        value={formData.proposedEndDate || ""} 
                        onChange={(e) => setFormData(p => ({...p, proposedEndDate: e.target.value}))} 
                        disabled={isReadOnly} 
                        className={cn("rounded-xl h-10", !formData.proposedEndDate && "border-red-200 ring-red-50")} 
                      />
                      {!formData.proposedEndDate && (
                        <p className="text-[9px] text-red-500 font-bold uppercase tracking-tighter pl-1">
                          Requis pour un contrat déterminé
                        </p>
                      )}
                    </div>
                 )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
               <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                 <Scale className="w-4 h-4" /> Classification CCNL
               </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Contrat Collectif (CCNL)</Label>
                    <Select value={formData.ccnlId} onValueChange={handleCcnlChange} disabled={isReadOnly}>
                      <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Choisir CCNL..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                        {activeCcnls?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Niveau de classification</Label>
                    <Select value={formData.levelId} onValueChange={handleLevelChange} disabled={isReadOnly || !formData.ccnlId || formData.ccnlId === "none_clear"}>
                      <SelectTrigger className="rounded-xl h-10">
                        <SelectValue placeholder={loadingLevels ? "Chargement..." : "Choisir niveau..."} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none_clear">--- Aucun ---</SelectItem>
                        {activeLevels?.map(l => <SelectItem key={l.id} value={l.id}>{l.levelCode} • {l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                 </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-4">
               <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-primary/70">
                 <Euro className="w-4 h-4" /> Rémunération & Avantages
               </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Brut Mensuel Proposé</Label>
                    <Input type="number" step="0.01" value={formData.proposedGrossMonthly || ""} onChange={(e) => handleMonthlySalaryChange(e.target.value)} disabled={isReadOnly} className="rounded-xl h-10 font-bold" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Mensualités</Label>
                    <Input type="number" value={formData.monthlyPayments || 13} readOnly className="bg-secondary/20 rounded-xl h-10" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Estimation RAL (Annuel)</Label>
                    <div className="h-10 bg-primary/5 border border-primary/20 rounded-xl flex items-center px-4 font-black text-primary">
                       € {formData.proposedGrossAnnual?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes sur la rémunération (Variables, primes...)</Label>
                 <Textarea value={formData.salaryNotes || ""} onChange={(e) => setFormData(p => ({...p, salaryNotes: e.target.value}))} disabled={isReadOnly} className="rounded-xl min-h-[80px]" />
               </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl rounded-3xl overflow-hidden">
            <CardHeader className="bg-white/10 py-4 border-b border-white/10">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Résumé
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <SummaryRow label="Candidat" value={offer.candidateDisplayName} />
              <SummaryRow label="Poste" value={formData.jobTitleName || "-"} />
              <SummaryRow label="Contrat" value={formData.contractType || "-"} />
              {isFixedTerm && <SummaryRow label="Fin" value={formData.proposedEndDate || "-"} />}
              <SummaryRow label="Brut mensuel" value={`${Number(formData.proposedGrossMonthly || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`} />
              <SummaryRow label="Brut annuel" value={`${Number(formData.proposedGrossAnnual || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`} />
              <Separator className="bg-white/10" />
              <SummaryRow label="Statut" value={getStatusBadge(offer.status)} />
            </CardContent>
          </Card>

          <Card className="border-primary/10 rounded-3xl shadow-lg">
             <CardHeader className="py-4 border-b bg-secondary/10">
               <CardTitle className="text-[10px] font-black uppercase tracking-widest">Lien & Validité</CardTitle>
             </CardHeader>
             <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                   <Label className="text-[10px] font-black uppercase text-muted-foreground">Validité du lien (jours)</Label>
                   <Input type="number" min="1" max="30" value={formData.linkValidityDays || 7} onChange={(e) => setFormData(p => ({...p, linkValidityDays: parseInt(e.target.value)}))} disabled={isReadOnly} className="rounded-xl" />
                </div>
                {offer.publicAccessTokenExpiresAt && (
                  <div className="p-3 bg-secondary/30 rounded-xl space-y-1">
                     <p className="text-[9px] font-black text-muted-foreground uppercase">Expire le</p>
                     <p className="text-xs font-bold text-primary">{new Date(getTimestampSeconds(offer.publicAccessTokenExpiresAt) * 1000).toLocaleString()}</p>
                  </div>
                )}
             </CardContent>
          </Card>
        </div>
      </div>

      {/* Reject Modal */}
      <Dialog open={rejectItem !== null} onOpenChange={() => setRejectItem(null)}>
        <DialogContent className="rounded-[2rem]">
          <DialogHeader><DialogTitle>Rejeter le document</DialogTitle><DialogDescription>Précisez la raison pour informer le candidat.</DialogDescription></DialogHeader>
          <div className="py-4 space-y-3">
             <Label className="text-xs uppercase font-black">Motif du rejet</Label>
             <Textarea value={rejectItem?.reason || ""} onChange={(e) => setRejectItem(p => p ? ({...p, reason: e.target.value}) : null)} placeholder="Ex: Illisible, périmé..." className="rounded-xl min-h-[100px]" />
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setRejectItem(null)}>Annuler</Button>
             <Button variant="destructive" disabled={!rejectItem?.reason} onClick={() => rejectItem && handleUpdateDoc(rejectItem.id, 'rejected', rejectItem.reason)}>Confirmer le rejet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Pre-hire Doc Confirmation Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary">Téléverser le document</DialogTitle>
            <DialogDescription>
              Fichier : <span className="font-bold">{pendingUploadFile?.name}</span>
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Date d'échéance (Optionnel)</Label>
              <Input 
                type="date"
                value={pendingExpiresAt}
                onChange={(e) => setPendingExpiresAt(e.target.value)}
                className="h-12 rounded-xl"
              />
            </div>
          </div>

          <DialogFooter>
             <Button variant="ghost" onClick={() => { setIsUploadDialogOpen(false); setPendingUploadItem(null); setPendingUploadFile(null); setPendingExpiresAt(""); }} disabled={isUploadingPreHireDocument}>Annuler</Button>
             <Button onClick={handleExecuteUpload} className="rounded-xl px-8 font-black shadow-lg" disabled={isUploadingPreHireDocument || !pendingUploadFile}>
                {isUploadingPreHireDocument ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Confirmer le téléversement
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirmation */}
      <AlertDialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Finaliser l'embauche</AlertDialogTitle>
            <AlertDialogDescription>Validation des documents et UniLav terminée. Le dossier est prêt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={converting} className="bg-green-600 hover:bg-green-700 text-white font-black rounded-xl px-8 shadow-lg shadow-green-100 transition-all">
               {converting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
               Confirmer l'embauche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getStatusBadge(status: EmploymentOfferStatus) {
  switch (status) {
    case 'accepted': return <Badge variant="secondary" className="bg-green-500 text-white font-black px-2 uppercase text-[9px]">Acceptée</Badge>;
    case 'sent': return <Badge className="bg-primary text-white px-2 uppercase text-[9px]">Envoyée</Badge>;
    case 'draft': return <Badge variant="outline" className="px-2 uppercase text-[9px]">Brouillon</Badge>;
    case 'internal_review': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 px-2 uppercase text-[9px]">En revue</Badge>;
    case 'ready_to_send': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 px-2 uppercase text-[9px]">Prête</Badge>;
    case 'viewed': return <Badge variant="secondary" className="bg-cyan-500 text-white border-none px-2 uppercase text-[9px]">Consultée</Badge>;
    case 'declined': return <Badge variant="destructive" className="bg-red-500 border-none text-white px-2 uppercase text-[9px]">Refusée</Badge>;
    default: return <Badge variant="outline" className="px-2 uppercase text-[9px]">{status}</Badge>;
  }
}

function SummaryRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[9px] font-black uppercase text-white/40 tracking-widest">{label}</span>
      <div className="text-xs font-black text-right text-white truncate max-w-[190px]">{value || "-"}</div>
    </div>
  );
}
