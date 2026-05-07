
"use client";

import { useState } from "react";
import { ShieldAlert, Loader2, CheckCircle2, PlayCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser } from "@/firebase";
import { seedPermissions } from "@/services/permission.service";
import { MVP_PERMISSIONS } from "@/config/permissions";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export default function PermissionsSeedPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSeed = async () => {
    if (!user) {
      setError("Vous devez être connecté pour effectuer cette action.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const count = await seedPermissions(user.uid);
      setSuccess(count);
      toast({
        title: "Catalogue synchronisé",
        description: `${count} permissions ont été traitées avec succès.`,
      });
    } catch (err: any) {
      console.error("Seed error:", err);
      setError(err.message || "Une erreur est survenue lors de la synchronisation.");
      toast({
        variant: "destructive",
        title: "Erreur de synchronisation",
        description: err.message || "Impossible de mettre à jour le catalogue.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/super-admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Initialisation du catalogue</h1>
          <p className="text-muted-foreground">Maintenance des permissions système.</p>
        </div>
      </div>

      <Card className="border-accent/20">
        <CardHeader>
          <div className="bg-accent/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
            <ShieldAlert className="text-accent w-6 h-6" />
          </div>
          <CardTitle>Catalogue des Permissions</CardTitle>
          <CardDescription>
            Cette opération va synchroniser le catalogue des permissions Firestore avec les définitions statiques de l'application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Attention</AlertTitle>
            <AlertDescription>
              Ceci est un outil temporaire de Super Administration. Il utilise une stratégie d'écriture "merge" (idempotente) : 
              les permissions existantes ne sont pas supprimées.
            </AlertDescription>
          </Alert>

          <div className="p-4 bg-secondary rounded-lg">
            <p className="text-sm font-medium">Nombre de permissions à traiter : <span className="text-primary font-bold">{MVP_PERMISSIONS.length}</span></p>
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Erreur</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success !== null && (
            <Alert className="border-green-500 text-green-600 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Succès</AlertTitle>
              <AlertDescription>
                Synchronisation terminée. {success} documents ont été créés ou mis à jour.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            onClick={handleSeed} 
            disabled={loading} 
            className="w-full gap-2 h-12 text-md font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {loading ? "Synchronisation en cours..." : "Lancer la synchronisation du catalogue"}
          </Button>
        </CardFooter>
      </Card>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        HR Nexus Studio - Gestion des Permissions Catalogue
      </p>
    </div>
  );
}
