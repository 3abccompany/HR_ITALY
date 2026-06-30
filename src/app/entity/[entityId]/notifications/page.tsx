"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Bell, 
  CheckCircle2, 
  History, 
  Archive, 
  Loader2, 
  Filter, 
  X, 
  Search, 
  ChevronRight, 
  Inbox,
  AlertTriangle, 
  Info, 
  Clock, 
  Check, 
  ListFilter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebase, useUser } from "@/firebase";
import { collection, query, where, orderBy, onSnapshot, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Notification, NotificationStatus } from "@/types/notification";
import { markNotificationAsRead, archiveNotification, markAllNotificationsAsRead } from "@/services/notification.service";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { membership, loading: membershipLoading } = useActiveMembership(entityId);

  const [activeTab, setActiveTab] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual multi-query snapshot listener to handle Firestore IN limit (30)
  useEffect(() => {
    if (!db || !entityId || !user || !membership || membership.entityId !== entityId) {
      if (!membershipLoading) setLoading(false);
      return;
    }

    const baseRef = collection(db, `entities/${entityId}/notifications`);
    const statusFilter = activeTab === "active" ? ["unread", "read"] : ["archived"];

    // Define queries
    const queries: Query[] = [];

    // Query A: Direct target to user
    queries.push(query(
      baseRef,
      where("status", "in", statusFilter),
      where("targetUid", "==", user.uid),
      orderBy("createdAt", "desc")
    ));

    // Query B: Targeted to permissions (Chunked)
    if (membership.permissions && membership.permissions.length > 0) {
      const CHUNK_SIZE = 30;
      for (let i = 0; i < membership.permissions.length; i += CHUNK_SIZE) {
        const chunk = membership.permissions.slice(i, i + CHUNK_SIZE);
        queries.push(query(
          baseRef,
          where("status", "in", statusFilter),
          where("targetPermission", "in", chunk),
          orderBy("createdAt", "desc")
        ));
      }
    }

    const resultsMap = new Map<number, Notification[]>();
    setLoading(true);

    const unsubscribes = queries.map((q, index) => {
      return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Notification));
        resultsMap.set(index, docs);
        
        // Merge and deduplicate
        const merged: Record<string, Notification> = {};
        resultsMap.forEach(docs => {
          docs.forEach(d => {
            merged[d.id] = d;
          });
        });

        // Sort by date desc
        const sorted = Object.values(merged).sort((a, b) => {
          const dateA = (a.createdAt as any)?.toDate?.() || new Date();
          const dateB = (b.createdAt as any)?.toDate?.() || new Date();
          return dateB.getTime() - dateA.getTime();
        });

        setNotifications(sorted);
        setLoading(false);
      }, (err) => {
        console.error(`[NotificationsPage] Query ${index} failed:`, err);
        setLoading(false);
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, entityId, user, membership, membershipLoading, activeTab]);

  const filteredNotifications = useMemo(() => {
    if (!notifications) return [];
    if (!search) return notifications;
    const term = search.toLowerCase();
    return notifications.filter(n => 
      n.title.toLowerCase().includes(term) || 
      n.message.toLowerCase().includes(term)
    );
  }, [notifications, search]);

  const handleMarkRead = async (n: Notification) => {
    setLoadingActionId(n.id);
    try {
      await markNotificationAsRead(entityId, n.id);
    } catch (err) {
      toast({ variant: "destructive", title: "Erreur" });
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleArchive = async (n: Notification) => {
    setLoadingActionId(n.id);
    try {
      await archiveNotification(entityId, n.id);
      toast({ title: "Notification archivée" });
    } catch (err) {
      toast({ variant: "destructive", title: "Erreur" });
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (!user || !membership) return;
    try {
      await markAllNotificationsAsRead(entityId, user.uid, membership.permissions);
      toast({ title: "Toutes les notifications ont été marquées comme lues." });
    } catch (err) {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-primary tracking-tight">Centre de Notifications</h1>
          <p className="text-muted-foreground text-sm">Gérez vos alertes et communications internes.</p>
        </div>
        {activeTab === 'active' && notifications.some(n => n.status === 'unread') && (
          <Button onClick={handleMarkAllRead} variant="outline" className="rounded-xl font-bold bg-white gap-2 border-primary/20">
             <CheckCircle2 className="w-4 h-4" /> Tout marquer comme lu
          </Button>
        )}
      </header>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
           <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
             <TabsList className="bg-white border rounded-xl h-11 p-1">
                <TabsTrigger value="active" className="rounded-lg font-bold px-6">Actives</TabsTrigger>
                <TabsTrigger value="archived" className="rounded-lg font-bold px-6">Archivées</TabsTrigger>
             </TabsList>
           </Tabs>
           
           <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                className="pl-10 rounded-xl bg-white border-primary/10" 
                placeholder="Filtrer mes messages..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
        </div>

        <Card className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white">
           <Table>
              <TableHeader className="bg-secondary/10">
                 <TableRow>
                   <TableHead className="pl-8 w-[100px]">Gravité</TableHead>
                   <TableHead>Message</TableHead>
                   <TableHead>Catégorie</TableHead>
                   <TableHead>Date</TableHead>
                   <TableHead className="text-right pr-8">Actions</TableHead>
                 </TableRow>
              </TableHeader>
              <TableBody>
                 {loading ? (
                   <TableRow><TableCell colSpan={5} className="text-center py-20"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary/20" /></TableCell></TableRow>
                 ) : filteredNotifications.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-32 space-y-4">
                        <div className="bg-slate-50 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                           <Inbox className="w-10 h-10 text-slate-200" />
                        </div>
                        <div className="space-y-1">
                           <p className="font-bold text-slate-400 uppercase text-xs tracking-widest">Aucune notification</p>
                           <p className="text-xs text-slate-300">Votre boîte de réception est vide.</p>
                        </div>
                     </TableCell>
                   </TableRow>
                 ) : (
                   filteredNotifications.map(n => (
                     <TableRow key={n.id} className={cn("hover:bg-slate-50 transition-colors", n.status === 'unread' && "bg-primary/[0.02] shadow-[inset_4px_0_0_0_theme(colors.primary.DEFAULT)]")}>
                        <TableCell className="pl-8">
                           {getSeverityBadge(n.severity)}
                        </TableCell>
                        <TableCell className="py-5">
                           <div className="space-y-1">
                              <p className={cn("font-bold text-sm", n.status === 'unread' ? "text-slate-900" : "text-slate-600")}>{n.title}</p>
                              <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">{n.message}</p>
                           </div>
                        </TableCell>
                        <TableCell>
                           <Badge variant="outline" className="uppercase text-[9px] font-black tracking-tighter h-5 px-2 bg-slate-50 border-primary/5">
                             {n.category}
                           </Badge>
                        </TableCell>
                        <TableCell>
                           <div className="flex flex-col">
                             <span className="text-[10px] font-bold text-slate-700">{formatDate(n.createdAt)}</span>
                             <span className="text-[9px] text-muted-foreground opacity-60 uppercase">{formatTime(n.createdAt)}</span>
                           </div>
                        </TableCell>
                        <TableCell className="text-right pr-8">
                           <div className="flex justify-end gap-2">
                              {n.status === 'unread' && (
                                <Button variant="ghost" size="sm" onClick={() => handleMarkRead(n)} disabled={!!loadingActionId} className="h-8 rounded-lg font-bold text-primary hover:bg-primary/5">
                                   Lu
                                </Button>
                              )}
                              {n.actionUrl && (
                                <Button variant="secondary" size="sm" onClick={() => { handleMarkRead(n); router.push(n.actionUrl!); }} className="h-8 rounded-lg font-bold bg-primary/5 text-primary hover:bg-primary/10">
                                   Ouvrir
                                </Button>
                              )}
                              {activeTab === 'active' ? (
                                <Button variant="ghost" size="icon" onClick={() => handleArchive(n)} disabled={!!loadingActionId} className="h-8 w-8 text-muted-foreground hover:text-red-600">
                                   <Archive className="w-4 h-4" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" disabled className="h-8 px-2 text-[10px] font-bold uppercase opacity-40">Archivée</Button>
                              )}
                           </div>
                        </TableCell>
                     </TableRow>
                   ))
                 )}
              </TableBody>
           </Table>
        </Card>
      </div>
    </div>
  );
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case 'critical': return <Badge className="bg-red-600 text-white border-none text-[8px] font-black uppercase h-5 px-1.5 animate-pulse">Critique</Badge>;
    case 'warning': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[8px] font-black uppercase h-5 px-1.5">Alerte</Badge>;
    case 'success': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 text-[8px] font-black uppercase h-5 px-1.5">Succès</Badge>;
    default: return <Badge variant="outline" className="text-[8px] font-black uppercase h-5 px-1.5 border-primary/10">Info</Badge>;
  }
}

function formatDate(val: any) {
  if (!val) return "-";
  const d = val.toDate ? val.toDate() : new Date(val);
  return format(d, "dd/MM/yyyy", { locale: fr });
}

function formatTime(val: any) {
  if (!val) return "";
  const d = val.toDate ? val.toDate() : new Date(val);
  return format(d, "HH:mm", { locale: fr });
}
