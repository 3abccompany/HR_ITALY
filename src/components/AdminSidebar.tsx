"use client";

import { 
  LayoutDashboard, 
  Building, 
  Users, 
  ShieldCheck, 
  Key, 
  Link as LinkIcon, 
  History, 
  Settings,
  Shield
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

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
    url: "#",
    icon: Users,
    isActive: false,
    label: "À venir",
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
    title: "Affectations",
    url: "#",
    icon: LinkIcon,
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
      <SidebarRail />
    </Sidebar>
  );
}
