"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function DocumentsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Documents" 
      requiredPermission="documents.read" 
    />
  );
}
