"use client";

import { useActiveMembership } from "@/hooks/use-active-membership";
import { useRouter, useParams } from "next/navigation";
import { useEffect } from "react";
import { 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  CalendarDays, 
  ClipboardList, 
  TrendingUp,
  Loader2,
  ShieldCheck,
  Building,
  UserCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function EntityDashboardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  
  const { membership, entity, loading, error, permissions } = useActiveMembership(entityId);

  useEffect(() => {
    if (!loading && error) {
      router.push("/no-access");
    }
  }, [loading, error, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Validation de vos accès...</p>
      </div>
    );
  }

  if (!membership || !entity) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <div className="flex items-center gap-2 text-accent font-semibold mb-2 uppercase tracking-widest text-xs">
            <LayoutDashboard className="w-4 h-4" />
            <span>Workspace Entreprise</span>
          </div>
          <h1 className="text-5xl font-headline font-bold text-primary mb-2">{entity.nomEntreprise}</h1>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <div className="flex items-center gap-1">
              <Building className="w-3.5 h-3.5" />
              <span className="font-mono">{entityId}</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Entité Active</Badge>
            </div>
          </div>
        </div>

        <Card className="w-full md:w-auto bg-secondary/20 border-none shadow-none">
          <CardContent className="py-4 flex items-center gap-4">
            <div className="bg-primary/10 p-2 rounded-lg">
              <UserCircle className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-primary">{membership.userDisplayName}</p>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium uppercase text-muted-foreground">{membership.roleLabel}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="Total Personnes" value="--" />
        <StatCard icon={UserCheck} label="Employés Actifs" value="--" />
        <StatCard icon={CalendarDays} label="Entretiens prévus" value="--" />
        <StatCard icon={TrendingUp} label="Nouveaux Candidats" value="--" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Opérations Métier</CardTitle>
            <CardDescription>Accédez aux modules RH et gestion du personnel autorisés pour votre rôle.</CardDescription>
          </CardHeader>
          <CardContent className="py-12 text-center">
            <div className="bg-secondary/30 rounded-2xl p-12 border-2 border-dashed flex flex-col items-center gap-4">
              <ClipboardList className="w-12 h-12 text-muted-foreground opacity-30" />
              <div className="space-y-1">
                <h3 className="font-headline font-bold text-xl text-primary">Modules à venir</h3>
                <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                  Les modules opérationnels (Candidats, Employés, Contrats) sont en cours de déploiement pour cette entité.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Vos Permissions</CardTitle>
            <CardDescription>Aperçu des capacités effectives héritées de votre rôle.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="p-4 bg-accent/5 rounded-lg border border-accent/10">
                <div className="text-3xl font-bold text-accent mb-1">{permissions.length}</div>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-tight">Permissions Actives</p>
              </div>
              <div className="flex flex-col gap-2">
                <button className="text-left p-3 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-sm">
                  Voir ma fiche profil
                </button>
                <button className="text-left p-3 text-sm border rounded-lg hover:bg-secondary transition-colors">
                  Contacter le support
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <Card className="shadow-sm border-none bg-white">
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-secondary rounded-xl">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground leading-none mb-1 font-bold uppercase tracking-tight">{label}</p>
            <p className="text-3xl font-bold text-primary">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
