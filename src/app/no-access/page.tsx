import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function NoAccessPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <ShieldAlert className="w-16 h-16 text-destructive mb-4" />
      <h1 className="text-3xl font-bold mb-2">Accès refusé</h1>
      <p className="text-muted-foreground mb-8 max-w-md">
        Vous n'avez aucun accès actif sur cette plateforme. Veuillez contacter votre administrateur.
      </p>
      <Link href="/login">
        <Button variant="outline">Retour à la connexion</Button>
      </Link>
    </div>
  );
}