"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, Clock, 
  Briefcase, Building2, User, Info, 
  ShieldCheck, Calendar, FileText, 
  Hash, Mail, Save, Send,
  History, AlertCircle, Eye,
  RefreshCcw, CheckCircle2,
  Upload, Download, FileCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFirebase, useDoc, useUser, useCollection } from "@/firebase";
import { doc, DocumentReference, collection, query, orderBy } from "firebase/firestore";
import { EmploymentRequest, EmploymentRequestStatus } from "@/types/employment-request";
import { Consultant } from "@/types/consultant";
import { HRDocument } from "@/types/hr-document";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  updateConsultantAssignment, 
  markAsSentToConsultant, 
  recordCpiCommunication,
  linkReceiptToEmploymentRequest,
  completeEmploymentRequest
} from "@/services/employment-request.service";
import { findConsultantByEmail, createConsultant } from "@/services/consultant.service";
import { uploadHRDocument, getDocumentDownloadUrl } from "@/services/document.service";
import { cn } from "@/lib/utils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
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
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { sendConsultantCPIRequestAction } from "@/services/email.service";

export default function EmploymentRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const requestId = params?.requestId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, entity, membership } = useActiveMembership(entityId);

  const canRead = hasPermission("employmentRequests.read");
  const canUpdate = hasPermission("employmentRequests.update") || hasPermission("employmentRequests.write");
  const canReadConsultants = hasPermission("consultants.read");

  const requestRef = useMemo(() => 
    db && entityId && requestId ? (doc(db, `entities/${entityId}/employmentRequests`, requestId) as DocumentReference<EmploymentRequest>) : null,
  [db, entityId, requestId]);

  const { data: request, loading } = useDoc<EmploymentRequest>(requestRef);

  // Consultant Registry
  const consultantsQuery = useMemo(() => {
    if (!db || !entityId || !canReadConsultants) return null;
    return query(collection(db, `entities/${entityId}/consultants`), orderBy("name", "asc"));
  }, [db, entityId, canReadConsultants]);
  const { data: consultants } = useCollection<Consultant>(consultantsQuery);

  // Receipt Document Lookup
  const receiptRef = useMemo(() => 
    db && entityId && request?.receiptDocumentId ? (doc(db, `entities/${entityId}/documents`, request.receiptDocumentId) as DocumentReference<HRDocument>) : null,
  [db, entityId, request?.receiptDocumentId]);
  const { data: receipt, loading: loadingReceipt } = useDoc<HRDocument>(receiptRef);

  // --- Local States for Forms ---
  const [consultantForm, setConsultantForm] = useState({ id: "", name: "", email: "" });
  const [sendMode, setSendMode] = useState<"email" | "portal" | "manual" | "draft_only" | "">("email");
  const [cpiForm, setCpiForm] = useState({ date: "", code: "" });
  const [processing, setProcessing] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isRegistryConfirmOpen, setIsRegistryConfirmOpen] = useState(false);

  useEffect(() => {
    if (request) {
      setConsultantForm({
        id: request.consultantId || "",
        name: request.consultantName || "",
        email: request.consultantEmail || ""
      });
      setSendMode(request.sendMode || "email");
      setCpiForm({
        date: request.cpiCommunicationDate || "",
        code: request.protocolCode || ""
      });
    }
  }, [request]);

  const isTerminal = request?.status === "completed" || request?.status === "cancelled";
  const canComplete = request && !isTerminal && request.protocolCode && request.cpiCommunicationDate && request.receiptDocumentId;

  // --- Handlers ---

  const handleSaveConsultant = async () => {
    if (!user || !entityId || !requestId) return;
    setProcessing(true);
    try {
      await updateConsultantAssignment({
        entityId,
        requestId,
        consultantId: consultantForm.id === "manual" ? null : consultantForm.id,
        consultantName: consultantForm.name,
        consultantEmail: consultantForm.email,
        actorUid: user.uid
      });
      
      if (consultantForm.id === "manual" || !consultantForm.id) {
        setIsRegistryConfirmOpen(true);
      } else {
        toast({ title: "Consultant enregistré" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmRegistrySave = async () => {
    if (!user || !entityId || !requestId || !consultantForm.email) return;
    setProcessing(true);
    try {
      // Duplicate prevention check
      const existing = await findConsultantByEmail(entityId, consultantForm.email);
      let consultantId = existing?.id;

      if (!consultantId) {
        consultantId = await createConsultant(entityId, {
          name: consultantForm.name,
          email: consultantForm.email,
        }, user.uid);
      }

      // Link the ID back to the request
      await updateConsultantAssignment({
        entityId,
        requestId,
        consultantId,
        consultantName: consultantForm.name,
        consultantEmail: consultantForm.email,
        actorUid: user.uid
      });

      toast({ title: "Ajouté au registre", description: "Le consultant a été enregistré et lié à ce dossier." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur registre", description: err.message });
    } finally {
      setProcessing(false);
      setIsRegistryConfirmOpen(false);
    }
  };

  const handleSendViaEmail = async () => {
    if (!user || !entityId || !requestId || !request) return;
    if (!consultantForm.email) {
      toast({ variant: "destructive", title: "Email manquant", description: "Veuillez renseigner l'email du consultant." });
      return;
    }

    setProcessing(true);
    try {
      const result = await sendConsultantCPIRequestAction({
        entityId,
        requestId,
        to: consultantForm.email,
        subject: `Richiesta Comunicazione UniLav/CPI — ${request.candidateDisplayName || 'Candidato'} — ${request.plannedHireDate || 'da definire'}`,
        templateData: {
          consultantName: consultantForm.name || "Consulente",
          candidateName: request.candidateDisplayName || "Candidato",
          candidateEmail: request.candidateEmail || undefined,
          candidatePhone: request.candidatePhone || undefined,
          jobTitle: request.jobRoleId || "da definire",
          companyName: entity?.nomEntreprise || "la nostra azienda",
          plannedHireDate: request.plannedHireDate || "da definire",
          contractType: request.contractType || "da definire",
          requestId: requestId
        }
      });

      if (!result.success) throw new Error(result.error);

      await markAsSentToConsultant({
        entityId,
        requestId,
        sendMode: "email",
        actorUid: user.uid
      });

      toast({ title: "Email envoyé", description: "Le dossier a été transmis au consultant." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleMarkSentManual = async () => {
    if (!user || !entityId || !requestId) return;
    setProcessing(true);
    try {
      await markAsSentToConsultant({
        entityId,
        requestId,
        sendMode: "manual",
        actorUid: user.uid
      });
      toast({ title: "Dossier marqué comme transmis (Manuel)" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleRecordCpi = async () => {
    if (!user || !entityId || !requestId) return;
    if (!cpiForm.code || !cpiForm.date) {
      toast({ variant: "destructive", title: "Champs requis", description: "Veuillez renseigner le protocole et la date." });
      return;
    }
    setProcessing(true);
    try {
      await recordCpiCommunication({
        entityId,
        requestId,
        protocolCode: cpiForm.code,
        cpiCommunicationDate: cpiForm.date,
        actorUid: user.uid
      });
      toast({ title: "Communication CPI enregistrée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !request) return;

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
          title: `Récépissé CPI - ${request.candidateDisplayName || 'Candidat'}`,
          documentType: "cpi_receipt",
          relatedModule: "employmentRequests",
          relatedId: requestId,
          personId: request.personId,
          candidateId: request.candidateId,
          employeeId: request.employeeId,
          status: "valid"
        }, 
        user.uid, 
        membership?.userDisplayName || "Utilisateur"
      );

      await linkReceiptToEmploymentRequest({
        entityId,
        requestId,
        documentId: docId,
        actorUid: user.uid
      });

      toast({ title: "Récépissé enregistré" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenReceipt = async () => {
    if (!receipt) return;
    setLoadingFile(true);
    try {
      const url = await getDocumentDownloadUrl(receipt.storagePath);
      window.open(url, "_blank");
    } catch (err) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible d'ouvrir le document." });
    } finally {
      setLoadingFile(false);
    }
  };

  const handleFinalize = async () => {
    if (!user || !entityId || !requestId) return;
    setProcessing(true);
    try {
      await completeEmploymentRequest({
        entityId,
        requestId,
        actorUid: user.uid
      });
      toast({ title: "Dossier clôturé", description: "Le dossier d'embauche est maintenant finalisé." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Clôture impossible", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  if (membershipLoading || loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="bg-destructive/5 border-destructive/20 rounded-3xl">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Permission "employmentRequests.read" requise.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><FileText className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Dossier introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/employment-requests`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/employment-requests`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Dossier Embauche / CPI</h1>
              {getStatusBadge(request.status)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">ID : {requestId}</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {isTerminal && (
            <Alert className="bg-green-50 border-green-200 text-green-800 rounded-2xl">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle className="font-black uppercase text-[10px] tracking-[0.2em]">Dossier Clôturé</AlertTitle>
              <AlertDescription className="text-xs font-bold opacity-80">
                Ce dossier a été finalisé le {formatDateTime(request.completedAt)}. Les modifications sont désormais verrouillées.
              </AlertDescription>
            </Alert>
          )}

          {/* 1. Consultant Assignment Section */}
          <Card className={cn("border-primary/10 shadow-xl rounded-[2rem] overflow-hidden transition-all", !request.consultantName && "border-orange-200 ring-2 ring-orange-50")}>
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Partenaire Consultant
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Sélectionner un consultant</Label>
                      <Select 
                        value={consultantForm.id} 
                        onValueChange={(v) => {
                          const c = consultants?.find(x => x.id === v);
                          setConsultantForm({ id: v, name: c?.name || "", email: c?.email || "" });
                        }}
                        disabled={isTerminal || !canUpdate}
                      >
                        <SelectTrigger className="rounded-xl h-10">
                          <SelectValue placeholder="Choisir du registre..." />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="manual">--- Saisie manuelle ---</SelectItem>
                           {consultants?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Nom du consultant</Label>
                      <Input 
                        value={consultantForm.name} 
                        onChange={(e) => setConsultantForm(p => ({...p, name: e.target.value}))} 
                        disabled={isTerminal || !canUpdate || (consultantForm.id !== "" && consultantForm.id !== "manual")}
                        placeholder="Ex: Studio Rossi"
                        className="rounded-xl"
                      />
                   </div>
                   <div className="space-y-2 col-span-full">
                      <Label className="text-[10px] uppercase font-black">Email de contact</Label>
                      <Input 
                        value={consultantForm.email} 
                        onChange={(e) => setConsultantForm(p => ({...p, email: e.target.value}))} 
                        disabled={isTerminal || !canUpdate || (consultantForm.id !== "" && consultantForm.id !== "manual")}
                        placeholder="payroll@example.com"
                        className="rounded-xl"
                      />
                   </div>
                </div>
                {canUpdate && !isTerminal && (
                  <div className="flex justify-end pt-2">
                    <Button onClick={handleSaveConsultant} disabled={processing} className="gap-2 h-10 px-8 rounded-xl font-bold">
                       {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                       Enregistrer consultant
                    </Button>
                  </div>
                )}
             </CardContent>
          </Card>

          {/* 2. Transmission Section */}
          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-secondary/10 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Send className="w-4 h-4" /> Transmission du dossier
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Dernier envoi</p>
                      <div className="flex items-center gap-2">
                        {request.sentAt ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            <div className="flex flex-col">
                               <span className="text-xs font-bold text-slate-800">{formatDateTime(request.sentAt)}</span>
                               <Badge variant="outline" className="w-fit text-[8px] h-3 px-1 mt-0.5 border-primary/20 uppercase">{request.sendMode}</Badge>
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Non transmis</span>
                        )}
                      </div>
                   </div>
                </div>

                {canUpdate && !isTerminal && (
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <Button 
                        onClick={handleSendViaEmail} 
                        disabled={processing || !request.consultantEmail} 
                        className="h-12 rounded-xl font-black bg-primary text-white shadow-lg gap-2"
                      >
                         {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                         Envoyer email au consultant
                      </Button>
                      <Button 
                        onClick={handleMarkSentManual} 
                        disabled={processing} 
                        variant="outline" 
                        className="h-12 rounded-xl font-bold border-dashed border-2 text-primary hover:bg-slate-50 transition-all gap-2"
                      >
                         {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                         Marquer comme envoyé manuellement
                      </Button>
                   </div>
                )}
             </CardContent>
          </Card>

          {/* 3. Validation Section */}
          <Card className={cn("border-primary/10 shadow-xl rounded-[2rem] overflow-hidden", request.status === "communication_done" ? "border-green-100 bg-green-50/5" : "")}>
             <CardHeader className="bg-green-50 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-green-700 flex items-center gap-2">
                   <ShieldCheck className="w-4 h-4" /> Validation UniLav / CPI
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Numéro de protocole (Requis)</Label>
                      <Input 
                        value={cpiForm.code} 
                        onChange={(e) => setCpiForm(p => ({...p, code: e.target.value}))} 
                        disabled={isTerminal || !canUpdate}
                        placeholder="Ex: 2024-XXXX-XXXX"
                        className="rounded-xl font-mono uppercase"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Date de communication</Label>
                      <Input 
                        type="date"
                        value={cpiForm.date} 
                        onChange={(e) => setCpiForm(p => ({...p, date: e.target.value}))} 
                        disabled={isTerminal || !canUpdate}
                        className="rounded-xl"
                      />
                   </div>
                </div>
                {canUpdate && !isTerminal && (
                   <Button 
                    onClick={handleRecordCpi} 
                    disabled={processing || !cpiForm.code || !cpiForm.date} 
                    className="w-full h-12 rounded-xl font-black bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-100 gap-3"
                   >
                      <CheckCircle2 className="w-4 h-4" />
                      Enregistrer communication CPI
                   </Button>
                )}
             </CardContent>
          </Card>

          {/* 4. Receipt Section */}
          <Card className={cn("border-primary/10 shadow-xl rounded-[2rem] overflow-hidden", request.receiptDocumentId ? "border-primary/20 bg-primary/5" : "border-dashed border-2")}>
             <CardHeader className="py-4 px-8 border-b bg-white/50">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <FileText className="w-4 h-4" /> Récépissé officiel (PDF)
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                {request.receiptDocumentId ? (
                   <div className="flex items-center justify-between gap-6 p-5 bg-white rounded-2xl border shadow-sm">
                      <div className="flex items-center gap-4 min-w-0">
                         <div className="bg-primary/10 p-3 rounded-2xl text-primary shrink-0">
                            <FileCheck className="w-6 h-6" />
                         </div>
                         <div className="min-w-0">
                            <p className="text-sm font-black text-slate-800 truncate">{receipt?.title || "Chargement..."}</p>
                            <div className="flex items-center gap-2 mt-1">
                               <p className="text-[9px] font-black uppercase text-muted-foreground/60">ID: {request.receiptDocumentId.substring(0, 8)}</p>
                               {receipt && (
                                 <p className="text-[9px] font-bold text-slate-400">
                                   {(() => {
                                      const dateVal = receipt.uploadedAt || receipt.createdAt || (receipt as any).uploadedOn || (receipt as any).createdOn;
                                      const formatted = formatDateTime(dateVal);
                                      return formatted === "Date non disponible" ? formatted : `Reçu le ${formatted}`;
                                   })()}
                                 </p>
                               )}
                            </div>
                         </div>
                      </div>
                      <Button variant="outline" size="sm" className="rounded-xl font-bold gap-2 bg-white" onClick={handleOpenReceipt} disabled={loadingFile || !receipt}>
                         {loadingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                         Ouvrir
                      </Button>
                   </div>
                ) : (
                   <div className={cn(
                    "border-2 border-dashed rounded-3xl p-10 transition-all relative flex flex-col items-center justify-center gap-4 text-center cursor-pointer",
                    isTerminal ? "bg-slate-50 opacity-40 grayscale" : "bg-slate-50/50 hover:bg-slate-100 hover:border-primary/30"
                   )}>
                      {!isTerminal && (
                        <input 
                          type="file" 
                          accept=".pdf" 
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                          onChange={handleUploadReceipt}
                          disabled={processing}
                        />
                      )}
                      <div className="bg-white p-4 rounded-2xl shadow-sm text-primary/30">
                         <Upload className="w-8 h-8" />
                      </div>
                      <div className="space-y-1">
                         <p className="text-sm font-bold text-slate-600">Joindre le récépissé de communication</p>
                         <p className="text-[10px] text-muted-foreground uppercase font-black tracking-tighter">Fichier PDF uniquement — Max 10 Mo</p>
                      </div>
                   </div>
                )}
             </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
           
           {!isTerminal && canUpdate && (
             <Card className={cn("border-2 rounded-[2rem] shadow-2xl overflow-hidden", canComplete ? "border-green-600 bg-green-600 text-white" : "border-slate-200 bg-white opacity-60")}>
                <CardHeader className="py-5 px-6 border-b border-white/10">
                   <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Finalisation
                   </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                   <p className="text-[10px] font-bold leading-relaxed opacity-90">
                     La clôture verrouille les données et notifie le système de la conformité du recrutement.
                   </p>
                   <Button 
                    onClick={handleFinalize} 
                    disabled={processing || !canComplete} 
                    className={cn(
                      "w-full h-12 rounded-xl font-black shadow-lg gap-2 transition-all",
                      canComplete ? "bg-white text-green-700 hover:bg-slate-100" : "bg-slate-100 text-slate-400"
                    )}
                   >
                      {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Clôturer le dossier CPI
                   </Button>
                   {!canComplete && (
                     <div className="space-y-1 mt-2">
                        <p className="text-[8px] font-black uppercase opacity-60">Pré-requis manquants :</p>
                        <ul className="text-[8px] font-bold space-y-1 list-disc pl-3 opacity-60">
                           {!request.protocolCode && <li>Protocole UniLav</li>}
                           {!request.cpiCommunicationDate && <li>Date de communication</li>}
                           {!request.receiptDocumentId && <li>Fichier récépissé PDF</li>}
                        </ul>
                     </div>
                   )}
                </CardContent>
             </Card>
           )}

           <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Historique & Audit
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <AuditMiniRow label="Dossier initié" value={formatDateTime(request.createdAt)} />
                <AuditMiniRow label="Dernière modif." value={formatDateTime(request.updatedAt)} />
                <AuditMiniRow label="Auteur" value={request.createdBy === 'candidate_portal' ? 'Candidat (Auto)' : 'Interne'} />
                {request.completedAt && (
                   <>
                     <Separator className="opacity-20" />
                     <AuditMiniRow label="Clôturé le" value={formatDateTime(request.completedAt)} />
                     <AuditMiniRow label="Clôturé par" value={request.completedBy === 'system' ? 'Auto' : 'Utilisateur'} />
                   </>
                )}
                <Separator className="opacity-20" />
                <div className="space-y-2">
                   <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Source de données</p>
                   <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                      <Briefcase className="w-3.5 h-3.5 opacity-40" />
                      Poste: {request.jobRoleId}
                   </div>
                   {request.offerId && (
                     <div className="text-[10px] text-muted-foreground">Réf: {request.offerId}</div>
                   )}
                </div>
             </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={isRegistryConfirmOpen} onOpenChange={setIsRegistryConfirmOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Ajouter au registre ?</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous ajouter ce consultant au registre pour le réutiliser plus tard ?
              <div className="mt-4 p-3 bg-secondary/30 rounded-xl">
                 <p className="text-xs font-bold text-primary">{consultantForm.name}</p>
                 <p className="text-[10px] text-muted-foreground">{consultantForm.email}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <AlertDialogCancel disabled={processing}>Non, garder seulement pour ce dossier</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); handleConfirmRegistrySave(); }}
              disabled={processing}
              className="bg-primary font-bold rounded-xl"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Oui, ajouter au registre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AuditMiniRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
       <span className="text-muted-foreground font-medium">{label}</span>
       <span className="font-bold text-slate-700">{value}</span>
    </div>
  );
}

/**
 * Robust date formatter that handles Firestore Timestamps (Client & Admin),
 * regular Date objects, and serialized timestamp maps.
 */
function formatDateTime(val: any): string {
  if (!val) return "Date non disponible";

  try {
    let date: Date | null = null;

    if (val instanceof Date) {
      date = val;
    } else if (typeof val.toDate === 'function') {
      date = val.toDate();
    } else if (val && typeof val === 'object') {
      const s = val.seconds ?? val._seconds;
      if (typeof s === 'number') {
        date = new Date(s * 1000);
      }
    }

    if (!date && (typeof val === 'string' || typeof val === 'number')) {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) date = parsed;
    }

    if (!date || isNaN(date.getTime())) return "Date non disponible";

    return format(date, "dd/MM/yyyy", { locale: fr });
  } catch (e) {
    return "Date non disponible";
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 uppercase font-black text-[9px] px-2">Brouillon</Badge>;
    case 'sent_to_consultant': return <Badge className="bg-blue-500 text-white uppercase font-black text-[9px] px-2 border-none">Envoyé</Badge>;
    case 'communication_done': return <Badge className="bg-orange-500 text-white uppercase font-black text-[9px] px-2 border-none">Validé CPI</Badge>;
    case 'completed': return <Badge className="bg-slate-900 text-white uppercase font-black text-[9px] px-2 border-none">Terminé</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Annulé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
