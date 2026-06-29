"use client";

import { useMemo } from "react";
import { Bell, BellDot, CheckCircle2, Clock, Info, AlertTriangle, ShieldCheck, FileText, Send, User, FileSignature } from "lucide-react";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, where, orderBy, limit, or, and } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notification, NotificationCategory } from "@/types/notification";
import { markNotificationAsRead, markAllNotificationsAsRead } from "@/services/notification.service";
import { useRouter, useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";

export function NotificationBell() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const { db } = useFirebase();
  const { user } = useUser();
  const { membership, loading: membershipLoading } = useActiveMembership(entityId);

  const notificationsQuery = useMemo(() => {
    if (!db || !entityId || !user || !membership) return null;
    
    return query(
      collection(db, `entities/${entityId}/notifications`),
      and(
        where("status", "==", "unread"),
        or(
          where("targetUid", "==", user.uid),
          where("targetPermission", "in", membership.permissions.length > 0 ? membership.permissions : ["__none__"])
        )
      ),
      orderBy("createdAt", "desc"),
      limit(20)
    );
  }, [db, entityId, user, membership]);

  const { data: notifications, loading } = useCollection<Notification>(notificationsQuery as any, "bell.notifications");

  const unreadCount = notifications?.length || 0;

  const handleMarkAllRead = async () => {
    if (!user || !membership) return;
    await markAllNotificationsAsRead(entityId, user.uid, membership.permissions);
  };

  const handleNotificationClick = async (notification: Notification) => {
    await markNotificationAsRead(entityId, notification.id);
    if (notification.actionUrl) {
      router.push(notification.actionUrl);
    }
  };

  if (membershipLoading) return <Button variant="ghost" size="icon" disabled className="rounded-full opacity-20"><Bell className="w-5 h-5" /></Button>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-primary/5 transition-colors">
          {unreadCount > 0 ? (
            <>
              <BellDot className="w-5 h-5 text-primary animate-pulse" />
              <Badge className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 flex items-center justify-center bg-red-600 text-[9px] font-black border-2 border-white shadow-sm">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            </>
          ) : (
            <Bell className="w-5 h-5 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] p-0 rounded-2xl shadow-2xl border-primary/5 overflow-hidden">
        <div className="bg-primary/5 p-4 border-b flex items-center justify-between">
           <DropdownMenuLabel className="p-0 font-black text-xs uppercase tracking-widest text-primary">Notifications</DropdownMenuLabel>
           {unreadCount > 0 && (
             <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="h-7 px-2 text-[10px] font-bold uppercase text-primary hover:bg-primary/10">
               Tout marquer comme lu
             </Button>
           )}
        </div>
        
        <ScrollArea className="max-h-[400px]">
           <div className="flex flex-col">
              {loading ? (
                <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary/20" /></div>
              ) : unreadCount === 0 ? (
                <div className="p-12 text-center space-y-3">
                   <div className="bg-slate-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8 text-slate-200" />
                   </div>
                   <p className="text-xs font-bold text-muted-foreground uppercase tracking-tight">Aucun nouveau message</p>
                </div>
              ) : (
                notifications?.map(n => (
                  <button 
                    key={n.id} 
                    onClick={() => handleNotificationClick(n)}
                    className="flex items-start gap-4 p-4 text-left hover:bg-slate-50 transition-colors border-b last:border-b-0 group"
                  >
                     <div className={cn("mt-1 p-2 rounded-xl shadow-sm", getCategoryColor(n.category))}>
                        {getCategoryIcon(n.category)}
                     </div>
                     <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                           <p className="font-bold text-xs text-slate-900 truncate pr-2">{n.title}</p>
                           <span className="text-[9px] font-bold text-muted-foreground uppercase whitespace-nowrap opacity-60">
                             {formatTimeAgo(n.createdAt)}
                           </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{n.message}</p>
                     </div>
                  </button>
                ))
              )}
           </div>
        </ScrollArea>

        <DropdownMenuSeparator className="m-0" />
        <Button 
          variant="ghost" 
          className="w-full h-11 rounded-none text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:bg-primary/5"
          onClick={() => router.push(`/entity/${entityId}/notifications`)}
        >
          Voir tout l'historique
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getCategoryIcon(cat: NotificationCategory) {
  switch (cat) {
    case 'contract': return <FileSignature className="w-3.5 h-3.5" />;
    case 'medical': return <ShieldCheck className="w-3.5 h-3.5" />;
    case 'training': return <GraduationCap className="w-3.5 h-3.5" />;
    case 'safety': return <ShieldCheck className="w-3.5 h-3.5" />;
    case 'absence': return <Clock className="w-3.5 h-3.5" />;
    case 'document': return <FileText className="w-3.5 h-3.5" />;
    case 'cpi': return <Send className="w-3.5 h-3.5" />;
    default: return <Info className="w-3.5 h-3.5" />;
  }
}

function getCategoryColor(cat: NotificationCategory) {
  switch (cat) {
    case 'contract': return "bg-blue-50 text-blue-600";
    case 'medical': return "bg-orange-50 text-orange-600";
    case 'training': return "bg-indigo-50 text-indigo-600";
    case 'safety': return "bg-teal-50 text-teal-600";
    case 'absence': return "bg-purple-50 text-purple-600";
    case 'cpi': return "bg-sky-50 text-sky-600";
    case 'document': return "bg-slate-50 text-slate-600";
    default: return "bg-slate-50 text-slate-400";
  }
}

function formatTimeAgo(date: any) {
  if (!date) return "";
  const d = date.toDate ? date.toDate() : new Date(date);
  return formatDistanceToNow(d, { addSuffix: true, locale: fr }).replace('environ ', '');
}

function Loader2(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

import { GraduationCap } from "lucide-react";
