"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function InterviewsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Entretiens" 
      requiredPermission="interviews.read" 
    />
  );
}
