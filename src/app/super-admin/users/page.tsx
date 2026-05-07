"use client";

import { useState, useMemo } from "react";
import { 
  Users, Plus, Loader2, Search, ArrowLeft, 
  AlertCircle, Save, X, Edit, PowerOff, ShieldCheck 
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
import { collection, query, orderBy } from "firebase/firestore";
import { createUserProfile, updateUserProfile, disableUserProfile } from "@/services/user.service";
import { AppUser, PlatformRole } from "@/types/user";
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

const initialForm: Omit<AppUser, 'uid' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & { uid: string } = {
  uid: "",
  displayName: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  platformRole: "user",
  notes: ""
};

export default function UsersManagementPage() {
  const { db, missingVars } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [disablingUid, setDisablingUid] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState(false);

  const usersQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, "users"), orderBy("createdAt", "desc"));
  }, [db]);

  const { data: users, loading: loadingUsers } = useCollection<AppUser>(usersQuery);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (profile: AppUser) => {
    setFormData({
      uid: profile.uid,
      displayName: profile.displayName || "",
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      email: profile.email || "",
      phone: profile.phone || "",
      platformRole: profile.platformRole,
      notes: profile.notes || ""
    });
    setEditingId(profile.uid);
    setIsFormVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    
    // Platform Role Confirmation
    if (formData.platformRole === "superAdmin") {
      setPendingSave(true);
      return;
    }

    await executeSave();
  };

  const executeSave = async () => {
    setLoading(true);
    try {
      if (editingId) {
        await updateUserProfile(editingId, formData, user!.uid);
        toast({ title: "Mis à jour", description: "Le profil utilisateur a été mis à jour." });
      } else {
        await createUserProfile(formData, user!.uid);
        toast({ title: "Profil créé", description: "Le profil Firestore a été créé avec succès." });
      }
      handleReset();
      setPendingSave(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err.message || "Impossible d'enregistrer le profil.",
      });
    } finally {
      setLoading(false);
    }
  };

  const confirmDisable = async () => {
    if (!db || !user || !disablingUid) return;
    setLoading(true);
    try {
      await disableUserProfile(disablingUid, user.uid);
      toast({ title: "Désactivé", description: "L'utilisateur est désormais inactif." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setDisablingUid(null);
    }
  };

  const filteredUsers = users?.filter(u => 
    u.displayName?.toLowerCase().includes(search.toLowerCase()) || 
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.uid?.includes(search)
  ) || [];

  if (missingVars.length > 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Firebase Incomplète</AlertTitle>
          <AlertDescription>
            Firestore n'est pas prêt. Variables manquantes : {missingVars.join(', ')}
          </AlertDescription>
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
            <h1 className="text-3xl font-headline font-bold text-primary">Gestion Utilisateurs</h1>
            <p className="text-muted-foreground">Profils applicatifs et accès plateforme.</p>
          </div>
        </div>
        {!isFormVisible && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nouvel utilisateur
          </Button>
        )}
      </div>

      {isFormVisible && (
        <Card className="mb-8 border-primary/20 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              {editingId ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {editingId ? "Modifier le profil" : "Nouveau profil Firestore"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="uid">UID Firebase Auth existant</Label>
                  <Input 
                    id="uid" 
                    value={formData.uid} 
                    onChange={handleInputChange} 
                    required 
                    disabled={!!editingId}
                    placeholder="Coller l'UID depuis la console"
                  />
                  {!editingId && <p className="text-[10px] text-muted-foreground">Requis : doit correspondre à un utilisateur Auth existant.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Nom d'affichage</Label>
                  <Input id="displayName" value={formData.displayName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="platformRole">Rôle Plateforme</Label>
                  <Select value={formData.platformRole} onValueChange={(v) => setFormData(p => ({...p, platformRole: v as PlatformRole}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Utilisateur Standard</SelectItem>
                      <SelectItem value="superAdmin">Super Administrateur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input id="firstName" value={formData.firstName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Nom</Label>
                  <Input id="lastName" value={formData.lastName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={formData.email} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Téléphone</Label>
                  <Input id="phone" value={formData.phone} onChange={handleInputChange} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes Internes</Label>
                <Textarea id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Observations..." />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>
                  <X className="w-4 h-4 mr-2" /> Annuler
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  {editingId ? "Enregistrer les modifications" : "Créer le profil Firestore"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Rechercher par nom, email ou UID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Contact / UID</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingUsers ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Aucun utilisateur trouvé.</TableCell></TableRow>
              ) : (
                filteredUsers.map((u) => (
                  <TableRow key={u.uid}>
                    <TableCell>
                      <div className="font-bold">{u.displayName}</div>
                      <div className="text-xs text-muted-foreground uppercase">{u.firstName} {u.lastName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{u.email}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">UID: {u.uid}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {u.platformRole === 'superAdmin' && <ShieldCheck className="w-4 h-4 text-accent" />}
                        <Badge variant={u.platformRole === 'superAdmin' ? 'default' : 'secondary'} className="capitalize text-[10px]">
                          {u.platformRole}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.status === 'active' ? 'default' : 'outline'} className={u.status === 'active' ? "bg-green-500 hover:bg-green-600 text-white border-none" : "bg-red-50 text-red-600 border-red-200"}>
                        {u.status === 'active' ? "Actif" : "Inactif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(u)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        {u.status === 'active' && u.uid !== user?.uid && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setDisablingUid(u.uid)} 
                            className="text-red-500 hover:text-red-600"
                          >
                            <PowerOff className="w-4 h-4" />
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
      <AlertDialog open={!!disablingUid} onOpenChange={(open) => !open && setDisablingUid(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir désactiver cet utilisateur ? Son statut passera à "Inactif".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                confirmDisable();
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={loading}
            >
              {loading ? "Désactivation..." : "Confirmer la désactivation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingSave} onOpenChange={setPendingSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'attribution du rôle</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir accorder le rôle Super Admin ? Cet utilisateur aura un contrôle total sur la plateforme.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                executeSave();
              }}
              disabled={loading}
            >
              {loading ? "Enregistrement..." : "Confirmer et Enregistrer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
