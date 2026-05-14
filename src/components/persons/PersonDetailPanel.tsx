"use client";

import { Person } from "@/types/person";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  User, Mail, Phone, Fingerprint, MapPin, 
  Calendar, Briefcase, UserCheck, Search, Link as LinkIcon 
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PersonTimeline } from "./PersonTimeline";
import { Separator } from "@/components/ui/separator";

interface PersonDetailPanelProps {
  entityId: string;
  person: Person | null;
}

export function PersonDetailPanel({ entityId, person }: PersonDetailPanelProps) {
  if (!person) return null;

  return (
    <Card className="h-full flex flex-col bg-white rounded-3xl border shadow-2xl shadow-primary/5 overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-6 md:p-8 space-y-8 pb-32">
          
          {/* Header Summary */}
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-primary leading-tight">{person.displayName}</h2>
                <div className="flex flex-wrap items-center gap-2">
                   <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">
                     ID: {person.personId}
                   </Badge>
                   {person.currentLifecycleStatus && (
                     <Badge className="bg-accent text-white text-[9px] uppercase font-black border-none h-5 px-2">
                       {person.currentLifecycleStatus}
                     </Badge>
                   )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <SummaryItem icon={Mail} label="Email" value={person.email} />
               <SummaryItem icon={Phone} label="Téléphone" value={person.phone || "Non renseigné"} />
               <SummaryItem icon={Fingerprint} label="Identifiant National" value={person.codiceFiscale} code />
               <SummaryItem icon={MapPin} label="Localisation" value={`${person.city || ""}, ${person.province || ""}`} />
            </div>
          </div>

          <Separator className="bg-slate-100" />

          {/* Connected Records */}
          <div className="space-y-4">
             <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Liens Actifs HR</p>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LinkCard 
                  icon={Search} 
                  label="Recrutement" 
                  value={person.currentCandidateId} 
                  subtitle="Candidature active"
                />
                <LinkCard 
                  icon={UserCheck} 
                  label="Collaborateur" 
                  value={person.currentEmployeeId} 
                  subtitle="Contrat en cours"
                />
             </div>
          </div>

          <Separator className="bg-slate-100" />

          {/* The Timeline */}
          <div className="space-y-6">
             <div className="flex items-center gap-2 px-1">
                <div className="bg-primary/5 p-1.5 rounded-lg text-primary">
                  <Calendar className="w-4 h-4" />
                </div>
                <h4 className="text-[11px] font-black uppercase text-primary tracking-wider">Parcours & Historique</h4>
             </div>
             
             <PersonTimeline entityId={entityId} personId={person.personId} />
          </div>

        </div>
      </ScrollArea>
    </Card>
  );
}

function SummaryItem({ icon: Icon, label, value, code = false }: { icon: any, label: string, value: string, code?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-tight opacity-70">{label}</p>
      <div className="flex items-center gap-2 text-primary font-bold text-xs">
         <Icon className="w-3 h-3 text-muted-foreground" />
         <span className={cn(code && "font-mono")}>{value}</span>
      </div>
    </div>
  );
}

function LinkCard({ icon: Icon, label, value, subtitle }: { icon: any, label: string, value: string | null, subtitle: string }) {
  if (!value) return (
    <div className="p-4 rounded-2xl border border-dashed border-slate-100 bg-slate-50/30 opacity-40">
       <p className="text-[9px] font-black text-muted-foreground uppercase">{label}</p>
       <p className="text-[10px] font-medium text-muted-foreground mt-0.5">Aucun lien</p>
    </div>
  );

  return (
    <div className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm ring-1 ring-primary/5">
       <div className="flex items-center gap-2 text-accent">
          <Icon className="w-3.5 h-3.5" />
          <p className="text-[9px] font-black uppercase">{label}</p>
       </div>
       <p className="text-[10px] font-bold text-primary mt-1 truncate">{value}</p>
       <p className="text-[8px] font-medium text-muted-foreground uppercase tracking-tight mt-0.5">{subtitle}</p>
    </div>
  );
}
