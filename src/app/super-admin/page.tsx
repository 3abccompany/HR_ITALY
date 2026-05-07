import { ShieldCheck, Users, Building, Lock, FileText, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SuperAdminPage() {
  return (
    <div className="p-8">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-primary mb-2">
          <ShieldCheck className="w-6 h-6" />
          <span className="font-semibold uppercase tracking-wider text-sm">Administration Plateforme</span>
        </div>
        <h1 className="text-4xl font-headline font-bold text-primary">Tableau de Bord</h1>
        <p className="text-muted-foreground">Bienvenue dans l'interface de gestion globale de la plateforme.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard 
          icon={Building} 
          title="Entités" 
          description="Entreprises et partenaires enregistrés." 
          value="--"
        />
        <StatCard 
          icon={Users} 
          title="Utilisateurs" 
          description="Profils applicatifs actifs." 
          value="--"
        />
        <StatCard 
          icon={Lock} 
          title="Sécurité" 
          description="Rôles et permissions configurés." 
          value="Standard"
        />
      </div>

      <div className="mt-12">
        <Card className="bg-secondary/20 border-dashed border-2">
          <CardContent className="py-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-muted-foreground">Résumé d'activité à venir</h3>
            <p className="text-sm text-muted-foreground/60">Les statistiques et graphiques globaux apparaîtront ici.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, title, description, value }: { icon: any, title: string, description: string, value: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <div className="p-2 bg-primary rounded-md">
          <Icon className="w-4 h-4 text-white" />
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold mb-1">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
