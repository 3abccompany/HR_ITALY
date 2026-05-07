
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  Building, 
  Users, 
  ShieldCheck, 
  Key, 
  Link as LinkIcon, 
  History, 
  Settings,
  Shield,
  LogOut,
  Loader2,
  Database,
  Lock
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { logout } from "@/services/auth.service";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  {
    title: "Tableau de bord",
    url: "/super-admin",
    icon: LayoutDashboard,
    isActive: true,
  },
  {
    title: "Entités",
    url: "/super-admin/entities",
    icon: Building,
    isActive: true,
  },
  {
    title: "Utilisateurs",
    url: "/super-admin/users",
    icon: Users,
    isActive: true,
  },
  {
    title: "Affectations",
    url: "/super-admin/memberships",
    icon: LinkIcon,
    isActive: true,
  },
  {
    title: "Catalogue Permissions",
    url: "/super-admin/permissions-seed",
    icon: Database,
    isActive: true,
    label: "Admin",
  },
  {
    title: "Initialisation Rôles",
    url: "/super-admin/roles-seed",
    icon: Lock,
    isActive: true,
    label: "Admin",
  },
  {
    title: "Rôles",
    url: "#",
    icon: ShieldCheck,
    isActive: false,
    label: "À venir",
  },
  {
    title: "Permissions",
    url: "#",
    icon: Key,
    isActive: false,
    label: "À venir",
  },
  {
    title: "Audit",
    url: "#",
    icon: History,
    isActive: false,
    label: "À venir",
  },
  {
    title: "Paramètres",
    url: "#",
    icon: Settings,
    isActive: false,
    label: "À venir",
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } catch (error: any) {
      console.error("Logout error:", error);
      toast({
        variant: "destructive",
        title: "Erreur de déconnexion",
        description: "Une erreur est survenue lors de la tentative de déconnexion.",
      });
      setIsLoggingOut(false);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b h-16 flex items-center px-4">
        <div className="flex items-center gap-2 font-headline font-bold text-primary">
          <div className="bg-primary p-1.5 rounded-lg">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="group-data-[collapsible=icon]:hidden">Super Admin</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation Plateforme</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isCurrent = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isCurrent}
                      tooltip={item.title}
                      disabled={!item.isActive}
                      className={!item.isActive ? "opacity-50 cursor-not-allowed" : ""}
                    >
                      {item.isActive ? (
                        <Link href={item.url}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <item.icon className="w-4 h-4" />
                            <span>{item.title}</span>
                          </div>
                          {item.label && (
                            <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">
                              {item.label}
                            </span>
                          )}
                        </div>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2 border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={handleLogout} 
              disabled={isLoggingOut}
              className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              tooltip="Déconnexion"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              <span className="group-data-[collapsible=icon]:hidden">Déconnexion</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
