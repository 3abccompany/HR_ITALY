"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Info,
  KeyRound,
  Link as LinkIcon,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { subscribeSuperAdminHealthReport } from "@/services/super-admin-health.service";
import type {
  SuperAdminHealthCategory,
  SuperAdminHealthDiagnostic,
  SuperAdminHealthReport,
  SuperAdminHealthSeverity,
} from "@/types/super-admin-health";

type SeverityFilter = "all" | SuperAdminHealthSeverity;
type CategoryFilter = "all" | SuperAdminHealthCategory;
type PageSize = 10 | 20 | 30;

interface RuntimeStatusSummary {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  invalidOrMissing: number;
}

interface PermissionShapeSummary {
  validArray: number;
  missing: number;
  invalidType: number;
}

interface StatusCompatibilitySummary {
  users: RuntimeStatusSummary;
  entities: RuntimeStatusSummary;
  memberships: RuntimeStatusSummary;
  membershipPermissions: PermissionShapeSummary;
  superAdmins: RuntimeStatusSummary;
}

const pageSizeOptions: PageSize[] = [10, 20, 30];

const severityLabels: Record<SuperAdminHealthSeverity, string> = {
  critical: "Critique",
  warning: "Attention",
  information: "Info",
};

const categoryLabels: Record<SuperAdminHealthCategory, string> = {
  membership: "Membership",
  permission: "Permission",
  role: "Rôle",
  catalog: "Catalogue",
};

export default function SuperAdminSecurityHealthPage() {
  const [report, setReport] = useState<SuperAdminHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setReport(null);

    const unsubscribe = subscribeSuperAdminHealthReport(
      (nextReport) => {
        setReport(nextReport);
        setError(null);
        setLoading(false);
      },
      (subscriptionError) => {
        setReport(null);
        setError(subscriptionError.message || "Impossible de synchroniser les diagnostics d'accès.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  const entityOptions = useMemo(() => {
    if (!report) return [];
    const entities = new Map<string, string>();
    report.diagnostics.forEach((diagnostic) => {
      if (diagnostic.entityId) entities.set(diagnostic.entityId, diagnostic.entityName || diagnostic.entityId);
    });
    return Array.from(entities.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [report]);

  const filteredDiagnostics = useMemo(() => {
    if (!report) return [];
    const normalizedSearch = search.trim().toLowerCase();

    return report.diagnostics.filter((diagnostic) => {
      if (severityFilter !== "all" && diagnostic.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && diagnostic.category !== categoryFilter) return false;
      if (entityFilter !== "all" && diagnostic.entityId !== entityFilter) return false;
      if (!normalizedSearch) return true;

      return [
        diagnostic.title,
        diagnostic.explanation,
        diagnostic.userDisplayName,
        diagnostic.userEmail,
        diagnostic.entityName,
        diagnostic.roleLabel,
        diagnostic.roleId,
        diagnostic.permissionCode,
        diagnostic.membershipId,
        diagnostic.code,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch));
    });
  }, [categoryFilter, entityFilter, report, search, severityFilter]);

  const totalFilteredDiagnostics = filteredDiagnostics.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredDiagnostics / pageSize));
  const effectiveCurrentPage = totalFilteredDiagnostics === 0 ? 1 : Math.min(currentPage, totalPages);
  const visibleStart = totalFilteredDiagnostics === 0 ? 0 : (effectiveCurrentPage - 1) * pageSize + 1;
  const visibleEnd = totalFilteredDiagnostics === 0 ? 0 : Math.min(effectiveCurrentPage * pageSize, totalFilteredDiagnostics);
  const paginatedDiagnostics = useMemo(() => {
    const startIndex = (effectiveCurrentPage - 1) * pageSize;
    return filteredDiagnostics.slice(startIndex, startIndex + pageSize);
  }, [effectiveCurrentPage, filteredDiagnostics, pageSize]);
  const statusCompatibility = (report as (SuperAdminHealthReport & { statusCompatibility?: StatusCompatibilitySummary }) | null)?.statusCompatibility;

  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFilter, entityFilter, pageSize, search, severityFilter]);

  useEffect(() => {
    setCurrentPage((page) => {
      if (totalFilteredDiagnostics === 0) return 1;
      return Math.min(page, totalPages);
    });
  }, [totalFilteredDiagnostics, totalPages]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <ShieldAlert className="w-6 h-6" />
          <span className="font-semibold uppercase tracking-wider text-sm">Diagnostic plateforme</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-headline font-bold text-primary">Santé accès & permissions</h1>
          <p className="max-w-3xl text-muted-foreground">
            Diagnostic read-only des memberships, rôles et permissions à l'échelle plateforme. Cette page ne répare,
            ne synchronise et ne modifie aucune donnée.
          </p>
          <Badge variant="outline" className="rounded-full bg-primary/5 text-primary border-primary/20">
            Portée plateforme · lecture seule
          </Badge>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Diagnostics indisponibles</AlertTitle>
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
        <SecurityHealthLoadingState />
      ) : report ? (
        <>
          {report.isEmptyPlatform && (
            <Alert className="rounded-2xl border-dashed">
              <Info className="h-4 w-4" />
              <AlertTitle>Plateforme vide</AlertTitle>
              <AlertDescription>
                Aucun enregistrement plateforme n'a encore été trouvé. Les diagnostics resteront vides tant que les catalogues ne sont pas initialisés.
              </AlertDescription>
            </Alert>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            <SummaryCard
              title="Critiques"
              value={report.summary.severity.critical}
              icon={AlertTriangle}
              tone={report.summary.severity.critical > 0 ? "critical" : "healthy"}
              description="Accès actifs cassés ou privilèges structurellement invalides."
            />
            <SummaryCard
              title="Avertissements"
              value={report.summary.severity.warning}
              icon={ShieldAlert}
              tone={report.summary.severity.warning > 0 ? "warning" : "healthy"}
              description="Écarts de catalogue, snapshots désynchronisés ou données à revoir."
            />
            <SummaryCard
              title="Informations"
              value={report.summary.severity.information}
              icon={Info}
              tone="default"
              description="Signaux utiles sans défaut fonctionnel immédiat."
            />
            <SummaryCard
              title="Total diagnostics"
              value={report.summary.total}
              icon={ShieldCheck}
              tone={report.summary.isHealthy ? "healthy" : "default"}
              description="Volume total des observations affichées."
            />
          </section>

          {statusCompatibility && (
            <Card className="rounded-2xl border-primary/10">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <ShieldCheck className="w-5 h-5" />
                  Compatibilité des statuts
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Agrégats read-only pour vérifier les statuts runtime avant tout renforcement de hasPermission(). Les valeurs invalides attendues sont à 0.
                </p>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <StatusCompatibilityCard title="Utilisateurs" summary={statusCompatibility.users} invalidLabel="Utilisateurs avec statut invalide" />
                <StatusCompatibilityCard title="Entités" summary={statusCompatibility.entities} invalidLabel="Entités avec statut invalide" />
                <StatusCompatibilityCard title="Appartenances" summary={statusCompatibility.memberships} invalidLabel="Appartenances avec statut invalide" />
                <PermissionShapeCard summary={statusCompatibility.membershipPermissions} />
                <SuperAdminStatusCard summary={statusCompatibility.superAdmins} />
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl border-primary/10">
            <CardHeader className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-primary">
                <Filter className="w-5 h-5" />
                Filtres
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Les filtres s'appliquent localement aux diagnostics déjà chargés, sans nouvelle requête Firestore.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recherche</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Utilisateur, entité, rôle, permission..."
                    className="pl-9"
                  />
                </div>
              </div>
              <FilterSelect
                label="Sévérité"
                value={severityFilter}
                onChange={(value) => setSeverityFilter(value as SeverityFilter)}
                options={[
                  ["all", "Toutes"],
                  ["critical", "Critique"],
                  ["warning", "Attention"],
                  ["information", "Info"],
                ]}
              />
              <FilterSelect
                label="Catégorie"
                value={categoryFilter}
                onChange={(value) => setCategoryFilter(value as CategoryFilter)}
                options={[
                  ["all", "Toutes"],
                  ["membership", "Membership"],
                  ["permission", "Permission"],
                  ["role", "Rôle"],
                  ["catalog", "Catalogue"],
                ]}
              />
              <FilterSelect
                label="Entité"
                value={entityFilter}
                onChange={setEntityFilter}
                options={[["all", "Toutes"], ...entityOptions]}
              />
            </CardContent>
          </Card>

          {report.summary.isHealthy ? (
            <Alert className="rounded-2xl border-green-200 bg-green-50/40">
              <CheckCircle2 className="h-4 w-4 text-green-700" />
              <AlertTitle>Aucun problème détecté</AlertTitle>
              <AlertDescription>Aucun problème d'affectation ou de permission détecté.</AlertDescription>
            </Alert>
          ) : (
            <DiagnosticsTable
              diagnostics={paginatedDiagnostics}
              currentPage={effectiveCurrentPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSize={pageSize}
              totalItems={totalFilteredDiagnostics}
              totalPages={totalPages}
              visibleEnd={visibleEnd}
              visibleStart={visibleStart}
            />
          )}
        </>
      ) : (
        <Alert className="rounded-2xl">
          <Info className="h-4 w-4" />
          <AlertTitle>Aucun diagnostic affichable</AlertTitle>
          <AlertDescription>Relancez la synchronisation des diagnostics d'accès.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusCompatibilityCard({
  title,
  summary,
  invalidLabel,
}: {
  title: string;
  summary: RuntimeStatusSummary;
  invalidLabel: string;
}) {
  return (
    <div className="rounded-2xl border bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-primary">{title}</p>
          <p className="text-xs text-muted-foreground">Total: {summary.total}</p>
        </div>
        <CompatibilityBadge value={summary.invalidOrMissing} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <StatusPill label="Actifs" value={summary.active} />
        <StatusPill label="Inactifs" value={summary.inactive} />
        <StatusPill label="Archivés" value={summary.archived} />
      </div>
      <p className={cn("text-xs font-semibold", summary.invalidOrMissing > 0 ? "text-red-700" : "text-green-700")}>
        {invalidLabel}: {summary.invalidOrMissing}
      </p>
    </div>
  );
}

function PermissionShapeCard({ summary }: { summary: PermissionShapeSummary }) {
  const invalidTotal = summary.missing + summary.invalidType;

  return (
    <div className="rounded-2xl border bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-primary">Snapshots de permissions</p>
          <p className="text-xs text-muted-foreground">Forme du champ permissions</p>
        </div>
        <CompatibilityBadge value={invalidTotal} />
      </div>
      <div className="space-y-2 text-xs">
        <StatusPill label="Tableaux valides" value={summary.validArray} />
        <StatusPill label="Permissions manquantes" value={summary.missing} tone={summary.missing > 0 ? "critical" : "default"} />
        <StatusPill label="Permissions de type invalide" value={summary.invalidType} tone={summary.invalidType > 0 ? "critical" : "default"} />
      </div>
    </div>
  );
}

function SuperAdminStatusCard({ summary }: { summary: RuntimeStatusSummary }) {
  const invalidTotal = summary.inactive + summary.archived + summary.invalidOrMissing;

  return (
    <div className="rounded-2xl border bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-primary">Super Admins</p>
          <p className="text-xs text-muted-foreground">Total: {summary.total}</p>
        </div>
        <CompatibilityBadge value={invalidTotal} />
      </div>
      <div className="space-y-2 text-xs">
        <StatusPill label="Actifs" value={summary.active} />
        <StatusPill label="Super Admins non actifs" value={summary.inactive + summary.archived} tone={summary.inactive + summary.archived > 0 ? "warning" : "default"} />
        <StatusPill label="Super Admins avec statut invalide" value={summary.invalidOrMissing} tone={summary.invalidOrMissing > 0 ? "critical" : "default"} />
      </div>
    </div>
  );
}

function StatusPill({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warning" | "critical" }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2",
        tone === "warning" && "border-orange-200 bg-orange-50 text-orange-700",
        tone === "critical" && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-black text-slate-900">{value}</span>
    </div>
  );
}

function CompatibilityBadge({ value }: { value: number }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full",
        value > 0 ? "border-red-200 bg-red-100 text-red-700" : "border-green-200 bg-green-100 text-green-700"
      )}
    >
      {value > 0 ? `${value} à revoir` : "OK"}
    </Badge>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  description: string;
  icon: any;
  tone: "critical" | "warning" | "healthy" | "default";
}) {
  return (
    <Card
      className={cn(
        "rounded-2xl shadow-sm",
        tone === "critical" && "border-red-200 bg-red-50/40",
        tone === "warning" && "border-orange-200 bg-orange-50/30",
        tone === "healthy" && "border-green-100 bg-green-50/30",
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
      <CardContent>
        <div className="text-4xl font-black tracking-tight text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

function DiagnosticsTable({
  diagnostics,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSize,
  totalItems,
  totalPages,
  visibleEnd,
  visibleStart,
}: {
  diagnostics: SuperAdminHealthDiagnostic[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  pageSize: PageSize;
  totalItems: number;
  totalPages: number;
  visibleEnd: number;
  visibleStart: number;
}) {
  const hasResults = totalItems > 0;

  return (
    <Card className="rounded-2xl overflow-hidden border-primary/10">
      <CardHeader className="space-y-4">
        <div className="space-y-1">
          <CardTitle className="text-primary">Diagnostics détaillés</CardTitle>
          <p className="text-sm text-muted-foreground">
            Liste read-only des observations. Aucune action de correction n'est disponible dans cette phase.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border bg-slate-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-700">
            {hasResults ? `${visibleStart}–${visibleEnd} sur ${totalItems} diagnostics` : "0 diagnostic"}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="whitespace-nowrap font-medium">Éléments par page</span>
              <select
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={!hasResults || currentPage <= 1}
              >
                Précédent
              </Button>
              <span className="min-w-[92px] text-center text-sm font-semibold text-slate-700">
                Page {hasResults ? currentPage : 0} sur {hasResults ? totalPages : 0}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={!hasResults || currentPage >= totalPages}
              >
                Suivant
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sévérité</TableHead>
                <TableHead>Diagnostic</TableHead>
                <TableHead>Contexte</TableHead>
                <TableHead>Rôle / permission</TableHead>
                <TableHead>Navigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diagnostics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    Aucun diagnostic ne correspond aux filtres actuels.
                  </TableCell>
                </TableRow>
              ) : (
                diagnostics.map((diagnostic) => (
                  <TableRow key={diagnostic.id} className="align-top">
                    <TableCell>
                      <SeverityBadge severity={diagnostic.severity} />
                      <p className="mt-2 text-xs text-muted-foreground">{categoryLabels[diagnostic.category]}</p>
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <p className="font-bold text-primary">{diagnostic.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{diagnostic.explanation}</p>
                      <p className="mt-2 break-all text-[11px] text-muted-foreground">{diagnostic.code}</p>
                    </TableCell>
                    <TableCell className="min-w-[240px]">
                      <ContextLine label="Utilisateur" value={diagnostic.userDisplayName || diagnostic.userEmail || diagnostic.userId} />
                      <ContextLine label="Entité" value={diagnostic.entityName || diagnostic.entityId} />
                      <ContextLine label="Membership" value={diagnostic.membershipId} />
                      <ContextLine label="Statut" value={diagnostic.status} />
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <ContextLine label="Rôle" value={diagnostic.roleLabel || diagnostic.roleId} />
                      <ContextLine label="Permission" value={diagnostic.permissionCode} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        {diagnostic.userId && <SafeAdminLink href="/super-admin/users" label="Utilisateurs" icon={ShieldCheck} />}
                        {diagnostic.entityId && <SafeAdminLink href="/super-admin/entities" label="Entités" icon={KeyRound} />}
                        {diagnostic.membershipId && <SafeAdminLink href="/super-admin/memberships" label="Affectations" icon={LinkIcon} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: SuperAdminHealthSeverity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full",
        severity === "critical" && "bg-red-100 text-red-700 border-red-200",
        severity === "warning" && "bg-orange-100 text-orange-700 border-orange-200",
        severity === "information" && "bg-blue-50 text-blue-700 border-blue-100"
      )}
    >
      {severityLabels[severity]}
    </Badge>
  );
}

function ContextLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold text-slate-700">{label}:</span>{" "}
      <span className="break-all text-muted-foreground">{value}</span>
    </p>
  );
}

function SafeAdminLink({ href, label, icon: Icon }: { href: string; label: string; icon: any }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </Link>
  );
}

function SecurityHealthLoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {[0, 1, 2, 3].map((item) => (
          <Card key={item} className="rounded-2xl">
            <CardHeader className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-2xl">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-14 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
