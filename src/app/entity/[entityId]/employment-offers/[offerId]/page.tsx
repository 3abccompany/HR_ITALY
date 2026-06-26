
"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, 
  Briefcase, Building2, FileSignature,
  Euro, Clock, Calendar, FileText,
  MapPin, CheckCircle2, RefreshCcw, 
  Save, AlertTriangle, ExternalLink,
  Upload, Send, XCircle, MessageSquare,
  ArrowRight, ClipboardList, UserPlus,
  AlertCircle,
  Eye,
  ChevronRight,
  Info,
  Plus,
  Scale,
  CheckCircle,
  Circle,
  Trash2,
  Globe,
  History
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFirebase, useDoc, useUser, useCollection, useAuth } from "@/firebase";
import { doc, DocumentReference, collection, query, where, Query, updateDoc, serverTimestamp, getDoc, orderBy } from "firebase/firestore";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { PreHireDossier, PreHireDocument, PreHireDocumentStatus } from "@/types/pre-hire-dossier";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { updateEmploymentOffer, initiateOfferSend } from "@/services/employment-offer.service";
import { convertOfferToEmployeeAction } from "@/services/employee-conversion.service";
import { 
  ensurePreHireDossier, 
  sendDocumentRequestEmail, 
  updateDocumentStatus,
  addCustomPreHireDocumentRequest,
  deleteCustomPreHireDocumentRequest
} from "@/services/pre-hire-dossier.service";
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
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { sendConsultantCPIRequestAction, getConsultantCPIEmailPreviewAction } from "@/services/email.service";

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

export default function EditEmploymentOfferPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const offerId = params?.offerId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, entity, membership } = useActiveMembership(entityId);

  const offerRef = useMemo(() => db && entityId && offerId ? (doc(db, `entities/${entityId}/employmentOffers`, offerId) as DocumentReference<EmploymentOffer>) : null, [db, entityId, offerId]);
  const { data: offer, loading: loadingOffer } = useDoc<EmploymentOffer>(offerRef);

  // Pre-Hire Dossier Query
  const dossierQuery = useMemo(() => db && entityId && offerId ? query(collection(db, `entities/${entityId}/preHireDossiers`), where("employmentOfferId", "==", offerId)) as Query<PreHireDossier> : null, [db, entityId, offerId]);
  const { data: dossiers } = useCollection<PreHireDossier>(dossierQuery);
  const dossier = dossiers?.[0];

  const canReadCPI = hasPermission("employmentRequests.read");
  const standaloneRequestRef = useMemo(() => 
    db && entityId && offerId && canReadCPI ? doc(db, `entities/${entityId}/employmentRequests`, `unilav_${offerId}`) as DocumentReference<any> : null,
  [db, entityId, offerId, canReadCPI]);
  const { data: standaloneRequest, loading: loadingStandalone } = useDoc<any>(standaloneRequestRef);

  // Dossier Checklist Query
  const checklistQuery = useMemo(() => dossier && db && entityId ? query(collection(db, `entities/${entityId}/preHireDossiers/${dossier.dossierId}/checklist`), orderBy("createdAt", "asc")) as Query<PreHireDocument> : null, [db, entityId, dossier]);
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
  const ccnlsQuery = useMemo(() => db && entityId ? query(collection(db, `entities/${entityId}/ccnls`), where("status", "==", "active")) as Query<any> : null, [db, entityId]);
  const { data: activeCcnls } = useCollection<any>(ccnlsQuery);

  const needRef = useMemo(() => db && entityId && offer?.recruitmentNeedId ? doc(db, `entities/${entityId}/recruitmentNeeds`, offer.recruitmentNeedId) as DocumentReference<RecruitmentNeed> : null, [db, entityId, offer?.recruitmentNeedId]);
  const { data: need } = useDoc<RecruitmentNeed>(needRef);

  const [formData, setFormData] = useState<Partial<EmploymentOffer>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
  const [rejectItem, setRejectItem] = useState<{ id: string, reason: string } | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  // Custom Doc Dialog State
  const [isCustomDocOpen, setIsCustomDocOpen] = useState(false);
  const [customDocForm, setCustomDocForm] = useState({ label: "", type: "other", isRequired: true, description: "" });

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

  // Server-side fetching for levels
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
        const levels = await getLevelsForCcnlAction(entityId, ccnlId, idToken);
        setActiveLevels(levels);
      } catch (err) {
        console.error("Error fetching levels:", err);
      } finally {
        setLoadingLevels(false);
      }
    }
    if (user) fetchLevels();
  }, [formData.ccnlId, entityId, user]);

  useEffect(() => {
    if (offer) setFormData(offer);
  }, [offer]);

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
      setFormData(p => ({ ...p, ccnlId: "", ccnlName: "", cnelCode: "", levelId: "", levelCode: "", levelLabel: "" }));
      return;
    }
    const foundCcnl = activeCcnls?.find((c: any) => c.id === ccnlId);
    setFormData(p => ({
      ...p,
      ccnlId,
      ccnlName: foundCcnl?.name || "",
      cnelCode: foundCcnl?.cnelCode || "",
      monthlyPayments: foundCcnl?.monthlyPayments || 13,
      hourlyDivisor: foundCcnl?.hourlyDivisor || 173,
      levelId: "", levelCode: "", levelLabel: ""
    }));
  };

  const handleLevelChange = (levelId: string) => {
    if (levelId === "none_clear") {
       setFormData(p => ({ ...p, levelId: "", levelCode: "", levelLabel: "", qualificationLabel: "" }));
       return;
    }
    const foundLevel = activeLevels?.find(l => l.id === levelId);
    setFormData(p => {
      const monthly = foundLevel?.minimumGrossMonthly || 0;
      return {
        ...p,
        levelId,
        levelCode: foundLevel?.levelCode || "",
        levelLabel: foundLevel?.label || "",
        qualificationLabel: foundLevel?.qualificationLabel || "",
        proposedGrossMonthly: monthly,
        proposedGrossAnnual: monthly * (p.monthlyPayments || 13)
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

  const isFixedTerm = useMemo(() => formData.contractType !== "Tempo indeterminato", [formData.contractType]);

  const handleSave = async (nextStatus?: EmploymentOfferStatus) => {
    if (!user || !entityId || !offerId) return;
    if (isFixedTerm && !formData.proposedEndDate) {
      toast({ variant: "destructive", title: "Date manquante", description: "La date de fin est obligatoire pour un contrat déterminé." });
      return;
    }
    setSaving(true);
    try {
      await updateEmploymentOffer(entityId, offerId, { ...formData, status: nextStatus || (offer?.status as EmploymentOfferStatus) || 'draft' }, user.uid);
      toast({ title: "Enregistré" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleSend = async () => {
    if (!user || !entityId || !offerId || !offer) return;
    setSending(true);
    try {
      const result = await initiateOfferSend(entityId, offerId, user.uid);
      if (result && result.success) toast({ title: "Envoyée" });
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
    } finally { setSaving(false); }
  };

  const handleAddCustomDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !dossier) return;
    setSaving(true);
    try {
      await addCustomPreHireDocumentRequest({
        entityId,
        dossierId: dossier.dossierId,
        actorUid: user.uid,
        ...customDocForm
      });
      toast({ title: "Document ajouté" });
      setIsCustomDocOpen(false);
      setCustomDocForm({ label: "", type: "other", isRequired: true, description: "" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSaving(false); }
  };

  const handleDeleteCustomDoc = async (itemId: string) => {
    if (!user || !dossier) return;
    try {
      await deleteCustomPreHireDocumentRequest(entityId, dossier.dossierId, itemId, user.uid);
      toast({ title: "Demande retirée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  const handleUpdateDoc = async (itemId: string, status: PreHireDocumentStatus, reason?: string) => {
    if (!user || !dossier || !entityId) return;
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
    e.target.value = "";
  };

  const handleExecuteUpload = async () => {
    if (!pendingUploadItem || !pendingUploadFile || !user || !offer || !dossier) return;
    setIsUploadingPreHireDocument(true);
    setUploadingItem(pendingUploadItem.itemId);
    try {
      await uploadPreHireDocument({
        entityId, dossierId: dossier.dossierId, item: pendingUploadItem,
        file: pendingUploadFile, offer, actorUid: user.uid,
        actorName: membership?.userDisplayName || undefined, expiresAt: pendingExpiresAt || undefined
      });
      toast({ title: "Document téléversé" });
      setIsUploadDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setIsUploadingPreHireDocument(false);
      setUploadingItem(null);
      setPendingUploadItem(null);
      setPendingUploadFile(null);
    }
  };

  const handleConsultDocument = async (item: PreHireDocument) => {
    if (!item.fileId) return;
    setLoadingFileId(item.itemId);
    try {
      const docSnap = await getDoc(doc(db!, `entities/${entityId}/documents`, item.fileId));
      if (!docSnap.exists()) throw new Error("Document introuvable.");
      const url = await getDocumentDownloadUrl(docSnap.data().storagePath);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setLoadingFileId(null); }
  };

  const handleSaveUniLav = async () => {
    if (!user || !mandatoryCommunication || !entityId) return;
    setSavingUniLav(true);
    try {
      const commRef = doc(db!, `entities/${entityId}/mandatoryCommunications`, mandatoryCommunication.id);
      const isComplete = uniLavData.protocolNumber && uniLavData.submittedAt && uniLavData.receiptPdfUrl;
      await updateDoc(commRef, { ...uniLavData, status: isComplete ? "receipt_received" : "draft", updatedAt: serverTimestamp(), updatedBy: user.uid });
      toast({ title: "Données UniLav enregistrées" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setSavingUniLav(false); }
  };

  const handleSendDocRequest = async (entityId: string, dossierId: string, actorUid: string) => {
    try {
      setSaving(true);
      await sendDocumentRequestEmail(entityId, dossierId, actorUid);
      toast({ title: "Email envoyé", description: "Le candidat a été relancé." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSendViaEmail = async () => {
    if (!user || !entityId || !requestId || !offer) return;
    if (!consultantForm.email) {
      toast({ variant: "destructive", title: "Email manquant", description: "Veuillez renseigner l'email du consultant." });
      return;
    }

    setProcessing(true);
    try {
      const result = await getConsultantCPIEmailPreviewAction({
        entityId,
        requestId,
        templateData: {
          consultantName: consultantForm.name || "Consulente",
          candidateName: offer.candidateDisplayName || "Candidato",
          candidateEmail: offer.candidateEmail || undefined,
          candidatePhone: offer.candidatePhone || undefined,
          jobTitle: offer.jobTitleName || "da definire",
          companyName: entity?.nomEntreprise || "la nostra azienda",
          plannedHireDate: offer.proposedStartDate || "da definire",
          contractType: offer.contractType || "da definire",
          requestId: requestId
        }
      });

      if (!result.success) throw new Error((result as any).error || "Impossible de générer l'aperçu.");

      setEditableSubject(result.preview!.subject);
      setEditableBody(result.preview!.text);
      setEmailPreview({
        to: consultantForm.email,
        subject: result.preview!.subject,
        html: result.preview!.html
      });
      setIsPreviewOpen(true);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'aperçu", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleTestUniLav = () => {
    toast({ title: "Mode Test", description: "Simulation de conformité UniLav activée." });
  };

  const isAccepted = offer?.status === 'accepted';
  const isUniLavDone = mandatoryCommunication?.status === "receipt_received" || mandatoryCommunication?.testMode === true;
  const isConverted = offer?.conversionStatus === 'converted';
  const canConvert = dossier?.readyForConversion && isUniLavDone && !isConverted;

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (!dossier?.readyForConversion) {
      const missing = checklist?.filter(i => i.isRequired && i.status !== 'approved' && i.status !== 'not_applicable').map(i => i.label);
      if (missing && missing.length > 0) {
        missing.forEach(m => list.push(`Attente validation : ${m}`));
      } else if (!checklist || checklist.length === 0) {
        list.push("Dossier RH non initialisé");
      }
    }
    if (!isUniLavDone) list.push("Communication UniLav / CPI non complétée");
    return list;
  }, [dossier, checklist, isUniLavDone]);

  const validatedCount = checklist?.filter(i => i.isRequired && (i.status === 'approved' || i.status === 'not_applicable')).length || 0;
  const requiredCount = checklist?.filter(i => i.isRequired).length || 0;

  if (membershipLoading || loadingOffer) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!offer) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-20">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Offre introuvable</h2>
        <Button onClick={() => router.back()}>Retour à la liste</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32 space-y-12">
      {/* 1. Header with Stepper */}
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/employment-offers`)} className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-primary tracking-tight">Onboarding Funnel</h1>
                {getStatusBadge(offer.status as EmploymentOfferStatus)}
              </div>
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">Candidat : {offer.candidateDisplayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
             {!isConverted && !["accepted", "sent", "viewed"].includes(offer.status) && (
               <Button variant="outline" onClick={() => handleSave()} disabled={saving} className="bg-white font-bold rounded-xl"><Save className="w-4 h-4 mr-2" /> Brouillon</Button>
             )}
             {offer.status === 'ready_to_send' && <Button onClick={handleSend} disabled={sending} className="bg-primary text-white font-black rounded-xl px-6"><Send className="w-4 h-4 mr-2" /> Envoyer offre</Button>}
          </div>
        </div>

        {/* Stepper Component */}
        <div className="grid grid-cols-4 gap-4 px-4">
           <Step label="Offre" active={true} completed={["sent", "viewed", "accepted", "declined"].includes(offer.status)} icon={FileSignature} />
           <Step label="Dossier RH" active={offer.status === 'accepted'} completed={dossier?.readyForConversion} icon={ClipboardList} />
           <Step label="UniLav" active={dossier?.readyForConversion} completed={isUniLavDone} icon={Globe} />
           <Step label="Embauche" active={isUniLavDone} completed={isConverted} icon={UserPlus} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* 2. Dossier Section */}
          {(offer.status === 'accepted' || isConverted) && (
            <Card className={cn("border-2 rounded-[2rem] overflow-hidden shadow-xl transition-all", dossier?.readyForConversion ? "border-green-100 bg-green-50/5" : "border-primary/5")}>
              <CardHeader className="bg-primary/5 border-b py-6 px-8 flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-primary text-white p-2.5 rounded-xl"><ClipboardList className="w-5 h-5" /></div>
                  <div>
                    <CardTitle className="text-lg font-black text-primary">Dossier de Pré-embauche</CardTitle>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">{validatedCount} / {requiredCount} validés</p>
                  </div>
                </div>
                {!isConverted && (
                   <div className="flex items-center gap-2">
                     <Button variant="outline" size="sm" onClick={() => setIsCustomDocOpen(true)} className="h-8 rounded-xl font-bold bg-white gap-2 border-dashed">
                        <Plus className="w-3.5 h-3.5" /> Ajouter demande
                     </Button>
                     <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleSendDocRequest(entityId, dossier!.dossierId, user?.uid || "")} 
                        disabled={saving || !user} 
                        className="h-8 rounded-xl font-bold bg-white gap-2"
                      >
                        <Send className="w-3.5 h-3.5" /> Relancer candidat
                     </Button>
                   </div>
                )}
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                {!dossier ? (
                  <div className="py-12 flex flex-col items-center gap-4 text-center">
                    <AlertCircle className="w-10 h-10 text-orange-400" />
                    <p className="text-sm font-medium text-slate-600">Le dossier n'est pas encore initialisé.</p>
                    <Button onClick={handleInitDossier} disabled={saving} className="rounded-xl">Initialiser maintenant</Button>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {checklist?.map(item => (
                      <div key={item.itemId} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm group hover:border-primary/20 transition-all">
                        <div className="flex items-center gap-4">
                           <div className={cn("p-2 rounded-xl shrink-0", 
                             item.status === 'approved' ? "bg-green-100 text-green-600" : 
                             item.status === 'rejected' ? "bg-red-100 text-red-600" : 
                             item.status === 'uploaded' ? "bg-orange-100 text-orange-600" : "bg-slate-100 text-slate-400")}>
                             <FileText className="w-5 h-5" />
                           </div>
                           <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-black text-slate-800 truncate">{item.label}</p>
                                {item.isRequired ? (
                                  <Badge variant="outline" className="text-[8px] font-black uppercase h-4 px-1.5 border-red-200 text-red-700 bg-red-50">Requis</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[8px] font-black uppercase h-4 px-1.5 border-slate-200 text-slate-400 bg-slate-50">Optionnel</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                 {getDocStatusBadge(item.status)}
                                 {item.description && <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{item.description}</span>}
                              </div>
                           </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                           {item.fileId && (
                             <Button variant="secondary" size="sm" className="h-8 rounded-xl font-bold bg-primary/5 text-primary gap-1.5" onClick={() => handleConsultDocument(item)}>
                               {loadingFileId === item.itemId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                               Voir
                             </Button>
                           )}
                           {!isConverted && (
                             <>
                               {item.status === 'missing' && (
                                 <div className="relative">
                                    <Button variant="outline" size="sm" className="h-8 rounded-xl font-bold border-dashed border-2 gap-1.5">
                                       <Upload className="w-3.5 h-3.5" />
                                       Joindre
                                    </Button>
                                    <input type="file" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={(e) => handleUploadPreHireDoc(item, e)} />
                                 </div>
                               )}
                               {item.status === 'uploaded' && (
                                 <>
                                   <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => handleUpdateDoc(item.itemId, 'approved')}><CheckCircle2 className="w-4 h-4" /></Button>
                                   <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setRejectItem({ id: item.itemId, reason: "" })}><XCircle className="w-4 h-4" /></Button>
                                 </>
                               )}
                               {item.isCustom && item.status === 'missing' && !item.fileId && (
                                 <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteCustomDoc(item.itemId)}><Trash2 className="w-4 h-4" /></Button>
                               )}
                             </>
                           )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 3. UniLav Section */}
          {(isAccepted || isConverted) && (
            <Card className="border-primary/10 rounded-[2rem] shadow-xl overflow-hidden bg-white">
              <CardHeader className="bg-secondary/10 border-b py-6 px-8 flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                   <div className="bg-primary text-white p-2.5 rounded-xl"><Globe className="w-5 h-5" /></div>
                   <div>
                     <CardTitle className="text-lg font-black text-primary">Compliance UniLav / CPI</CardTitle>
                     <p className="text-[10px] uppercase font-bold text-muted-foreground">Communication obligatoire Italie</p>
                   </div>
                </div>
                {mandatoryCommunication && (
                   <Badge variant="outline" className={cn("font-black uppercase h-7 px-3 border-2", 
                     isUniLavDone ? "bg-green-50 text-green-700 border-green-200" : "bg-orange-50 text-orange-700 border-orange-200"
                   )}>
                      {isUniLavDone ? "Complétée" : "À faire"}
                   </Badge>
                )}
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                {!mandatoryCommunication ? (
                  <div className="py-6 text-center text-xs italic text-muted-foreground">Module de communication non actif.</div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Numéro Protocole</Label>
                          <Input value={uniLavData.protocolNumber} onChange={(e) => setUniLavData(p => ({...p, protocolNumber: e.target.value}))} disabled={isConverted} placeholder="Ex: 2024-XXX..." className="rounded-xl font-mono h-11" />
                       </div>
                       <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Date de soumission</Label>
                          <Input type="date" value={uniLavData.submittedAt} onChange={(e) => setUniLavData(p => ({...p, submittedAt: e.target.value}))} disabled={isConverted} className="rounded-xl h-11" />
                       </div>
                       <div className="space-y-2 col-span-full">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">URL du récépissé (PDF)</Label>
                          <Input value={uniLavData.receiptPdfUrl} onChange={(e) => setUniLavData(p => ({...p, receiptPdfUrl: e.target.value}))} disabled={isConverted} placeholder="https://..." className="rounded-xl h-11" />
                       </div>
                    </div>
                    
                    {!isConverted && (
                      <div className="flex justify-between items-center gap-4">
                         <div className="flex gap-2">
                           <Button variant="outline" onClick={handleSaveUniLav} disabled={savingUniLav} className="rounded-xl font-bold h-10 px-6">
                              {savingUniLav ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Sauvegarder
                           </Button>
                           <Button variant="outline" onClick={handleTestUniLav} disabled={savingUniLav} className="rounded-xl border-orange-200 text-orange-700 font-bold h-10 px-6">Mode Test</Button>
                         </div>
                         {mandatoryCommunication.emailBody && (
                            <Button variant="ghost" className="text-primary font-bold text-xs" onClick={() => { navigator.clipboard.writeText(mandatoryCommunication.emailBody); toast({ title: "Email copié" }); }}>Copier mail consultant</Button>
                         )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Standard Offer Details - Hidden when converted for focus */}
          {!isConverted && (
            <Card className="border-primary/5 rounded-[2rem] overflow-hidden opacity-80 grayscale-[0.2]">
               <CardHeader className="py-4 px-8 border-b bg-slate-50">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                     <FileSignature className="w-4 h-4" /> Détails de la proposition
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8">
                  <div className="grid grid-cols-2 gap-8">
                     <DetailItem label="Type contrat" value={formData.contractType} />
                     <DetailItem label="RAL" value={`€ ${formData.proposedGrossAnnual?.toLocaleString()}`} />
                     <DetailItem label="CCNL" value={formData.ccnlName} />
                     <DetailItem label="Niveau" value={formData.levelCode} />
                  </div>
               </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-8">
           {/* 4. Embauche Finale Card */}
           {(isAccepted || isConverted) && (
             <Card className={cn("border-2 rounded-[2.5rem] shadow-2xl overflow-hidden transition-all", canConvert ? "border-green-500 ring-4 ring-green-50" : "border-primary/10 opacity-80")}>
                <CardHeader className={cn("py-6 px-8 border-b", canConvert ? "bg-green-600 text-white" : "bg-primary/90 text-white")}>
                   <div className="flex items-center gap-3">
                      <div className="bg-white/20 p-2.5 rounded-xl"><UserPlus className="w-6 h-6" /></div>
                      <CardTitle className="text-xl font-black">Embauche finale</CardTitle>
                   </div>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                   {isConverted ? (
                      <div className="space-y-4 text-center">
                         <div className="bg-green-100 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto text-green-600"><CheckCircle2 className="w-10 h-10" /></div>
                         <p className="font-bold text-slate-800">Le recrutement est finalisé.</p>
                         <Button asChild className="w-full h-12 rounded-xl font-black bg-primary text-white shadow-lg">
                            <Link href={`/entity/${entityId}/employees/${offer.employeeId}`}>Voir la fiche employé</Link>
                         </Button>
                      </div>
                   ) : (
                      <>
                        <div className="space-y-4">
                           {blockers.length > 0 ? (
                             <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Actions requises avant création :</p>
                                <div className="space-y-2">
                                   {blockers.map((b, i) => (
                                     <div key={i} className="flex items-start gap-2 text-xs font-bold text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">
                                        <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{b}</span>
                                     </div>
                                   ))}
                                </div>
                             </div>
                           ) : (
                             <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-start gap-3 animate-in zoom-in-95">
                                <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
                                <p className="text-sm font-bold text-green-800 leading-tight">Le dossier est complet. Toutes les validations compliance sont terminées. Vous pouvez créer l'employé.</p>
                             </div>
                           )}
                        </div>

                        <Button 
                          onClick={() => setIsConvertDialogOpen(true)} 
                          disabled={!canConvert || converting} 
                          className={cn("w-full h-16 rounded-2xl text-lg font-black shadow-xl transition-all", 
                            canConvert ? "bg-green-600 hover:bg-green-700 text-white" : "bg-slate-100 text-slate-300"
                          )}
                        >
                           {converting ? <Loader2 className="w-6 h-6 animate-spin mr-2" /> : <UserPlus className="w-6 h-6 mr-2" />}
                           Créer l'employé
                        </Button>
                      </>
                   )}
                </CardContent>
             </Card>
           )}

           <Card className="rounded-[2rem] border-primary/5 bg-secondary/5 overflow-hidden">
             <CardHeader className="py-5 px-8 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Timeline Proposition
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <AuditRow label="Acceptée le" value={formatDateTime(offer.respondedAt)} />
                <AuditRow label="Dernier envoi" value={formatDateTime(offer.sentAt)} />
                <AuditRow label="Vue" value={`${offer.viewCount || 0} fois`} />
             </CardContent>
           </Card>
        </div>
      </div>

      {/* Add Custom Doc Dialog */}
      <Dialog open={isCustomDocOpen} onOpenChange={setIsCustomDocOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
           <DialogHeader>
              <DialogTitle className="text-xl font-black text-primary">Ajouter une demande</DialogTitle>
              <DialogDescription>Sollicitez un document spécifique auprès du candidat.</DialogDescription>
           </DialogHeader>
           <form onSubmit={handleAddCustomDoc} className="space-y-5 py-4">
              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Libellé du document</Label>
                 <Input value={customDocForm.label} onChange={(e) => setCustomDocForm(p => ({...p, label: e.target.value}))} required placeholder="Ex: Permis de conduire..." className="rounded-xl h-11" />
              </div>
              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Type</Label>
                 <Select value={customDocForm.type} onValueChange={(v) => setCustomDocForm(p => ({...p, type: v}))}>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="identity_document">Identité</SelectItem>
                       <SelectItem value="professional_qualification">Diplôme / Certif.</SelectItem>
                       <SelectItem value="residence_permit">Permis séjour</SelectItem>
                       <SelectItem value="other">Autre document</SelectItem>
                    </SelectContent>
                 </Select>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border">
                 <Label className="font-bold text-sm">Réponse obligatoire</Label>
                 <Switch checked={customDocForm.isRequired} onCheckedChange={(v) => setCustomDocForm(p => ({...p, isRequired: v}))} />
              </div>
              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Description (Optionnel)</Label>
                 <Textarea value={customDocForm.description} onChange={(e) => setCustomDocForm(p => ({...p, description: e.target.value}))} className="rounded-xl min-h-[80px]" />
              </div>
              <DialogFooter className="pt-2">
                 <Button type="button" variant="ghost" onClick={() => setIsCustomDocOpen(false)}>Annuler</Button>
                 <Button type="submit" disabled={saving || !customDocForm.label} className="rounded-xl px-8 font-black">Ajouter à la checklist</Button>
              </DialogFooter>
           </form>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
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

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[450px]">
          <DialogHeader><DialogTitle className="text-xl font-black text-primary">Téléverser le document</DialogTitle></DialogHeader>
          <div className="py-6 space-y-4">
            <p className="text-sm font-medium text-slate-600">Document : <span className="font-bold text-primary">{pendingUploadItem?.label}</span></p>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black">Date d'échéance (Optionnel)</Label>
              <Input type="date" value={pendingExpiresAt} onChange={(e) => setPendingExpiresAt(e.target.value)} className="h-12 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
             <Button variant="ghost" onClick={() => { setIsUploadDialogOpen(false); setPendingUploadFile(null); }}>Annuler</Button>
             <Button onClick={handleExecuteUpload} className="rounded-xl px-8 font-black shadow-lg" disabled={isUploadingPreHireDocument}>
                {isUploadingPreHireDocument ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />} Confirmer
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final Conversion Alert */}
      <AlertDialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'embauche</AlertDialogTitle>
            <AlertDialogDescription>Le dossier compliance est validé. Souhaitez-vous créer officiellement le profil employé et générer le contrat de travail ?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={converting} className="bg-green-600 hover:bg-green-700 text-white font-black rounded-xl px-8 shadow-lg">
               {converting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />} Confirmer l'embauche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Step({ label, active, completed, icon: Icon }: any) {
  return (
    <div className="flex flex-col items-center gap-3 relative">
       <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center transition-all z-10 border-2", 
         completed ? "bg-green-600 border-green-600 text-white shadow-lg shadow-green-100" : 
         active ? "bg-primary border-primary text-white shadow-lg shadow-primary/10" : "bg-white border-slate-200 text-slate-300"
       )}>
          {completed ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-5 h-5" />}
       </div>
       <p className={cn("text-[9px] font-black uppercase tracking-widest", 
         completed ? "text-green-700" : active ? "text-primary" : "text-slate-400"
       )}>{label}</p>
    </div>
  );
}

function getStatusBadge(status: string) {
  const map: any = {
    accepted: { label: "Acceptée", color: "bg-green-500" },
    sent: { label: "Envoyée", color: "bg-primary" },
    draft: { label: "Brouillon", color: "bg-slate-200 text-slate-700" },
    internal_review: { label: "En revue", color: "bg-orange-50 text-orange-700" },
    ready_to_send: { label: "Prête", color: "bg-blue-50 text-blue-700" },
    viewed: { label: "Consultée", color: "bg-cyan-500" },
    declined: { label: "Refusée", color: "bg-red-500" }
  };
  const config = map[status] || { label: status, color: "bg-slate-100 text-slate-500" };
  return <Badge className={cn("px-2 uppercase text-[9px] font-black border-none", config.color)}>{config.label}</Badge>;
}

function getDocStatusBadge(status: string) {
  switch(status) {
    case 'approved': return <div className="flex items-center gap-1 text-[9px] font-black text-green-600 uppercase"><CheckCircle2 className="w-3 h-3" /> Validé</div>;
    case 'uploaded': return <div className="flex items-center gap-1 text-[9px] font-black text-orange-500 uppercase"><Clock className="w-3 h-3" /> Reçu (À valider)</div>;
    case 'rejected': return <div className="flex items-center gap-1 text-[9px] font-black text-red-600 uppercase"><XCircle className="w-3 h-3" /> Rejeté</div>;
    case 'not_applicable': return <div className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase">N/A</div>;
    default: return <div className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase"><Circle className="w-3 h-3 opacity-20" /> Manquant</div>;
  }
}

function DetailItem({ label, value }: any) {
  return (
    <div className="space-y-0.5">
       <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
       <p className="text-sm font-bold text-slate-700">{value || "—"}</p>
    </div>
  );
}

function AuditRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center text-[11px] font-bold">
       <span className="text-muted-foreground font-medium uppercase text-[9px]">{label}</span>
       <span className="text-slate-700">{value}</span>
    </div>
  );
}

function formatDateTime(val: any): string {
  if (!val) return "-";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return format(d, "dd/MM/yyyy", { locale: fr });
  } catch (e) { return "-"; }
}
