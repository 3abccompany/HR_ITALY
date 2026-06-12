"use client";

import { useParams, useRouter } from "next/navigation";
import { 
  Mail, Settings, ArrowRight, Info, ShieldCheck, 
  ChevronRight, Lock, Building2
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Loader2 } from "lucide-react";

export default function EntitySettingsPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { hasPermission, loading, entity } = useActiveMembership(entityId);

  const canManageEmail = hasPermission("settings.manage") || hasPermission("emailSettings.manage");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32 space-y-8">
      <header>
        <div className="flex items-center gap-3 mb-2">
           <div className="bg-primary p-2 rounded-xl text-white">
              <Settings className="w-6 h-6" />
           </div>
           <div>
              <h1 className="text-3xl font-black text-primary tracking-tight">Paramètres</h1>
              <p className="text-muted-foreground text-sm font-medium">Gérez les paramètres de configuration de {entity?.nomEntreprise}.</p>
           </div>
        </div>
      </header>

      <div className="bg-blue-50/50 border border-blue-100 rounded-[2rem] p-6 flex items-start gap-4">
         <div className="bg-white p-2 rounded-xl text-blue-600 shadow-sm border border-blue-50">
            <Info className="w-5 h-5" />
         </div>
         <p className="text-sm text-blue-800 leading-relaxed font-medium">
            Les paramètres email configurent uniquement l’identité d’envoi (nom, email, serveur SMTP). 
            <span className="font-bold ml-1">Les contenus et modèles des emails restent inchangés et sont gérés par la plateforme.</span>
         </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         {canManageEmail && (
           <Card className="rounded-[2rem] border-primary/10 hover:shadow-xl transition-all group overflow-hidden bg-white">
              <CardHeader className="bg-primary/5 border-b py-6 px-8 flex flex-row items-center justify-between">
                 <div className="flex items-center gap-3">
                    <div className="bg-white p-2.5 rounded-xl shadow-sm text-primary">
                       <Mail className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-lg font-black text-primary">Paramètres Email</CardTitle>
                 </div>
                 <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
              </CardHeader>
              <CardContent className="p-8 space-y-4">
                 <p className="text-sm text-muted-foreground leading-relaxed">
                    Configurez le nom d’expéditeur, l’adresse email, le reply-to et les paramètres du serveur SMTP pour les communications de cette entité.
                 </p>
                 <div className="pt-4">
                    <Button onClick={() => router.push(`/entity/${entityId}/settings/email`)} className="rounded-xl font-bold gap-2">
                       <ShieldCheck className="w-4 h-4" /> Configurer
                    </Button>
                 </div>
              </CardContent>
           </Card>
         )}

         {/* Placeholder for other settings */}
         <Card className="rounded-[2rem] border-dashed border-2 bg-secondary/5 opacity-50 flex flex-col items-center justify-center p-12 text-center grayscale">
            <Building2 className="w-10 h-10 text-muted-foreground mb-4" />
            <h3 className="font-bold text-muted-foreground uppercase text-[10px] tracking-widest">Autres paramètres</h3>
            <p className="text-xs text-muted-foreground mt-2 italic">Bientôt disponible</p>
         </Card>
      </div>

      <footer className="pt-12 text-center">
         <div className="inline-flex items-center gap-2 px-4 py-2 bg-secondary/30 rounded-full text-[10px] font-black uppercase text-muted-foreground tracking-widest">
            <Lock className="w-3 h-3" /> Espace de configuration sécurisé
         </div>
      </footer>
    </div>
  );
}
