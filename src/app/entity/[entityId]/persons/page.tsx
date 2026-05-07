"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function PersonsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Personnes" 
      requiredPermission="persons.read" 
    />
  );
}
