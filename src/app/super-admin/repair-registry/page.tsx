"use client";

import { useState, useMemo } from "react";
import { 
  ShieldAlert, Loader2, PlayCircle, Search, ArrowLeft, 
  CheckCircle2, AlertTriangle, Building2, ListTodo, FileText,
  RefreshCw, Info, Users, FolderOpen, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useFirebase, useUser, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { repairEntityDataLinkage } from "@/services/admin-repair.service";
import { Entity } from "@/types/entity";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

export default function RepairRegistryPage() {
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const entitiesQuery = useMemo(() => db ? query(collection(db, "entities"), orderBy("nomEntreprise", "asc")) : null, [db]);
  const { data: entities, loading: loadingEntities } = useCollection<Entity>(entitiesQuery);

  const handleRun = async (dryRun: boolean) => {
    if (!user || !selectedEntityId) return;

    setLoading(true);
    setResult(null);
    try {
      const res = await repairEntityDataLinkage(selectedEntityId, user.uid, dryRun);
      setResult({ ...res, dryRun });
      toast({ title: dryRun ? "Simulation terminée" : "Réparation terminée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto pb-32">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/super-admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-black text-primary">Réparation du Registre</h1>
          <p className="text-muted-foreground">Synchronisation globale des liens EmployeeId manquants.</p>
        </div>
      </div>

      <div className="grid gap-8">
        <Card className="border-primary/10 shadow-lg">
          <CardHeader className="bg-primary/5 border-b">
             <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> Sélection de l'entité
             </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
             <div className="space-y-2">
                <Label>Entreprise cible</Label>
                <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                   <SelectTrigger className="h-12">
                      <SelectValue placeholder={loadingEntities ? "Chargement..." : "Choisir une entreprise"} />
                   </SelectTrigger>
                   <SelectContent>
                      {entities?.filter(e => e.status === 'active').map(e => (
                        <SelectItem key={e.entityId} value={e.entityId}>{e.nomEntreprise || e.name}</SelectItem>
                      ))}
                   </SelectContent>
                </Select>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-12 rounded-xl font-bold gap-2"
                  onClick={() => handleRun(true)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                   Lancer Simulation (Dry Run)
                </Button>
                <Button 
                  className="h-12 rounded-xl font-black gap-2 bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100 text-white"
                  onClick={() => handleRun(false)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                   Appliquer Réparation
                </Button>
             </div>
          </CardContent>
        </Card>

        {result && (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
             <Alert className={result.dryRun ? "bg-blue-50 border-blue-200" : "bg-green-50 border-green-200"}>
                {result.dryRun ? <Info className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <AlertTitle className="font-bold">{result.dryRun ? "Rapport de simulation" : "Action effectuée avec succès"}</AlertTitle>
                <AlertDescription className="text-xs">
                  {result.dryRun ? "Aucune donnée n'a été modifiée." : "Les enregistrements ont été mis à jour dans le registre."}
                </AlertDescription>
             </Alert>

             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <ResultCard label="Employés analysés" value={result.employeesScanned} icon={Users} />
                <ResultCard label="Contrats à réparer" value={result.contractsRepaired} icon={FileText} color="orange" />
                <ResultCard label="Documents à réparer" value={result.documentsRepaired} icon={FolderOpen} color="indigo" />
                <ResultCard label="Pointeurs Employee" value={result.employeePointersFixed} icon={RefreshCw} color="teal" />
             </div>

             {result.conflicts.length > 0 && (
               <Card className="border-red-100 bg-red-50/50">
                  <CardHeader><CardTitle className="text-xs font-bold uppercase text-red-600">Conflits / Alertes détectées</CardTitle></CardHeader>
                  <CardContent>
                     <ul className="text-xs space-y-1 list-disc pl-5 text-red-700 font-medium">
                        {result.conflicts.map((c: string, i: number) => <li key={i}>{c}</li>)}
                     </ul>
                  </CardContent>
               </Card>
             )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ label, value, icon: Icon, color = "blue" }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
    teal: "bg-teal-50 text-teal-600 border-teal-100"
  };
  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl bg-white">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={cn("p-2.5 rounded-xl border", colors[color])}><Icon className="w-4 h-4" /></div>
        <div>
           <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
           <p className="text-xl font-black text-primary">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}