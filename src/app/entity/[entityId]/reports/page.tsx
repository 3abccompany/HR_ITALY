"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function ReportsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Rapports et Analyses" 
      requiredPermission="reports.read" 
    />
  );
}
