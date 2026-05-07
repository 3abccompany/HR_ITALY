"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function AttendancesPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Présences" 
      requiredPermission="attendances.read" 
    />
  );
}
