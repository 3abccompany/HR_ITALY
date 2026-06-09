"use client";

import { useState, useMemo } from "react";
import { 
  ShieldAlert, Loader2, PlayCircle, Search, ArrowLeft, 
  CheckCircle2, AlertTriangle, Building2, ListTodo, FileText,
  RefreshCw, Info, Users, FolderOpen, ChevronDown, Fingerprint,
  CheckCircle,
  FileCheck,
  Database
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useFirebase, useUser, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { repairEntityDataLinkageAction } from "./actions";
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

  const entitiesQuery = useMemo(() => db ? query(collection(db, "entities"), orderBy("nomEntreprise", "asc")) : null, [db]);
  const { data: entities, loading: loadingEntities } = useCollection<Entity>(entitiesQuery, "repair.entities");

  const handleRun = async (dryRun: boolean) => {
    if (!user || !selectedEntityId) return;

    setLoading(true);
    setResult(null);
    try {
      // PROVE SUPER ADMIN RIGHTS VIA ID TOKEN (SERVER-SIDE VERIFICATION)
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

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/super-admin">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-black text-primary tracking-tight">Réparation du Registre</h1>
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 uppercase font-black text-[9px] h-5">Mode Admin SDK</Badge>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Synchronisation des liens EmployeeId par scan déterministe côté serveur.</p>
        </div>
      </div>

      <div className="grid gap-8">
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-primary/5 border-b py-6 px-8">
             <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                <Database className="w-4 h-4" /> Configuration du Scan
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
                     <Info className="h-3.5 w-3.5 text-primary/40 cursor-help" title="Bypasse les conflits de personId pour lier les records à cet ID spécifique via un scan serveur." />
                  </div>
                  <Input 
                    placeholder="Ex: ERDNxeNE9q..." 
                    className="h-12 rounded-xl font-mono" 
                    value={canonicalEmployeeId}
                    onChange={(e) => setCanonicalEmployeeId(e.target.value)}
                  />
                </div>
             </div>

             <Alert className="bg-orange-50/50 border-orange-200 rounded-2xl">
                <ShieldAlert className="h-5 w-5 text-orange-600" />
                <div>
                   <AlertTitle className="text-xs font-black uppercase tracking-widest text-orange-800">Scan Déterministe & Sécurité Serveur</AlertTitle>
                   <AlertDescription className="text-[11px] text-orange-700 leading-relaxed mt-1 font-medium">
                      Cette action s'exécute côté serveur via le <strong>Firebase Admin SDK</strong>. Elle ignore les limitations des règles de sécurité client pour scanner intégralement les collections de l'entité et rétablir les liens de données rompus lors du recrutement ou des migrations.
                   </AlertDescription>
                </div>
             </Alert>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                <Button 
                  variant="outline" 
                  className="h-14 rounded-2xl font-black gap-2 border-2 border-dashed hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                  onClick={() => handleRun(true)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-5 h-5" />}
                   Lancer Simulation (Dry Run)
                </Button>
                <Button 
                  className="h-14 rounded-2xl font-black gap-2 bg-red-600 hover:bg-red-700 shadow-xl shadow-red-100 text-white uppercase tracking-widest text-xs"
                  onClick={() => handleRun(false)}
                  disabled={loading || !selectedEntityId}
                >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
                   Appliquer Réparation (Live)
                </Button>
             </div>
          </CardContent>
        </Card>

        {result && (
          <div className="space-y-8 animate-in fade-in slide-in-from-top-4">
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

             <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <ResultCard label="ID Analysés" value={result.employeesAnalyzed} icon={Users} />
                <ResultCard label="Contrats matchés" value={result.contractsRepaired} icon={FileText} color="orange" />
                <ResultCard label="Documents matchés" value={result.documentsRepaired} icon={FolderOpen} color="indigo" />
                <ResultCard label="Pointeurs Fixés" value={result.employeePointersUpdated} icon={RefreshCw} color="teal" />
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Detailed Matched Records List */}
                {(result.matchedContractIds?.length > 0 || result.matchedDocumentIds?.length > 0) && (
                  <Card className="border-primary/10 rounded-[2rem] overflow-hidden shadow-lg">
                    <CardHeader className="py-4 px-6 bg-secondary/20 border-b">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                           <ListTodo className="w-4 h-4" /> Détail des correspondances
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <ScrollArea className="h-[300px]">
                          <div className="divide-y divide-slate-100">
                              {result.matchedContractIds?.map((id: string) => (
                                <div key={id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center gap-4">
                                      <div className="bg-orange-100 p-2 rounded-xl text-orange-600 shadow-sm"><FileText className="w-4 h-4" /></div>
                                      <div>
                                          <p className="text-[10px] font-black text-slate-800">Contrat: {id}</p>
                                          <p className="text-[9px] font-bold text-orange-500 uppercase tracking-tighter mt-0.5">Link pending</p>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-[8px] font-black bg-white border-orange-100">REPAIR</Badge>
                                </div>
                              ))}
                              {result.matchedDocumentIds?.map((id: string) => (
                                <div key={id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center gap-4">
                                      <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600 shadow-sm"><FolderOpen className="w-4 h-4" /></div>
                                      <div>
                                          <p className="text-[10px] font-black text-slate-800">Document: {id}</p>
                                          <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-tighter mt-0.5">Link pending</p>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-[8px] font-black bg-white border-indigo-100">REPAIR</Badge>
                                </div>
                              ))}
                          </div>
                        </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Identity Info Panel */}
                {result.exactIdentityIds && result.exactIdentityIds.length > 0 && (
                   <Card className="border-primary/10 rounded-[2rem] bg-secondary/5 overflow-hidden">
                      <CardHeader className="py-4 px-6 border-b bg-white/50">
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                           <Fingerprint className="w-4 h-4" /> Empreintes d'identité
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                         <div className="space-y-2">
                            <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">ID Identifiés (Scan multi-variantes)</p>
                            <div className="flex flex-wrap gap-2">
                               {result.exactIdentityIds.map((id: string) => (
                                 <Badge key={id} variant="secondary" className="font-mono text-[9px] bg-white border-primary/5 py-1 px-2">{id}</Badge>
                               ))}
                            </div>
                         </div>
                         <Separator className="opacity-30" />
                         <div className="space-y-2">
                            <p className="text-[9px] font-black uppercase text-muted-foreground opacity-60">Clés de hachage (Casing-aware)</p>
                            <div className="flex flex-wrap gap-2">
                               {result.identityKeys.map((key: string) => (
                                 <Badge key={key} variant="outline" className="font-mono text-[8px] border-primary/5">{key}</Badge>
                               ))}
                            </div>
                         </div>
                      </CardContent>
                   </Card>
                )}
             </div>

             {result.skippedConflicts && result.skippedConflicts.length > 0 && (
               <Card className="border-red-100 bg-red-50/20 rounded-3xl overflow-hidden">
                  <CardHeader className="py-4 px-6 border-b border-red-100 bg-red-100/30">
                    <CardTitle className="text-xs font-black uppercase text-red-700 flex items-center gap-2 tracking-widest">
                       <AlertTriangle className="w-4 h-4" /> Conflits / Alertes de sécurité
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                     <ScrollArea className="max-h-[150px]">
                        <ul className="text-[11px] space-y-2 list-none text-red-800 font-bold">
                           {result.skippedConflicts.map((c: string, i: number) => (
                             <li key={i} className="flex items-start gap-2">
                                <span className="mt-1 flex h-1 w-1 shrink-0 rounded-full bg-red-600" />
                                {c}
                             </li>
                           ))}
                        </ul>
                     </ScrollArea>
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
    <Card className="border-primary/5 shadow-lg rounded-3xl bg-white group hover:shadow-xl transition-all">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border transition-colors", colors[color])}><Icon className="w-5 h-5" /></div>
        <div className="min-w-0">
           <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest truncate">{label}</p>
           <p className="text-2xl font-black text-primary leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
