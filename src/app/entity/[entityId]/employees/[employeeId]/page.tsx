"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Mail, Phone, Fingerprint, Calendar,
  Briefcase, Building2, MapPin, FileSignature,
  Info, Euro, Clock, History, ExternalLink,
  ShieldCheck, GraduationCap, CheckCircle2,
  FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { EmploymentOffer } from "@/types/employment-offer";
import { useActiveMembership } from "@/hooks/use-active-membership";
import Link from "next/link";

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const employeeId = params.employeeId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const employeeRef = useMemo(() => 
    db ? (doc(db, `entities/${entityId}/employees`, employeeId) as DocumentReference<Employee>) : null,
  [db, entityId, employeeId]);

  const { data: employee, loading: loadingEmployee } = useDoc<Employee>(employeeRef);

  const contractRef = useMemo(() => 
    db && employee?.activeContractId ? (doc(db, `entities/${entityId}/contracts`, employee.activeContractId) as DocumentReference<Contract>) : null,
  [db, entityId, employee?.activeContractId]);

  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  // Fallback data from source offer if professional labels are missing on employee record
  const offerRef = useMemo(() => 
    db && employee?.sourceOfferId ? (doc(db, `entities/${entityId}/employmentOffers`, employee.sourceOfferId) as DocumentReference<EmploymentOffer>) : null,
  [db, entityId, employee?.sourceOfferId]);

  const { data: offer } = useDoc<EmploymentOffer>(offerRef);

  if (membershipLoading || loadingEmployee) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!employee) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <User className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-black text-primary">Employé introuvable</h2>
        <p className="text-muted-foreground mt-2">Désolé, nous ne trouvons pas le dossier de ce collaborateur.</p>
        <Button onClick={() => router.push(`/entity/${entityId}/employees`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/employees`)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-primary tracking-tight">{employee.displayName}</h1>
              {getStatusBadge(employee.status)}
            </div>
            <div className="flex items-center gap-4 text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">
              <span className="flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> {employee.employeeCode}</span>
              <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {employee.jobTitle || offer?.jobTitleName || "Non renseigné"}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* Identity Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Identité & Contact
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Prénom" value={employee.firstName} />
                   <DetailRow label="Nom" value={employee.lastName} />
                   <DetailRow label="Email" value={employee.email} />
                   <DetailRow label="Téléphone" value={employee.phone} />
                   <DetailRow label="Identifiant National" value={employee.taxCode} className="font-mono uppercase" />
                   <DetailRow label="Date de naissance" value={employee.birthDate} />
                   <DetailRow label="ID Interne" value={employee.personId} className="font-mono text-[10px] col-span-full" />
                </div>
             </CardContent>
          </Card>

          {/* Professional Context */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Contexte Professionnel
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailRow label="Département" value={employee.departmentName || offer?.departmentName} icon={Building2} />
                   <DetailRow label="Site Principal" value={employee.worksiteName || offer?.worksiteName} icon={MapPin} />
                   <DetailRow label="Date d'embauche" value={employee.hireDate} icon={Calendar} />
                   <DetailRow label="Poste Officiel" value={employee.jobTitle || offer?.jobTitleName} icon={Briefcase} />
                </div>
             </CardContent>
          </Card>

          {/* Recruitment Origin */}
          <Card className="border-accent/10 bg-accent/5 rounded-[2rem] overflow-hidden">
             <CardContent className="p-8">
                <div className="flex items-center gap-2 text-accent font-black uppercase text-[10px] tracking-widest mb-6">
                   <History className="w-4 h-4" /> Origine du recrutement
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                   {employee.sourceOfferId && (
                     <Link href={`/entity/${entityId}/employment-offers/${employee.sourceOfferId}`}>
                        <Button variant="outline" className="w-full justify-between h-12 rounded-xl bg-white border-accent/20 text-accent font-bold">
                           Voir Proposition Source
                           <ExternalLink className="w-4 h-4" />
                        </Button>
                     </Link>
                   )}
                   {employee.sourceCandidateId && (
                     <Link href={`/entity/${entityId}/candidates`}>
                        <Button variant="outline" className="w-full justify-between h-12 rounded-xl bg-white border-accent/20 text-accent font-bold">
                           Voir Dossier Candidat
                           <ExternalLink className="w-4 h-4" />
                        </Button>
                     </Link>
                   )}
                </div>
             </CardContent>
          </Card>

        </div>

        <div className="space-y-8">
          {/* Active Contract Summary */}
          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl shadow-primary/20 rounded-[2.5rem] overflow-hidden">
             <CardHeader className="bg-white/10 py-6 px-8 border-b border-white/10">
                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <FileSignature className="w-4 h-4" /> Contrat Actif
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                {loadingContract ? (
                   <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin" /></div>
                ) : !contract ? (
                   <p className="text-xs italic opacity-60">Aucun détail contractuel chargé.</p>
                ) : (
                   <>
                      <SummaryRow label="Type" value={contract.contractType} />
                      <SummaryRow label="Début" value={contract.startDate} />
                      {contract.endDate && <SummaryRow label="Fin (CDD)" value={contract.endDate} />}
                      <SummaryRow label="Hebdo" value={`${contract.weeklyHours}h`} />
                      <Separator className="bg-white/10" />
                      <SummaryRow label="CCNL" value={contract.ccnlName} />
                      <SummaryRow label="Niveau" value={contract.levelCode} />
                      <Separator className="bg-white/10" />
                      <div className="pt-2 flex justify-between items-end">
                         <p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Salaire Brut Annuel</p>
                         <p className="text-2xl font-black">€ {contract.grossAnnual?.toLocaleString('fr-FR')}</p>
                      </div>
                      
                      {hasPermission("contracts.read") && (
                        <div className="pt-4">
                           <Button variant="outline" className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 rounded-xl gap-2 font-bold" disabled>
                              <FileText className="w-4 h-4" />
                              Détails contrat (Bientôt)
                           </Button>
                        </div>
                      )}
                   </>
                )}
             </CardContent>
          </Card>

          {/* Quick Shortcuts */}
          <div className="space-y-3">
             <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Actions Rapides</p>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <History className="w-4 h-4" /> Historique (Bientôt)
             </Button>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <ShieldCheck className="w-4 h-4" /> Sécurité (Bientôt)
             </Button>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <GraduationCap className="w-4 h-4" /> Formations (Bientôt)
             </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, className, icon: Icon }: { label: string, value: any, className?: string, icon?: any }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight mb-1 opacity-70">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />}
         {value || "Non renseigné"}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-start gap-4">
       <span className="text-[10px] font-black uppercase text-white/50 tracking-widest shrink-0">{label}</span>
       <span className="text-sm font-bold text-right truncate">{value || "-"}</span>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white">ACTIF</Badge>;
    case 'suspended': return <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200">SUSPENDU</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">TERMINE</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}
