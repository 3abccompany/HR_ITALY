"use client";

import { useMemo } from "react";
import { useCollection, useFirebase } from "@/firebase";
import { collection, query, where, orderBy } from "firebase/firestore";
import { 
  Loader2, CheckCircle2, UserPlus, ClipboardList, 
  Calendar, MessageSquare, AlertCircle, XCircle, 
  UserCheck, FileBadge, Info, User
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useActiveMembership } from "@/hooks/use-active-membership";

interface PersonTimelineProps {
  entityId: string;
  personId: string;
}

export function PersonTimeline({ entityId, personId }: PersonTimelineProps) {
  const { db } = useFirebase();
  const { membership, loading: membershipLoading } = useActiveMembership(entityId);

  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  const timelineQuery = useMemo(() => {
    if (!db || !entityId || !personId || !permissionsReady) return null;
    return query(
      collection(db, `entities/${entityId}/personTimeline`),
      where("personId", "==", personId),
      orderBy("createdAt", "desc")
    );
  }, [db, entityId, personId, permissionsReady]);

  const { data: events, loading } = useCollection<any>(timelineQuery, "person_timeline");

  if (loading || !permissionsReady) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary opacity-20" /></div>;
  }

  if (!events || events.length === 0) {
    return (
      <div className="py-12 text-center bg-secondary/5 rounded-2xl border border-dashed">
         <Info className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
         <p className="text-xs text-muted-foreground font-medium">Aucun événement dans le parcours.</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-8 pl-4 border-l-2 border-primary/10">
      {events.map((event, i) => (
        <div key={event.id || i} className="relative pl-6">
           <div className="absolute left-[-26px] top-0 w-4 h-4 rounded-full border-2 border-white bg-primary shadow-sm" />
           <div className="space-y-1">
              <div className="flex items-center justify-between">
                 <p className="text-xs font-black uppercase text-primary">{event.label}</p>
                 <span className="text-[10px] text-muted-foreground italic">{formatDateTime(event.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-600 font-medium">{event.description}</p>
           </div>
        </div>
      ))}
    </div>
  );
}

function formatDateTime(val: any): string {
  if (!val) return "Date non disponible";
  try {
    const date = val.toDate ? val.toDate() : new Date(val);
    return format(date, "dd/MM/yyyy HH:mm", { locale: fr });
  } catch (e) { return "Date non disponible"; }
}
import { format } from "date-fns";
import { fr } from "date-fns/locale";
