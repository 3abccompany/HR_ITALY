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
  History,
  Mail,
  Phone,
  Fingerprint,
  Edit,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFirebase, useDoc, useUser, useCollection, useAuth } from "@/firebase";
import { doc, DocumentReference, collection, query, where, Query, getDoc, orderBy } from "firebase/firestore";
import { EmploymentOffer, EmploymentOfferStatus } from "@/types/employment-offer";
import { PreHireDossier, PreHireDocument, PreHireDocumentStatus } from "@/types/pre-hire-dossier";
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

/**
 * Employment Offer Detail Page / Onboarding Funnel.
 */
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

  const offerRef = useMemo(() => 
    db && entityId && offerId ? (doc(db, `entities/${entityId}/employmentOffers`, offerId) as DocumentReference<EmploymentOffer>) : null,
  [db, entityId, offerId]);
  
  const { data: offer, loading: loadingOffer } = useDoc<EmploymentOffer>(offerRef);

  // Pre-Hire Dossier Query
  const dossierQuery = useMemo(() => 
    db && entityId && offerId ? query(collection(db, `entities/${entityId}/preHireDossiers`), where("employmentOfferId", "==", offerId)) as Query<PreHireDossier> : null,
  [db, entityId, offerId]);
  const { data: dossiers } = useCollection<PreHireDossier>(dossierQuery);
  const dossier = dossiers?.[0];

  const canReadCPI = hasPermission("employmentRequests.read");
  const standaloneRequestRef = useMemo(() => 
    db && entityId && offerId && canReadCPI ? doc(db, `entities/${entityId}/employmentRequests`, `unilav_${offerId}`) as DocumentReference<any> : null,
  [db, entityId, offerId, canReadCPI]);
  const { data: standaloneRequest } = useDoc<any>(standaloneRequestRef);

  // Dossier Checklist Query
  const checklistQuery = useMemo(() => {
    if (!dossier || !db || !entityId) return null;
    return query(collection(db, `entities/${entityId}/preHireDossiers/${dossier.dossierId}/checklist`), orderBy("createdAt", "asc")) as Query<PreHireDocument>;
  }, [db, entityId, dossier]);
  const { data: checklist } = useCollection<PreHireDocument>(checklistQuery);

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
  
  const { data: communications } = useCollection<any>(mandatoryCommunicationQuery);
  
  const mandatoryCommunication = communications?.find(
    (item: any) => item.type === "UNILAV_ASSUNZIONE"
  );

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false);
  const [rejectItem, setRejectItem] = useState<{ id: string, reason: string } | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);

  // Edit Mode States
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<EmploymentOffer>>({});

  // Upload States
  const [pendingUploadItem, setPendingUploadItem] = useState<PreHireDocument | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [pendingExpiresAt, setPendingExpiresAt] = useState("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploadingPreHireDocument, setIsUploadingPreHireDocument] = useState(false);

  // Custom Doc Dialog State
  const [isCustomDocOpen, setIsCustomDocOpen] = useState(false);
  const [customDocForm, setCustomDocForm] = useState({ label: "", type: "other", isRequired: true, description: "" });

  const annualToDisplay = useMemo(() => {
    if (!offer) return null;
    if (offer.proposedGrossAnnual && offer.proposedGrossAnnual > 0) return offer.proposedGrossAnnual;
    const m = Number(offer.proposedGrossMonthly || 0);
    const p = Number(offer.monthlyPayments ?? 13);
    if (m > 0) return m * p;
    return null;
  }, [offer]);

  const handleEnterEdit = () => {
    if (offer) {
      const monthly = offer.proposedGrossMonthly || 0;
      const payments = offer.monthlyPayments || 13;
      const annual = offer.proposedGrossAnnual || (monthly > 0 ? Number((monthly * payments).toFixed(2)) : 0);

      setEditForm({
        contractType: offer.contractType || "",
        ccnlName: offer.ccnlName || "",
        levelCode: offer.levelCode || "",
        proposedStartDate: offer.proposedStartDate || "",
        proposedEndDate: offer.proposedEndDate || "",
        weeklyHours: offer.weeklyHours || 40,
        workingTime: offer.workingTime || "Tempo pieno (Full-time)",
        trialPeriodDays: offer.trialPeriodDays || 0,
        proposedGrossMonthly: monthly,
        monthlyPayments: payments,
        proposedGrossAnnual: annual,
        salaryNotes: offer.salaryNotes || ""
      });
      setIsEditing(true);
    }
  };

  const handleUpdateEditField = (key: keyof EmploymentOffer, value: any) => {
    setEditForm(prev => {
      const next = { ...prev, [key]: value };
      
      // Auto calculation for salary
      if (key === 'proposedGrossMonthly' || key === 'monthlyPayments') {
        const monthly = key === 'proposedGrossMonthly' ? (value ? Number(value) : 0) : (prev.proposedGrossMonthly || 0);
        const payments = key === 'monthlyPayments' ? (value ? Number(value) : 13) : (prev.monthlyPayments || 13);
        
        if (monthly > 0) {
          next.proposedGrossAnnual = Number((monthly * payments).toFixed(2));
        } else {
          next.proposedGrossAnnual = 0;
        }
      }
      
      return next;
    });
  };

  const handleSaveEdit = async () => {
    if (!user || !entityId || !offerId) return;
    setSaving(true);
    try {
      await updateEmploymentOffer(entityId, offerId, editForm, user.uid);
      setIsEditing(false);
      toast({ title: "Proposition mise à jour" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!user || !entityId || !offerId || !offer) return;
    setSending(true);
    try {
      const result = await initiateOfferSend(entityId, offerId, user.uid);
      if (result && result.success) {
        toast({ title: "Offre envoyée", description: "Le candidat a été notifié par email." });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur lors de l'envoi", description: err.message });
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
    } finally {
      setSaving(false);
    }
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

  const handleSendDocRequest = async (eId: string, dId: string, uId: string) => {
    setSaving(true);
    try {
      await sendDocumentRequestEmail(eId, dId, uId);
      toast({ title: "Relance envoyée", description: "Le candidat a été invité à compléter son dossier." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
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
    try {
      await uploadPreHireDocument({
        entityId, dossierId: dossier.dossierId, item: pendingUploadItem,
        file: pendingUploadFile, offer, actorUid: user.uid,
        actorName: membership?.userDisplayName || undefined, expiresAt: pendingExpiresAt || undefined,
        oldFileId: pendingUploadItem.fileId
      });
      toast({ title: "Document téléversé" });
      setIsUploadDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setIsUploadingPreHireDocument(false);
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
      window.open(url, '_blank');
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally { setLoadingFileId(null); }
  };

  const isAccepted = offer?.status === 'accepted';
  const isUniLavDone = mandatoryCommunication?.status === "receipt_received" || standaloneRequest?.status === 'completed';
  const isConverted = offer?.conversionStatus === 'converted';
  const canConvert = dossier?.readyForConversion && isUniLavDone && !isConverted;

  const canManage = hasPermission("contracts.create") || hasPermission("contracts.update");

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
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><FileText className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Proposition introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/employment-offers`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32 space-y-12">
      {/* Header with Onboarding Stepper */}
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
             {canManage && !isEditing && (offer.status === 'draft' || offer.status === 'internal_review' || offer.status === 'ready_to_send') && (
               <Button variant="outline" onClick={handleEnterEdit} className="rounded-xl font-bold bg-white gap-2">
                  <Edit className="w-4 h-4" /> Modifier la proposition
               </Button>
             )}
             {isEditing && (
               <>
                 <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={saving}>Annuler</Button>
                 <Button onClick={handleSaveEdit} disabled={saving} className="bg-green-600 text-white font-black rounded-xl px-6 shadow-lg gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Enregistrer les modifications
                 </Button>
               </>
             )}
             {canManage && (offer.status === 'draft' || offer.status === 'ready_to_send' || offer.status === 'sent' || offer.status === 'viewed') && !isEditing && (
               <Button onClick={handleSend} disabled={sending} className="bg-primary text-white font-black rounded-xl px-6 shadow-lg shadow-primary/10 gap-2">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {offer.status === 'draft' || offer.status === 'ready_to_send' ? "Envoyer au candidat" : "Renvoyer l'offre"}
               </Button>
             )}
          </div>
        </div>

        {/* Dynamic Funnel Progress Bar */}
        <div className="grid grid-cols-5 gap-4 px-4">
           <Step label="Brouillon" active={offer.status === 'draft'} completed={offer.status !== 'draft'} icon={FileSignature} date={formatDateTime(offer.createdAt)} />
           <Step label="Envoyée" active={offer.status === 'sent'} completed={['sent', 'viewed', 'accepted', 'declined'].includes(offer.status)} icon={Send} date={formatDateTime(offer.sentAt)} />
           <Step label="Vue" active={offer.status === 'viewed'} completed={['viewed', 'accepted', 'declined'].includes(offer.status)} icon={Eye} date={formatDateTime(offer.viewedAt || offer.lastViewedAt)} />
           <Step label="Acceptée" active={offer.status === 'accepted'} completed={isConverted} icon={CheckCircle2} date={formatDateTime(offer.respondedAt)} />
           <Step label="Embauche" active={isConverted} completed={isConverted} icon={UserPlus} date={isConverted ? formatDateTime(offer.updatedAt) : ""} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Identité Candidat
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                <DetailItem label="Nom Complet" value={offer.candidateDisplayName} icon={User} />
                <DetailItem label="Email" value={offer.candidateEmail} icon={Mail} />
                <DetailItem label="Téléphone" value={offer.candidatePhone} icon={Phone} />
                <DetailItem label="Proposé le" value={formatDate(offer.createdAt)} icon={Calendar} />
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Contexte Poste
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                <DetailItem label="Intitulé du Poste" value={offer.jobTitleName} icon={Briefcase} />
                <DetailItem label="Département" value={offer.departmentName} icon={Building2} />
                <DetailItem label="Site d'affectation" value={offer.worksiteName} icon={MapPin} />
                {offer.recruitmentNeedTitle && <DetailItem label="Projet de recrutement" value={offer.recruitmentNeedTitle} icon={Info} />}
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <FileText className="w-4 h-4" /> Conditions Contractuelles
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                {isEditing ? (
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Type de contrat</Label>
                         <Input value={editForm.contractType ?? ""} onChange={(e) => handleUpdateEditField('contractType', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Temps de travail</Label>
                         <Input value={editForm.workingTime ?? ""} onChange={(e) => handleUpdateEditField('workingTime', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">CCNL appliqué</Label>
                         <Input value={editForm.ccnlName ?? ""} onChange={(e) => handleUpdateEditField('ccnlName', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Niveau / Livello</Label>
                         <Input value={editForm.levelCode ?? ""} onChange={(e) => handleUpdateEditField('levelCode', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Date de début prévue</Label>
                         <Input type="date" value={editForm.proposedStartDate ?? ""} onChange={(e) => handleUpdateEditField('proposedStartDate', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Date de fin prévue (CDD)</Label>
                         <Input type="date" value={editForm.proposedEndDate ?? ""} onChange={(e) => handleUpdateEditField('proposedEndDate', e.target.value)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Heures hebdomadaires</Label>
                         <Input type="number" value={editForm.weeklyHours ?? ""} onChange={(e) => handleUpdateEditField('weeklyHours', e.target.value ? parseFloat(e.target.value) : 0)} className="rounded-xl" />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black text-muted-foreground">Période d'essai (jours)</Label>
                         <Input type="number" value={editForm.trialPeriodDays ?? ""} onChange={(e) => handleUpdateEditField('trialPeriodDays', e.target.value ? parseInt(e.target.value) : 0)} className="rounded-xl" />
                      </div>
                   </div>
                ) : (
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <DetailItem label="Type de contrat" value={offer.contractType} />
                      <DetailItem label="Temps de travail" value={offer.workingTime || "Temps plein"} icon={Clock} />
                      <DetailItem label="CCNL appliqué" value={offer.ccnlName} icon={Scale} />
                      <DetailItem label="Niveau / Livello" value={offer.levelCode ? `${offer.levelCode} (${offer.levelLabel || ''})` : '—'} />
                      <DetailItem label="Date de début prévue" value={formatDate(offer.proposedStartDate)} icon={Calendar} />
                      <DetailItem label="Date de fin (si CDD)" value={formatDate(offer.proposedEndDate)} icon={Calendar} />
                      <DetailItem label="Heures hebdomadaires" value={offer.weeklyHours ? `${offer.weeklyHours}h` : '—'} />
                      <DetailItem label="Période d'essai (jours)" value={offer.trialPeriodDays} />
                   </div>
                )}
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Euro className="w-4 h-4" /> Rémunération
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-8">
                {isEditing ? (
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-2">
                         <Label className="text-[10px] font-black uppercase text-muted-foreground">Brut Mensuel (€)</Label>
                         <Input 
                           type="number" 
                           step="0.01" 
                           value={editForm.proposedGrossMonthly ?? ""} 
                           onChange={(e) => handleUpdateEditField('proposedGrossMonthly', e.target.value ? parseFloat(e.target.value) : 0)} 
                           className="rounded-xl"
                         />
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] font-black uppercase text-muted-foreground">Mensualités</Label>
                         <Select 
                           value={String(editForm.monthlyPayments ?? 13)} 
                           onValueChange={(v) => handleUpdateEditField('monthlyPayments', parseInt(v))}
                         >
                           <SelectTrigger className="rounded-xl">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              <SelectItem value="12">12 mensualités</SelectItem>
                              <SelectItem value="13">13 mensualités</SelectItem>
                              <SelectItem value="14">14 mensualités</SelectItem>
                           </SelectContent>
                         </Select>
                      </div>
                      <div className="space-y-2">
                         <Label className="text-[10px] font-black uppercase text-muted-foreground">RAL (Auto-calculé)</Label>
                         <Input 
                           type="number" 
                           value={editForm.proposedGrossAnnual ?? ""} 
                           readOnly
                           className="rounded-xl bg-slate-50 font-bold"
                         />
                      </div>
                      <div className="col-span-full space-y-2">
                         <Label className="text-[10px] font-black uppercase text-muted-foreground">Notes sur la rémunération</Label>
                         <Textarea 
                           value={editForm.salaryNotes ?? ""} 
                           onChange={(e) => handleUpdateEditField('salaryNotes', e.target.value)} 
                           className="rounded-xl min-h-[80px]"
                         />
                      </div>
                   </div>
                ) : (
                   <div className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                         <div className="bg-slate-50 p-4 rounded-2xl border text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Brut Mensuel</p>
                            <p className="text-xl font-black text-slate-800">€ {offer.proposedGrossMonthly?.toLocaleString('fr-FR') || "—"}</p>
                            <p className="text-[8px] text-muted-foreground font-bold uppercase mt-1">{offer.monthlyPayments || 13} mensualités</p>
                         </div>
                         <div className="md:col-span-2 bg-primary/5 p-4 rounded-2xl border border-primary/10 text-center ring-2 ring-primary/5">
                            <p className="text-[9px] font-black uppercase text-primary/60 mb-1">RAL (Annuel estimé)</p>
                            <p className="text-xl font-black text-primary">€ {annualToDisplay?.toLocaleString('fr-FR') || "—"}</p>
                         </div>
                      </div>
                      {offer.salaryNotes && (
                        <div className="p-4 bg-slate-50 border-l-4 border-primary rounded-r-xl text-xs text-slate-600 italic">
                           "{offer.salaryNotes}"
                        </div>
                      )}
                   </div>
                )}
             </CardContent>
          </Card>

          {/* Compliance Phase (visible after acceptance) */}
          {(offer.status === 'accepted' || isConverted) && (
            <>
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
                          onClick={() => user && dossier && handleSendDocRequest(entityId, dossier.dossierId, user.uid)} 
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
                                  {item.isRequired && <Badge variant="outline" className="text-[8px] font-black uppercase h-4 border-red-200 text-red-700 bg-red-50">Requis</Badge>}
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
                                 {(item.status === 'missing' || item.status === 'uploaded' || item.status === 'rejected') && (
                                   <div className="relative">
                                      <Button variant="outline" size="sm" className="h-8 rounded-xl font-bold border-dashed border-2 gap-1.5">
                                         <Upload className="w-3.5 h-3.5" />
                                         {item.status === 'missing' ? 'Joindre' : 'Remplacer'}
                                      </Button>
                                      <input type="file" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={(e) => handleUploadPreHireDoc(item, e)} />
                                   </div>
                                 )}
                                 {item.status === 'uploaded' && (
                                   <div className="flex gap-1 ml-2">
                                     <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title="Approuver" onClick={() => handleUpdateDoc(item.itemId, 'approved')}><CheckCircle2 className="w-4 h-4" /></Button>
                                     <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Rejeter" onClick={() => setRejectItem({ id: item.itemId, reason: "" })}><XCircle className="w-4 h-4" /></Button>
                                   </div>
                                 )}
                                 {item.isCustom && item.status === 'missing' && !item.fileId && (
                                   <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Supprimer" onClick={() => handleDeleteCustomDoc(item.itemId)}><Trash2 className="w-4 h-4" /></Button>
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

              <Card className="border-primary/10 rounded-[2rem] shadow-xl overflow-hidden bg-white">
                <CardHeader className="bg-secondary/10 border-b py-6 px-8 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-3">
                     <div className="bg-primary text-white p-2.5 rounded-xl"><Globe className="w-5 h-5" /></div>
                     <div>
                       <CardTitle className="text-lg font-black text-primary">Conformité UniLav / CPI</CardTitle>
                       <p className="text-[10px] uppercase font-bold text-muted-foreground">Communication obligatoire Italie</p>
                     </div>
                  </div>
                  <Badge variant="outline" className={cn("font-black uppercase h-7 px-3 border-2", 
                    isUniLavDone ? "bg-green-50 text-green-700 border-green-200" : "bg-orange-50 text-orange-700 border-orange-200"
                  )}>
                     {isUniLavDone ? "Complétée" : "À faire"}
                  </Badge>
                </CardHeader>
                <CardContent className="p-8 space-y-6 text-center">
                    <p className="text-sm text-slate-600">
                      Gérez les déclarations obligatoires auprès des autorités compétentes.
                    </p>
                    <Button asChild variant="outline" className="w-full h-11 rounded-xl font-bold border-dashed border-2 gap-2 hover:bg-slate-50">
                       <Link href={`/entity/${entityId}/employment-requests/unilav_${offerId}`}>
                          Gérer le dossier CPI <ChevronRight className="w-4 h-4" />
                       </Link>
                    </Button>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="space-y-8">
           <Card className="rounded-[2rem] border-primary/10 shadow-xl overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <History className="w-4 h-4" /> Suivi Proposition
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-4">
                <AuditRow label="Statut" value={STATUS_LABELS[offer.status] || offer.status.toUpperCase()} />
                <AuditRow label="Vues" value={`${offer.viewCount || 0} fois`} />
                <AuditRow label="Dernier envoi" value={formatDateTime(offer.sentAt)} />
                <AuditRow label="Dernière vue" value={formatDateTime(offer.lastViewedAt || offer.viewedAt)} />
                <Separator className="opacity-50" />
                <AuditRow label="Créée le" value={formatDateTime(offer.createdAt)} />
             </CardContent>
           </Card>
        </div>
      </div>

      {/* Dialogs */}
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

      <AlertDialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'embauche</AlertDialogTitle>
            <AlertDialogDescription>Le dossier compliance est validé. Souhaitez-vous créer officiellement le profil employé ?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={converting} className="bg-green-600 hover:bg-green-700 text-white font-black rounded-xl px-8 shadow-lg">
               {converting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />} Confirmer l'embauche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
  );
}

function Step({ label, active, completed, icon: Icon, date }: any) {
  return (
    <div className="flex flex-col items-center gap-3 relative">
       <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center transition-all z-10 border-2", 
         completed ? "bg-green-600 border-green-600 text-white shadow-lg shadow-green-100" : 
         active ? "bg-primary border-primary text-white shadow-lg shadow-primary/10" : "bg-white border-slate-200 text-slate-300"
       )}>
          {completed ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-5 h-5" />}
       </div>
       <div className="text-center min-h-[32px]">
         <p className={cn("text-[9px] font-black uppercase tracking-widest leading-tight", 
           completed ? "text-green-700" : active ? "text-primary" : "text-slate-400"
         )}>{label}</p>
         {date && date !== "—" && (
           <p className="text-[8px] font-bold text-muted-foreground mt-0.5">{date}</p>
         )}
       </div>
    </div>
  );
}

function DetailItem({ label, value, icon: Icon }: any) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
      <div className="flex items-center gap-2">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/30" />}
         <p className="text-sm font-bold text-slate-700">{value || "—"}</p>
      </div>
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

function getStatusBadge(status: EmploymentOfferStatus) {
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

function formatDateTime(val: any): string {
  if (!val) return "—";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return format(d, "dd/MM/yyyy HH:mm", { locale: fr });
  } catch (e) { return "—"; }
}

function formatDate(val: any): string {
  if (!val) return "—";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return format(d, "dd/MM/yyyy", { locale: fr });
  } catch (e) { return "—"; }
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  internal_review: "En validation",
  ready_to_send: "Prête à envoyer",
  sent: "Envoyée",
  viewed: "Consultée",
  accepted: "Acceptée",
  declined: "Refusée",
  expired: "Expirée",
  cancelled: "Annulée"
};

function Circle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}
