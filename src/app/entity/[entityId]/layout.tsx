"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { EntitySidebar } from "@/components/EntitySidebar";
import { Separator } from "@/components/ui/separator";
import { useParams, useRouter } from "next/navigation";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useEffect } from "react";
import { Loader2, Building } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuthGuard } from "@/components/guards/AuthGuard";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export default function EntityWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const { loading, error, entity } = useActiveMembership(entityId);

  useEffect(() => {
    if (!loading && error) {
      router.push("/no-access");
    }
  }, [loading, error, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Accès à l'entité...</p>
      </div>
    );
  }

  if (error || !entity) return null;

  return (
    <AuthGuard>
      <SidebarProvider>
        <div className="flex min-h-screen w-full">
          <EntitySidebar />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 bg-background/50 backdrop-blur sticky top-0 z-30 justify-between">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-primary uppercase tracking-wider">
                    <Building className="w-4 h-4" />
                    <span>{entity.nomEntreprise}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] py-0 h-4 bg-green-50 text-green-700 border-green-200">
                    Actif
                  </Badge>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <NotificationBell />
                <Separator orientation="vertical" className="h-4 opacity-20" />
                <span className="text-[10px] text-muted-foreground font-mono group-data-[collapsible=icon]:hidden">
                  ID: {entityId}
                </span>
              </div>
            </header>
            <div className="flex-1 overflow-auto bg-background/30">
              {children}
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
