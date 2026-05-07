"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function ContractsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Contrats" 
      requiredPermission="contracts.read" 
    />
  );
}
