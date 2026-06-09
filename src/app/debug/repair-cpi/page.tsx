"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useUser } from "@/firebase";
import { repairCpiLink } from "@/services/admin-repair.service";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert, CheckCircle2, AlertCircle, FileCheck, UserCheck } from "lucide-react";
import { cn } from '@/lib/utils';
import { SuperAdminGuard } from "@/components/guards/SuperAdminGuard";

export default function RepairCpiPage() {
  const [offerId, setOfferId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { user } = useUser();
  const { toast } = useToast();

  const handleRepair = async () => {
    if (!user || !entityId || !offerId) {
      toast({ variant: "destructive", title: "Paramètres manquants" });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await repairCpiLink(entityId, offerId, user.uid);
      setResult(`Succès ! Dossier UniLav lié à l'employé ${res.employeeId}.${res.receiptDocumentId ? " Récépissé document également synchronisé." : ""}`);
      toast({ title: "Réparation terminée" });
    } catch (err: any) {
      setResult(`Erreur : ${err.message}`);
      toast({ variant: "destructive", title: "Échec de la réparation", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SuperAdminGuard>
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <Card className="w-full max-w-md shadow-xl border-blue-200">
          <CardHeader className="bg-blue-50 border-b">
            <div className="mx-auto bg-blue-500 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-white">
              <FileCheck className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-black text-center text-blue-900">Réparation CPI / UniLav</CardTitle>
            <CardDescription className="text-center text-orange-700">
              Lien d'un dossier UniLav existant à une fiche employé après conversion.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="p-4 bg-blue-100/50 border border-blue-200 rounded-xl text-xs text-blue-800 space-y-2">
               <p className="font-bold uppercase flex items-center gap-1">
                 <Info className="w-3 h-3" /> Information
               </p>
               <p>Cette action va synchroniser le <strong>requestId</strong> (unilav_OFFERID) avec l'ID employé résolu, permettant au récépissé de s'afficher correctement.</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>ID Entité (Tenant)</Label>
                <Input 
                  value={entityId} 
                  onChange={(e) => setEntityId(e.target.value)} 
                  placeholder="Ex: 3vhiKfy..."
                />
              </div>
              <div className="space-y-2">
                <Label>ID de l'offre source (OfferId)</Label>
                <Input 
                  value={offerId} 
                  onChange={(e) => setOfferId(e.target.value)}
                  placeholder="Ex: d4rXy8..."
                />
              </div>
            </div>

            <Button 
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 font-black gap-2"
              onClick={handleRepair}
              disabled={loading || !entityId || !offerId}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              Réparer le lien employé
            </Button>

            {result && (
              <div className={cn(
                "p-4 rounded-xl text-sm font-bold flex items-center gap-3 border",
                result.startsWith("Succès") ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"
              )}>
                 {result.startsWith("Succès") ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                 {result}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminGuard>
  );
}

function Info(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}
