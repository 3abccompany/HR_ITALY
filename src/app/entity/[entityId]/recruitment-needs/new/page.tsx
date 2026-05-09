
"use client";

import { useParams } from "next/navigation";
import { useUser } from "@/firebase";
import { RecruitmentNeedForm } from "@/components/recruitment-needs/RecruitmentNeedForm";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function NewRecruitmentNeedPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { user } = useUser();
  const { entity, loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const canCreate = hasPermission("recruitmentNeeds.create");

  if (membershipLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ShieldAlert className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de créer des besoins RH.</p>
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
        requesterName={user?.displayName || "Collaborateur"}
        userId={user?.uid || ""}
      />
    </div>
  );
}
