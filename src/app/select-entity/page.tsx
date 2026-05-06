
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToAuthState, getCurrentUserContext } from "@/services/auth.service";
import { Membership } from "@/types/membership";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, Loader2, AlertCircle } from "lucide-react";
import { useFirebase } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SelectEntityPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { auth } = useFirebase();

  useEffect(() => {
    if (!auth) {
      setError("Le service d'authentification n'est pas configuré.");
      setLoading(false);
      return;
    }

    return listenToAuthState(async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      try {
        const context = await getCurrentUserContext(user);
        setMemberships(context.memberships);
        setLoading(false);
      } catch (e) {
        console.error("Error loading user context:", e);
        router.push("/no-access");
      }
    });
  }, [router, auth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erreur de Configuration</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-headline font-bold mb-8 text-center">Choisir une entreprise</h1>
      {memberships.length === 0 ? (
        <p className="text-center text-muted-foreground">Aucune entreprise trouvée pour votre compte.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {memberships.map((m) => (
            <Card 
              key={m.id} 
              className="cursor-pointer hover:border-accent transition-all hover:shadow-md"
              onClick={() => router.push(`/entity/${m.entityId}/dashboard`)}
            >
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="p-2 bg-secondary rounded-lg">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Entité {m.entityId}</CardTitle>
                  <p className="text-xs text-muted-foreground">Rôle: {m.roleId}</p>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
