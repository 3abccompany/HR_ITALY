"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Edit,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  cloneSystemRoleAction,
  createCustomRoleAction,
  deactivateCustomRoleAction,
  listCustomRoleManagementDataAction,
  updateCustomRoleAction,
  type CustomRoleManagementCustomRole,
  type CustomRoleManagementDataResult,
  type CustomRoleManagementEntity,
  type CustomRoleManagementPermission,
  type CustomRoleManagementSystemRole,
} from "@/app/actions/custom-role-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useUser } from "@/firebase";

type FormMode = "create" | "clone" | "edit";

interface RoleFormState {
  mode: FormMode;
  customRoleId?: string;
  sourceRoleId?: string;
  name: string;
  label: string;
  description: string;
  permissions: string[];
}

const emptyForm: RoleFormState = {
  mode: "create",
  name: "",
  label: "",
  description: "",
  permissions: [],
};

function entityLabel(entity: CustomRoleManagementEntity): string {
  return entity.name || entity.legalName || entity.entityId;
}

function safeError(result: { error?: string; code?: string }): string {
  return result.error || result.code || "Action impossible.";
}

export default function SuperAdminRolesCatalogPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const [data, setData] = useState<CustomRoleManagementDataResult | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RoleFormState | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<CustomRoleManagementCustomRole | null>(null);

  const loadData = async (entityId = selectedEntityId) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const result = await listCustomRoleManagementDataAction({ idToken, entityId: entityId || undefined });
      if (!result.success) {
        setError(safeError(result));
        setData(null);
        return;
      }
      setData(result);
    } catch {
      setError("Impossible de charger les rôles personnalisés.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEntityId]);

  const entities = data?.entities || [];
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);
  const systemRoles = data?.systemRoles || [];
  const customRoles = data?.customRoles || [];
  const permissions = data?.permissions || [];

  const activeEntityPermissions = useMemo(
    () => permissions.filter((permission) => !permission.code.startsWith("platform.")),
    [permissions]
  );

  const permissionGroups = useMemo(() => {
    const normalizedSearch = permissionSearch.trim().toLowerCase();
    const groups = new Map<string, CustomRoleManagementPermission[]>();

    activeEntityPermissions
      .filter((permission) => {
        if (!normalizedSearch) return true;
        return [permission.code, permission.label, permission.description, permission.module]
          .some((value) => value.toLowerCase().includes(normalizedSearch));
      })
      .forEach((permission) => {
        const group = groups.get(permission.module) || [];
        group.push(permission);
        groups.set(permission.module, group);
      });

    return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [activeEntityPermissions, permissionSearch]);

  const openCreateForm = () => {
    setForm({ ...emptyForm, mode: "create" });
    setPermissionSearch("");
  };

  const openCloneForm = (role: CustomRoleManagementSystemRole) => {
    if (!role.cloneAllowed) return;
    setForm({
      mode: "clone",
      sourceRoleId: role.roleId,
      name: `${role.name}Custom`,
      label: `${role.label} (copie)`,
      description: role.description,
      permissions: [],
    });
    setPermissionSearch("");
  };

  const openEditForm = (role: CustomRoleManagementCustomRole) => {
    if (role.status !== "active") return;
    setForm({
      mode: "edit",
      customRoleId: role.roleId,
      name: role.name,
      label: role.label,
      description: role.description,
      permissions: role.permissions,
    });
    setPermissionSearch("");
  };

  const togglePermission = (code: string) => {
    setForm((current) => {
      if (!current || current.mode === "clone") return current;
      const selected = new Set(current.permissions);
      if (selected.has(code)) selected.delete(code);
      else selected.add(code);
      return { ...current, permissions: Array.from(selected).sort((left, right) => left.localeCompare(right)) };
    });
  };

  const showMutationResult = (result: { success: boolean; auditWarning?: string; error?: string; code?: string }, successTitle: string) => {
    if (!result.success) {
      toast({ variant: "destructive", title: "Action refusée", description: safeError(result) });
      return false;
    }

    toast({
      title: successTitle,
      description: result.auditWarning || "Action enregistrée avec succès.",
      variant: result.auditWarning ? "default" : undefined,
    });
    return true;
  };

  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !form || !selectedEntityId) return;

    setActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const result = form.mode === "create"
        ? await createCustomRoleAction({
          idToken,
          entityId: selectedEntityId,
          name: form.name,
          label: form.label,
          description: form.description,
          permissions: form.permissions,
        })
        : form.mode === "clone"
          ? await cloneSystemRoleAction({
            idToken,
            entityId: selectedEntityId,
            sourceRoleId: form.sourceRoleId || "",
            name: form.name,
            label: form.label,
            description: form.description,
          })
          : await updateCustomRoleAction({
            idToken,
            entityId: selectedEntityId,
            customRoleId: form.customRoleId || "",
            name: form.name,
            label: form.label,
            description: form.description,
            permissions: form.permissions,
          });

      if (showMutationResult(result, form.mode === "edit" ? "Rôle personnalisé mis à jour" : form.mode === "clone" ? "Rôle système cloné" : "Rôle personnalisé créé")) {
        setForm(null);
        await loadData(selectedEntityId);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!user || !selectedEntityId || !deactivateTarget) return;
    setActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const result = await deactivateCustomRoleAction({
        idToken,
        entityId: selectedEntityId,
        customRoleId: deactivateTarget.roleId,
      });
      if (showMutationResult(result, result.alreadyInactive ? "Rôle déjà inactif" : "Rôle personnalisé désactivé")) {
        setDeactivateTarget(null);
        await loadData(selectedEntityId);
      }
    } finally {
      setActionLoading(false);
    }
  };

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
            <span className="font-semibold uppercase tracking-wider text-sm">Super Admin uniquement</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-headline font-bold text-primary">Rôles</h1>
          <p className="max-w-3xl text-muted-foreground">
            Gestion des rôles personnalisés par entité. Les rôles prédéfinis restent protégés, non modifiables et prêts à l'emploi.
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Gestion des rôles indisponible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <RolesManagementLoadingState />
      ) : (
        <>
          <SystemRolesSection roles={systemRoles} onClone={openCloneForm} />

          <Card className="rounded-2xl border-primary/10">
            <CardHeader className="space-y-3">
              <CardTitle className="text-primary">Rôles personnalisés</CardTitle>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Entité</label>
                  <select
                    value={selectedEntityId}
                    onChange={(event) => {
                      setSelectedEntityId(event.target.value);
                      setForm(null);
                      setDeactivateTarget(null);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Sélectionner une entité</option>
                    {entities.map((entity) => (
                      <option key={entity.entityId} value={entity.entityId}>
                        {entityLabel(entity)} ({entity.status})
                      </option>
                    ))}
                  </select>
                  {selectedEntity && (
                    <p className="text-xs text-muted-foreground">
                      ID technique: <span className="font-mono">{selectedEntity.entityId}</span>
                    </p>
                  )}
                </div>
                <Button type="button" onClick={openCreateForm} disabled={!selectedEntityId || actionLoading} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Créer un rôle
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedEntityId ? (
                <EmptyState title="Aucune entité sélectionnée" description="Choisissez une entité pour charger ses rôles personnalisés." />
              ) : customRoles.length === 0 ? (
                <EmptyState title="Aucun rôle personnalisé" description="Cette entité ne contient pas encore de rôle personnalisé." />
              ) : (
                <CustomRolesTable roles={customRoles} onEdit={openEditForm} onDeactivate={setDeactivateTarget} actionLoading={actionLoading} />
              )}
            </CardContent>
          </Card>

          {form && selectedEntityId && (
            <RoleFormCard
              actionLoading={actionLoading}
              form={form}
              onCancel={() => setForm(null)}
              onChange={setForm}
              onSubmit={handleSubmitForm}
              permissionGroups={permissionGroups}
              permissionSearch={permissionSearch}
              selectedEntity={selectedEntity}
              setPermissionSearch={setPermissionSearch}
              togglePermission={togglePermission}
            />
          )}
        </>
      )}

      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver le rôle personnalisé</AlertDialogTitle>
            <AlertDialogDescription>
              Le rôle restera visible mais ne pourra plus être modifié dans cette phase. Les affectations existantes ne sont pas modifiées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); handleDeactivate(); }} disabled={actionLoading} className="bg-red-600 text-white hover:bg-red-700">
              {actionLoading ? "Désactivation..." : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SystemRolesSection({ roles, onClone }: { roles: CustomRoleManagementSystemRole[]; onClone: (role: CustomRoleManagementSystemRole) => void }) {
  return (
    <Card className="rounded-2xl border-primary/10">
      <CardHeader>
        <CardTitle className="text-primary">Rôles prédéfinis</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <Card key={role.roleId} className="rounded-2xl bg-slate-50/60">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold text-primary">{role.label}</h2>
                  <Badge variant="outline" className="rounded-full bg-blue-50 text-blue-700 border-blue-100">Protégé</Badge>
                  <Badge variant="outline" className="rounded-full">Actif</Badge>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{role.roleId}</p>
                <p className="text-sm text-muted-foreground">{role.description}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold">{role.permissionCount} permissions</span>
                {role.cloneAllowed ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onClone(role)} className="gap-2">
                    <Copy className="h-4 w-4" />
                    Cloner
                  </Button>
                ) : (
                  <Badge variant="outline" className="rounded-full bg-slate-100 text-slate-600">Non clonable</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}

function CustomRolesTable({ roles, onEdit, onDeactivate, actionLoading }: {
  roles: CustomRoleManagementCustomRole[];
  onEdit: (role: CustomRoleManagementCustomRole) => void;
  onDeactivate: (role: CustomRoleManagementCustomRole) => void;
  actionLoading: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="p-3">Rôle</th>
            <th className="p-3">Statut</th>
            <th className="p-3">Permissions</th>
            <th className="p-3">Version</th>
            <th className="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => {
            const isActive = role.status === "active";
            return (
              <tr key={role.roleId} className="border-t align-top">
                <td className="p-3">
                  <p className="font-bold text-primary">{role.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">{role.roleId}</p>
                  {role.name && <p className="text-xs text-muted-foreground">{role.name}</p>}
                  {role.description && <p className="mt-1 max-w-lg text-sm text-muted-foreground">{role.description}</p>}
                  {role.sourceRoleId && <p className="mt-1 text-xs text-muted-foreground">Source: {role.sourceRoleId}</p>}
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={cn("rounded-full", isActive ? "bg-green-50 text-green-700 border-green-100" : "bg-slate-50 text-slate-600 border-slate-200")}>
                    {isActive ? "Actif" : "Inactif"}
                  </Badge>
                </td>
                <td className="p-3 font-semibold">{role.permissionCount}</td>
                <td className="p-3">{role.version || 1}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onEdit(role)} disabled={!isActive || actionLoading} className="gap-2">
                      <Edit className="h-4 w-4" />
                      Modifier
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => onDeactivate(role)} disabled={!isActive || actionLoading} className="gap-2 text-red-600 hover:text-red-700">
                      <ShieldOff className="h-4 w-4" />
                      Désactiver
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoleFormCard(props: {
  actionLoading: boolean;
  form: RoleFormState;
  onCancel: () => void;
  onChange: (form: RoleFormState) => void;
  onSubmit: (event: React.FormEvent) => void;
  permissionGroups: [string, CustomRoleManagementPermission[]][];
  permissionSearch: string;
  selectedEntity?: CustomRoleManagementEntity;
  setPermissionSearch: (value: string) => void;
  togglePermission: (code: string) => void;
}) {
  const isClone = props.form.mode === "clone";
  const title = props.form.mode === "edit" ? "Modifier le rôle personnalisé" : props.form.mode === "clone" ? "Cloner un rôle prédéfini" : "Créer un rôle personnalisé";

  return (
    <Card className="rounded-2xl border-primary/20 shadow-sm">
      <CardHeader>
        <CardTitle className="text-primary">{title}</CardTitle>
        {props.selectedEntity && (
          <p className="text-sm text-muted-foreground">
            Entité: {entityLabel(props.selectedEntity)} <span className="font-mono text-xs">({props.selectedEntity.entityId})</span>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={props.onSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <LabeledInput label="Nom technique" value={props.form.name} onChange={(value) => props.onChange({ ...props.form, name: value })} />
            <LabeledInput label="Libellé" value={props.form.label} onChange={(value) => props.onChange({ ...props.form, label: value })} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
            <Textarea value={props.form.description} onChange={(event) => props.onChange({ ...props.form, description: event.target.value })} />
          </div>

          {isClone ? (
            <Alert className="rounded-2xl">
              <Copy className="h-4 w-4" />
              <AlertTitle>Permissions copiées depuis le rôle source</AlertTitle>
              <AlertDescription>
                Le serveur validera toutes les permissions du rôle prédéfini avant de créer la copie. Les permissions plateforme sont rejetées.
              </AlertDescription>
            </Alert>
          ) : (
            <PermissionSelector
              form={props.form}
              permissionGroups={props.permissionGroups}
              permissionSearch={props.permissionSearch}
              setPermissionSearch={props.setPermissionSearch}
              togglePermission={props.togglePermission}
            />
          )}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.actionLoading}>
              Annuler
            </Button>
            <Button type="submit" disabled={props.actionLoading || !props.form.name.trim() || !props.form.label.trim() || (!isClone && props.form.permissions.length === 0)}>
              {props.actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PermissionSelector({ form, permissionGroups, permissionSearch, setPermissionSearch, togglePermission }: {
  form: RoleFormState;
  permissionGroups: [string, CustomRoleManagementPermission[]][];
  permissionSearch: string;
  setPermissionSearch: (value: string) => void;
  togglePermission: (code: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Permissions entité actives</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="Rechercher une permission..." className="pl-9" />
        </div>
      </div>
      <div className="max-h-[420px] space-y-4 overflow-y-auto rounded-2xl border p-4">
        {permissionGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune permission entité active ne correspond à la recherche.</p>
        ) : (
          permissionGroups.map(([module, permissions]) => (
            <div key={module} className="space-y-2">
              <h3 className="text-sm font-black uppercase tracking-wide text-primary">{module}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {permissions.map((permission) => (
                  <label key={permission.code} className="flex cursor-pointer gap-3 rounded-xl border p-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(permission.code)}
                      onChange={() => togglePermission(permission.code)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold">{permission.label}</span>
                      <span className="block break-all font-mono text-xs text-muted-foreground">{permission.code}</span>
                      {permission.description && <span className="mt-1 block text-xs text-muted-foreground">{permission.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-sm font-semibold text-muted-foreground">{form.permissions.length} permissions sélectionnées</p>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center">
      <p className="font-bold text-primary">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function RolesManagementLoadingState() {
  return (
    <div className="space-y-5">
      {[0, 1, 2].map((item) => (
        <Card key={item} className="rounded-2xl">
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
