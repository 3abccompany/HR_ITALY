"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Filter,
  History,
  Search,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";

type PageSize = 10 | 20 | 30;
type TrustFilter = "all" | "trusted" | "legacy";

interface AuditLogRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  entityId: string;
  userId: string;
  source: string;
  date: Date | null;
  timestampMs: number;
}

interface AuditUserSummary {
  uid: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface AuditEntitySummary {
  entityId: string;
  name?: string;
  legalName?: string;
}

const pageSizeOptions: PageSize[] = [10, 20, 30];

function asSafeString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "Non renseigné";
}

function resolveDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as Timestamp).toDate === "function") return (value as Timestamp).toDate();
  if (typeof value === "object" && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

function snapshotToAuditLog(document: QueryDocumentSnapshot<DocumentData>): AuditLogRow {
  const data = document.data();
  const date = resolveDate(data.timestamp) || resolveDate(data.createdAt);

  return {
    id: document.id,
    action: asSafeString(data.action),
    resourceType: asSafeString(data.resourceType),
    resourceId: asSafeString(data.resourceId),
    entityId: asSafeString(data.entityId),
    userId: asSafeString(data.userId),
    source: typeof data.source === "string" ? data.source : "",
    date,
    timestampMs: date?.getTime() || 0,
  };
}

function snapshotToAuditUser(document: QueryDocumentSnapshot<DocumentData>): AuditUserSummary {
  const data = document.data();

  return {
    uid: typeof data.uid === "string" && data.uid.trim().length > 0 ? data.uid.trim() : document.id,
    displayName: typeof data.displayName === "string" ? data.displayName.trim() : undefined,
    firstName: typeof data.firstName === "string" ? data.firstName.trim() : undefined,
    lastName: typeof data.lastName === "string" ? data.lastName.trim() : undefined,
    email: typeof data.email === "string" ? data.email.trim() : undefined,
  };
}

function buildUserMap(snapshot: QueryDocumentSnapshot<DocumentData>[]): Map<string, AuditUserSummary> {
  const userMap = new Map<string, AuditUserSummary>();

  snapshot.forEach((document) => {
    const user = snapshotToAuditUser(document);
    userMap.set(document.id, user);
    if (user.uid) userMap.set(user.uid, user);
  });

  return userMap;
}

function snapshotToAuditEntity(document: QueryDocumentSnapshot<DocumentData>): AuditEntitySummary {
  const data = document.data();

  return {
    entityId: typeof data.entityId === "string" && data.entityId.trim().length > 0 ? data.entityId.trim() : document.id,
    name: typeof data.name === "string" ? data.name.trim() : undefined,
    legalName: typeof data.legalName === "string" ? data.legalName.trim() : undefined,
  };
}

function buildEntityMap(snapshot: QueryDocumentSnapshot<DocumentData>[]): Map<string, AuditEntitySummary> {
  const entityMap = new Map<string, AuditEntitySummary>();

  snapshot.forEach((document) => {
    const entity = snapshotToAuditEntity(document);
    entityMap.set(document.id, entity);
    if (entity.entityId) entityMap.set(entity.entityId, entity);
  });

  return entityMap;
}

function resolveUserDisplay(userId: string, usersById: Map<string, AuditUserSummary>) {
  if (userId.startsWith("system:")) {
    return {
      primary: "Système",
      email: "",
      technicalId: userId,
    };
  }

  const user = usersById.get(userId);
  if (!user) {
    return {
      primary: "Utilisateur inconnu",
      email: "",
      technicalId: userId,
    };
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const primary = user.displayName || fullName || user.email || "Utilisateur inconnu";

  return {
    primary,
    email: user.email && user.email !== primary ? user.email : "",
    technicalId: userId,
  };
}

function resolveEntityDisplay(entityId: string, entitiesById: Map<string, AuditEntitySummary>) {
  if (!entityId || entityId === "Non renseignÃ©") {
    return {
      primary: "Plateforme / global",
      legalName: "",
      technicalId: "",
    };
  }

  const entity = entitiesById.get(entityId);
  if (!entity) {
    return {
      primary: "Entité inconnue",
      legalName: "",
      technicalId: entityId,
    };
  }

  const primary = entity.name || entity.legalName || "Entité inconnue";

  return {
    primary,
    legalName: entity.legalName && entity.legalName !== primary ? entity.legalName : "",
    technicalId: entityId,
  };
}

function isTrustedServerLog(log: AuditLogRow): boolean {
  return log.source === "trusted-server";
}

function formatAuditDate(date: Date | null): string {
  if (!date) return "Date non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateStart(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function parseDateEnd(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export default function SuperAdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [usersById, setUsersById] = useState<Map<string, AuditUserSummary>>(new Map());
  const [entitiesById, setEntitiesById] = useState<Map<string, AuditEntitySummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [trustFilter, setTrustFilter] = useState<TrustFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!db) {
      setError("Firestore n'est pas initialisé.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setLogs([]);

    const unsubscribe = onSnapshot(
      collection(db, "auditLogs"),
      (snapshot) => {
        const nextLogs = snapshot.docs
          .map(snapshotToAuditLog)
          .sort((left, right) => right.timestampMs - left.timestampMs || right.id.localeCompare(left.id));
        setLogs(nextLogs);
        setError(null);
        setLoading(false);
      },
      (subscriptionError) => {
        setLogs([]);
        setError(subscriptionError.message || "Impossible de synchroniser les journaux d'audit.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  useEffect(() => {
    if (!db) return;

    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        setUsersById(buildUserMap(snapshot.docs));
      },
      () => {
        setUsersById(new Map());
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  useEffect(() => {
    if (!db) return;

    const unsubscribe = onSnapshot(
      collection(db, "entities"),
      (snapshot) => {
        setEntitiesById(buildEntityMap(snapshot.docs));
      },
      () => {
        setEntitiesById(new Map());
      }
    );

    return unsubscribe;
  }, [subscriptionKey]);

  const actionOptions = useMemo(() => buildOptions(logs.map((log) => log.action)), [logs]);
  const resourceTypeOptions = useMemo(() => buildOptions(logs.map((log) => log.resourceType)), [logs]);
  const entityOptions = useMemo(() => {
    const entityIds = Array.from(new Set(logs.map((log) => log.entityId).filter((entityId) => entityId && entityId !== "Non renseignÃ©")));
    return entityIds
      .map((entityId) => [entityId, resolveEntityDisplay(entityId, entitiesById).primary] as [string, string])
      .sort((left, right) => left[1].localeCompare(right[1]));
  }, [entitiesById, logs]);

  const trustedCount = useMemo(() => logs.filter(isTrustedServerLog).length, [logs]);
  const legacyCount = logs.length - trustedCount;

  const filteredLogs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const from = parseDateStart(dateFrom);
    const to = parseDateEnd(dateTo);

    return logs.filter((log) => {
      if (actionFilter !== "all" && log.action !== actionFilter) return false;
      if (resourceTypeFilter !== "all" && log.resourceType !== resourceTypeFilter) return false;
      if (entityFilter !== "all" && log.entityId !== entityFilter) return false;
      if (trustFilter === "trusted" && !isTrustedServerLog(log)) return false;
      if (trustFilter === "legacy" && isTrustedServerLog(log)) return false;
      if (from !== null && log.timestampMs < from) return false;
      if (to !== null && log.timestampMs > to) return false;
      if (!normalizedSearch) return true;

      const entityDisplay = resolveEntityDisplay(log.entityId, entitiesById);

      return [log.action, log.resourceType, log.resourceId, log.entityId, entityDisplay.primary, entityDisplay.legalName, log.userId, log.source]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [actionFilter, dateFrom, dateTo, entitiesById, entityFilter, logs, resourceTypeFilter, search, trustFilter]);

  const totalItems = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectiveCurrentPage = totalItems === 0 ? 1 : Math.min(currentPage, totalPages);
  const visibleStart = totalItems === 0 ? 0 : (effectiveCurrentPage - 1) * pageSize + 1;
  const visibleEnd = totalItems === 0 ? 0 : Math.min(effectiveCurrentPage * pageSize, totalItems);
  const paginatedLogs = useMemo(() => {
    const startIndex = (effectiveCurrentPage - 1) * pageSize;
    return filteredLogs.slice(startIndex, startIndex + pageSize);
  }, [effectiveCurrentPage, filteredLogs, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, dateFrom, dateTo, entityFilter, pageSize, resourceTypeFilter, search, trustFilter]);

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
            <History className="w-6 h-6" />
            <span className="font-semibold uppercase tracking-wider text-sm">Audit read-only</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-headline font-bold text-primary">Audit</h1>
          <p className="max-w-3xl text-muted-foreground">
            Consultation Super Admin des journaux d'audit existants. Les détails bruts ne sont pas affichés afin d'éviter l'exposition de données sensibles.
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audit indisponible</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => setSubscriptionKey((current) => current + 1)} className="bg-background text-foreground">
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <AuditLoadingState />
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <SummaryCard title="Journaux" value={logs.length} icon={History} />
            <SummaryCard title="Fiables" value={trustedCount} icon={ShieldCheck} tone="healthy" />
            <SummaryCard title="Legacy / non vérifiés" value={legacyCount} icon={ShieldQuestion} tone={legacyCount > 0 ? "warning" : "healthy"} />
          </section>

          {logs.length === 0 ? (
            <Alert className="rounded-2xl border-dashed">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Aucun journal d'audit</AlertTitle>
              <AlertDescription>La collection auditLogs ne contient aucun événement affichable.</AlertDescription>
            </Alert>
          ) : (
            <>
              <AuditFilters
                actionFilter={actionFilter}
                actionOptions={actionOptions}
                dateFrom={dateFrom}
                dateTo={dateTo}
                entityFilter={entityFilter}
                entityOptions={entityOptions}
                onActionFilterChange={setActionFilter}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onEntityFilterChange={setEntityFilter}
                onResourceTypeFilterChange={setResourceTypeFilter}
                onSearchChange={setSearch}
                onTrustFilterChange={(value) => setTrustFilter(value as TrustFilter)}
                resourceTypeFilter={resourceTypeFilter}
                resourceTypeOptions={resourceTypeOptions}
                search={search}
                trustFilter={trustFilter}
              />

              <AuditTable
                currentPage={effectiveCurrentPage}
                logs={paginatedLogs}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
                pageSize={pageSize}
                totalItems={totalItems}
                totalPages={totalPages}
                entitiesById={entitiesById}
                usersById={usersById}
                visibleEnd={visibleEnd}
                visibleStart={visibleStart}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function buildOptions(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value && value !== "Non renseigné"))).sort((left, right) => left.localeCompare(right));
}

function AuditFilters(props: {
  actionFilter: string;
  actionOptions: string[];
  dateFrom: string;
  dateTo: string;
  entityFilter: string;
  entityOptions: [string, string][];
  onActionFilterChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onEntityFilterChange: (value: string) => void;
  onResourceTypeFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onTrustFilterChange: (value: string) => void;
  resourceTypeFilter: string;
  resourceTypeOptions: string[];
  search: string;
  trustFilter: TrustFilter;
}) {
  return (
    <Card className="rounded-2xl border-primary/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary">
          <Filter className="h-5 w-5" />
          Filtres
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Rechercher action, ressource, entité, utilisateur..."
            className="pl-9"
          />
        </div>
        <FilterSelect label="Action" value={props.actionFilter} onChange={props.onActionFilterChange} options={props.actionOptions} />
        <FilterSelect label="Ressource" value={props.resourceTypeFilter} onChange={props.onResourceTypeFilterChange} options={props.resourceTypeOptions} />
        <FilterSelect label="Entité" value={props.entityFilter} onChange={props.onEntityFilterChange} options={props.entityOptions} />
        <FilterSelect
          label="Confiance"
          value={props.trustFilter}
          onChange={props.onTrustFilterChange}
          options={[
            ["trusted", "Fiable"],
            ["legacy", "Legacy / non vérifié"],
          ]}
        />
        <DateInput label="Depuis" value={props.dateFrom} onChange={props.onDateFromChange} />
        <DateInput label="Jusqu'au" value={props.dateTo} onChange={props.onDateToChange} />
      </CardContent>
    </Card>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | [string, string][];
}) {
  const normalizedOptions = props.options.map((option) => Array.isArray(option) ? option : [option, option] as [string, string]);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{props.label}</p>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous</SelectItem>
          {normalizedOptions.map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{props.label}</p>
      <Input type="date" value={props.value} max={formatDateInput(new Date())} onChange={(event) => props.onChange(event.target.value)} />
    </div>
  );
}

function AuditTable(props: {
  currentPage: number;
  logs: AuditLogRow[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  pageSize: PageSize;
  totalItems: number;
  totalPages: number;
  entitiesById: Map<string, AuditEntitySummary>;
  usersById: Map<string, AuditUserSummary>;
  visibleEnd: number;
  visibleStart: number;
}) {
  const hasResults = props.totalItems > 0;

  return (
    <Card className="rounded-2xl overflow-hidden border-primary/10">
      <CardHeader className="space-y-4">
        <CardTitle className="text-primary">Journaux d'audit</CardTitle>
        <PaginationControls {...props} />
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Ressource</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Confiance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!hasResults ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    Aucun journal d'audit ne correspond aux filtres actuels.
                  </TableCell>
                </TableRow>
              ) : (
                props.logs.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{formatAuditDate(log.date)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-xs font-bold text-primary">{log.action}</p>
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <p className="font-semibold">{log.resourceType}</p>
                      <p className="break-all font-mono text-xs text-muted-foreground">{log.resourceId}</p>
                    </TableCell>
                    <TableCell>
                      <EntityCell log={log} entitiesById={props.entitiesById} />
                    </TableCell>
                    <TableCell>
                      <UserCell log={log} usersById={props.usersById} />
                    </TableCell>
                    <TableCell>
                      <TrustBadge log={log} />
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

function EntityCell({ log, entitiesById }: { log: AuditLogRow; entitiesById: Map<string, AuditEntitySummary> }) {
  const entityDisplay = resolveEntityDisplay(log.entityId, entitiesById);

  return (
    <div className="min-w-[180px] space-y-1">
      <p className="font-semibold text-slate-800">{entityDisplay.primary}</p>
      {entityDisplay.legalName && <p className="text-xs text-muted-foreground">{entityDisplay.legalName}</p>}
      {entityDisplay.technicalId && (
        <p className="break-all font-mono text-[10px] text-muted-foreground/70" title={entityDisplay.technicalId}>
          {entityDisplay.technicalId}
        </p>
      )}
    </div>
  );
}

function UserCell({ log, usersById }: { log: AuditLogRow; usersById: Map<string, AuditUserSummary> }) {
  const userDisplay = resolveUserDisplay(log.userId, usersById);

  return (
    <div className="min-w-[180px] space-y-1">
      <p className="font-semibold text-slate-800">{userDisplay.primary}</p>
      {userDisplay.email && <p className="break-all text-xs text-muted-foreground">{userDisplay.email}</p>}
      <p className="break-all font-mono text-[10px] text-muted-foreground/70" title={userDisplay.technicalId}>
        {userDisplay.technicalId}
      </p>
    </div>
  );
}

function TrustBadge({ log }: { log: AuditLogRow }) {
  if (isTrustedServerLog(log)) {
    return (
      <Badge className="rounded-full bg-green-100 text-green-800 hover:bg-green-100">
        Fiable
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="rounded-full border-orange-200 bg-orange-50 text-orange-700">
      Legacy / non vérifié
    </Badge>
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
}) {
  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
      <span>
        {props.visibleStart}–{props.visibleEnd} sur {props.totalItems} journaux
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(props.pageSize)} onValueChange={(value) => props.onPageSizeChange(Number(value) as PageSize)}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>{option} / page</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => props.onPageChange(Math.max(1, props.currentPage - 1))} disabled={props.currentPage <= 1}>
          Précédent
        </Button>
        <span>Page {props.currentPage} sur {props.totalPages}</span>
        <Button variant="outline" size="sm" onClick={() => props.onPageChange(Math.min(props.totalPages, props.currentPage + 1))} disabled={props.currentPage >= props.totalPages}>
          Suivant
        </Button>
      </div>
    </div>
  );
}

function SummaryCard(props: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "healthy" | "warning";
}) {
  const Icon = props.icon;

  return (
    <Card className={cn(
      "rounded-2xl border-primary/10",
      props.tone === "healthy" && "bg-green-50/40 border-green-100",
      props.tone === "warning" && "bg-orange-50/40 border-orange-100"
    )}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-muted-foreground">{props.title}</p>
            <p className="mt-2 text-3xl font-black text-primary">{props.value}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditLoadingState() {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[0, 1, 2].map((item) => (
          <Card key={item} className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </section>
      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
