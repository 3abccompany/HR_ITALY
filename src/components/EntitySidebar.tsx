"use client";

import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useParams, usePathname, useRouter } from "next/navigation";
import { collection, limit, query, where, type Query } from "firebase/firestore";
import { 
  Building, 
  UserCircle, 
  ShieldCheck, 
  LogOut, 
  ArrowLeftRight,
  Loader2,
  GraduationCap,
  Stethoscope
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
import { useCollection, useFirebase, useUser } from "@/firebase";
import { entityMenu, type MenuItem } from "@/config/menu";
import { logout } from "@/services/auth.service";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@/types/employee";
import { cn } from "@/lib/utils";

const MY_SPACE_HREF = "my-space";
const MY_SPACE_TRAINING_HREF = "my-space/formations";
const MY_SPACE_MEDICAL_VISITS_HREF = "my-space/medical-visits";

export function EntitySidebar() {
  const params = useParams();
  const entityId = params.entityId as string;
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { db } = useFirebase();
  const { user } = useUser();
  const { membership, entity, loading, hasPermission } = useActiveMembership(entityId);
  const [loadingHref, setLoadingHref] = useState<string | null>(null);

  const mySpaceItem = entityMenu.find((item) => item.href === MY_SPACE_HREF);
  const businessMenuItems = entityMenu.filter((item) => item.href !== MY_SPACE_HREF);
  const canReadSelfProfile = hasPermission("self.profile.read");
  const userUid = user?.uid;
  const linkedEmployeeQuery = useMemo(() => {
    if (!db || !entityId || !userUid || !canReadSelfProfile) {
      return null;
    }

    return query(
        collection(db, `entities/${entityId}/employees`),
        where("userId", "==", userUid),
        limit(1)
      ) as Query<Employee>;
  }, [db, entityId, userUid, canReadSelfProfile]);
  const {
    data: linkedEmployees,
    loading: loadingLinkedEmployee,
    error: linkedEmployeeError,
  } = useCollection<Employee>(linkedEmployeeQuery, "sidebar.my-space-employee");
  const hasLinkedEmployeeProfile = !!linkedEmployees?.[0];
  const isMySpacePath = pathname?.startsWith(`/entity/${entityId}/my-space`);
  const showMySpace =
    !!mySpaceItem &&
    canReadSelfProfile &&
    !!user &&
    hasLinkedEmployeeProfile &&
    !linkedEmployeeError;
  const showSelfServiceNavigation =
    !!mySpaceItem &&
    canReadSelfProfile &&
    !!user &&
    !linkedEmployeeError &&
    (loadingLinkedEmployee || hasLinkedEmployeeProfile || isMySpacePath);

  useEffect(() => {
    if (linkedEmployeeError) {
      console.warn("[EntitySidebar] Linked employee profile lookup failed", linkedEmployeeError);
    }
  }, [linkedEmployeeError]);

  useEffect(() => {
    setLoadingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!loadingHref) return;

    const timeout = window.setTimeout(() => {
      setLoadingHref(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [loadingHref]);

  const handleMenuAnchorClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setLoadingHref(href);
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/login");
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

  const renderNavigationLink = (item: MenuItem) => {
    const href = `/entity/${entityId}/${item.href}`;
    const isActive = pathname === href;
    const isLoading = loadingHref === href && !isActive;
    const Icon = item.icon;

    return (
      <SidebarMenuItem key={item.href}>
        <a href={href}
          title={item.label}
          data-sidebar="menu-button"
          data-active={isActive}
          data-size="default"
          onClick={(event) => handleMenuAnchorClick(event, href)}
          className={cn(
            "peer/menu-button flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-left text-sm font-medium text-foreground outline-none ring-sidebar-ring transition-[width,height,padding] md:h-8 md:min-h-0 md:gap-2 md:p-2 md:text-sidebar-foreground",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 active:bg-accent active:text-accent-foreground md:hover:bg-sidebar-accent md:hover:text-sidebar-accent-foreground md:active:bg-sidebar-accent md:active:text-sidebar-accent-foreground",
            "data-[active=true]:bg-accent data-[active=true]:font-bold data-[active=true]:text-accent-foreground md:data-[active=true]:bg-sidebar-accent md:data-[active=true]:text-sidebar-accent-foreground",
            "group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
          )}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="w-4 h-4" aria-hidden="true" />
          )}
          <span>{item.label}</span>
        </a>
      </SidebarMenuItem>
    );
  };

  const renderMySpaceTrainingLink = () => {
    const href = `/entity/${entityId}/${MY_SPACE_TRAINING_HREF}`;
    const isActive = pathname === href;
    const isLoading = loadingHref === href && !isActive;

    return (
      <SidebarMenuItem key={MY_SPACE_TRAINING_HREF}>
        <a href={href}
          title="Mes formations"
          data-sidebar="menu-button"
          data-active={isActive}
          data-size="default"
          onClick={(event) => handleMenuAnchorClick(event, href)}
          className={cn(
            "peer/menu-button flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-left text-sm font-medium text-foreground outline-none ring-sidebar-ring transition-[width,height,padding] md:h-8 md:min-h-0 md:gap-2 md:p-2 md:text-sidebar-foreground",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 active:bg-accent active:text-accent-foreground md:hover:bg-sidebar-accent md:hover:text-sidebar-accent-foreground md:active:bg-sidebar-accent md:active:text-sidebar-accent-foreground",
            "data-[active=true]:bg-accent data-[active=true]:font-bold data-[active=true]:text-accent-foreground md:data-[active=true]:bg-sidebar-accent md:data-[active=true]:text-sidebar-accent-foreground",
            "group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
          )}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <GraduationCap className="w-4 h-4" aria-hidden="true" />
          )}
          <span>Mes formations</span>
        </a>
      </SidebarMenuItem>
    );
  };

  const renderMySpaceMedicalVisitsLink = () => {
    const href = `/entity/${entityId}/${MY_SPACE_MEDICAL_VISITS_HREF}`;
    const isActive = pathname === href;
    const isLoading = loadingHref === href && !isActive;

    return (
      <SidebarMenuItem key={MY_SPACE_MEDICAL_VISITS_HREF}>
        <a href={href}
          title="Mes visites médicales"
          data-sidebar="menu-button"
          data-active={isActive}
          data-size="default"
          onClick={(event) => handleMenuAnchorClick(event, href)}
          className={cn(
            "peer/menu-button flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-left text-sm font-medium text-foreground outline-none ring-sidebar-ring transition-[width,height,padding] md:h-8 md:min-h-0 md:gap-2 md:p-2 md:text-sidebar-foreground",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 active:bg-accent active:text-accent-foreground md:hover:bg-sidebar-accent md:hover:text-sidebar-accent-foreground md:active:bg-sidebar-accent md:active:text-sidebar-accent-foreground",
            "data-[active=true]:bg-accent data-[active=true]:font-bold data-[active=true]:text-accent-foreground md:data-[active=true]:bg-sidebar-accent md:data-[active=true]:text-sidebar-accent-foreground",
            "group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
          )}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Stethoscope className="w-4 h-4" aria-hidden="true" />
          )}
          <span>Mes visites médicales</span>
        </a>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-background text-foreground md:bg-sidebar md:text-sidebar-foreground">
      <SidebarHeader className="border-b border-border h-16 flex flex-col justify-center px-4 pr-12 md:pr-4 gap-0.5 bg-background md:bg-sidebar">
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

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground md:text-sidebar-foreground/70 font-black uppercase tracking-widest">Navigation Métier</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {businessMenuItems.map((item) => {
                const permissions = Array.isArray(item.permission) ? item.permission : [item.permission];
                const isVisible = permissions.some(p => hasPermission(p));
                if (!isVisible) return null;

                return renderNavigationLink(item);
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showSelfServiceNavigation && mySpaceItem && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted-foreground md:text-sidebar-foreground/70 font-black uppercase tracking-widest">Espace personnel</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {showMySpace || isMySpacePath ? renderNavigationLink(mySpaceItem) : null}
                {renderMySpaceTrainingLink()}
                {renderMySpaceMedicalVisitsLink()}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-border space-y-2 bg-background md:bg-sidebar">
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
            <SidebarMenuButton
              asChild
              tooltip="Changer d'entreprise"
              className="min-h-11 md:min-h-0 md:h-8 text-foreground md:text-sidebar-foreground"
            >
              <a href="/select-entity">
                <ArrowLeftRight className="w-4 h-4" />
                <span>Changer d'entreprise</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="min-h-11 md:min-h-0 md:h-8 text-destructive hover:text-destructive hover:bg-destructive/10" tooltip="Déconnexion">
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
