"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Info, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * Placeholder for the Employee Account Activation page.
 * Phase 1A: Foundation. Full activation logic will be added in Phase 1B.
 */
export default function EmployeeActivationPlaceholderPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-2xl border-none rounded-[2rem] overflow-hidden">
        <div className="h-32 bg-primary flex items-center justify-center relative">
          <div className="absolute -bottom-10 bg-white p-4 rounded-full shadow-xl text-primary">
             <Info className="w-12 h-12" />
          </div>
        </div>
        <CardContent className="pt-16 pb-12 px-10 text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Espace Employé</h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              Le module d'activation des comptes est en cours de déploiement final.
            </p>
          </div>

          <div className="p-4 bg-blue-50 rounded-2xl border border-dashed border-blue-200 text-sm text-blue-700 italic">
             "Veuillez réessayer dans quelques instants. Votre lien reste valide pendant 48 heures."
          </div>

          <div className="pt-4">
            <Link href="/login">
               <Button variant="outline" className="rounded-xl font-bold gap-2">
                 Retour à la connexion
               </Button>
            </Link>
          </div>

          <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400 uppercase font-black tracking-widest pt-4">
             <Building2 className="w-3 h-3" />
             HR Nexus Ecosystem
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
