
"use client";

import { useParams } from "next/navigation";
import { useUser, useDoc, useFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { JobProfile } from "@/types/job-profile";
import { JobProfileForm } from "@/components/job-profiles/JobProfileForm";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Loader2, ShieldAlert, FileSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useMemo } from "react";

export default function EditJobProfilePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const jobProfileId = params.jobProfileId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { entity, loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const profileRef = useMemo(() => {
    if (!db || !entityId || !jobProfileId) return null;
    return doc(db, `entities/${entityId}/jobProfiles`, jobProfileId);
  }, [db, entityId, jobProfileId]);

  const { data: profile, loading: loadingProfile } = useDoc<JobProfile>(profileRef);

  const canUpdate = hasPermission("jobProfiles.update");

  if (membershipLoading || loadingProfile) {
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
            <p className="text-muted-foreground">Vous n'avez pas la permission de modifier les fiches de postes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8">
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <FileSearch className="w-12 h-12 text-muted-foreground mb-4 opacity-30" />
            <h2 className="text-xl font-bold text-primary mb-2">Fiche introuvable</h2>
            <p className="text-muted-foreground">Le document demandé n'existe pas ou a été supprimé.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <JobProfileForm 
        entityId={entityId}
        entityName={entity?.nomEntreprise || "Entreprise"}
        userId={user?.uid || ""}
        initialData={profile}
        isEditing={true}
      />
    </div>
  );
}
