"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function CandidatesPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Candidats" 
      requiredPermission="candidates.read" 
    />
  );
}
