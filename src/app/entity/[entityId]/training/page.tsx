"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function TrainingPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Formations" 
      requiredPermission="training.read" 
    />
  );
}
