"use client";

import { useActiveMembership } from "@/hooks/use-active-membership";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Building, 
  UserCircle, 
  ShieldCheck, 
  ChevronRight, 
  LogOut, 
  ArrowLeftRight,
  Loader2
} from "lucide-react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarHeader, 
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail
} from "@/components/ui/sidebar";
import { entityMenu } from "@/config/menu";
import { logout } from "@/services/auth.service";
import { useToast } from "@/hooks/use-toast";

export function EntitySidebar() {
  const params = useParams();
  const entityId = params.entityId as string;
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { membership, entity, loading, hasPermission } = useActiveMembership(entityId);

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/login");
    } catch (e) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de se déconnecter." });
    }
  };

  if (loading) {
    return (
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="h-16 flex items-center justify-center border-b">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </SidebarHeader>
      </Sidebar>
    );
  }

  if (!membership || !entity) return null;

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b h-16 flex flex-col justify-center px-4 gap-0.5">
        <div className="flex items-center gap-2 font-headline font-bold text-primary">
          <div className="bg-primary p-1 rounded-lg shrink-0">
            <Building className="w-4 h-4 text-white" />
          </div>
          <span className="group-data-[collapsible=icon]:hidden truncate">{entity.nomEntreprise}</span>
        </div>
        <p className="text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden uppercase font-bold tracking-widest pl-7">
          Workspace
        </p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation Métier</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {entityMenu.map((item) => {
                const permissions = Array.isArray(item.permission) ? item.permission : [item.permission];
                const isVisible = permissions.some(p => hasPermission(p));
                if (!isVisible) return null;
                
                const href = `/entity/${entityId}/${item.href}`;
                const isActive = pathname === href;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link href={href}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2 border-t space-y-1">
        <div className="px-2 py-3 flex items-center gap-3 bg-secondary/30 rounded-lg group-data-[collapsible=icon]:p-1 group-data-[collapsible=icon]:justify-center transition-all">
          <div className="bg-primary/10 p-1.5 rounded-md shrink-0">
            <UserCircle className="w-5 h-5 text-primary" />
          </div>
          <div className="group-data-[collapsible=icon]:hidden overflow-hidden">
            <p className="text-xs font-bold text-primary truncate">{membership.userDisplayName}</p>
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-accent" />
              <span className="text-[10px] uppercase font-bold text-muted-foreground truncate">{membership.roleLabel}</span>
            </div>
          </div>
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => router.push("/select-entity")} tooltip="Changer d'entreprise">
              <ArrowLeftRight className="w-4 h-4" />
              <span>Changer d'entreprise</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive hover:bg-destructive/10" tooltip="Déconnexion">
              <LogOut className="w-4 h-4" />
              <span>Déconnexion</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
