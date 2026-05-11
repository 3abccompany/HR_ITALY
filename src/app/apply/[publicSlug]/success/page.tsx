
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function ApplicationSuccessPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-2xl border-none rounded-[2rem] overflow-hidden">
        <div className="h-32 bg-primary flex items-center justify-center relative">
          <div className="absolute -bottom-10 bg-white p-4 rounded-full shadow-xl">
             <CheckCircle2 className="w-12 h-12 text-green-500" />
          </div>
        </div>
        <CardContent className="pt-16 pb-12 px-10 text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Félicitations !</h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              Votre candidature a été envoyée avec succès. Notre équipe RH l'étudiera avec attention.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-sm text-slate-600 italic">
             "Merci de votre intérêt pour notre entreprise. Nous reviendrons vers vous prochainement."
          </div>

          <div className="pt-4">
            <Link href="https://google.com">
               <Button variant="outline" className="rounded-xl font-bold gap-2">
                 Quitter la page
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
