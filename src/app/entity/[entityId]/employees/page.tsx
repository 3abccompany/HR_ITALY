"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function EmployeesPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Employés" 
      requiredPermission="employees.read" 
    />
  );
}
