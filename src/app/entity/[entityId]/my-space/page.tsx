"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Loader2, User, Calendar, Clock, FolderOpen, 
  ShieldCheck, UserCircle, Briefcase, 
  MapPin, Building2, Fingerprint, Info,
  Calculator, Plane, Plus
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useUser, useCollection } from "@/firebase";
import { collection, query, where, limit } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Employee } from "@/types/employee";
import { LeaveBalance } from "@/types/time-off";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export default function MySpacePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { loading: membershipLoading, entity } = useActiveMembership(entityId);

  const currentYear = new Date().getFullYear();

  // Fetch only the employee document linked to this user's UID
  const employeeQuery = useMemo(() => {
    if (!db || !entityId || !user) return null;
    return query(
      collection(db, `entities/${entityId}/employees`), 
      where("userId", "==", user.uid),
      limit(1)
    );
  }, [db, entityId, user]);

  const { data: employeeData, loading: loadingEmployee } = useCollection<Employee>(employeeQuery as any, "my-space.profile");
  const employee = employeeData?.[0];

  const balanceQuery = useMemo(() => {
    if (!db || !entityId || !employee) return null;
    return query(
      collection(db, `entities/${entityId}/leaveBalances`),
      where("employeeId", "==", employee.employeeId),
      where("year", "==", currentYear),
      limit(1)
    );
  }, [db, entityId, employee, currentYear]);

  const { data: balanceData, loading: loadingBalance } = useCollection<LeaveBalance>(balanceQuery as any, "my-space.balance");
  const balance = balanceData?.[0];

  if (membershipLoading || loadingEmployee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Accès à votre espace...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 pb-24">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
            <UserCircle className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Mon Espace Employé</h1>
        </div>
        <p className="text-muted-foreground text-sm font-medium">Bienvenue dans votre portail RH personnel chez {entity?.nomEntreprise}.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Profile Summary */}
        <div className="md:col-span-2 space-y-6">
          <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
            <CardHeader className="bg-primary/5 border-b py-6 px-8">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <User className="w-4 h-4" /> Mon Profil
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              {employee ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <DetailItem label="Nom Complet" value={employee.displayName} icon={User} />
                  <DetailItem label="Matricule" value={employee.employeeCode} icon={Fingerprint} />
                  <DetailItem label="Poste" value={employee.jobTitle} icon={Briefcase} />
                  <DetailItem label="Département" value={employee.departmentName} icon={Building2} />
                  <DetailItem label="Site" value={employee.worksiteName} icon={MapPin} />
                  <DetailItem label="Date d'embauche" value={employee.hireDate} icon={Calendar} />
                </div>
              ) : (
                <div className="py-8 text-center space-y-3 opacity-60">
                   <Info className="w-10 h-10 mx-auto text-muted-foreground/30" />
                   <p className="text-sm font-medium">Informations de profil en cours de synchronisation.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leave Balances */}
          <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-6 px-8 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                   <Plane className="w-4 h-4" /> Solde Congés {currentYear}
                </CardTitle>
                <Badge variant="outline" className="bg-white border-primary/10">Congés Payés</Badge>
             </CardHeader>
             <CardContent className="p-8">
                {loadingBalance ? (
                   <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-primary/20" /></div>
                ) : balance ? (
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                      <BalanceStat label="Total Acquis" value={balance.entitlementDays + balance.carriedOverDays} unit="jours" />
                      <BalanceStat label="Déjà Pris" value={balance.usedDays} unit="jours" color="red" />
                      <BalanceStat label="En attente" value={balance.pendingDays} unit="jours" color="orange" />
                      <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10 text-center">
                         <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-1">Restant</p>
                         <p className="text-3xl font-black text-primary">{balance.remainingDays}</p>
                      </div>
                   </div>
                ) : (
                   <div className="py-8 text-center bg-secondary/5 rounded-2xl border border-dashed">
                      <Calculator className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground font-medium">Votre solde n'a pas encore été initialisé pour {currentYear}.</p>
                   </div>
                )}
             </CardContent>
          </Card>

          {/* Placeholders for future modules */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PlaceholderCard title="Nouvelle demande" icon={Plus} description="Posez un congé ou déclarez une absence (Bientôt)." />
            <PlaceholderCard title="Historique" icon={Clock} description="Consultez l'historique de vos demandes." />
          </div>
        </div>

        {/* Sidebar / Status */}
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-primary/10 bg-secondary/5 overflow-hidden">
            <CardHeader className="py-6 px-8 border-b bg-secondary/10">
               <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                 <ShieldCheck className="w-4 h-4" /> Statut du compte
               </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-4">
               <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                  <p className="text-xs font-bold text-slate-800 uppercase tracking-tight">Accès Employé Actif</p>
               </div>
               <Separator className="opacity-20" />
               <p className="text-[10px] text-muted-foreground leading-relaxed">
                 Vous êtes connecté à l'espace sécurisé de l'entité <strong>{entity?.nomEntreprise}</strong>. 
                 Vos données sont protégées et accessibles uniquement par vous et le service RH.
               </p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-primary/10 bg-primary/95 text-white overflow-hidden shadow-lg">
             <CardContent className="p-8 flex flex-col items-center text-center space-y-4">
                <div className="bg-white/10 p-4 rounded-full">
                  <FolderOpen className="w-8 h-8 text-white" />
                </div>
                <div className="space-y-1">
                   <h4 className="font-bold text-sm uppercase tracking-widest">Mes Documents</h4>
                   <p className="text-[10px] opacity-70">Accédez à vos contrats et bulletins de paie.</p>
                </div>
                <Badge variant="outline" className="border-white/20 text-white text-[9px] font-black uppercase">Bientôt disponible</Badge>
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BalanceStat({ label, value, unit, color }: any) {
   return (
      <div className="text-center">
         <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1">{label}</p>
         <p className={cn("text-2xl font-black", 
           color === 'red' ? "text-red-600" : 
           color === 'orange' ? "text-orange-600" : "text-slate-800"
         )}>{value}</p>
         <p className="text-[8px] font-bold text-muted-foreground uppercase">{unit}</p>
      </div>
   );
}

function DetailItem({ label, value, icon: Icon }: any) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <Icon className="w-3.5 h-3.5 text-primary/30" />
        <span className="truncate">{value || "Non renseigné"}</span>
      </div>
    </div>
  );
}

function PlaceholderCard({ title, icon: Icon, description }: any) {
  return (
    <Card className="rounded-3xl border-dashed border-2 bg-secondary/5 group opacity-60 grayscale hover:opacity-100 hover:grayscale-0 transition-all cursor-not-allowed">
      <CardContent className="p-6 space-y-3">
        <div className="bg-white p-2.5 rounded-xl shadow-sm w-fit group-hover:text-primary transition-colors">
          <Icon className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <div className="space-y-1">
          <h4 className="font-black text-xs uppercase tracking-widest text-primary">{title}</h4>
          <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
        </div>
        <Badge variant="outline" className="text-[8px] font-black uppercase tracking-tighter h-4">Module à venir</Badge>
      </CardContent>
    </Card>
  );
}
