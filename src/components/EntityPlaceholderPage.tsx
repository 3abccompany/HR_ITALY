"use client";

import { useActiveMembership } from "@/hooks/use-active-membership";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, ShieldAlert, Construction } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface EntityPlaceholderPageProps {
  title: string;
  requiredPermission: string;
}

export function EntityPlaceholderPage({ title, requiredPermission }: EntityPlaceholderPageProps) {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const { loading, error, hasPermission, entity } = useActiveMembership(entityId);

  useEffect(() => {
    if (!loading && (error || !hasPermission(requiredPermission))) {
      router.push("/no-access");
    }
  }, [loading, error, hasPermission, requiredPermission, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">Chargement du module...</p>
      </div>
    );
  }

  if (error || !hasPermission(requiredPermission)) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-headline font-bold text-primary mb-2">{title}</h1>
        <p className="text-muted-foreground">{entity?.nomEntreprise}</p>
      </div>

      <div className="grid gap-6">
        <Alert className="bg-blue-50 border-blue-200 text-blue-800">
          <Construction className="h-4 w-4" />
          <AlertTitle>Module à venir</AlertTitle>
          <AlertDescription>
            Cette fonctionnalité est en cours de développement dans le cadre du Studio.
          </AlertDescription>
        </Alert>

        <Card className="border-dashed border-2 bg-secondary/10">
          <CardHeader>
            <CardTitle className="text-xl">Informations d'accès</CardTitle>
            <CardDescription>Détails sur l'autorisation requise pour ce module.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-background rounded-lg border flex items-center gap-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <ShieldAlert className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-primary">{requiredPermission}</p>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-tight">Permission Requise</p>
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Vous avez accès à ce placeholder car votre membership actif pour <strong>{entity?.nomEntreprise}</strong> inclut le privilège listé ci-dessus.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
