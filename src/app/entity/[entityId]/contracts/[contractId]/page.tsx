"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Briefcase, Building2, FileSignature,
  Info, Euro, Clock, History, ExternalLink,
  Scale, Fingerprint, Calendar, FileText,
  MapPin, CheckCircle2, XCircle, Ban, Archive, 
  RefreshCcw, ShieldCheck, UserCircle, Globe,
  ScrollText, ListTodo
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc, useUser } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  sendContractToSignature, 
  activateContractAction, 
  terminateContractAction, 
  archiveContractAction,
  rollbackToDraft
} from "@/services/contract.service";

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const contractId = params.contractId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, entity } = useActiveMembership(entityId);

  const [processing, setProcessing] = useState(false);

  const contractRef = useMemo(() => 
    db ? (doc(db, `entities/${entityId}/contracts`, contractId) as DocumentReference<Contract>) : null,
  [db, entityId, contractId]);

  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  const employeeRef = useMemo(() => 
    db && contract?.employeeId ? (doc(db, `entities/${entityId}/employees`, contract.employeeId) as DocumentReference<Employee>) : null,
  [db, entityId, contract?.employeeId]);

  const { data: employee } = useDoc<Employee>(employeeRef);

  const formatMoney = (value: any, decimals = 2) => {
    if (value === undefined || value === null) return "-";
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return num.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
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
      return d.toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric'
      });
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
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
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

  const handleTransition = async (action: () => Promise<any>, successMsg: string) => {
    if (!user || !contract) return;
    setProcessing(true);
    try {
      await action();
      toast({ title: "Succès", description: successMsg });
    } catch (err: any) {
      console.error("Transition error:", err);
      let msg = err.message || "Une erreur est survenue.";
      if (err.message === "ALREADY_HAS_ACTIVE_CONTRACT") {
        msg = "Un autre contrat actif existe déjà pour cet employé.";
      }
      toast({ variant: "destructive", title: "Erreur", description: msg });
    } finally {
      setProcessing(false);
    }
  };

  if (membershipLoading || loadingContract) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!contract) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <FileText className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-black text-primary">Contrat introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/contracts`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const businessReference = contract.employeeCode || "Brouillon d'intégration";
  const canUpdate = hasPermission("contracts.update");

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
              {getStatusBadge(contract.status)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">
              Référence : {businessReference}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
           {canUpdate && contract.status === 'draft' && (
             <Button 
               onClick={() => handleTransition(() => sendContractToSignature(entityId, contractId, user!.uid), "Contrat marqué comme prêt pour signature.")}
               disabled={processing}
               className="gap-2 bg-accent text-white font-bold rounded-xl"
             >
               {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
               Prêt pour signature
             </Button>
           )}

           {canUpdate && contract.status === 'pending_signature' && (
             <>
               <Button 
                 variant="outline"
                 onClick={() => handleTransition(() => rollbackToDraft(entityId, contractId, user!.uid), "Retour au statut brouillon.")}
                 disabled={processing}
                 className="gap-2 bg-white rounded-xl"
               >
                 <RefreshCcw className="w-4 h-4" />
                 Brouillon
               </Button>
               <Button 
                 onClick={() => handleTransition(() => activateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat activé avec succès.")}
                 disabled={processing || !contract.employeeId}
                 className="gap-2 bg-primary text-white font-black rounded-xl"
               >
                 {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                 Confirmer signature et activer
               </Button>
             </>
           )}

           {canUpdate && contract.status === 'active' && (
             <Button 
               variant="destructive"
               onClick={() => handleTransition(() => terminateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat résilié.")}
               disabled={processing}
               className="gap-2 font-bold rounded-xl"
             >
               <Ban className="w-4 h-4" />
               Résilier / Terminer
             </Button>
           )}

           {canUpdate && (contract.status === 'draft' || contract.status === 'terminated') && (
             <Button 
               variant="ghost" 
               size="icon" 
               className="text-muted-foreground"
               onClick={() => handleTransition(() => archiveContractAction(entityId, contractId, user!.uid), "Contrat archivé.")}
               disabled={processing}
             >
               <Archive className="w-4 h-4" />
             </Button>
           )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          
          {/* Employer Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Employeur
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Entreprise (Nom commercial)" value={contract.entityName} />
                   <DetailRow label="Raison Sociale" value={contract.entityLegalName} />
                   <DetailRow label="Numéro TVA / Code Fiscal" value={contract.entityVatNumber} />
                   <DetailRow label="Représentant Légal" value={contract.legalRepresentativeName} />
                   <DetailRow label="Adresse du Siège" value={contract.companyAddressSnapshot} className="col-span-full" />
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
                   <DetailRow label="Nom Complet" value={contract.employeeDisplayName} />
                   <DetailRow label="Code Fiscal / ID" value={contract.taxCode} className="font-mono uppercase" />
                   <DetailRow label="Date de Naissance" value={formatDate(contract.dateOfBirth)} />
                   <DetailRow label="Lieu de Naissance" value={contract.placeOfBirth} />
                   <DetailRow label="Adresse de Résidence" value={contract.employeeAddressSnapshot} className="col-span-full" />
                </div>
                <div className="mt-8 pt-6 border-t flex gap-4">
                   {contract.employeeId && (
                     <Link href={`/entity/${entityId}/employees/${contract.employeeId}`}>
                        <Button variant="outline" size="sm" className="h-9 rounded-xl font-bold gap-2 bg-white">
                           <UserCheck className="w-3.5 h-3.5" /> Voir Profil Employé
                        </Button>
                     </Link>
                   )}
                </div>
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
                   <DetailRow label="Intitulé du Poste" value={contract.jobTitleName} icon={Briefcase} />
                   <DetailRow label="Département" value={contract.departmentName} icon={Building2} />
                   <DetailRow label="Site d'Affectation" value={contract.worksiteName} icon={MapPin} className="col-span-full" />
                </div>
                {contract.missionsSnapshot && contract.missionsSnapshot.length > 0 && (
                  <div className="space-y-3 pt-6 border-t">
                     <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Missions & Responsabilités</p>
                     <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700">
                           {contract.missionsSnapshot.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                     </div>
                  </div>
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
                   <DetailRow label="Type de Contrat" value={contract.contractType} />
                   <DetailRow label="Date de Début" value={formatDate(contract.startDate)} icon={Calendar} />
                   {contract.endDate && <DetailRow label="Date de Fin" value={formatDate(contract.endDate)} icon={Calendar} />}
                   <DetailRow label="Période d'essai" value={contract.trialPeriodDays ? `${contract.trialPeriodDays} jours` : "Non renseignée"} />
                </div>
                
                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Temps de Travail" value={`${contract.weeklyHours}h / semaine`} icon={Clock} />
                   <DetailRow label="Format" value={contract.isPartTime ? "Temps Partiel" : "Temps Plein"} />
                   {contract.workingScheduleNotes && <DetailRow label="Notes Planning" value={contract.workingScheduleNotes} className="col-span-full" />}
                </div>

                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailRow label="Contrat Collectif (CCNL)" value={contract.ccnlName} />
                   <DetailRow label="Niveau" value={contract.levelCode} />
                   <DetailRow label="Qualification" value={contract.qualificationCategory || contract.levelLabel} />
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
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Brut Mensuel</p>
                      <p className="text-xl font-black text-primary">€ {formatMoney(contract.grossMonthly)}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Brut Annuel (RAL)</p>
                      <p className="text-xl font-black text-primary">€ {formatMoney(contract.grossAnnual)}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Mensualités</p>
                      <p className="text-xl font-black text-primary">{contract.monthlyPayments || 13}</p>
                   </div>
                </div>
                {contract.overtimeNote && (
                   <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600 italic">
                      {contract.overtimeNote}
                   </div>
                )}
             </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          {/* Compliance Card */}
          <Card className="border-accent/10 bg-accent/5 rounded-[2rem] overflow-hidden shadow-lg shadow-accent/5">
             <CardHeader className="py-4 border-b bg-accent/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-accent-foreground flex items-center gap-2">
                   <Globe className="w-4 h-4" /> Compliance Italie
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-6">
                <AuditRow label="Protocole UniLav" value={contract.uniLavProtocolNumber || "Non renseigné"} />
                <AuditRow label="Date Soumission" value={contract.uniLavSubmissionDate || "Non renseignée"} />
                {contract.uniLavReceiptUrl && (
                  <Button variant="outline" size="sm" className="w-full h-8 rounded-lg text-[9px] font-black bg-white" asChild>
                    <a href={contract.uniLavReceiptUrl} target="_blank" rel="noopener noreferrer">Voir le reçu (PDF)</a>
                  </Button>
                )}
             </CardContent>
          </Card>

          {/* Audit Sidebar */}
          <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Historique
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-6">
                <div className="space-y-4">
                   <AuditRow label="Créé le" value={formatDateTime(contract.createdAt)} />
                   <AuditRow label="Auteur" value={getUserLabel(contract.createdBy)} />
                   <Separator className="opacity-20" />
                   {contract.sentForSignatureAt && <AuditRow label="Envoyé sign. le" value={formatDateTime(contract.sentForSignatureAt)} />}
                   {contract.activatedAt && <AuditRow label="Activé le" value={formatDateTime(contract.activatedAt)} />}
                   <Separator className="opacity-20" />
                   <AuditRow label="Dernière modif." value={formatDateTime(contract.updatedAt)} />
                   <AuditRow label="Modifié par" value={getUserLabel(contract.updatedBy)} />
                </div>
             </CardContent>
          </Card>
          
          <div className="p-4 bg-primary/5 rounded-[2rem] border border-primary/10">
             <div className="flex items-center gap-2 text-primary font-black uppercase text-[10px] tracking-widest mb-3">
                <ListTodo className="w-4 h-4" /> Prochaines Étapes
             </div>
             <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
                {contract.status === 'draft' ? "Vérifiez les données de snapshot avant de marquer le contrat comme 'Prêt pour signature'." :
                 contract.status === 'pending_signature' ? "Une fois la signature obtenue, confirmez-la pour activer le dossier employé." :
                 "Ce contrat est archivé ou actif."}
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon: Icon, className }: { label: string, value: any, icon?: any, className?: string }) {
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
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Terminé</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground uppercase font-black text-[9px] px-2">Archivé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
