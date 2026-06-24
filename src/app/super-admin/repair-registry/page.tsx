
"use client";

import { useState, useMemo } from "react";
import { 
  ShieldAlert, Loader2, PlayCircle, Search, ArrowLeft, 
  CheckCircle2, AlertTriangle, Building2, ListTodo, FileText,
  RefreshCw, Info, Users, FolderOpen, ChevronDown, Fingerprint,
  CheckCircle,
  FileCheck,
  Database,
  Link as LinkIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useFirebase, useUser, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { repairEntityDataLinkageAction, repairMembershipsAction } from "./actions";
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
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function RepairRegistryPage() {
  const { db, auth } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [canonicalEmployeeId, setCanonicalEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Membership repair state
  const [mLoading, setMLoading] = useState(false);
  const [mResult, setMResult] = useState<any>(null);

  const entitiesQuery = useMemo(() => db ? query(collection(db, "entities"), orderBy("nomEntreprise", "asc")) : null, [db]);
  const { data: entities, loading: loadingEntities } = useCollection<Entity>(entitiesQuery, "repair.entities");

  const handleRun = async (dryRun: boolean) => {
    if (!user || !selectedEntityId) return;

    setLoading(true);
    setResult(null);
    try {
      const idToken = await auth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Impossible de récupérer le jeton de session.");

      const response = await repairEntityDataLinkageAction({
        entityId: selectedEntityId,
        dryRun,
        canonicalEmployeeId: canonicalEmployeeId.trim() || undefined,
        idToken
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      setResult(response.results);
      toast({ title: dryRun ? "Simulation terminée" : "Réparation terminée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de réparation", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRepairMemberships = async (dryRun: boolean) => {
    if (!user) return;
    setMLoading(true);
    setMResult(null);
    try {
      const idToken = await auth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("No token");

      const response = await repairMembershipsAction({ dryRun, idToken });
      if (!response.success) throw new Error(response.error);

      setMResult(response.results);
      toast({ title: "Scan Memberships terminé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setMLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/super-admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-black text-primary tracking-tight">Outils de Réparation</h1>
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 uppercase font-black text-[9px] h-5">Mode Admin SDK</Badge>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Maintenance du registre et des liens de données plateforme.</p>
        </div>
      </div>

      <div className="space-y-12">
        {/* SECTION 1: ENTITY LINKAGE */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-primary/5 border-b py-6 px-8">
             <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                <Database className="w-4 h-4" /> Scan des liens Entité (Employés, Contrats, GED)
             </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-8">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Entreprise cible</Label>
                  <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                    <SelectTrigger className="h-12 rounded-xl">
                        <SelectValue placeholder={loadingEntities ? "Chargement..." : "Choisir une entreprise"} />
                    </SelectTrigger>
                    <SelectContent>
                        {entities?.filter(e => e.status === 'active').map(e => (
                          <SelectItem key={e.entityId} value={e.entityId}>{e.nomEntreprise || e.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                     <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">ID Employé Canonique (Forçage)</Label>
                     <span title="Bypasse les conflits de personId pour lier les records à cet ID spécifique via un scan serveur.">
                        <Info className="h-3.5 w-3.5 text-primary/40 cursor-help" />
                     </span>
                  </div>
                  <Input 
                    placeholder="Ex: ERDNxeNE9q..." 
                    className="h-12 rounded-xl font-mono" 
                    value={canonicalEmployeeId}
                    onChange={(e) => setCanonicalEmployeeId(e.target.value)}
                  />
                </div>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                <Button 
                  variant="outline" 
                  className="h-14 rounded-2xl font-black gap-2 border-2 border-dashed hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                  onClick={() => handleRun(true)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-5 h-5" />}
                   Lancer Simulation
                </Button>
                <Button 
                  className="h-14 rounded-2xl font-black gap-2 bg-red-600 hover:bg-red-700 shadow-xl shadow-red-100 text-white uppercase tracking-widest text-xs"
                  onClick={() => handleRun(false)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
                   Appliquer Réparation Live
                </Button>
             </div>

             {result && (
               <div className="mt-8 pt-8 border-t space-y-4 animate-in fade-in slide-in-from-top-4">
                  <Alert className={cn("rounded-2xl border-2", result.dryRun ? "bg-blue-50 border-blue-200" : "bg-green-50 border-green-200")}>
                    {result.dryRun ? <Info className="h-5 w-5 text-blue-600" /> : <CheckCircle2 className="h-5 w-5 text-green-600" />}
                    <div className="ml-2">
                       <AlertTitle className="font-black uppercase text-xs tracking-widest">{result.dryRun ? "Rapport de simulation" : "Réparation effectuée"}</AlertTitle>
                       <AlertDescription className="text-xs font-bold mt-1">
                         {result.dryRun ? "Scan serveur terminé. Aucune modification n'a été persistée." : "Les enregistrements ont été normalisés et liés à l'employé cible."}
                         <div className="mt-3 flex items-center gap-4 text-[10px] uppercase tracking-tighter opacity-70">
                            <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {result.totalContractsScanned} contrats analysés</span>
                            <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {result.totalDocumentsScanned} documents analysés</span>
                         </div>
                       </AlertDescription>
                    </div>
                  </Alert>
               </div>
             )}
          </CardContent>
        </Card>

        {/* SECTION 2: MEMBERSHIP METADATA */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-secondary/10 border-b py-6 px-8">
             <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                <LinkIcon className="w-4 h-4" /> Réparation des Métadonnées Memberships
             </CardTitle>
             <CardDescription className="text-xs font-medium text-slate-500 mt-1">
                Fills missing userDisplayName, userEmail and entityName on membership documents.
             </CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
             <Alert className="bg-blue-50/50 border-blue-100 rounded-2xl">
                <Info className="h-5 w-5 text-blue-600" />
                <AlertDescription className="text-[11px] text-blue-800 leading-relaxed font-medium">
                  Cette opération scanne l'intégralité du catalogue des accès pour enrichir les documents de dénormalisation manquants (utilisateurs créés via invitation employé). Elle ne modifie pas les permissions.
                </AlertDescription>
             </Alert>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-12 rounded-xl font-bold gap-2 border-dashed"
                  onClick={() => handleRepairMemberships(true)}
                  disabled={mLoading}
                >
                   {mLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                   Simuler (Scan global)
                </Button>
                <Button 
                  className="h-12 rounded-xl font-black bg-primary text-white shadow-lg gap-2"
                  onClick={() => handleRepairMemberships(false)}
                  disabled={mLoading}
                >
                   {mLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                   Lancer Réparation
                </Button>
             </div>

             {mResult && (
               <div className="space-y-4 animate-in fade-in slide-in-from-top-2 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                     <div className="p-4 bg-slate-50 rounded-2xl border text-center">
                        <p className="text-[9px] font-black text-muted-foreground uppercase">Membres analysés</p>
                        <p className="text-2xl font-black text-primary">{mResult.scanned}</p>
                     </div>
                     <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 text-center">
                        <p className="text-[9px] font-black text-primary/60 uppercase">{mResult.dryRun ? "Besoin réparation" : "Membres réparés"}</p>
                        <p className="text-2xl font-black text-primary">{mResult.repaired}</p>
                     </div>
                  </div>
                  
                  {mResult.logs?.length > 0 && (
                     <ScrollArea className="h-[200px] rounded-xl border bg-slate-50 p-4">
                        <div className="space-y-1">
                           {mResult.logs.map((log: string, i: number) => (
                             <p key={i} className="text-[10px] font-mono text-slate-600 truncate">{log}</p>
                           ))}
                        </div>
                     </ScrollArea>
                  )}
               </div>
             )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
