"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToAuthState } from "@/services/auth.service";
import { getValidActiveMembershipsByUid } from "@/services/membership.service";
import { Membership } from "@/types/membership";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, Loader2, AlertCircle, KeyRound, ChevronRight } from "lucide-react";
import { useFirebase } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

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
        // Load only valid memberships where linked entity is also active
        const list = await getValidActiveMembershipsByUid(user.uid);
        if (list.length === 0) {
          router.push("/no-access");
          return;
        }
        setMemberships(list);
      } catch (e) {
        console.error("Error loading valid memberships:", e);
        router.push("/no-access");
      } finally {
        setLoading(false);
      }
    });
  }, [router, auth]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">Chargement de vos accès...</p>
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
    <div className="max-w-5xl mx-auto py-16 px-6">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-headline font-bold mb-4 text-primary">Choisir une entreprise</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Sélectionnez l'entité pour laquelle vous souhaitez travailler aujourd'hui. Vos permissions sont isolées par entreprise.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {memberships.map((m) => (
          <Card 
            key={m.membershipId} 
            className="group cursor-pointer hover:border-accent border-2 transition-all hover:shadow-xl bg-card"
            onClick={() => router.push(`/entity/${m.entityId}/dashboard`)}
          >
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div className="p-3 bg-secondary rounded-xl group-hover:bg-accent/10 transition-colors">
                <Building2 className="w-8 h-8 text-primary group-hover:text-accent transition-colors" />
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-all group-hover:translate-x-1" />
            </CardHeader>
            <CardContent>
              <CardTitle className="text-xl mb-2 font-headline">{m.entityName}</CardTitle>
              <div className="space-y-3 mt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <KeyRound className="w-4 h-4" />
                  <span className="font-medium text-foreground">{m.roleLabel}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Permissions</span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {m.permissions?.length || 0} actives
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <footer className="mt-24 pt-8 border-t text-center text-xs text-muted-foreground">
        HR Nexus Studio &copy; {new Date().getFullYear()} — Accès Multi-Entités Sécurisé
      </footer>
    </div>
  );
}
