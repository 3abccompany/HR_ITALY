
"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, Clock, 
  Briefcase, Building2, User, Info, 
  ShieldCheck, Calendar, FileText, 
  Hash, Mail, Save, Send,
  History, AlertCircle, Eye,
  RefreshCcw, CheckCircle2
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
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  updateConsultantAssignment, 
  markAsSentToConsultant, 
  recordCpiCommunication 
} from "@/services/employment-request.service";
import { cn } from "@/lib/utils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

export default function EmploymentRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const requestId = params?.requestId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

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

  // --- Local States for Forms ---
  const [consultantForm, setConsultantForm] = useState({ id: "", name: "", email: "" });
  const [sendMode, setSendMode] = useState<"email" | "portal" | "manual" | "draft_only">("email");
  const [cpiForm, setCpiForm] = useState({ date: "", code: "" });
  const [processing, setProcessing] = useState(false);

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

  // --- Handlers ---

  const handleSaveConsultant = async () => {
    if (!user || !entityId || !requestId) return;
    setProcessing(true);
    try {
      await updateConsultantAssignment({
        entityId,
        requestId,
        consultantId: consultantForm.id,
        consultantName: consultantForm.name,
        consultantEmail: consultantForm.email,
        actorUid: user.uid
      });
      toast({ title: "Consultant enregistré" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(true);
      setTimeout(() => setProcessing(false), 500); // UI breathing room
    }
  };

  const handleMarkSent = async () => {
    if (!user || !entityId || !requestId) return;
    setProcessing(true);
    try {
      await markAsSentToConsultant({
        entityId,
        requestId,
        sendMode,
        actorUid: user.uid
      });
      toast({ title: "Dossier marqué comme transmis" });
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
          
          <Alert className="bg-blue-50 border-blue-200 text-blue-800 rounded-2xl">
            <Info className="h-4 w-4" />
            <AlertTitle className="font-bold text-xs uppercase tracking-wider">Module CPI Foundation — Phase 5B-1</AlertTitle>
            <AlertDescription className="text-xs">
              Workflow opérationnel actif. Enregistrez les étapes de transmission et les résultats CPI.
            </AlertDescription>
          </Alert>

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
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Mode d'envoi</Label>
                      <Select 
                        value={sendMode} 
                        onValueChange={(v) => setSendMode(v as any)}
                        disabled={isTerminal || !canUpdate}
                      >
                        <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email direct</SelectItem>
                          <SelectItem value="portal">Portail Consultant</SelectItem>
                          <SelectItem value="manual">Remise manuelle / Courrier</SelectItem>
                          <SelectItem value="draft_only">Mode Brouillon (Pas d'envoi)</SelectItem>
                        </SelectContent>
                      </Select>
                   </div>
                   <div className="bg-slate-50 p-4 rounded-2xl border flex flex-col justify-center">
                      <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Dernier envoi</p>
                      <div className="flex items-center gap-2">
                        {request.sentAt ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            <span className="text-xs font-bold text-slate-800">{formatDateTime(request.sentAt)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Non transmis</span>
                        )}
                      </div>
                   </div>
                </div>
                {canUpdate && !isTerminal && (
                   <Button 
                    onClick={handleMarkSent} 
                    disabled={processing || !request.consultantName} 
                    variant="outline" 
                    className="w-full h-12 rounded-xl font-black border-dashed border-2 text-primary hover:bg-primary hover:text-white transition-all gap-3"
                   >
                      <Send className="w-4 h-4" />
                      {request.status === "draft" ? "Marquer comme envoyé au consultant" : "Mettre à jour l'état d'envoi"}
                   </Button>
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
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
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

          {request.notes && (
            <div className="space-y-2">
               <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Notes Internes</p>
               <div className="p-4 bg-white rounded-2xl border border-primary/5 shadow-sm text-xs text-slate-600 italic leading-relaxed">
                  {request.notes}
               </div>
            </div>
          )}
        </div>
      </div>
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

function formatDateTime(val: any): string {
  if (!val) return "N/A";
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleString('fr-FR', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return "N/A"; }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 uppercase font-black text-[9px] px-2">Brouillon</Badge>;
    case 'sent_to_consultant': return <Badge className="bg-blue-500 text-white uppercase font-black text-[9px] px-2 border-none">Envoyé</Badge>;
    case 'communication_done': return <Badge className="bg-green-600 text-white uppercase font-black text-[9px] px-2 border-none">Validé CPI</Badge>;
    case 'completed': return <Badge className="bg-slate-900 text-white uppercase font-black text-[9px] px-2 border-none">Terminé</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Annulé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
