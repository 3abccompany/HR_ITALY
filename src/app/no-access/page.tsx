import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function NoAccessPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-background text-foreground">
      <div className="bg-destructive/10 p-6 rounded-full mb-6">
        <ShieldAlert className="w-16 h-16 text-destructive" />
      </div>
      <h1 className="text-3xl font-headline font-bold mb-4 text-primary">Accès restreint</h1>
      <p className="text-muted-foreground mb-8 max-w-md text-lg">
        Vous n'avez aucun accès actif ou l'entreprise à laquelle vous tentez d'accéder est momentanément indisponible.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link href="/login">
          <Button variant="default" className="w-full">Retour à la connexion</Button>
        </Link>
        <p className="text-xs text-muted-foreground mt-4">
          Veuillez contacter votre administrateur si vous pensez qu'il s'agit d'une erreur.
        </p>
      </div>
    </div>
  );
}
