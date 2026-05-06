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
        <h1 className="text-4xl font-headline font-bold">Dashboard Super Admin</h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AdminCard icon={Building} title="Entités" description="Gérer les entreprises clientes et internes." />
        <AdminCard icon={Users} title="Utilisateurs" description="Contrôler les comptes utilisateurs globaux." />
        <AdminCard icon={Lock} title="Rôles & Permissions" description="Définir la matrice d'accès du système." />
        <AdminCard icon={FileText} title="Abonnements" description="Gérer les memberships uid/entity." />
        <AdminCard icon={Activity} title="Audit Logs" description="Consulter les logs d'activité système." />
      </div>
    </div>
  );
}

function AdminCard({ icon: Icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-md">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{description}</p>
      </CardContent>
    </Card>
  );
}