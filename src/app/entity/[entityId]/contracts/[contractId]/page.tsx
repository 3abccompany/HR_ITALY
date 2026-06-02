"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Briefcase, Building2, FileSignature,
  Info, Euro, Clock, History, ExternalLink,
  Scale, Fingerprint, Calendar, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { useActiveMembership } from "@/hooks/use-active-membership";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const contractId = params.contractId as string;
  
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission, entity } = useActiveMembership(entityId);

  const contractRef = useMemo(() => 
    db ? (doc(db, `entities/${entityId}/contracts`, contractId) as DocumentReference<Contract>) : null,
  [db, entityId, contractId]);

  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  // Fallback Employee Query if denormalized data is missing
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

  if (membershipLoading || loadingContract) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!contract) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <FileText className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-black text-primary">Contrat introuvable</h2>
        <p className="text-muted-foreground mt-2">Le document demandé n'existe pas ou vous n'avez pas les droits d'accès.</p>
        <Button onClick={() => router.push(`/entity/${entityId}/contracts`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const displayName = contract.employeeDisplayName || (employee ? `${employee.firstName} ${employee.lastName}` : "Collaborateur inconnu");
  const employeeCode = contract.employeeCode || (employee ? employee.employeeCode : "Référence non disponible");
  const businessReference = contract.status === 'draft' ? "Brouillon d'intégration" : employeeCode;

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/contracts`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Détails du Contrat</h1>
              {getStatusBadge(contract.status)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">
              Référence : {businessReference}
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* Identity Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Collaborateur concerné
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                   <div className="space-y-1">
                      <p className="text-2xl font-black text-slate-900">{displayName}</p>
                      <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                         <span className="flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> {employeeCode}</span>
                      </div>
                   </div>
                   
                   <div className="flex flex-col gap-2">
                      {contract.employeeId && (
                        <Link href={`/entity/${entityId}/employees/${contract.employeeId}`}>
                           <Button variant="outline" size="sm" className="w-full justify-start h-9 rounded-xl font-bold gap-2">
                              <UserCheck className="w-3.5 h-3.5" />
                              Voir fiche employé
                           </Button>
                        </Link>
                      )}
                      {contract.sourceOfferId && hasPermission("candidates.read") && (
                        <Link href={`/entity/${entityId}/employment-offers/${contract.sourceOfferId}`}>
                           <Button variant="outline" size="sm" className="w-full justify-start h-9 rounded-xl font-bold gap-2">
                              <ExternalLink className="w-3.5 h-3.5" />
                              Voir proposition source
                           </Button>
                        </Link>
                      )}
                   </div>
                </div>
             </CardContent>
          </Card>

          {/* Contract Terms */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <FileSignature className="w-4 h-4" /> Conditions Contractuelles
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Type de contrat" value={contract.contractType} icon={Briefcase} />
                   <DetailRow label="Temps de travail hebdomadaire" value={contract.weeklyHours ? `${contract.weeklyHours} heures` : "-"} icon={Clock} />
                   <DetailRow label="Date de début" value={formatDate(contract.startDate)} icon={Calendar} />
                   {contract.endDate && <DetailRow label="Date de fin (CDD)" value={formatDate(contract.endDate)} icon={Calendar} />}
                </div>
             </CardContent>
          </Card>

          {/* Classification & Remuneration */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-3xl overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Scale className="w-4 h-4" /> Classification & Rémunération
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Contrat Collectif (CCNL)" value={contract.ccnlName} />
                   <DetailRow label="Niveau / Qualification" value={contract.levelCode ? `${contract.levelCode} - ${contract.levelLabel || ""}` : "-"} />
                </div>
                
                <Separator className="bg-slate-100" />
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Brut Mensuel</p>
                      <div className="flex items-center gap-2 text-primary font-black text-lg">
                         <Euro className="w-4 h-4 text-accent" />
                         <span>{formatMoney(contract.grossMonthly)}</span>
                      </div>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Brut Annuel (RAL)</p>
                      <div className="flex items-center gap-2 text-primary font-black text-lg">
                         <Euro className="w-4 h-4 text-accent" />
                         <span>{formatMoney(contract.grossAnnual)}</span>
                      </div>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight opacity-70">Mensualités</p>
                      <div className="flex items-center gap-2 text-primary font-black text-lg">
                         <span>{contract.monthlyPayments || 13}</span>
                      </div>
                   </div>
                </div>
             </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          {/* Audit Sidebar */}
          <Card className="border-primary/10 rounded-3xl shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Audit & Statut
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-6">
                <div className="space-y-4">
                   <AuditRow label="Créé le" value={formatDateTime(contract.createdAt)} />
                   <AuditRow label="Mis à jour le" value={formatDateTime(contract.updatedAt)} />
                   <AuditRow label="Auteur" value={contract.createdBy === "system" ? "Système" : (contract.createdBy || "-")} />
                </div>
                
                <Separator />
                
                <div className="bg-white p-4 rounded-2xl border border-primary/5 shadow-sm space-y-2">
                   <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Informations</p>
                   <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-primary/5">
                        <Info className="w-4 h-4 text-accent shrink-0" />
                      </div>
                      <p className="text-[10px] font-medium text-slate-600 leading-relaxed">
                        {contract.status === 'draft' 
                          ? "Ce contrat est en cours de préparation. Les termes peuvent encore être modifiés dans la proposition source." 
                          : "Ce contrat est finalisé et archivé dans le dossier du collaborateur."}
                      </p>
                   </div>
                </div>
             </CardContent>
          </Card>
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
         {value || "-"}
      </div>
    </div>
  );
}

function AuditRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
       <span className="text-muted-foreground font-medium">{label}</span>
       <span className="font-bold text-slate-700">{value}</span>
    </div>
  );
}

function getStatusBadge(status: ContractStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 uppercase font-black text-[9px] px-2">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase font-black text-[9px] px-2">En signature</Badge>;
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white uppercase font-black text-[9px] px-2">Actif</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Terminé</Badge>;
    case 'suspended': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 uppercase font-black text-[9px] px-2">Suspendu</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground uppercase font-black text-[9px] px-2">Archivé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
