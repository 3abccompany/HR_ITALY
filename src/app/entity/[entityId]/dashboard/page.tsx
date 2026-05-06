import { LayoutDashboard, Users, UserCheck, CalendarDays, ClipboardList, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EntityDashboardPage({ params }: { params: { entityId: string } }) {
  const { entityId } = params;

  return (
    <div className="p-8">
      <header className="mb-8 flex justify-between items-end">
        <div>
          <div className="flex items-center gap-2 text-accent font-medium mb-1">
            <LayoutDashboard className="w-4 h-4" />
            <span className="text-sm">Vue d'ensemble</span>
          </div>
          <h1 className="text-4xl font-headline font-bold">Dashboard Entreprise</h1>
          <p className="text-muted-foreground">Entité ID: <span className="font-mono text-primary">{entityId}</span></p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="Total Personnes" value="128" />
        <StatCard icon={UserCheck} label="Employés Actifs" value="94" />
        <StatCard icon={CalendarDays} label="Entretiens prévus" value="12" />
        <StatCard icon={TrendingUp} label="Nouveaux Candidats" value="45" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activités Récentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-4 p-3 border rounded-lg">
                  <div className="p-2 bg-secondary rounded">
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Nouveau candidat ajouté: Jean Dupont</p>
                    <p className="text-xs text-muted-foreground">Il y a 2 heures par Admin</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions Rapides</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <button className="text-left p-3 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Ajouter un candidat</button>
            <button className="text-left p-3 text-sm border rounded-lg hover:bg-secondary transition-colors">Planifier un entretien</button>
            <button className="text-left p-3 text-sm border rounded-lg hover:bg-secondary transition-colors">Exporter rapports</button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-secondary rounded-full">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground leading-none mb-1">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}