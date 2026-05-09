
import { 
  LayoutDashboard, 
  Users, 
  Search, 
  Calendar, 
  Building2,
  FileBadge,
  Briefcase,
  UserCheck, 
  FileText, 
  FolderOpen, 
  Clock, 
  Plane, 
  GraduationCap, 
  ShieldAlert, 
  Stethoscope, 
  BarChart, 
  Settings,
  LucideIcon
} from "lucide-react";

export interface MenuItem {
  label: string;
  href: string;
  permission: string;
  icon: LucideIcon;
}

export const entityMenu: MenuItem[] = [
  { label: "Tableau de bord", href: "dashboard", permission: "dashboard.read", icon: LayoutDashboard },
  { label: "Personnes", href: "persons", permission: "persons.read", icon: Users },
  { label: "Candidats", href: "candidates", permission: "candidates.read", icon: Search },
  { label: "Entretiens", href: "interviews", permission: "interviews.read", icon: Calendar },
  { label: "Départements", href: "departments", permission: "departments.read", icon: Building2 },
  { label: "Fiches de postes", href: "job-profiles", permission: "jobProfiles.read", icon: FileBadge },
  { label: "Besoins RH", href: "recruitment-needs", permission: "recruitmentNeeds.read", icon: Briefcase },
  { label: "Employés", href: "employees", permission: "employees.read", icon: UserCheck },
  { label: "Contrats", href: "contracts", permission: "contracts.read", icon: FileText },
  { label: "Documents", href: "documents", permission: "documents.read", icon: FolderOpen },
  { label: "Présences", href: "attendances", permission: "attendances.read", icon: Clock },
  { label: "Congés / Absences", href: "leave-requests", permission: "leaveRequests.read", icon: Plane },
  { label: "Formation", href: "training", permission: "training.read", icon: GraduationCap },
  { label: "Sécurité / DPI", href: "safety", permission: "safety.read", icon: ShieldAlert },
  { label: "Visites médicales", href: "medical-visits", permission: "medicalVisits.read", icon: Stethoscope },
  { label: "Rapports", href: "reports", permission: "reports.read", icon: BarChart },
  { label: "Paramètres", href: "settings", permission: "settings.read", icon: Settings },
];
