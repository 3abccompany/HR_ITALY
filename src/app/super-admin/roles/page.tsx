"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Filter,
  Search,
  ShieldCheck,
  Users,
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
import { subscribeSuperAdminCatalogReport } from "@/services/super-admin-catalog.service";
import type {
  SuperAdminCatalogComparisonState,
  SuperAdminCatalogReport,
  SuperAdminRoleCatalogItem,
} from "@/types/super-admin-catalog";

type ScopeFilter = "all" | "platform" | "entity";
type StatusFilter = "all" | "active" | "inactive" | "missing";
type ComparisonFilter = "all" | SuperAdminCatalogComparisonState;
type SortKey = "label" | "roleId" | "permissionCount" | "activeMemberships" | "status" | "comparisonState";
type PageSize = 10 | 20 | 30;

const pageSizeOptions: PageSize[] = [10, 20, 30];

const comparisonLabels: Record<SuperAdminCatalogComparisonState, string> = {
  synchronized: "Synchronisé",
  "missing-runtime": "Absent runtime",
  "runtime-only": "Runtime seul",
  drifted: "Différent",
  inactive: "Inactif",
};

export default function SuperAdminRolesCatalogPage() {
  const [report, setReport] = useState<SuperAdminCatalogReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [comparisonFilter, setComparisonFilter] = useState<ComparisonFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setReport(null);

    const unsubscribe = subscribeSuperAdminCatalogReport(
      (nextReport) => {
        setReport(nextReport);
        setError(null);
        setLoading(false);
      },
      (subscriptionError) => {
        setReport(null);
        setError(subscriptionError.message || "Impossible de synchroniser le catalogue des rôles.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  const filteredRoles = useMemo(() => {
    if (!report) return [];
    const normalizedSearch = search.trim().toLowerCase();

    const rows = report.roles.filter((role) => {
      if (scopeFilter !== "all" && role.scope !== scopeFilter) return false;
      if (comparisonFilter !== "all" && role.comparisonState !== comparisonFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "missing" && role.runtimeStatus) return false;
        if (statusFilter !== "missing" && role.runtimeStatus !== statusFilter) return false;
      }
      if (!normalizedSearch) return true;

      return [role.label, role.roleId, role.name, role.description]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch));
    });

    return rows.sort((left, right) => {
      if (sortKey === "permissionCount") return right.permissionCount - left.permissionCount;
      if (sortKey === "activeMemberships") return right.activeMemberships - left.activeMemberships;
      if (sortKey === "status") return String(left.runtimeStatus || "").localeCompare(String(right.runtimeStatus || ""));
      if (sortKey === "comparisonState") return left.comparisonState.localeCompare(right.comparisonState);
      if (sortKey === "roleId") return left.roleId.localeCompare(right.roleId);
      return left.label.localeCompare(right.label);
    });
  }, [comparisonFilter, report, scopeFilter, search, sortKey, statusFilter]);

  const totalItems = filteredRoles.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectiveCurrentPage = totalItems === 0 ? 1 : Math.min(currentPage, totalPages);
  const visibleStart = totalItems === 0 ? 0 : (effectiveCurrentPage - 1) * pageSize + 1;
  const visibleEnd = totalItems === 0 ? 0 : Math.min(effectiveCurrentPage * pageSize, totalItems);
  const paginatedRoles = useMemo(() => {
    const startIndex = (effectiveCurrentPage - 1) * pageSize;
    return filteredRoles.slice(startIndex, startIndex + pageSize);
  }, [effectiveCurrentPage, filteredRoles, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [comparisonFilter, pageSize, scopeFilter, search, sortKey, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => {
      if (totalItems === 0) return 1;
      return Math.min(page, totalPages);
    });
  }, [totalItems, totalPages]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="space-y-4">
        <Link href="/super-admin" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Retour au tableau de bord
        </Link>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="w-6 h-6" />
            <span className="font-semibold uppercase tracking-wider text-sm">Catalogue read-only</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-headline font-bold text-primary">Rôles</h1>
          <p className="max-w-3xl text-muted-foreground">
            Consultation des modèles de rôles système et runtime. La synchronisation reste séparée dans l'outil de maintenance.
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Catalogue indisponible</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => setSubscriptionKey((current) => current + 1)} className="bg-background text-foreground">
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogLoadingState />
      ) : report ? (
        <>
          {report.isEmptyRuntimeCatalog && (
            <Alert className="rounded-2xl border-orange-200 bg-orange-50/40">
              <Database className="h-4 w-4 text-orange-700" />
              <AlertTitle>Catalogue runtime vide</AlertTitle>
              <AlertDescription>
                Les modèles statiques existent, mais le catalogue Firestore semble vide. Cet état n'est pas considéré comme synchronisé.
              </AlertDescription>
            </Alert>
          )}

          {report.roleSummary.missingRuntime === 0 && report.roleSummary.runtimeOnly === 0 && report.roleSummary.drifted === 0 && report.roleSummary.inactive === 0 && (
            <Alert className="rounded-2xl border-green-200 bg-green-50/40">
              <CheckCircle2 className="h-4 w-4 text-green-700" />
              <AlertTitle>Rôles synchronisés</AlertTitle>
              <AlertDescription>Les rôles statiques et runtime sont alignés.</AlertDescription>
            </Alert>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-5">
            <SummaryCard title="Total rôles" value={report.roleSummary.total} />
            <SummaryCard title="Synchronisés" value={report.roleSummary.synchronized} tone="healthy" />
            <SummaryCard title="Absents runtime" value={report.roleSummary.missingRuntime} tone={report.roleSummary.missingRuntime > 0 ? "warning" : "healthy"} />
            <SummaryCard title="Runtime seuls" value={report.roleSummary.runtimeOnly} tone={report.roleSummary.runtimeOnly > 0 ? "warning" : "healthy"} />
            <SummaryCard title="Différents" value={report.roleSummary.drifted} tone={report.roleSummary.drifted > 0 ? "warning" : "healthy"} />
            <SummaryCard title="Affectations actives" value={report.roleSummary.activeMembershipAssignments} icon={Users} />
          </section>

          <CatalogFilters>
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher un rôle..." />
            <FilterSelect label="Portée" value={scopeFilter} onChange={(value) => setScopeFilter(value as ScopeFilter)} options={[["all", "Toutes"], ["platform", "Plateforme"], ["entity", "Entité"]]} />
            <FilterSelect label="Statut runtime" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={[["all", "Tous"], ["active", "Actif"], ["inactive", "Inactif"], ["missing", "Absent runtime"]]} />
            <FilterSelect label="Comparaison" value={comparisonFilter} onChange={(value) => setComparisonFilter(value as ComparisonFilter)} options={[["all", "Toutes"], ["synchronized", "Synchronisé"], ["missing-runtime", "Absent runtime"], ["runtime-only", "Runtime seul"], ["drifted", "Différent"], ["inactive", "Inactif"]]} />
            <FilterSelect label="Tri" value={sortKey} onChange={(value) => setSortKey(value as SortKey)} options={[["label", "Libellé"], ["roleId", "Role ID"], ["permissionCount", "Permissions"], ["activeMemberships", "Affectations actives"], ["status", "Statut"], ["comparisonState", "Comparaison"]]} />
          </CatalogFilters>

          <RolesTable
            roles={paginatedRoles}
            currentPage={effectiveCurrentPage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSize={pageSize}
            totalItems={totalItems}
            totalPages={totalPages}
            visibleEnd={visibleEnd}
            visibleStart={visibleStart}
          />
        </>
      ) : (
        <Alert className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Aucune donnée affichable</AlertTitle>
          <AlertDescription>Relancez la synchronisation du catalogue des rôles.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function RolesTable(props: {
  roles: SuperAdminRoleCatalogItem[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  pageSize: PageSize;
  totalItems: number;
  totalPages: number;
  visibleEnd: number;
  visibleStart: number;
}) {
  const hasResults = props.totalItems > 0;
  return (
    <Card className="rounded-2xl overflow-hidden border-primary/10">
      <CardHeader className="space-y-4">
        <CardTitle className="text-primary">Catalogue des rôles</CardTitle>
        <PaginationControls {...props} itemLabel="rôles" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rôle</TableHead>
                <TableHead>Portée</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Affectations</TableHead>
                <TableHead>Maintenance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!hasResults ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    Aucun rôle ne correspond aux filtres actuels.
                  </TableCell>
                </TableRow>
              ) : (
                props.roles.map((role) => (
                  <TableRow key={role.roleId} className="align-top">
                    <TableCell className="min-w-[260px]">
                      <p className="font-bold text-primary">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.roleId}</p>
                      {role.name && role.name !== role.label && <p className="text-xs text-muted-foreground">{role.name}</p>}
                      {role.description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{role.description}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{role.scope === "platform" ? "Plateforme" : role.scope === "entity" ? "Entité" : "Non renseigné"}</Badge>
                    </TableCell>
                    <TableCell>
                      <ComparisonBadge state={role.comparisonState} />
                      <p className="mt-2 text-xs text-muted-foreground">Runtime: {role.runtimeStatus || "Absent"}</p>
                      <p className="text-xs text-muted-foreground">Source: {role.source}</p>
                    </TableCell>
                    <TableCell className="font-semibold">{role.permissionCount}</TableCell>
                    <TableCell>
                      <p className="text-sm font-semibold">{role.totalMemberships} total</p>
                      <p className="text-xs text-green-700">{role.activeMemberships} actives</p>
                      <p className="text-xs text-muted-foreground">{role.inactiveMemberships} inactives</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <Link href="/super-admin/memberships" className="text-xs font-semibold text-primary hover:underline">Voir affectations</Link>
                        <Link href="/super-admin/security-health" className="text-xs font-semibold text-primary hover:underline">Voir diagnostics</Link>
                        <Link href="/super-admin/roles-seed" className="text-xs font-semibold text-muted-foreground hover:underline">Outil sync séparé</Link>
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

function SummaryCard({ title, value, tone = "default", icon: Icon = ShieldCheck }: { title: string; value: number; tone?: "default" | "warning" | "healthy"; icon?: any }) {
  return (
    <Card className={cn("rounded-2xl shadow-sm", tone === "warning" && "border-orange-200 bg-orange-50/30", tone === "healthy" && "border-green-100 bg-green-50/30")}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <CardTitle className="text-sm font-black text-primary">{title}</CardTitle>
        <Icon className="w-4 h-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-black tracking-tight text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

function CatalogFilters({ children }: { children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl border-primary/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary"><Filter className="w-5 h-5" /> Filtres</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">{children}</CardContent>
    </Card>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recherche</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" />
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </div>
  );
}

function PaginationControls(props: {
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  pageSize: PageSize;
  totalItems: number;
  totalPages: number;
  visibleEnd: number;
  visibleStart: number;
  itemLabel: string;
}) {
  const hasResults = props.totalItems > 0;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-slate-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-semibold text-slate-700">
        {hasResults ? `${props.visibleStart}–${props.visibleEnd} sur ${props.totalItems} ${props.itemLabel}` : `0 ${props.itemLabel}`}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap font-medium">Éléments par page</span>
          <select value={props.pageSize} onChange={(event) => props.onPageSizeChange(Number(event.target.value) as PageSize)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onPageChange(Math.max(1, props.currentPage - 1))} disabled={!hasResults || props.currentPage <= 1}>Précédent</Button>
          <span className="min-w-[92px] text-center text-sm font-semibold text-slate-700">Page {hasResults ? props.currentPage : 0} sur {hasResults ? props.totalPages : 0}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => props.onPageChange(Math.min(props.totalPages, props.currentPage + 1))} disabled={!hasResults || props.currentPage >= props.totalPages}>Suivant</Button>
        </div>
      </div>
    </div>
  );
}

function ComparisonBadge({ state }: { state: SuperAdminCatalogComparisonState }) {
  return (
    <Badge variant="outline" className={cn(
      "rounded-full",
      state === "synchronized" && "bg-green-50 text-green-700 border-green-100",
      state === "drifted" && "bg-orange-50 text-orange-700 border-orange-100",
      state === "missing-runtime" && "bg-red-50 text-red-700 border-red-100",
      state === "runtime-only" && "bg-blue-50 text-blue-700 border-blue-100",
      state === "inactive" && "bg-slate-50 text-slate-600 border-slate-200"
    )}>
      {comparisonLabels[state]}
    </Badge>
  );
}

function CatalogLoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-5">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Card key={item} className="rounded-2xl">
            <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-9 w-16" /></CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-2xl">
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full rounded-xl" />)}
        </CardContent>
      </Card>
    </div>
  );
}

