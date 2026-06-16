
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle, Building2, Lock, Eye, EyeOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { activateEmployeeAccountAction, getInvitationSnippetAction } from "@/services/employee-account.service";
import Link from "next/link";

/**
 * Employee Account Activation Page.
 * Allows employees to set their password and activate their Espace Employé.
 */
export default function EmployeeActivationPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [invitation, setInvitation] = useState<{ email: string; entityName: string } | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    async function verify() {
      if (!token) return;
      try {
        const result = await getInvitationSnippetAction(token);
        if (result.success && result.invitation) {
          setInvitation(result.invitation);
        } else {
          setError(result.error || "Ce lien d'activation est invalide ou a expiré.");
        }
      } catch (err) {
        setError("Impossible de vérifier votre invitation.");
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [token]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ variant: "destructive", title: "Mot de passe trop court", description: "Le mot de passe doit contenir au moins 8 caractères." });
      return;
    }
    if (password !== confirmPassword) {
      toast({ variant: "destructive", title: "Erreur", description: "Les mots de passe ne correspondent pas." });
      return;
    }

    setActivating(true);
    try {
      const result = await activateEmployeeAccountAction(token, password);
      if (result.success) {
        setSuccess(true);
        toast({ title: "Compte activé !", description: "Vous pouvez maintenant vous connecter à votre espace." });
      } else {
        toast({ variant: "destructive", title: "Échec de l'activation", description: result.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur technique", description: "Une erreur est survenue lors de l'activation." });
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="text-muted-foreground font-medium animate-pulse">Vérification de votre invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border-none rounded-[2rem] text-center p-12">
          <div className="mx-auto bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center mb-6 text-destructive">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Lien invalide</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">{error}</p>
          <Link href="/login">
            <Button variant="outline" className="rounded-xl">Retour à la connexion</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border-none rounded-[2rem] overflow-hidden">
          <div className="h-32 bg-green-500 flex items-center justify-center relative">
            <div className="absolute -bottom-10 bg-white p-4 rounded-full shadow-xl text-green-500">
               <CheckCircle2 className="w-12 h-12" />
            </div>
          </div>
          <CardContent className="pt-16 pb-12 px-10 text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-slate-900">Félicitations !</h1>
              <p className="text-slate-500 font-medium leading-relaxed">
                Votre compte employé est désormais actif. Vous pouvez accéder à votre espace personnel.
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-dashed text-sm">
               Identifiant : <span className="font-bold text-primary">{invitation?.email}</span>
            </div>
            <Link href="/login">
              <Button className="w-full rounded-xl font-bold h-12 shadow-lg shadow-primary/20">
                Se connecter maintenant
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-2xl border-none rounded-[2rem] overflow-hidden bg-white">
        <div className="h-24 bg-primary flex items-center justify-center relative">
          <div className="absolute -bottom-8 bg-white p-4 rounded-full shadow-xl text-primary border-4 border-slate-50">
             <ShieldCheck className="w-10 h-10" />
          </div>
        </div>
        <CardHeader className="pt-12 pb-2 text-center">
          <CardTitle className="text-2xl font-black text-primary">Activation du compte</CardTitle>
          <CardDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
             {invitation?.entityName}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 pt-4 space-y-6">
          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
             <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
             <p className="text-xs text-blue-800 leading-relaxed">
               Bonjour <strong>{invitation?.email}</strong>. Veuillez définir votre mot de passe pour finaliser l'accès à votre espace.
             </p>
          </div>

          <form onSubmit={handleActivate} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nouveau mot de passe</Label>
                <div className="relative">
                  <Input 
                    id="password" 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    placeholder="Minimum 8 caractères"
                    className="rounded-xl h-11 pr-10"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
                <Input 
                  id="confirmPassword" 
                  type="password" 
                  value={confirmPassword} 
                  onChange={(e) => setConfirmPassword(e.target.value)} 
                  required 
                  className="rounded-xl h-11"
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-12 rounded-xl font-bold shadow-lg" disabled={activating}>
              {activating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Activer mon accès
            </Button>
          </form>

          <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400 uppercase font-black tracking-widest pt-4">
             <Building2 className="w-3 h-3" />
             HR Nexus Ecosystem
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
