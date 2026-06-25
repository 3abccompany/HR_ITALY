
"use client";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { AlertCircle, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Disabled Legacy Seed Page.
 * This tool is obsolete and has been deactivated to prevent unauthorized writes.
 */
export default function DisabledSeedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-xl border-orange-200">
        <CardHeader className="bg-orange-50 border-b text-center pb-8">
          <div className="mx-auto bg-orange-500 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-white shadow-lg shadow-orange-200">
            <Lock className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-black text-orange-900">Outil Désactivé</CardTitle>
          <CardDescription className="text-orange-700">
            Cette page de bootstrap n'est plus opérationnelle.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <Alert variant="destructive" className="border-orange-200 bg-white rounded-xl">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <AlertTitle className="text-orange-900 font-bold uppercase text-[10px] tracking-widest">Avertissement</AlertTitle>
            <AlertDescription className="text-xs text-orange-800 leading-relaxed">
              Cette page héritée (legacy seed page) a été désactivée. Elle était uniquement utilisée pour l'initialisation du premier Super Admin dans Firestore.
              <br /><br />
              Veuillez utiliser les outils d'administration sécurisés ou des scripts locaux contrôlés pour toute opération de maintenance.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
