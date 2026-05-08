
import { RoleScope } from "@/types/role";
import { MVP_PERMISSIONS } from "./permissions";

export interface RoleDefinition {
  roleId: string;
  name: string;
  label: string;
  description: string;
  scope: RoleScope;
  getPermissions: () => string[];
}

export const MVP_ROLES: RoleDefinition[] = [
  {
    roleId: "superAdmin",
    name: "superAdmin",
    label: "Super Admin",
    description: "Accès total à la plateforme et à toutes les entités.",
    scope: "platform",
    getPermissions: () => 
      MVP_PERMISSIONS.filter(p => p.scope === "platform").map(p => p.code)
  },
  {
    roleId: "companyAdmin",
    name: "companyAdmin",
    label: "Administrateur d'entreprise",
    description: "Accès total aux données de l'entreprise.",
    scope: "entity",
    getPermissions: () => 
      MVP_PERMISSIONS.filter(p => p.scope === "entity").map(p => p.code)
  },
  {
    roleId: "companyHR",
    name: "companyHR",
    label: "RH d'entreprise",
    description: "Gestion complète des ressources humaines et du recrutement.",
    scope: "entity",
    getPermissions: () => {
      const hrModules = [
        "dashboard", "persons", "candidates", "interviews", 
        "departments", "jobTitles",
        "employees", "contracts", "documents", "attendances", 
        "leaveRequests", "reports"
      ];
      return MVP_PERMISSIONS
        .filter(p => p.scope === "entity" && hrModules.includes(p.module))
        .map(p => p.code);
    }
  },
  {
    roleId: "safetyManager",
    name: "safetyManager",
    label: "Responsable sécurité",
    description: "Gestion de la sécurité, des formations et des visites médicales.",
    scope: "entity",
    getPermissions: () => {
      const exactCodes = [
        "dashboard.read",
        "employees.read",
        "documents.read",
        "documents.upload",
        "documents.download",
        "reports.read"
      ];
      const safetyModules = ["training", "safety", "medicalVisits"];
      return MVP_PERMISSIONS
        .filter(p => {
          if (p.scope !== "entity") return false;
          if (exactCodes.includes(p.code)) return true;
          if (safetyModules.includes(p.module)) {
            // Safety Managers don't write medical visits in this MVP logic
            if (p.module === "medicalVisits" && p.action !== "read") return false;
            return true;
          }
          return false;
        })
        .map(p => p.code);
    }
  },
  {
    roleId: "readOnly",
    name: "readOnly",
    label: "Utilisateur en consultation",
    description: "Accès en lecture seule aux données de l'entité.",
    scope: "entity",
    getPermissions: () => 
      MVP_PERMISSIONS
        .filter(p => p.scope === "entity" && (p.action === "read" || p.module === "departments" || p.module === "jobTitles"))
        .filter(p => p.action === "read")
        .map(p => p.code)
  }
];
