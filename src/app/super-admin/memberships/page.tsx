
"use client";

import { useState, useMemo } from "react";
import { 
  Link as LinkIcon, Plus, Loader2, Search, ArrowLeft, 
  AlertCircle, Save, X, Edit, PowerOff, RefreshCcw, ShieldCheck, RefreshCw 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, doc, getDoc } from "firebase/firestore";
import { 
  createMembership, 
  updateMembership, 
  disableMembership, 
  reactivateMembership 
} from "@/services/membership.service";
import { getAllUserProfiles } from "@/services/user.service";
import { getAllEntities } from "@/services/entity.service";
import { getAllRoles } from "@/services/role.service";
import { Membership, MembershipStatus } from "@/types/membership";
import { AppUser } from "@/types/user";
import { Entity } from "@/types/entity";
import { Role } from "@/types/role";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
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

export default function MembershipsManagementPage() {
  const { db, missingVars } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  
  // Form State
  const [selectedUid, setSelectedUid] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [notes, setNotes] = useState("");

  // Masters
  const [usersMaster, setUsersMaster] = useState<AppUser[]>([]);
  const [entitiesMaster, setEntitiesMaster] = useState<Entity[]>([]);
  const [rolesMaster, setRolesMaster] = useState<Role[]>([]);

  // Dialogs
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [roleChangePending, setRoleChangePending] = useState<{ id: string, roleId: string } | null>(null);

  const membershipsQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, "memberships"), orderBy("createdAt", "desc"));
  }, [db]);

  const { data: memberships, loading: loadingMemberships } = useCollection<Membership>(membershipsQuery);

  const loadMasters = async () => {
    setLoading(true);
    try {
      const [u, e, r] = await Promise.all([
        getAllUserProfiles(),
        getAllEntities(),
        getAllRoles()
      ]);
      setUsersMaster(u.filter(user => user.status === "active"));
      setEntitiesMaster(e.filter(entity => entity.status === "active"));
      setRolesMaster(r.filter(role => role.status === "active" && role.scope === "entity") as Role[]);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de charger les données de référence." });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenNew = () => {
    resetForm();
    setIsFormVisible(true);
    loadMasters();
  };

  const resetForm = () => {
    setSelectedUid("");
    setSelectedEntityId("");
    setSelectedRoleId("");
    setNotes("");
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    if (!selectedUid || !selectedEntityId || !selectedRoleId) {
      toast({ variant: "destructive", title: "Incomplet", description: "Veuillez sélectionner un utilisateur, une entité et un rôle." });
      return;
    }

    setLoading(true);
    try {
      const selectedUser = usersMaster.find(u => u.uid === selectedUid);
      const selectedEntity = entitiesMaster.find(e => e.entityId === selectedEntityId);
      const selectedRole = rolesMaster.find(r => r.roleId === selectedRoleId);

      if (!selectedUser || !selectedEntity || !selectedRole) throw new Error("Données de référence invalides.");

      await createMembership({
        uid: selectedUid,
        entityId: selectedEntityId,
        roleId: selectedRoleId,
        userDisplayName: selectedUser.displayName,
        userEmail: selectedUser.email,
        entityName: selectedEntity.nomEntreprise || selectedEntity.name || "N/A",
        roleLabel: selectedRole.label,
        permissions: selectedRole.permissions,
        notes
      }, user.uid);

      toast({ title: "Affectation créée", description: "L'utilisateur a été rattaché à l'entité." });
      resetForm();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (m: Membership) => {
    setSelectedRoleId(m.roleId);
    setNotes(m.notes || "");
    setEditingId(m.membershipId);
    setIsFormVisible(true);
    loadMasters();
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user || !editingId) return;

    const currentMembership = memberships?.find(m => m.membershipId === editingId);
    if (!currentMembership) return;

    // Trigger confirmation dialog for permission sync if role changed OR manually requested
    setRoleChangePending({ id: editingId, roleId: selectedRoleId });
  };

  const executeUpdate = async (id: string, data: Partial<Membership>, syncPermissions: boolean) => {
    setLoading(true);
    try {
      let finalData = { ...data };
      if (syncPermissions && data.roleId && db) {
        const roleRef = doc(db, "roles", data.roleId);
        const roleSnap = await getDoc(roleRef);
        if (roleSnap.exists()) {
          const roleData = roleSnap.data();
          finalData.permissions = roleData.permissions;
          finalData.roleLabel = roleData.label;
        }
      } else if (data.roleId && db) {
        const roleRef = doc(db, "roles", data.roleId);
        const roleSnap = await getDoc(roleRef);
        if (roleSnap.exists()) {
          finalData.roleLabel = roleSnap.data().label;
        }
      }

      await updateMembership(id, finalData, user!.uid);
      toast({ title: "Mis à jour", description: "L'affectation a été modifiée." });
      resetForm();
      setRoleChangePending(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSync = async (m: Membership) => {
    if (!db || !user) return;
    setLoading(true);
    try {
      const roleRef = doc(db, "roles", m.roleId);
      const roleSnap = await getDoc(roleRef);
      if (!roleSnap.exists()) throw new Error("Rôle introuvable dans le catalogue.");
      
      const roleData = roleSnap.data();
      await updateMembership(m.membershipId, {
        permissions: roleData.permissions,
        roleLabel: roleData.label,
        updatedAt: new Date()
      }, user.uid);
      
      toast({ title: "Permissions synchronisées", description: `Les accès pour ${m.userDisplayName} ont été mis à jour.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmDisable = async () => {
    if (!disablingId || !user) return;
    setLoading(true);
    try {
      await disableMembership(disablingId, user.uid);
      toast({ title: "Désactivé", description: "L'accès est désormais suspendu." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setDisablingId(null);
    }
  };

  const confirmReactivate = async () => {
    if (!reactivatingId || !user) return;
    setLoading(true);
    try {
      await reactivateMembership(reactivatingId, user.uid);
      toast({ title: "Réactivé", description: "L'accès est à nouveau actif." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  const normalizeSearchValue = (value: unknown) => 
    String(value ?? '').toLowerCase(); 
  const normalizedSearch = normalizeSearchValue(search); 
  const filteredMemberships = memberships?.filter((m) => 
    normalizeSearchValue(m.userDisplayName).includes(normalizedSearch) || 
    normalizeSearchValue(m.userEmail).includes(normalizedSearch) || 
    normalizeSearchValue(m.entityName).includes(normalizedSearch) 
  ) || [];

  if (missingVars.length > 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Firebase Incomplète</AlertTitle>
          <AlertDescription>Firestore n'est pas prêt. Variables manquantes : {missingVars.join(', ')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/super-admin">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-3xl font-headline font-bold text-primary">Affectations / Memberships</h1>
            <p className="text-muted-foreground">Lien entre utilisateurs, entreprises et rôles.</p>
          </div>
        </div>
        {!isFormVisible && (
          <Button onClick={handleOpenNew} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvelle affectation
          </Button>
        )}
      </div>

      {isFormVisible && (
        <Card className="mb-8 border-primary/20 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              {editingId ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {editingId ? "Modifier l'affectation" : "Nouvelle affectation utilisateur"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={editingId ? handleSaveEdit : handleCreate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {!editingId && (
                  <>
                    <div className="space-y-2">
                      <Label>Utilisateur Actif</Label>
                      <Select value={selectedUid} onValueChange={setSelectedUid}>
                        <SelectTrigger><SelectValue placeholder="Choisir un utilisateur" /></SelectTrigger>
                        <SelectContent>
                          {usersMaster.map(u => (
                            <SelectItem key={u.uid} value={u.uid}>{u.displayName} ({u.email})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Entité Active</Label>
                      <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                        <SelectTrigger><SelectValue placeholder="Choisir une entreprise" /></SelectTrigger>
                        <SelectContent>
                          {entitiesMaster.map(e => (
                            <SelectItem key={e.entityId} value={e.entityId}>{e.nomEntreprise || e.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                {editingId && (
                   <div className="md:col-span-2 p-3 bg-secondary/30 rounded-lg flex items-center gap-4">
                      <LinkIcon className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-bold text-primary">
                          {memberships?.find(m => m.membershipId === editingId)?.userDisplayName} 
                          {" @ "} 
                          {memberships?.find(m => m.membershipId === editingId)?.entityName}
                        </p>
                        <p className="text-xs text-muted-foreground">ID: {editingId}</p>
                      </div>
                   </div>
                )}
                <div className="space-y-2">
                  <Label>Rôle à attribuer</Label>
                  <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                    <SelectTrigger><SelectValue placeholder="Choisir un rôle" /></SelectTrigger>
                    <SelectContent>
                      {rolesMaster.map(r => (
                        <SelectItem key={r.roleId} value={r.roleId}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes Internes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations sur cette affectation..." />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={resetForm} disabled={loading}>
                  <X className="w-4 h-4 mr-2" /> Annuler
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  {editingId ? "Vérifier et Enregistrer" : "Créer l'affectation"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Rechercher par nom d'utilisateur, email ou entité..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingMemberships ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredMemberships.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucune affectation trouvée.</TableCell></TableRow>
              ) : (
                filteredMemberships.map((m) => (
                  <TableRow key={m.membershipId}>
                    <TableCell>
                      <div className="font-bold">{m.userDisplayName}</div>
                      <div className="text-xs text-muted-foreground">{m.userEmail}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{m.entityName}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">ID: {m.entityId}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                        {m.roleLabel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                       <span className="text-xs font-semibold px-2 py-0.5 bg-secondary rounded-full text-secondary-foreground">
                         {m.permissions?.length || 0}
                       </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.status === 'active' ? 'default' : 'outline'} className={m.status === 'active' ? "bg-green-500 hover:bg-green-600 text-white border-none" : "bg-red-50 text-red-600 border-red-200"}>
                        {m.status === 'active' ? "Actif" : m.status === 'inactive' ? "Inactif" : "Archivé"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleQuickSync(m)} disabled={loading} title="Synchroniser permissions">
                           {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(m)} disabled={loading}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        {m.status === 'active' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setDisablingId(m.membershipId)} 
                            className="text-red-500 hover:text-red-600"
                            disabled={loading}
                          >
                            <PowerOff className="w-4 h-4" />
                          </Button>
                        )}
                        {m.status === 'inactive' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setReactivatingId(m.membershipId)} 
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            disabled={loading}
                          >
                            <RefreshCcw className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Confirmation Dialogs */}
      <AlertDialog open={!!disablingId} onOpenChange={(open) => !open && setDisablingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suspension</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir désactiver cette affectation ? L'utilisateur n'aura plus accès à cette entité.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); confirmDisable(); }}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={loading}
            >
              {loading ? "Suspension..." : "Confirmer la suspension"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivatingId} onOpenChange={(open) => !open && setReactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la réactivation</AlertDialogTitle>
            <AlertDialogDescription>
              Souhaitez-vous rétablir l'accès de cet utilisateur à cette entité ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); confirmReactivate(); }}
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={loading}
            >
              {loading ? "Réactivation..." : "Confirmer la réactivation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!roleChangePending} onOpenChange={(open) => !open && setRoleChangePending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mise à jour des accès</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous également synchroniser les permissions effectives de cette affectation avec celles définies dans le catalogue des rôles ? 
              Ceci est nécessaire pour appliquer les nouveaux modules comme "Personnes / Timeline".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="w-full sm:w-auto" disabled={loading}>Annuler</AlertDialogCancel>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button 
                variant="outline" 
                onClick={() => executeUpdate(roleChangePending!.id, { roleId: roleChangePending!.roleId, notes }, false)}
                disabled={loading}
              >
                Garder les permissions actuelles
              </Button>
              <Button 
                onClick={() => executeUpdate(roleChangePending!.id, { roleId: roleChangePending!.roleId, notes }, true)}
                disabled={loading}
              >
                Synchroniser du catalogue
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
