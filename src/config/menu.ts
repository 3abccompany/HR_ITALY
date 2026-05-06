export interface MenuItem {
  label: string;
  href: string;
  permission: string;
  icon?: string;
}

export const entityMenu: MenuItem[] = [
  { label: "Dashboard", href: "dashboard", permission: "dashboard.read" },
  { label: "Personnes", href: "persons", permission: "persons.read" },
  { label: "Candidats", href: "candidates", permission: "candidates.read" },
  { label: "Entretiens", href: "interviews", permission: "interviews.read" },
  { label: "Employés", href: "employees", permission: "employees.read" },
  { label: "Contrats", href: "contracts", permission: "contracts.read" },
  { label: "Documents", href: "documents", permission: "documents.read" },
  { label: "Présences", href: "attendances", permission: "attendances.read" },
  { label: "Absences / Congés", href: "leaveRequests", permission: "leaveRequests.read" },
  { label: "Rémunération", href: "payroll", permission: "payroll.read" },
  { label: "Rapports", href: "reports", permission: "reports.read" },
  { label: "Notifications", href: "notifications", permission: "notifications.read" },
  { label: "Paramètres", href: "settings", permission: "settings.read" },
];