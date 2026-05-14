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

interface PersonTimelineProps {
  entityId: string;
  personId: string;
}

export function PersonTimeline({ entityId, personId }: PersonTimelineProps) {
  const { db } = useFirebase();

  const timelineQuery = useMemo(() => {
    if (!db || !entityId || !personId) return null;
    return query(
      collection(db, `entities/${entityId}/personTimeline`),
      where("personId", "==", personId),
      orderBy("createdAt", "desc")
    );
  }, [db, entityId, personId]);

  const { data: events, loading } = useCollection<any>(timelineQuery);

  if (loading) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary opacity-20" />
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="py-12 text-center bg-secondary/5 rounded-2xl border border-dashed">
         <Info className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
         <p className="text-xs text-muted-foreground font-medium">Aucun événement dans le parcours de cette personne.</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/20 before:via-primary/10 before:to-transparent">
      {events.map((event, i) => (
        <TimelineItem key={event.id || i} event={event} />
      ))}
    </div>
  );
}

function TimelineItem({ event }: { event: any }) {
  const config = getEventConfig(event.type);
  const Icon = config.icon;

  return (
    <div className="relative flex items-start gap-6 pl-0 sm:pl-0 animate-in fade-in slide-in-from-left-2 duration-300">
      {/* Icon Node */}
      <div className={cn(
        "relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 bg-white shadow-sm shrink-0",
        config.borderColor
      )}>
        <Icon className={cn("w-4 h-4", config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2 pt-1.5 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h5 className="text-xs font-black text-primary uppercase tracking-tight">
              {event.label || formatTypeToLabel(event.type)}
            </h5>
            {event.sourceCollection && (
              <Badge variant="outline" className="text-[8px] h-4 py-0 uppercase bg-slate-50 text-muted-foreground">
                {event.sourceCollection}
              </Badge>
            )}
          </div>
          <p className="text-[10px] font-bold text-muted-foreground italic">
            {formatDateTime(event.createdAt)}
          </p>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm shadow-primary/5">
           <p className="text-xs text-slate-600 leading-relaxed font-medium">
             {event.description || "Aucun détail disponible."}
           </p>
           {event.createdBy && (
             <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-50 text-[9px] font-black uppercase text-muted-foreground/60">
                <User className="w-2.5 h-2.5" />
                <span>Par: {event.createdBy === 'public_application' ? 'Candidat' : event.createdBy}</span>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function getEventConfig(type: string) {
  const configs: Record<string, any> = {
    "person.created": { icon: UserPlus, color: "text-blue-500", borderColor: "border-blue-100" },
    "candidate.created": { icon: ClipboardList, color: "text-indigo-500", borderColor: "border-indigo-100" },
    "candidate.review_started": { icon: MessageSquare, color: "text-orange-500", borderColor: "border-orange-100" },
    "candidate.shortlisted": { icon: StarIcon, color: "text-purple-500", borderColor: "border-purple-100" },
    "candidate.accepted": { icon: CheckCircle2, color: "text-green-500", borderColor: "border-green-100" },
    "candidate.rejected": { icon: XCircle, color: "text-red-500", borderColor: "border-red-100" },
    "interview.scheduled": { icon: Calendar, color: "text-cyan-500", borderColor: "border-cyan-100" },
    "interview.completed": { icon: FileBadge, color: "text-teal-500", borderColor: "border-teal-100" },
    "employee.created": { icon: UserCheck, color: "text-emerald-600", borderColor: "border-emerald-100" },
  };

  return configs[type] || { icon: Info, color: "text-muted-foreground", borderColor: "border-slate-100" };
}

function StarIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function formatTypeToLabel(type: string) {
  return type?.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || "Événement";
}

function formatDateTime(val: any): string {
  if (!val) return "Date non disponible";
  try {
    let date: Date;
    if (val && typeof val === 'object' && 'seconds' in val) {
      date = new Date(val.seconds * 1000);
    } else if (val instanceof Date) {
      date = val;
    } else {
      date = new Date(val);
    }
    if (isNaN(date.getTime())) return "Date non disponible";
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' 
    });
  } catch (e) {
    return "Date non disponible";
  }
}
