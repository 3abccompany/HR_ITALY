"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { 
  Loader2, ShieldCheck, ArrowLeft, Briefcase, 
  Info, FileCode, Search, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useFirebase, useUser } from "@/firebase";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { createApplicationForm } from "@/services/application-form.service";
import { useToast } from "@/hooks/use-toast";
import { useOneShotSubmission } from "@/hooks/use-one-shot-submission";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export default function NewApplicationFormPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const entityId = params.entityId as string;
  const preselectedNeedId = searchParams.get("recruitmentNeedId");
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { tryStartSubmission, resetSubmission } = useOneShotSubmission();
  const { membership, loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [selectedNeedId, setSelectedNeedId] = useState<string>(preselectedNeedId || "");
  const [loading, setLoading] = useState(false);

  // Manual state for one-time fetch to avoid listener crashes
  const [needs, setNeeds] = useState<RecruitmentNeed[]>([]);
  const [loadingNeeds, setLoadingNeeds] = useState(false);
  const [needsError, setNeedsError] = useState<string | null>(null);

  const permissionsReady =
    !membershipLoading &&
    !!membership &&
    membership.entityId === entityId;
  const canCreateApplicationForms = hasPermission("applicationForms.create");
  const canReadRecruitmentNeeds = hasPermission("recruitmentNeeds.read");

  useEffect(() => {
    async function fetchNeeds() {
      if (!db || !entityId || !permissionsReady || !canCreateApplicationForms || !canReadRecruitmentNeeds) return;
      
      setLoadingNeeds(true);
      setNeedsError(null);
      
      try {
        const q = query(
          collection(db, `entities/${entityId}/recruitmentNeeds`), 
          where("status", "in", ["open", "partially_fulfilled"]),
          orderBy("createdAt", "desc")
        );
        
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ ...doc.data(), needId: doc.id } as RecruitmentNeed));
        setNeeds(data);
      } catch (err: any) {
        console.error("Error fetching recruitment needs:", err);
        setNeedsError(err.message || "Impossible de charger les besoins de recrutement.");
      } finally {
        setLoadingNeeds(false);
      }
    }

    fetchNeeds();
  }, [db, entityId, permissionsReady, canCreateApplicationForms, canReadRecruitmentNeeds]);

  const selectedNeed = useMemo(() => 
    needs?.find(n => n.needId === selectedNeedId), 
  [needs, selectedNeedId]);

  useEffect(() => {
    if (preselectedNeedId) setSelectedNeedId(preselectedNeedId);
  }, [preselectedNeedId]);

  const handleCreate = async () => {
    if (!user || !entityId || !permissionsReady || !canCreateApplicationForms || !canReadRecruitmentNeeds || !selectedNeed) return;
    if (!tryStartSubmission()) return;

    setLoading(true);
    try {
      const formId = await createApplicationForm(entityId, selectedNeed, user.uid);
      toast({ title: "Formulaire initialisé", description: "Brouillon créé avec les champs standards." });
      window.location.assign(`/entity/${entityId}/application-forms/${formId}/edit`);
    } catch (err: any) {
      resetSubmission();
      setLoading(false);
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!permissionsReady || !canCreateApplicationForms) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">
              Vous n'avez pas la permission de créer des formulaires.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <a href={`/entity/${entityId}/application-forms`} aria-label="Retour aux formulaires">
            <ArrowLeft className="w-5 h-5" />
          </a>
        </Button>
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Nouveau formulaire</h1>
          <p className="text-muted-foreground">Liez un formulaire à un besoin de recrutement ouvert.</p>
        </div>
      </div>

      <div className="grid gap-8">
        <Card className="border-primary/10 shadow-sm">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" /> Sélection du Besoin RH
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {needsError && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {needsError}
              </div>
            )}

            {!canReadRecruitmentNeeds && (
              <div className="bg-amber-50 text-amber-800 p-3 rounded-md text-sm flex items-center gap-2 border border-amber-200">
                <AlertCircle className="w-4 h-4" />
                La création d’un formulaire nécessite l’accès aux besoins RH.
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Besoin RH source</label>
              <Select value={selectedNeedId} onValueChange={setSelectedNeedId} disabled={!canReadRecruitmentNeeds}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder={!canReadRecruitmentNeeds ? "Besoins RH indisponibles" : loadingNeeds ? "Chargement des besoins..." : "Choisir un besoin ouvert"} />
                </SelectTrigger>
                <SelectContent>
                  {needs?.map(n => (
                    <SelectItem key={n.needId} value={n.needId}>
                      {n.jobTitleName} — {n.worksiteName} ({n.remainingHeadcount} postes restants)
                    </SelectItem>
                  ))}
                  {!loadingNeeds && needs?.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">Aucun besoin ouvert trouvé.</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedNeed && (
              <div className="bg-secondary/20 rounded-xl p-6 border border-dashed border-primary/20 space-y-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="font-bold text-primary">{selectedNeed.jobTitleName}</h3>
                    <p className="text-xs text-muted-foreground uppercase font-medium">{selectedNeed.departmentName}</p>
                  </div>
                  <Badge variant="outline" className="bg-white">{selectedNeed.contractType}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-bold">Site</p>
                    <p className="font-semibold">{selectedNeed.worksiteName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-bold">Postes à pourvoir</p>
                    <p className="font-semibold text-primary">{selectedNeed.remainingHeadcount}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-primary/10">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Info className="w-3.5 h-3.5" />
                    <span>L'offre d'emploi et les missions seront automatiquement importées.</span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-end">
              <Button 
                onClick={handleCreate} 
                disabled={loading || !canReadRecruitmentNeeds || !selectedNeedId}
                className="gap-2 h-12 px-8"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
                Initialiser le formulaire
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
