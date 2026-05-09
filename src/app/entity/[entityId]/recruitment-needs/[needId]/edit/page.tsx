"use client";

import { useParams } from "next/navigation";
import { useUser, useDoc, useFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { RecruitmentNeedForm } from "@/components/recruitment-needs/RecruitmentNeedForm";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Loader2, ShieldAlert, FileSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useMemo } from "react";

export default function EditRecruitmentNeedPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const needId = params.needId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { entity, loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const needRef = useMemo(() => {
    if (!db || !entityId || !needId) return null;
    return doc(db, `entities/${entityId}/recruitmentNeeds`, needId);
  }, [db, entityId, needId]);

  const { data: need, loading: loadingNeed } = useDoc<RecruitmentNeed>(needRef);

  const canUpdate = hasPermission("recruitmentNeeds.update");

  if (membershipLoading || loadingNeed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!canUpdate) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ShieldAlert className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de modifier les besoins RH.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!need) {
    return (
      <div className="p-8">
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <FileSearch className="w-12 h-12 text-muted-foreground mb-4 opacity-30" />
            <h2 className="text-xl font-bold text-primary mb-2">Besoin introuvable</h2>
            <p className="text-muted-foreground">Le document demandé n'existe pas ou a été supprimé.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <RecruitmentNeedForm 
        entityId={entityId}
        entityName={entity?.nomEntreprise || "Entreprise"}
        userId={user?.uid || ""}
        initialData={need}
        isEditing={true}
      />
    </div>
  );
}
