"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useUser } from "@/firebase";
import { repairCandidateEmployeeRecord } from "@/services/admin-repair.service";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from '@/lib/utils';

export default function RepairCandidatePage() {
  const [candidateId, setCandidateId] = useState("bbJ1tMjhE2pUrcUsv9jy");
  const [entityId, setEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { user } = useUser();
  const { toast } = useToast();

  const handleRepair = async () => {
    if (!user || !entityId || !candidateId) {
      toast({ variant: "destructive", title: "Paramètres manquants" });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await repairCandidateEmployeeRecord(entityId, candidateId, user.uid);
      setResult(`Succès ! Employé ${res.employeeId} réparé.`);
      toast({ title: "Réparation terminée" });
    } catch (err: any) {
      setResult(`Erreur : ${err.message}`);
      toast({ variant: "destructive", title: "Échec de la réparation", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-xl border-orange-200">
        <CardHeader className="bg-orange-50 border-b">
          <div className="mx-auto bg-orange-500 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-white">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-black text-center text-orange-900">Outil de Réparation</CardTitle>
          <CardDescription className="text-center text-orange-700">
            Restauration d'un document employé supprimé par erreur.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="p-4 bg-orange-100/50 border border-orange-200 rounded-xl text-xs text-orange-800 space-y-2">
             <p className="font-bold uppercase flex items-center gap-1">
               <AlertCircle className="w-3 h-3" /> Danger Zone
             </p>
             <p>Cette action va recréer le document <strong>Employee</strong> à partir des snapshots de recrutement.</p>
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
              <Label>ID Candidat à réparer</Label>
              <Input 
                value={candidateId} 
                onChange={(e) => setCandidateId(e.target.value)}
              />
            </div>
          </div>

          <Button 
            className="w-full h-12 rounded-xl bg-orange-600 hover:bg-orange-700 font-bold gap-2"
            onClick={handleRepair}
            disabled={loading || !entityId || !candidateId}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            Lancer la réparation
          </Button>

          {result && (
            <div className={cn(
              "p-4 rounded-xl text-sm font-bold flex items-center gap-3",
              result.startsWith("Succès") ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
            )}>
               {result.startsWith("Succès") ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
               {result}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RefreshCcw(props: any) {
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
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}

function XCircle(props: any) {
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
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  )
}
