"use client"

import { useMemo, useState, useEffect } from "react";
import { 
  Bell, 
  BellDot, 
  CheckCircle2, 
  Clock, 
  Info, 
  AlertTriangle, 
  ShieldCheck, 
  FileText, 
  Send, 
  User, 
  FileSignature, 
  GraduationCap,
  Loader2
} from "lucide-react";
import { useFirebase, useUser } from "@/firebase";
import { collection, query, where, onSnapshot, Query } from "firebase/firestore";
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

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Use simplified queries to avoid composite index requirements
  useEffect(() => {
    if (!db || !entityId || !user || !membership || membership.entityId !== entityId) {
      if (!membershipLoading) setLoading(false);
      return;
    }

    const notificationsRef = collection(db, `entities/${entityId}/notifications`);
    
    // 1. Define base queries without combined status or ordering
    const queries: Query[] = [];
    
    // Query A: Direct target to user
    queries.push(query(
      notificationsRef,
      where("targetUid", "==", user.uid)
    ));

    // Query B: Targeted to permissions (Chunked)
    if (membership.permissions && membership.permissions.length > 0) {
      const CHUNK_SIZE = 30;
      for (let i = 0; i < membership.permissions.length; i += CHUNK_SIZE) {
        const chunk = membership.permissions.slice(i, i + CHUNK_SIZE);
        queries.push(query(
          notificationsRef,
          where("targetPermission", "in", chunk)
        ));
      }
    }

    const resultsMap = new Map<number, Notification[]>();
    setLoading(true);

    const unsubscribes = queries.map((q, index) => {
      return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Notification));
        resultsMap.set(index, docs);
        
        // 2. Merge, deduplicate, filter, sort and limit client-side
        const merged: Record<string, Notification> = {};
        resultsMap.forEach(docs => {
          docs.forEach(d => {
            merged[d.id] = d;
          });
        });

        const processed = Object.values(merged)
          .filter(n => n.status === "unread")
          .sort((a, b) => {
            const dateA = (a.createdAt as any)?.toDate?.() || new Date(0);
            const dateB = (b.createdAt as any)?.toDate?.() || new Date(0);
            return dateB.getTime() - dateA.getTime();
          });

        setNotifications(processed.slice(0, 20));
        setLoading(false);
      }, (err) => {
        // Log but don't crash
        console.error(`[NotificationBell] Query ${index} failed:`, err);
        setLoading(false);
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, entityId, user, membership, membershipLoading]);

  const unreadCount = notifications.length;

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
                notifications.map(n => (
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
    case 'safety': return "bg-teal-50 text-teal-700 border-teal-100";
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
