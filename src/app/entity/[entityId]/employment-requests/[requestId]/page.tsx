"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, Clock, 
  Briefcase, Building2, User, Info, 
  ShieldCheck, Calendar, FileText, 
  Hash, Mail, 
  History, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { EmploymentRequest } from "@/types/employment-request";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { cn } from "@/lib/utils";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export default function EmploymentRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params?.entityId as string;
  const requestId = params?.requestId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading } = useActiveMembership(entityId);

  const requestRef = useMemo(() => 
    db && entityId && requestId ? (doc(db, `entities/${entityId}/employmentRequests`, requestId) as DocumentReference<EmploymentRequest>) : null,
  [db, entityId, requestId]);

  const { data: request, loading } = useDoc<EmploymentRequest>(requestRef);

  if (membershipLoading || loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

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
            <AlertTitle className="font-bold">Module CPI Foundation (Phase 5A)</AlertTitle>
            <AlertDescription className="text-xs">
              Ce module est actuellement en mode consultation. La gestion complète des envois et validations sera disponible dans la phase suivante.
            </AlertDescription>
          </Alert>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Briefcase className="w-4 h-4" /> Détails du poste & Source
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Poste / Rôle" value={request.jobRoleId} icon={Briefcase} />
                   <DetailRow label="Date d'embauche prévue" value={request.plannedHireDate} icon={Calendar} />
                   <DetailRow label="Site / Localisation" value={request.worksiteId || "Siège / Principal"} icon={Building2} />
                   <DetailRow label="Type de communication" value={request.type?.toUpperCase()} icon={FileText} />
                   <DetailRow label="Origine du dossier" value={request.source === 'offer' ? `Proposition d'embauche : ${request.offerId}` : "Saisie manuelle"} className="col-span-full" />
                </div>
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-secondary/10 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Partenaire Consultant
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Consultant assigné" value={request.consultantName || "Non assigné"} />
                   <DetailRow label="Email de contact" value={request.consultantEmail || "Non renseigné"} icon={Mail} />
                   <DetailRow label="Mode d'envoi" value={request.sendMode || "Non défini"} />
                   <DetailRow label="Date d'envoi" value={formatDateTime(request.sentAt)} icon={Clock} />
                </div>
             </CardContent>
          </Card>

          <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-green-50 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-green-700 flex items-center gap-2">
                   <ShieldCheck className="w-4 h-4" /> Validation UniLav / CPI
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Code Protocole" value={request.protocolCode || "En attente..."} icon={Hash} className="font-mono" />
                   <DetailRow label="Date de communication" value={request.cpiCommunicationDate || "—"} icon={Calendar} />
                   <div className="col-span-full pt-4 border-t border-dashed">
                      <p className="text-[10px] font-black uppercase text-muted-foreground mb-3">Document de reçu</p>
                      {request.receiptDocumentId || request.legacyReceiptPdfUrl ? (
                        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border">
                           <FileText className="w-6 h-6 text-primary/40" />
                           <div className="flex-1">
                              <p className="text-xs font-bold text-slate-800">Reçu de communication validé</p>
                              <p className="text-[10px] text-muted-foreground uppercase mt-0.5">Réf: {request.receiptDocumentId || 'Legacy URL'}</p>
                           </div>
                           <Button variant="outline" size="sm" className="rounded-xl h-8 text-[10px] font-black uppercase gap-2 bg-white" disabled>
                              <Eye className="w-3 h-3" /> Visualiser
                           </Button>
                        </div>
                      ) : (
                        <div className="p-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground/40">
                           <AlertCircle className="w-8 h-8 opacity-20" />
                           <p className="text-[10px] font-black uppercase tracking-widest">Aucun reçu enregistré</p>
                        </div>
                      )}
                   </div>
                </div>
             </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
           <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Historique
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                <AuditMiniRow label="Créé le" value={formatDateTime(request.createdAt)} />
                <AuditMiniRow label="Auteur" value={request.createdBy === 'candidate_portal' ? 'Candidat (Auto)' : 'Interne'} />
                <Separator className="opacity-20" />
                <AuditMiniRow label="Mis à jour" value={formatDateTime(request.updatedAt)} />
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

function DetailRow({ label, value, className, icon: Icon }: { label: string, value: any, className?: string, icon?: any }) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight mb-1 opacity-70">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />}
         {value || "Non renseigné"}
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
    case 'waiting_for_communication': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase font-black text-[9px] px-2">En attente</Badge>;
    case 'completed': return <Badge className="bg-green-500 text-white uppercase font-black text-[9px] px-2 border-none">Terminé</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Annulé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
