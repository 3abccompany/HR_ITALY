"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Building,
  Database,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserX,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeSuperAdminDashboardSummary } from "@/services/super-admin-dashboard.service";
import type {
  SuperAdminDashboardSummary,
  SuperAdminStatusSummary,
} from "@/types/super-admin-dashboard";
import { cn } from "@/lib/utils";

type KpiTone = "default" | "warning" | "critical" | "healthy";

export default function SuperAdminPage() {
  const [summary, setSummary] = useState<SuperAdminDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSummary(null);

    const unsubscribe = subscribeSuperAdminDashboardSummary(
      (result) => {
        setSummary(result);
        setError(null);
        setLoading(false);
      },
      (subscriptionError) => {
        setSummary(null);
        setError(subscriptionError.message || "Impossible de synchroniser le tableau de bord plateforme.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header>
        <div>
          <div className="flex items-center gap-2 text-primary mb-2">
            <ShieldCheck className="w-6 h-6" />
            <span className="font-semibold uppercase tracking-wider text-sm">Administration Plateforme</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-headline font-bold text-primary">Tableau de bord</h1>
          <p className="text-muted-foreground">
            Indicateurs globaux synchronisés en temps réel pour les entités, utilisateurs, affectations et catalogues d’accès.
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Indicateurs indisponibles</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubscriptionKey((current) => current + 1)}
              className="bg-background text-foreground"
            >
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <DashboardLoadingState />
      ) : summary ? (
        <>
          {summary.isEmptyPlatform && (
            <Alert className="rounded-2xl border-dashed">
              <Database className="h-4 w-4" />
              <AlertTitle>Plateforme vide</AlertTitle>
              <AlertDescription>
                Aucun enregistrement plateforme n’a encore été trouvé. Les compteurs à zéro sont normaux dans cet état.
              </AlertDescription>
            </Alert>
          )}

          <section className="space-y-4">
            <SectionTitle title="Vue plateforme" description="Données globales issues des collections de premier niveau." />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              <StatusKpiCard
                icon={Building}
                title="Entités"
                description="Entreprises et partenaires enregistrés."
                href="/super-admin/entities"
                summary={summary.entities}
              />
              <StatusKpiCard
                icon={Users}
                title="Utilisateurs"
                description="Profils applicatifs déclarés."
                href="/super-admin/users"
                summary={summary.users}
              />
              <StatusKpiCard
                icon={Lock}
                title="Memberships"
                description="Affectations utilisateur ↔ entité."
                href="/super-admin/memberships"
                summary={summary.memberships}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle title="Santé des accès" description="Contrôles relationnels simples, sans correction automatique." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <SimpleKpiCard
                icon={UserX}
                title="Utilisateurs sans affectation"
                value={summary.accessHealth.usersWithoutMembership}
                description="Utilisateurs sans membership associé."
                href="/super-admin/memberships"
                tone={summary.accessHealth.usersWithoutMembership > 0 ? "warning" : "healthy"}
                badge={summary.accessHealth.usersWithoutMembership > 0 ? "À vérifier" : "OK"}
              />
              <SimpleKpiCard
                icon={AlertTriangle}
                title="Affectations cassées"
                value={summary.accessHealth.brokenMemberships}
                description="Memberships avec utilisateur ou entité manquante."
                href="/super-admin/memberships"
                tone={summary.accessHealth.brokenMemberships > 0 ? "critical" : "healthy"}
                badge={summary.accessHealth.brokenMemberships > 0 ? "Critique" : "OK"}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle
              title="Santé accès & permissions"
              description="Diagnostic read-only des memberships, rôles et permissions. Aucune correction automatique."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
              <SimpleKpiCard
                icon={AlertTriangle}
                title="Anomalies critiques"
                value={summary.health.severity.critical}
                description="Accès actifs cassés ou privilèges structurellement invalides."
                href="/super-admin/security-health"
                tone={summary.health.severity.critical > 0 ? "critical" : "healthy"}
                badge={summary.health.severity.critical > 0 ? "Critique" : "OK"}
              />
              <SimpleKpiCard
                icon={ShieldAlert}
                title="Avertissements"
                value={summary.health.severity.warning}
                description="Écarts de catalogue, rôles ou snapshots à revoir."
                href="/super-admin/security-health"
                tone={summary.health.severity.warning > 0 ? "warning" : "healthy"}
                badge={summary.health.severity.warning > 0 ? "À vérifier" : "OK"}
              />
              <SimpleKpiCard
                icon={KeyRound}
                title="Permissions inconnues"
                value={summary.health.unknownPermissions}
                description="Permissions présentes dans les rôles ou memberships mais absentes du catalogue runtime."
                href="/super-admin/security-health"
                tone={summary.health.unknownPermissions > 0 ? "critical" : "healthy"}
                badge={summary.health.unknownPermissions > 0 ? "Catalogue" : "OK"}
              />
              <SimpleKpiCard
                icon={Lock}
                title="Snapshots désynchronisés"
                value={summary.health.staleRoleSnapshots}
                description="Memberships dont les permissions diffèrent du rôle référencé."
                href="/super-admin/security-health"
                tone={summary.health.staleRoleSnapshots > 0 ? "warning" : "healthy"}
                badge={summary.health.staleRoleSnapshots > 0 ? "Snapshot" : "OK"}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle
              title="Rôles et permissions"
              description="Catalogues existants. Les liens mènent temporairement aux outils de synchronisation contrôlée."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <SimpleKpiCard
                icon={ShieldCheck}
                title="Rôles"
                value={summary.catalog.roles}
                description="Modèles de rôles dans le catalogue."
                href="/super-admin/roles-seed"
                tone="default"
                badge="Sync temporaire"
              />
              <SimpleKpiCard
                icon={KeyRound}
                title="Permissions"
                value={summary.catalog.permissions}
                description="Permissions contrôlées disponibles."
                href="/super-admin/permissions-seed"
                tone="default"
                badge="Sync temporaire"
              />
            </div>
          </section>
        </>
      ) : (
        <Alert className="rounded-2xl">
          <Activity className="h-4 w-4" />
          <AlertTitle>Aucune donnée affichable</AlertTitle>
          <AlertDescription>Relancez la synchronisation des indicateurs plateforme.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-black text-primary tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StatusKpiCard({
  icon: Icon,
  title,
  description,
  href,
  summary,
}: {
  icon: any;
  title: string;
  description: string;
  href: string;
  summary: SuperAdminStatusSummary;
}) {
  return (
    <Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
      <Card className="h-full rounded-2xl border-primary/10 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-black text-primary">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="p-2 bg-primary rounded-xl shrink-0">
            <Icon className="w-4 h-4 text-white" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-4xl font-black tracking-tight text-slate-900">{summary.total}</div>
          <div className="grid grid-cols-2 gap-3">
            <BreakdownPill label="Actifs" value={summary.active} className="bg-green-50 text-green-700 border-green-100" />
            <BreakdownPill label="Inactifs" value={summary.inactive} className="bg-slate-50 text-slate-600 border-slate-100" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SimpleKpiCard({
  icon: Icon,
  title,
  value,
  description,
  href,
  tone,
  badge,
}: {
  icon: any;
  title: string;
  value: number;
  description: string;
  href: string;
  tone: KpiTone;
  badge: string;
}) {
  return (
    <Link href={href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
      <Card
        className={cn(
          "h-full rounded-2xl shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
          tone === "critical" && "border-red-200 bg-red-50/40",
          tone === "warning" && "border-orange-200 bg-orange-50/30",
          tone === "healthy" && "border-green-100 bg-green-50/20",
          tone === "default" && "border-primary/10"
        )}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-black text-primary">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div
            className={cn(
              "p-2 rounded-xl shrink-0",
              tone === "critical" && "bg-red-600",
              tone === "warning" && "bg-orange-500",
              tone === "healthy" && "bg-green-600",
              tone === "default" && "bg-primary"
            )}
          >
            <Icon className="w-4 h-4 text-white" />
          </div>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-4">
          <div className="text-4xl font-black tracking-tight text-slate-900">{value}</div>
          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              tone === "critical" && "bg-red-100 text-red-700 border-red-200",
              tone === "warning" && "bg-orange-100 text-orange-700 border-orange-200",
              tone === "healthy" && "bg-green-100 text-green-700 border-green-200"
            )}
          >
            {badge}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}

function BreakdownPill({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2", className)}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((section) => (
        <section key={section} className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48 rounded-full" />
            <Skeleton className="h-4 w-full max-w-md rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[0, 1, 2].slice(0, section === 0 ? 3 : 2).map((item) => (
              <Card key={item} className="rounded-2xl">
                <CardHeader className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-56" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-20" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
