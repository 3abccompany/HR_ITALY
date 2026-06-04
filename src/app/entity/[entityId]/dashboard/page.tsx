"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, Users, FileText, 
  AlertTriangle, Clock, Calendar, CheckCircle2,
  FileSignature, Building2,
  ArrowUpRight, AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useCollection, useFirebase } from "@/firebase";
import { collection, query, where } from "firebase/firestore";
import { format, isBefore, addDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import Link from "next/link";

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

export default function EntityDashboardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission, entity } = useActiveMembership(entityId);

  const contractsQuery = useMemo(() => {
    if (!db || !entityId || !hasPermission("contracts.read")) return null;
    return query(collection(db, `entities/${entityId}/contracts`));
  }, [db, entityId, hasPermission]);

  const docsQuery = useMemo(() => {
    if (!db || !entityId || !hasPermission("documents.read")) return null;
    return query(collection(db, `entities/${entityId}/documents`));
  }, [db, entityId, hasPermission]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !hasPermission("employees.read")) return null;
    return query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active"));
  }, [db, entityId, hasPermission]);

  const { data: contracts, loading: loadingContracts } = useCollection<any>(contractsQuery);
  const { data: documents, loading: loadingDocs } = useCollection<any>(docsQuery);
  const { data: employees, loading: loadingEmployees } = useCollection<any>(employeesQuery);

  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    const s = {
      expiringContracts: [] as any[],
      expiredContracts: [] as any[],
      expiringDocs: [] as any[],
      expiredDocs: [] as any[],
      totalEmployees: employees?.length || 0
    };

    contracts?.forEach(c => {
      if (c.status !== 'active') return;
      const endDate = parseSafeDate(c.endDate);
      if (!endDate) return;

      if (isBefore(endDate, today)) {
        s.expiredContracts.push(c);
      } else if (isBefore(endDate, thirtyDaysOut)) {
        s.expiringContracts.push(c);
      }
    });

    documents?.forEach(d => {
      if (d.status !== 'valid') return;
      const expiry = parseSafeDate(d.expiresAt);
      if (!expiry) return;

      if (isBefore(expiry, today)) {
        s.expiredDocs.push(d);
      } else if (isBefore(expiry, thirtyDaysOut)) {
        s.expiringDocs.push(d);
      }
    });

    return s;
  }, [contracts, documents, employees]);

  if (membershipLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">Chargement du dashboard...</p>
      </div>
    );
  }

  const isLoadingData = loadingContracts || loadingDocs || loadingEmployees;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header>
        <div className="flex items-center gap-3 mb-2">
           <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
              <Building2 className="w-6 h-6" />
           </div>
           <div>
              <h1 className="text-3xl font-black text-primary tracking-tight">Tableau de bord</h1>
              <p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p>
           </div>
        </div>
      </header>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <SummaryCard 
           title="Employés actifs" 
           value={stats.totalEmployees} 
           icon={Users} 
           color="blue"
           link={`/entity/${entityId}/employees`}
         />
         <SummaryCard 
           title="Contrats à échéance" 
           value={stats.expiringContracts.length} 
           icon={Clock} 
           color="orange"
           alert={stats.expiredContracts.length > 0}
           link={`/entity/${entityId}/contracts`}
         />
         <SummaryCard 
           title="Documents à échéance" 
           value={stats.expiringDocs.length} 
           icon={Calendar} 
           color="indigo"
           link={`/entity/${entityId}/documents`}
         />
         <SummaryCard 
           title="Documents expirés" 
           value={stats.expiredDocs.length} 
           icon={AlertTriangle} 
           color="red"
           alert={stats.expiredDocs.length > 0}
           link={`/entity/${entityId}/documents`}
         />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Critical Alerts Column */}
         <div className="lg:col-span-2 space-y-6">
            <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
               <CardHeader className="bg-secondary/10 border-b py-4 px-8 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Alertes de conformité
                  </CardTitle>
                  <Badge variant="outline" className="bg-white border-primary/10 text-[9px] font-black uppercase">Threshold: 30 jours</Badge>
               </CardHeader>
               <CardContent className="p-0">
                  {isLoadingData ? (
                    <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
                  ) : (stats.expiredContracts.length === 0 && stats.expiringContracts.length === 0 && stats.expiredDocs.length === 0 && stats.expiringDocs.length === 0) ? (
                    <div className="py-20 text-center space-y-4">
                       <div className="bg-green-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                          <CheckCircle2 className="w-8 h-8 text-green-500" />
                       </div>
                       <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Aucune échéance critique.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                       {/* Expired Contracts */}
                       {stats.expiredContracts.map(c => (
                         <ExpiryRow 
                            key={c.id} 
                            title={c.employeeDisplayName || "Contrat sans nom"} 
                            subtitle={c.contractType}
                            date={c.endDate}
                            type="contract"
                            variant="expired"
                            link={`/entity/${entityId}/contracts/${c.id}`}
                         />
                       ))}
                       {/* Expiring Contracts */}
                       {stats.expiringContracts.map(c => (
                         <ExpiryRow 
                            key={c.id} 
                            title={c.employeeDisplayName || "Contrat sans nom"} 
                            subtitle={c.contractType}
                            date={c.endDate}
                            type="contract"
                            variant="soon"
                            link={`/entity/${entityId}/contracts/${c.id}`}
                         />
                       ))}
                       {/* Expired Documents */}
                       {stats.expiredDocs.map(d => (
                         <ExpiryRow 
                            key={d.id} 
                            title={d.title} 
                            subtitle={d.employeeDisplayName || "Document général"}
                            date={d.expiresAt}
                            type="document"
                            variant="expired"
                            link={`/entity/${entityId}/documents`}
                         />
                       ))}
                       {/* Expiring Documents */}
                       {stats.expiringDocs.map(d => (
                         <ExpiryRow 
                            key={d.id} 
                            title={d.title} 
                            subtitle={d.employeeDisplayName || "Document général"}
                            date={d.expiresAt}
                            type="document"
                            variant="soon"
                            link={`/entity/${entityId}/documents`}
                         />
                       ))}
                    </div>
                  )}
               </CardContent>
            </Card>
         </div>

         {/* Side Info */}
         <div className="space-y-6">
            <Card className="border-primary/10 rounded-[2rem] shadow-lg overflow-hidden bg-primary/95 text-white">
               <CardHeader className="bg-white/10 py-6 border-b border-white/10 px-8">
                  <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                     <Clock className="w-4 h-4" /> Rappel Automatique
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8 space-y-4">
                  <p className="text-xs leading-relaxed opacity-80">
                    Les alertes de conformité sont calculées en temps réel sur la base des dates de fin de contrat et d'expiration des documents enregistrés.
                  </p>
                  <Separator className="bg-white/10" />
                  <div className="flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                     <p className="text-[10px] font-bold uppercase tracking-tight">Rouge : Action requise immédiate</p>
                  </div>
                  <div className="flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                     <p className="text-[10px] font-bold uppercase tracking-tight">Orange : Échéance sous 30 jours</p>
                  </div>
               </CardContent>
            </Card>
         </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, color, alert, link }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };

  return (
    <Link href={link}>
      <Card className={cn(
        "border-primary/5 shadow-sm rounded-2xl hover:shadow-md transition-all group bg-white",
        alert && "ring-1 ring-red-500/20"
      )}>
        <CardContent className="p-5 flex items-center gap-4">
          <div className={cn("p-3 rounded-2xl border transition-colors", colors[color])}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest truncate mr-2">{title}</p>
              <ArrowUpRight className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-2xl font-black text-primary">{value}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ExpiryRow({ title, subtitle, date, type, variant, link }: any) {
  return (
    <Link href={link} className="flex items-center justify-between p-6 hover:bg-slate-50 transition-colors group">
      <div className="flex items-center gap-4">
        <div className={cn(
          "p-3 rounded-2xl shrink-0",
          variant === 'expired' ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"
        )}>
          {type === 'contract' ? <FileSignature className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900 truncate">{title}</p>
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-tight mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
         <Badge variant="outline" className={cn(
           "text-[9px] font-black uppercase px-2 h-5",
           variant === 'expired' ? "bg-red-600 text-white border-none" : "bg-orange-50 text-orange-700 border-orange-200"
         )}>
           {variant === 'expired' ? "Expiré" : "Échéance proche"}
         </Badge>
         <p className="text-xs font-bold text-slate-500 tabular-nums">{formatDateDisplay(date)}</p>
      </div>
    </Link>
  );
}

function formatDateDisplay(val: any): string {
  const d = parseSafeDate(val);
  if (!d) return "N/A";
  return format(d, "dd MMM yyyy", { locale: fr });
}
