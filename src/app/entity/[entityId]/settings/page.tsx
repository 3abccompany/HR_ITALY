"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function SettingsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Paramètres de l'Entreprise" 
      requiredPermission="settings.read" 
    />
  );
}
