"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function SafetyPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Sécurité et DPI" 
      requiredPermission="safety.read" 
    />
  );
}
