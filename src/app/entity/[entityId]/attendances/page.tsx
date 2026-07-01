"use client";

import { useParams } from "next/navigation";
import { 
  Clock, 
  FileSpreadsheet, 
  Download, 
  Upload, 
  AlertCircle,
  Calendar,
  CheckCircle2,
  Info
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Loader2 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

/**
 * Attendance Registry Skeleton (Phase 1).
 * Focused on workflow orientation before Excel integration.
 */
export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { hasPermission, loading, entity } = useActiveMembership(entityId);

  const canRead = hasPermission("attendances.read");
  const canCreate = hasPermission("attendances.create") || hasPermission("attendances.write");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary opacity-20" />
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em]">Chargement...</p>
      </div>
    );
  }

  if (!canRead) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 pb-32">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Présences</h1>
            <p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p>
          </div>
        </div>
      </header>

      <Alert className="bg-blue-50 border-blue-100 text-blue-800 rounded-[2rem] p-6 shadow-sm">
        <Info className="h-5 w-5 text-blue-600" />
        <div className="ml-2">
          <AlertTitle className="font-black text-xs uppercase tracking-widest mb-1">Module en cours de déploiement</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed opacity-90">
            La gestion des présences sera basée sur un flux d'importation Excel. Vous pourrez bientôt générer des matrices pré-remplies avec les noms de vos collaborateurs pour une saisie rapide.
          </AlertDescription>
        </div>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <WorkflowStepCard 
          step="1"
          title="Préparation"
          description="Générez le modèle Excel pour la période souhaitée (semaine ou mois)."
          icon={Download}
          disabled={!canCreate}
        />
        <WorkflowStepCard 
          step="2"
          title="Saisie"
          description="Remplissez les horaires AM/PM et les éventuels codes d'absence."
          icon={FileSpreadsheet}
          disabled={!canCreate}
        />
        <WorkflowStepCard 
          step="3"
          title="Importation"
          description="Téléversez le fichier pour valider et enregistrer les présences."
          icon={Upload}
          disabled={!canCreate}
        />
      </div>

      <Separator className="my-12 opacity-50" />

      <Card className="rounded-[2rem] border-dashed border-2 bg-secondary/5 opacity-50 flex flex-col items-center justify-center p-16 text-center grayscale">
        <Calendar className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
        <h3 className="font-black text-muted-foreground uppercase text-xs tracking-[0.2em]">Registre des pointages</h3>
        <p className="text-xs text-muted-foreground mt-2 italic max-w-xs">
          Les données importées apparaîtront ici sous forme de calendrier et de liste après votre première importation.
        </p>
      </Card>
    </div>
  );
}

function WorkflowStepCard({ step, title, description, icon: Icon, disabled }: any) {
  return (
    <Card className={cn(
      "rounded-[2rem] border-primary/10 shadow-sm relative overflow-hidden transition-all group",
      disabled ? "opacity-50 grayscale" : "hover:shadow-md hover:border-primary/20"
    )}>
      <div className="absolute top-4 right-6 text-4xl font-black text-primary/5 group-hover:text-primary/10 transition-colors select-none">
        0{step}
      </div>
      <CardContent className="p-8 space-y-4">
        <div className="bg-primary/5 p-3 rounded-2xl w-fit text-primary">
          <Icon className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="font-black text-lg text-slate-800">{title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
