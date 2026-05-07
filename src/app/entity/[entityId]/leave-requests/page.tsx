"use client";

import { EntityPlaceholderPage } from "@/components/EntityPlaceholderPage";

export default function LeaveRequestsPlaceholderPage() {
  return (
    <EntityPlaceholderPage 
      title="Gestion des Congés" 
      requiredPermission="leaveRequests.read" 
    />
  );
}
