"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, Users, FileText, 
  AlertTriangle, Clock, Calendar, CheckCircle2,
  FileSignature, Building2,
  ArrowUpRight, AlertCircle,
  Stethoscope, ShieldCheck,
  GraduationCap, Send, Shield, FileWarning,
  PlusCircle, ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useCollection, useFirebase } from "@/firebase";
import { collection, query, where } from "firebase/firestore";
import { format, isBefore, addDays, startOfDay, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { MEDICAL_VISIT_TYPE_LABELS, MedicalVisitType } from "@/types/medical-visit";

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

function formatDateDisplay(val: any): string {
  const d = parseSafeDate(val);
  if (!d) return "N/A";
  return format(d, "dd MMM yyyy", { locale: fr });
}

export default function EntityDashboardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission, entity, membership } = useActiveMembership(entityId);

  // Guard to ensure membership context matches the current route entity
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  const canReadContracts = hasPermission("contracts.read");
  const canReadDocs = hasPermission("documents.read");
  const canReadEmployees = hasPermission("employees.read");
  const canReadMedical = hasPermission("medicalVisits.read");
  const canReadTraining = hasPermission("training.read");
  const canReadSafety = hasPermission("safety.read");
  const canReadCPI = hasPermission("employmentRequests.read");

  // Collections
  const contractsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadContracts) return null;
    return query(collection(db, `entities/${entityId}/contracts`));
  }, [db, entityId, permissionsReady, canReadContracts]);

  const docsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadDocs) return null;
    return query(collection(db, `entities/${entityId}/documents`));
  }, [db, entityId, permissionsReady, canReadDocs]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadEmployees) return null;
    return query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active"));
  }, [db, entityId, permissionsReady, canReadEmployees]);

  const medicalVisitsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadMedical) return null;
    return query(collection(db, `entities/${entityId}/medicalVisits`));
  }, [db, entityId, permissionsReady, canReadMedical]);

  const trainingsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadTraining) return null;
    return query(collection(db, `entities/${entityId}/trainings`));
  }, [db, entityId, permissionsReady, canReadTraining]);

  const safetyQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadSafety) return null;
    return query(collection(db, `entities/${entityId}/safetyDpiAssignments`));
  }, [db, entityId, permissionsReady, canReadSafety]);

  const requestsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadCPI) return null;
    return query(collection(db, `entities/${entityId}/employmentRequests`));
  }, [db, entityId, permissionsReady, canReadCPI]);

  const { data: contracts } = useCollection<any>(contractsQuery, "dashboard.contracts");
  const { data: documents } = useCollection<any>(docsQuery, "dashboard.documents");
  const { data: employees } = useCollection<any>(employeesQuery, "dashboard.employees");
  const { data: medicalVisits } = useCollection<any>(medicalVisitsQuery, "dashboard.medicalVisits");
  const { data: trainings } = useCollection<any>(trainingsQuery, "dashboard.trainings");
  const { data: safetyAssignments } = useCollection<any>(safetyQuery, "dashboard.safety");
  const { data: employmentRequests } = useCollection<any>(requestsQuery, "dashboard.requests");

  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const thirtyDaysOut = addDays(today, 30);

    const s = {
      criticalCount: 0,
      upcoming30Count: 0,
      missingDocsCount: 0,
      pendingActionsCount: 0,
      
      // Module Lists
      contractAlerts: [] as any[],
      medicalAlerts: [] as any[],
      trainingAlerts: [] as any[],
      safetyAlerts: [] as any[],
      gedAlerts: [] as any[],
      
      totalEmployees: employees?.length || 0
    };

    // 1. Contracts & CPI
    if (canReadContracts && contracts) {
      contracts.forEach(c => {
        if (['terminated', 'archived', 'cancelled'].includes(c.status)) return;
        if (c.status === 'renewed') return;

        const endDate = parseSafeDate(c.endDate);

        if (c.status === 'active' && endDate) {
          if (isBefore(endDate, today)) {
            s.criticalCount++;
            s.contractAlerts.push({ id: c.id, title: c.employeeDisplayName || 'Contrat', subtitle: `Expiré (${c.contractType})`, date: c.endDate, type: 'contract', variant: 'expired', link: `/entity/${entityId}/contracts/${c.id}` });
          } else if (isBefore(endDate, thirtyDaysOut)) {
            s.upcoming30Count++;
            s.contractAlerts.push({ id: c.id, title: c.employeeDisplayName || 'Contrat', subtitle: `Échéance proche (${c.contractType})`, date: c.endDate, type: 'contract', variant: 'soon', link: `/entity/${entityId}/contracts/${c.id}` });
          }
        } else if (c.status === 'draft') {
          s.pendingActionsCount++;
          s.contractAlerts.push({ id: c.id, title: c.employeeDisplayName || 'Contrat', subtitle: 'Brouillon à finaliser', date: c.createdAt, type: 'contract', variant: 'soon', link: `/entity/${entityId}/contracts/${c.id}` });
        } else if (c.status === 'pending_activation') {
          s.pendingActionsCount++;
        }
      });
    }

    if (canReadCPI && employmentRequests) {
      employmentRequests.forEach(r => {
        if (['completed', 'cancelled'].includes(r.status)) return;
        if (r.status === 'draft' || r.status === 'to_send') {
          s.criticalCount++;
          s.contractAlerts.push({ id: r.id, title: r.candidateDisplayName || 'CPI', subtitle: 'Communication UniLav bloquante', date: r.createdAt, type: 'cpi', variant: 'expired', link: `/entity/${entityId}/employment-requests/${r.id}` });
        } else {
          s.pendingActionsCount++;
          s.contractAlerts.push({ id: r.id, title: r.candidateDisplayName || 'CPI', subtitle: 'Transmission en cours', date: r.sentAt || r.createdAt, type: 'cpi', variant: 'soon', link: `/entity/${entityId}/employment-requests/${r.id}` });
        }
      });
    }

    // 2. Medical Visits
    if (canReadMedical && medicalVisits) {
      medicalVisits.forEach(v => {
        if (['cancelled', 'archived'].includes(v.status)) return;

        const visitDate = parseSafeDate(v.visitDate);
        const nextDate = parseSafeDate(v.nextVisitDate);
        const empName = v.employeeDisplayName || 'Employé';

        if (nextDate && isBefore(nextDate, today)) {
          s.criticalCount++;
          s.medicalAlerts.push({ id: v.id, title: empName, subtitle: `Visite échue`, date: v.nextVisitDate, type: 'medical', variant: 'expired', link: `/entity/${entityId}/medical-visits` });
        } else if (nextDate && isBefore(nextDate, thirtyDaysOut)) {
          s.upcoming30Count++;
          s.medicalAlerts.push({ id: v.id, title: empName, subtitle: `Échéance proche`, date: v.nextVisitDate, type: 'medical', variant: 'soon', link: `/entity/${entityId}/medical-visits` });
        }

        if (v.fitnessStatus === 'pending_result' && visitDate && isBefore(visitDate, today)) {
          s.pendingActionsCount++;
          s.medicalAlerts.push({ id: v.id, title: empName, subtitle: `Résultat manquant`, date: v.visitDate, type: 'medical', variant: 'missing', link: `/entity/${entityId}/medical-visits` });
        }

        if (v.status === 'completed' && !v.documentId) {
          s.missingDocsCount++;
          s.gedAlerts.push({ id: v.id, title: `Certificat médical: ${empName}`, subtitle: 'Non joint', date: v.visitDate, type: 'document', variant: 'missing', link: `/entity/${entityId}/medical-visits` });
        }
      });
    }

    // 3. Trainings
    if (canReadTraining && trainings) {
      trainings.forEach(t => {
        if (['cancelled', 'archived'].includes(t.status)) return;
        
        const expiryDate = parseSafeDate(t.expiryDate);
        const empName = t.employeeDisplayName || 'Employé';

        if (expiryDate && isBefore(expiryDate, today)) {
          s.criticalCount++;
          s.trainingAlerts.push({ id: t.id, title: empName, subtitle: `Formation expirée: ${t.title}`, date: t.expiryDate, type: 'training', variant: 'expired', link: `/entity/${entityId}/training` });
        } else if (expiryDate && isBefore(expiryDate, thirtyDaysOut)) {
          s.upcoming30Count++;
          s.trainingAlerts.push({ id: t.id, title: empName, subtitle: `Renouvellement: ${t.title}`, date: t.expiryDate, type: 'training', variant: 'soon', link: `/entity/${entityId}/training` });
        }

        if (t.status === 'planned' || t.status === 'in_progress') {
          s.pendingActionsCount++;
          s.trainingAlerts.push({ id: t.id, title: empName, subtitle: `Session planifiée: ${t.title}`, date: t.startDate || t.courseDate, type: 'training', variant: 'soon', link: `/entity/${entityId}/training` });
        }

        if (t.status === 'completed' && !t.certificateDocumentId) {
          s.missingDocsCount++;
          s.gedAlerts.push({ id: t.id, title: `Attestation: ${t.title}`, subtitle: empName, date: t.completionDate || t.endDate, type: 'document', variant: 'missing', link: `/entity/${entityId}/training` });
        }
      });
    }

    // 4. Safety / DPI
    if (canReadSafety && safetyAssignments) {
      safetyAssignments.forEach(a => {
        if (a.status !== 'assigned') return;

        const nextDate = parseSafeDate(a.plannedReplacementDate);
        const empName = a.employeeName || 'Employé';

        if (nextDate && isBefore(nextDate, today)) {
          s.criticalCount++;
          s.safetyAlerts.push({ id: a.assignmentId, title: empName, subtitle: `DPI échu: ${a.dpiName}`, date: a.plannedReplacementDate, type: 'safety', variant: 'expired', link: `/entity/${entityId}/safety` });
        } else if (nextDate && isBefore(nextDate, thirtyDaysOut)) {
          s.upcoming30Count++;
          s.safetyAlerts.push({ id: a.assignmentId, title: empName, subtitle: `DPI à remplacer: ${a.dpiName}`, date: a.plannedReplacementDate, type: 'safety', variant: 'soon', link: `/entity/${entityId}/safety` });
        }

        if (!a.reportDocumentId) {
          s.missingDocsCount++;
          s.gedAlerts.push({ id: a.assignmentId, title: `PV DPI: ${a.dpiName}`, subtitle: empName, date: a.deliveryDate, type: 'document', variant: 'missing', link: `/entity/${entityId}/safety` });
        }
      });
    }

    // Sorting by priority (earlier dates first)
    const sortByDate = (a: any, b: any) => {
      const d1 = parseSafeDate(a.date)?.getTime() || 0;
      const d2 = parseSafeDate(b.date)?.getTime() || 0;
      if (!d1 && d2) return 1;
      if (d1 && !d2) return -1;
      return d1 - d2;
    };

    s.contractAlerts.sort(sortByDate);
    s.medicalAlerts.sort(sortByDate);
    s.trainingAlerts.sort(sortByDate);
    s.safetyAlerts.sort(sortByDate);
    s.gedAlerts.sort(sortByDate);

    return s;
  }, [contracts, employees, medicalVisits, trainings, safetyAssignments, employmentRequests, canReadContracts, canReadMedical, canReadTraining, canReadSafety, canReadCPI, entityId]);

  const isLoading = membershipLoading || !permissionsReady;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Chargement du dashboard...</p>
      </div>
    );
  }

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

      {/* Global Compliance KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <SummaryCard 
           title="Alertes critiques" 
           value={stats.criticalCount} 
           icon={AlertTriangle} 
           color="red"
           alert={stats.criticalCount > 0}
           link="#"
         />
         <SummaryCard 
           title="Échéances 30 jours" 
           value={stats.upcoming30Count} 
           icon={Clock} 
           color="orange"
           link="#"
         />
         <SummaryCard 
           title="Documents manquants" 
           value={stats.missingDocsCount} 
           icon={FileWarning} 
           color="indigo"
           link="#"
         />
         <SummaryCard 
           title="Actions RH en attente" 
           value={stats.pendingActionsCount} 
           icon={PlusCircle} 
           color="blue"
           link="#"
         />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         {/* Contracts & CPI */}
         {canReadContracts && (
           <ComplianceSection 
             title="Contrats & CPI / UniLav" 
             icon={FileSignature}
             alerts={stats.contractAlerts}
             link={`/entity/${entityId}/contracts`}
           />
         )}

         {/* Health at Work */}
         {canReadMedical && (
           <ComplianceSection 
             title="Santé au travail" 
             icon={Stethoscope}
             alerts={stats.medicalAlerts}
             link={`/entity/${entityId}/medical-visits`}
           />
         )}

         {/* Training */}
         {canReadTraining && (
           <ComplianceSection 
             title="Formations" 
             icon={GraduationCap}
             alerts={stats.trainingAlerts}
             link={`/entity/${entityId}/training`}
           />
         )}

         {/* Safety */}
         {canReadSafety && (
           <ComplianceSection 
             title="Sécurité / EPI-DPI" 
             icon={ShieldCheck}
             alerts={stats.safetyAlerts}
             link={`/entity/${entityId}/safety`}
           />
         )}

         {/* GED Compliance */}
         {canReadDocs && (
           <ComplianceSection 
             title="Audit GED / Certificats" 
             icon={FileWarning}
             alerts={stats.gedAlerts}
             link={`/entity/${entityId}/documents`}
             className="lg:col-span-2"
           />
         )}
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
    <Card className={cn(
      "border-primary/5 shadow-sm rounded-2xl group bg-white",
      alert && "ring-1 ring-red-500/20 shadow-md"
    )}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border transition-colors", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest truncate mr-2">{title}</p>
            {link !== "#" && <ArrowUpRight className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </div>
          <p className="text-2xl font-black text-primary">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ComplianceSection({ title, icon: Icon, alerts, link, className }: any) {
  return (
    <Card className={cn("rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white h-fit", className)}>
      <CardHeader className="bg-secondary/10 border-b py-4 px-8 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
          <Icon className="w-4 h-4" /> {title}
        </CardTitle>
        <Link href={link} className="text-[10px] font-black uppercase text-primary/60 hover:text-primary transition-colors flex items-center gap-1">
           Voir tout <ChevronRight className="w-3 h-3" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {alerts.length === 0 ? (
          <div className="py-12 text-center space-y-2 opacity-40">
             <CheckCircle2 className="w-8 h-8 mx-auto text-green-500" />
             <p className="text-[10px] font-bold uppercase tracking-widest">Conformité OK</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
             {alerts.slice(0, 5).map((a: any) => (
               <ExpiryRow 
                  key={a.id} 
                  title={a.title} 
                  subtitle={a.subtitle}
                  date={a.date}
                  type={a.type}
                  variant={a.variant}
                  link={a.link}
               />
             ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExpiryRow({ title, subtitle, date, type, variant, link }: any) {
  const icons: any = {
    contract: <FileSignature className="w-5 h-5" />,
    document: <FileText className="w-5 h-5" />,
    medical: <Stethoscope className="w-5 h-5" />,
    training: <GraduationCap className="w-5 h-5" />,
    safety: <ShieldCheck className="w-5 h-5" />,
    cpi: <Send className="w-5 h-5" />
  };

  const badgeConfig: any = {
    expired: { label: "Critique", className: "bg-red-600 text-white border-none" },
    missing: { label: "Manquant", className: "bg-red-600 text-white border-none" },
    soon: { label: "Échéance", className: "bg-orange-50 text-orange-700 border-orange-200" }
  };

  const config = badgeConfig[variant] || { label: "Action", className: "bg-slate-50" };

  return (
    <Link href={link} className="flex items-center justify-between p-6 hover:bg-slate-50 transition-colors group">
      <div className="flex items-center gap-4">
        <div className={cn(
          "p-3 rounded-2xl shrink-0",
          (variant === 'expired' || variant === 'missing') ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"
        )}>
          {icons[type] || <FileText className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900 truncate text-sm">{title}</p>
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-tight mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
         <Badge variant="outline" className={cn("text-[9px] font-black uppercase px-2 h-5", config.className)}>
           {config.label}
         </Badge>
         <p className="text-xs font-bold text-slate-500 tabular-nums">{formatDateDisplay(date)}</p>
      </div>
    </Link>
  );
}
