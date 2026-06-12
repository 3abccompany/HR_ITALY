"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Mail, Save, ShieldCheck, AlertCircle, Info, Loader2, 
  Server, User, CheckCircle2, Settings2, Lock, ArrowLeft, Clock
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { 
  getEntityEmailSettingsForAdmin, 
  saveEntityEmailSettings,
  validateEmailSettingsInput
} from "@/services/email-settings.service";
import { EntityEmailSettingsUI, EmailProvider } from "@/types/email-settings";
import { cn } from "@/lib/utils";

export default function EntityEmailSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Partial<EntityEmailSettingsUI & { password?: string }>>({
    provider: "none",
    fromName: "",
    fromEmail: "",
    replyToEmail: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    password: "",
    status: "not_configured",
    hasPassword: false
  });

  const canManage = hasPermission("settings.manage") || hasPermission("emailSettings.manage");

  useEffect(() => {
    async function load() {
      if (membershipLoading) return;
      
      if (!entityId || !canManage) {
        setLoading(false);
        return;
      }

      try {
        const data = await getEntityEmailSettingsForAdmin(entityId);
        if (data) {
          setSettings(prev => ({
            ...prev,
            ...data,
            password: "" 
          }));
        }
      } catch (err) {
        console.error("[EmailSettingsPage] Load failed:", err);
        toast({ 
          variant: "destructive", 
          title: "Erreur de chargement", 
          description: "Impossible de récupérer les paramètres email." 
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entityId, canManage, membershipLoading, toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    const validation = await validateEmailSettingsInput(settings);
    if (!validation.isValid) {
      toast({ 
        variant: "destructive", 
        title: "Validation échouée", 
        description: validation.errors[0] 
      });
      return;
    }

    setSaving(true);
    try {
      await saveEntityEmailSettings(entityId, settings as any, user.uid);
      toast({ title: "Paramètres enregistrés", description: "La configuration a été mise à jour." });
      
      const updated = await getEntityEmailSettingsForAdmin(entityId);
      if (updated) {
        setSettings(prev => ({ 
          ...prev, 
          ...updated, 
          password: "" 
        }));
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (membershipLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Chargement...</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="max-w-2xl mx-auto rounded-[2rem]">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Accès Refusé</AlertTitle>
          <AlertDescription>Vous n'avez pas la permission de modifier les paramètres de l'entité.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto pb-32 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Paramètres Email</h1>
            <p className="text-muted-foreground text-sm">Configurez l’identité d’envoi email utilisée par cette entité.</p>
          </div>
        </div>
        {getStatusBadge(settings.status)}
      </header>

      <Alert className="bg-blue-50 border-blue-100 text-blue-800 rounded-[2rem] p-6 shadow-sm">
        <Info className="h-5 w-5 text-blue-600" />
        <div className="ml-2">
          <AlertTitle className="font-bold text-xs uppercase tracking-widest mb-1">Note d'intégration</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed opacity-90">
            Les contenus des emails restent inchangés. Cette configuration concerne uniquement l’adresse d’envoi et le serveur SMTP de l’entité.
            <br />
            <span className="font-bold mt-1 block italic text-blue-700">
              Cette configuration n’est pas encore utilisée pour l’envoi réel des emails tant que l’intégration transport n’est pas activée.
            </span>
          </AlertDescription>
        </div>
      </Alert>

      <form onSubmit={handleSave} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden">
              <CardHeader className="bg-primary/5 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                  <User className="w-4 h-4" /> Identité d’envoi
                </CardTitle>
                <CardDescription className="text-xs font-medium text-slate-500 mt-2">
                  Cette page configure uniquement l’expéditeur des emails de cette entité. Le destinataire (À / TO) reste défini dans chaque module : candidat, consultant, employé ou dossier concerné.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="fromName" className="text-[10px] font-black uppercase text-muted-foreground">Nom affiché de l’expéditeur</Label>
                    <Input 
                      id="fromName" 
                      placeholder="Ex: HR Nexus - Mon Entreprise" 
                      value={settings.fromName || ""} 
                      onChange={(e) => setSettings(p => ({...p, fromName: e.target.value}))}
                      className="rounded-xl h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fromEmail" className="text-[10px] font-black uppercase text-muted-foreground">Adresse expéditeur (FROM)</Label>
                    <Input 
                      id="fromEmail" 
                      type="email"
                      placeholder="hr@entreprise.com" 
                      value={settings.fromEmail || ""} 
                      onChange={(e) => setSettings(p => ({...p, fromEmail: e.target.value}))}
                      className="rounded-xl h-11"
                    />
                    <p className="text-[10px] text-muted-foreground italic">Adresse utilisée comme expéditeur officiel des emails envoyés par cette entité.</p>
                  </div>
                  <div className="space-y-2 col-span-full">
                    <Label htmlFor="replyToEmail" className="text-[10px] font-black uppercase text-muted-foreground">Adresse de réception des réponses (REPLY-TO)</Label>
                    <Input 
                      id="replyToEmail" 
                      type="email"
                      placeholder="recrutement@entreprise.com" 
                      value={settings.replyToEmail || ""} 
                      onChange={(e) => setSettings(p => ({...p, replyToEmail: e.target.value}))}
                      className="rounded-xl h-11"
                    />
                    <p className="text-[10px] text-muted-foreground italic">Lorsqu’un destinataire répond à un email, sa réponse sera envoyée à cette adresse. Ce n’est pas l’adresse du destinataire.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden">
              <CardHeader className="bg-secondary/10 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                  <Server className="w-4 h-4" /> Serveur SMTP
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-8">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Fournisseur</Label>
                  <Select value={settings.provider || "none"} onValueChange={(v) => setSettings(p => ({...p, provider: v as EmailProvider}))}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smtp">Serveur SMTP Personnalisé</SelectItem>
                      <SelectItem value="none">Aucun (Utiliser défaut plateforme)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {settings.provider === 'smtp' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-2">
                    <div className="sm:col-span-2 space-y-2">
                      <Label htmlFor="smtpHost" className="text-[10px] font-black uppercase text-muted-foreground">Hôte SMTP</Label>
                      <Input 
                        id="smtpHost" 
                        placeholder="smtp.mailgun.org" 
                        value={settings.smtpHost || ""} 
                        onChange={(e) => setSettings(p => ({...p, smtpHost: e.target.value}))}
                        className="rounded-xl h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPort" className="text-[10px] font-black uppercase text-muted-foreground">Port</Label>
                      <Input 
                        id="smtpPort" 
                        type="number"
                        placeholder="587" 
                        value={settings.smtpPort || 587} 
                        onChange={(e) => setSettings(p => ({...p, smtpPort: parseInt(e.target.value) || 0}))}
                        className="rounded-xl h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpUser" className="text-[10px] font-black uppercase text-muted-foreground">Utilisateur / Login</Label>
                      <Input 
                        id="smtpUser" 
                        placeholder="postmaster@domain.com" 
                        value={settings.smtpUser || ""} 
                        onChange={(e) => setSettings(p => ({...p, smtpUser: e.target.value}))}
                        className="rounded-xl h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-[10px] font-black uppercase text-muted-foreground">Mot de passe</Label>
                      <Input 
                        id="password" 
                        type="password"
                        placeholder="••••••••" 
                        value={settings.password || ""} 
                        onChange={(e) => setSettings(p => ({...p, password: e.target.value}))}
                        className="rounded-xl h-11"
                      />
                    </div>
                    <div className="flex flex-col justify-end gap-2 h-11 pb-2">
                       <div className="flex items-center space-x-2">
                         <Switch 
                           id="smtpSecure" 
                           checked={!!settings.smtpSecure} 
                           onCheckedChange={(v) => setSettings(p => ({...p, smtpSecure: v}))} 
                         />
                         <Label htmlFor="smtpSecure" className="text-xs font-bold cursor-pointer">SSL / TLS (Port 465)</Label>
                       </div>
                    </div>

                    {settings.hasPassword && (
                      <div className="col-span-full flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-xl border border-green-100 text-[10px] font-black uppercase tracking-tight">
                         <Lock className="w-3 h-3" />
                         Mot de passe configuré — laisser vide pour conserver le mot de passe actuel.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-slate-50 border-t p-8 flex justify-end">
                <Button type="submit" disabled={saving} className="gap-2 rounded-xl px-8 font-black shadow-lg">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Enregistrer la configuration
                </Button>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-8">
            <Card className="rounded-[2rem] border-primary/10 bg-secondary/5 overflow-hidden">
               <CardHeader className="py-6 px-8 border-b bg-secondary/10">
                  <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <Settings2 className="w-4 h-4" /> Statut & Diagnostics
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8 space-y-6">
                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">État actuel</p>
                    <div className="flex items-center gap-2">
                       {settings.status === 'verified' ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Clock className="w-4 h-4 text-orange-400" />}
                       <span className="text-xs font-bold text-slate-800">
                         {settings.status ? (settings.status as string).replace(/_/g, ' ').toUpperCase() : "NON CONFIGURÉ"}
                       </span>
                    </div>
                  </div>

                  <Separator className="opacity-20" />

                  <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 border-dashed border-2 opacity-50 cursor-not-allowed" disabled title="Bientôt disponible">
                     <Mail className="w-4 h-4" /> Envoyer email de test
                  </Button>
                  <p className="text-[8px] text-center text-muted-foreground uppercase font-black tracking-tighter">Disponible en phase Email D</p>
               </CardContent>
            </Card>

            <Card className="border-primary/10 rounded-[2rem] shadow-lg overflow-hidden bg-primary/95 text-white">
               <CardHeader className="bg-white/10 py-6 border-b border-white/10 px-8">
                  <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                     <ShieldCheck className="w-4 h-4" /> Sécurité
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8 space-y-4">
                  <p className="text-xs leading-relaxed opacity-80">
                    Vos identifiants SMTP sont chiffrés côté serveur à l'aide de l'algorithme <strong>AES-256-GCM</strong>.
                  </p>
                  <p className="text-xs leading-relaxed opacity-80">
                    Le mot de passe ne quitte jamais le serveur et n'est jamais affiché dans cette interface.
                  </p>
                  <Separator className="bg-white/10" />
                  <div className="flex items-center gap-3">
                     <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                     <p className="text-[10px] font-bold uppercase tracking-tight">Chiffrement actif</p>
                  </div>
               </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}

function getStatusBadge(status: string | undefined) {
  const s = status || "not_configured";
  switch (s) {
    case 'verified': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white font-black text-[10px] h-6 px-3">VÉRIFIÉ</Badge>;
    case 'failed': return <Badge variant="destructive" className="font-black text-[10px] h-6 px-3">ÉCHEC</Badge>;
    case 'configured': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[10px] h-6 px-3">CONFIGURÉ</Badge>;
    default: return <Badge variant="outline" className="font-black text-[10px] h-6 px-3 uppercase text-muted-foreground">{s.replace(/_/g, ' ')}</Badge>;
  }
}
