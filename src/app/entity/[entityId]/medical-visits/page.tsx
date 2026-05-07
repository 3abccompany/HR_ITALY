"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function MedicalVisitsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Visites Médicales" 
      requiredPermission="medicalVisits.read" 
    />
  );
}
