
"use client";

import { useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2, PlayCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser } from "@/firebase";
import { seedRoles } from "@/services/role.service";
import { MVP_ROLES } from "@/config/roles";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export default function RolesSeedPage() {
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
      const count = await seedRoles(user.uid);
      setSuccess(count);
      toast({
        title: "Catalogue des rôles synchronisé",
        description: `${count} modèles de rôles ont été créés ou mis à jour.`,
      });
    } catch (err: any) {
      console.error("Seed error:", err);
      setError(err.message || "Une erreur est survenue lors de la synchronisation.");
      toast({
        variant: "destructive",
        title: "Erreur de synchronisation",
        description: err.message || "Impossible de mettre à jour le catalogue des rôles.",
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
          <h1 className="text-3xl font-headline font-bold text-primary">Initialisation des rôles</h1>
          <p className="text-muted-foreground">Configuration des modèles de rôles standards.</p>
        </div>
      </div>

      <Card className="border-accent/20">
        <CardHeader>
          <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
            <ShieldCheck className="text-primary w-6 h-6" />
          </div>
          <CardTitle>Catalogue des Modèles de Rôles</CardTitle>
          <CardDescription>
            Cette opération va synchroniser les modèles de rôles standards (Super Admin, RH, Sécurité...) avec Firestore.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Note d'architecture</AlertTitle>
            <AlertDescription>
              Les rôles sont des modèles (templates). Leurs permissions seront copiées dans les "memberships" lors de l'affectation d'un utilisateur à une entité.
            </AlertDescription>
          </Alert>

          <div className="p-4 bg-secondary rounded-lg">
            <p className="text-sm font-medium">Nombre de rôles à initialiser : <span className="text-primary font-bold">{MVP_ROLES.length}</span></p>
            <ul className="text-xs text-muted-foreground mt-2 list-disc list-inside space-y-1">
              {MVP_ROLES.map(r => <li key={r.roleId}>{r.label} ({r.scope})</li>)}
            </ul>
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Erreur</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success !== null && (
            <Alert className="border-green-500 text-green-600 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Succès</AlertTitle>
              <AlertDescription>
                Synchronisation terminée. {success} modèles de rôles sont prêts.
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
            {loading ? "Synchronisation en cours..." : "Initialiser le catalogue des rôles"}
          </Button>
        </CardFooter>
      </Card>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        HR Nexus Studio - Gestion des Modèles de Rôles
      </p>
    </div>
  );
}
