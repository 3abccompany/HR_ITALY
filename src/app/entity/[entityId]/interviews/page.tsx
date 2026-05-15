
"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  Calendar, Search, Plus, Edit, PowerOff, RefreshCcw, 
  Loader2, User, Briefcase, MapPin, CheckCircle2, 
  AlertCircle, MoreVertical, Star, MessageSquare, Mail, 
  Info, Eye, ChevronLeft, ChevronRight, List as ListIcon,
  Clock, MapPinned, UserCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  scheduleInterview, 
  updateInterview, 
  recordInterviewDecision,
  disableInterview, 
  reactivateInterview 
} from "@/services/interview.service";
import { Interview, InterviewStatus, InterviewDecision, InterviewType } from "@/types/interview";
import { Candidate } from "@/types/candidate";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  parseISO
} from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

const initialForm = {
  candidateId: "",
  scheduledAt: new Date().toISOString().slice(0, 16),
  interviewType: "video" as InterviewType,
  interviewerName: "",
  location: "",
  notes: ""
};

const defaultEmailSubject = "Convocation à un entretien — {{jobTitle}}";
const defaultEmailMessage = `Bonjour {{candidateName}},

Nous avons le plaisir de vous convier à un entretien pour le poste de {{jobTitle}} au sein de l'entreprise {{companyName}}.

Détails de votre rendez-vous :
- Date : {{interviewDate}}
- Heure : {{interviewTime}}
- Format/Lieu : {{locationOrLink}}

Votre interlocuteur sera : {{recruiterName}}.

Nous restons à votre disposition pour toute information complémentaire.

Cordialement,
L'équipe recrutement de {{companyName}}`;

const initialDecisionForm = {
  decision: "pending" as InterviewDecision,
  score: 3,
  feedback: ""
};

/**
 * Robust date parser for mixed Firestore/Admin/Corrupted formats.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    return null;
  }
  
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  
  return null;
}

export default function InterviewsManagementPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, entity, loading: membershipLoading } = useActiveMembership(entityId);

  // View State
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Form/Modal State
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isDecisionVisible, setIsDecisionVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [decidingId, setDecisionId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [emailConfig, setEmailConfig] = useState({
    enabled: true,
    subject: defaultEmailSubject,
    message: defaultEmailMessage
  });
  const [decisionData, setDecisionData] = useState(initialDecisionForm);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Permissions
  const canRead = hasPermission("interviews.read");
  const canCreate = hasPermission("interviews.create");
  const canUpdate = hasPermission("interviews.update");
  const canDecide = hasPermission("interviews.decide");
  const canReadCandidates = hasPermission("candidates.read");

  // Queries
  const interviewsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/interviews`), orderBy("scheduledAt", "desc")) as Query<Interview>;
  }, [db, entityId, canRead]);

  const candidatesQuery = useMemo(() => {
    if (!db || !entityId || !canReadCandidates || !isFormVisible || editingId) return null;
    return query(collection(db, `entities/${entityId}/candidates`), orderBy("createdAt", "desc")) as Query<Candidate>;
  }, [db, entityId, canReadCandidates, isFormVisible, editingId]);

  const { data: interviews, loading: loadingInterviews } = useCollection<Interview>(interviewsQuery);
  const { data: candidates, loading: loadingCandidates } = useCollection<Candidate>(candidatesQuery);

  const eligibleCandidates = useMemo(() => {
    return candidates?.filter(c => c.status === "interview_to_schedule") || [];
  }, [candidates]);

  // Filtering Logic
  const filteredInterviews = useMemo(() => {
    const term = search.toLowerCase();
    return interviews?.filter(i => 
      i.candidateDisplayName.toLowerCase().includes(term) || 
      i.positionApplied.toLowerCase().includes(term) ||
      i.interviewerName.toLowerCase().includes(term)
    ) || [];
  }, [interviews, search]);

  // Calendar Specific Memoized Data
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentMonth]);

  const interviewsByDate = useMemo(() => {
    const groups: Record<string, Interview[]> = {};
    filteredInterviews.forEach(i => {
      const d = parseSafeDate(i.scheduledAt);
      if (d) {
        const key = format(d, 'yyyy-MM-dd');
        if (!groups[key]) groups[key] = [];
        groups[key].push(i);
      }
    });
    return groups;
  }, [filteredInterviews]);

  const interviewsWithoutDate = useMemo(() => {
    return filteredInterviews.filter(i => !parseSafeDate(i.scheduledAt));
  }, [filteredInterviews]);

  // Handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleReset = () => {
    setFormData(initialForm);
    setDecisionData(initialDecisionForm);
    setEmailConfig({
      enabled: true,
      subject: defaultEmailSubject,
      message: defaultEmailMessage
    });
    setEditingId(null);
    setDecisionId(null);
    setIsFormVisible(false);
    setIsDecisionVisible(false);
  };

  const handleEdit = (i: Interview) => {
    setFormData({
      candidateId: i.candidateId,
      scheduledAt: i.scheduledAt,
      interviewType: i.interviewType,
      interviewerName: i.interviewerName,
      location: i.location || "",
      notes: i.notes || ""
    });
    setEditingId(i.interviewId);
    setIsFormVisible(true);
  };

  const handleOpenDecision = (i: Interview) => {
    setDecisionData({
      decision: i.decision || "pending",
      score: i.score || 3,
      feedback: i.feedback || ""
    });
    setDecisionId(i.interviewId);
    setIsDecisionVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    setLoading(true);
    try {
      if (editingId) {
        await updateInterview(entityId, editingId, formData, user.uid);
        toast({ title: "Mis à jour", description: "L'entretien a été modifié." });
      } else {
        await scheduleInterview(entityId, formData, user.uid, {
          ...emailConfig,
          companyName: entity?.nomEntreprise || "Notre Entreprise"
        });
        toast({ title: "Planifié", description: "L'entretien a été enregistré et le candidat notifié." });
      }
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId || !decidingId) return;

    setLoading(true);
    try {
      await recordInterviewDecision(entityId, decidingId, decisionData, user.uid);
      toast({ title: "Décision enregistrée", description: "L'entretien a été marqué comme terminé." });
      handleReset();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmDisable = async () => {
    if (!disablingId || !user) return;
    setLoading(true);
    try {
      await disableInterview(entityId, disablingId, user.uid);
      toast({ title: "Désactivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setDisablingId(null);
    }
  };

  const confirmReactivate = async () => {
    if (!reactivatingId || !user) return;
    setLoading(true);
    try {
      await reactivateInterview(entityId, reactivatingId, user.uid);
      toast({ title: "Réactivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
      setReactivatingId(null);
    }
  };

  const getEmailPreview = () => {
    const candidate = eligibleCandidates.find(c => c.candidateId === formData.candidateId);
    const dateObj = new Date(formData.scheduledAt);
    
    const data = {
      candidateName: candidate?.displayName || "[Nom du candidat]",
      jobTitle: candidate?.positionApplied || "[Titre du poste]",
      companyName: entity?.nomEntreprise || "[Nom de l'entreprise]",
      interviewDate: dateObj.toLocaleDateString('fr-FR', { dateStyle: 'long' }),
      interviewTime: dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      locationOrLink: formData.location || "[Lieu ou Lien]",
      recruiterName: formData.interviewerName || "[Nom du recruteur]"
    };

    let renderedSubject = emailConfig.subject;
    let renderedMessage = emailConfig.message;

    Object.entries(data).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      renderedSubject = renderedSubject.replace(regex, value);
      renderedMessage = renderedMessage.replace(regex, value);
    });

    return { renderedSubject, renderedMessage };
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-headline font-bold text-primary">Gestion des Entretiens</h1>
          <p className="text-muted-foreground text-sm">Planification et évaluation des candidats.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsFormVisible(true)} className="gap-2 shadow-lg shadow-primary/10">
            <Plus className="w-4 h-4" /> Nouvel entretien
          </Button>
        )}
      </div>

      <div className="space-y-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Rechercher par candidat, poste ou recruteur..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Tabs defaultValue="list" className="space-y-6">
          <div className="flex items-center justify-between bg-white/50 p-1 rounded-xl border border-primary/5">
            <TabsList className="grid w-[400px] grid-cols-2 h-10">
              <TabsTrigger value="list" className="gap-2">
                <ListIcon className="w-4 h-4" /> Liste
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-2">
                <Calendar className="w-4 h-4" /> Calendrier
              </TabsTrigger>
            </TabsList>
            
            {/* Contextual calendar counts */}
            <div className="px-4 hidden sm:block">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                {filteredInterviews.length} entretien{filteredInterviews.length > 1 ? 's' : ''} trouvé{filteredInterviews.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <TabsContent value="list" className="mt-0">
            <Card className="overflow-hidden border-primary/10 shadow-xl shadow-primary/5">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/20">
                    <TableHead>Candidat & Poste</TableHead>
                    <TableHead>Rendez-vous</TableHead>
                    <TableHead>Recruteur</TableHead>
                    <TableHead>Communication</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInterviews ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                  ) : filteredInterviews.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Aucun entretien trouvé.</TableCell></TableRow>
                  ) : (
                    filteredInterviews.map((i) => (
                      <TableRow key={i.interviewId} className="hover:bg-muted/50 transition-colors">
                        <TableCell>
                          <div className="font-bold text-primary">{i.candidateDisplayName}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase mt-1">
                            <Briefcase className="w-3 h-3" /> {i.positionApplied}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              <Calendar className="w-3.5 h-3.5 text-primary" /> {formatDateDisplay(i.scheduledAt)}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              {i.location && <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {i.location}</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs">
                            <User className="w-3 h-3 text-muted-foreground" />
                            {i.interviewerName || "N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getEmailStatusBadge(i.emailStatus)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(i.status)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canUpdate && (
                                <DropdownMenuItem onClick={() => handleEdit(i)} className="gap-2">
                                  <Edit className="w-4 h-4" /> Modifier
                                </DropdownMenuItem>
                              )}
                              {canDecide && i.status !== 'inactive' && (
                                <DropdownMenuItem onClick={() => handleOpenDecision(i)} className="gap-2 font-bold text-primary">
                                  <CheckCircle2 className="w-4 h-4" /> Décision
                                </DropdownMenuItem>
                              )}
                              {canUpdate && (
                                i.status !== 'inactive' ? (
                                  <DropdownMenuItem onClick={() => setDisablingId(i.interviewId)} className="gap-2 text-destructive">
                                    <PowerOff className="w-4 h-4" /> Désactiver
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => setReactivatingId(i.interviewId)} className="gap-2 text-green-600">
                                    <RefreshCcw className="w-4 h-4" /> Réactiver
                                  </DropdownMenuItem>
                                )
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="calendar" className="mt-0">
             <div className="space-y-6">
                <Card className="border-primary/10 shadow-xl shadow-primary/5 overflow-hidden">
                  <CardHeader className="bg-secondary/20 flex flex-row items-center justify-between border-b px-6 py-4">
                    <div className="flex items-center gap-4">
                      <h2 className="text-xl font-black text-primary uppercase tracking-tight">
                        {format(currentMonth, 'MMMM yyyy', { locale: fr })}
                      </h2>
                      <div className="flex items-center bg-white rounded-lg border shadow-sm p-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 px-3 text-[10px] font-black uppercase" onClick={() => setCurrentMonth(new Date())}>
                          Aujourd'hui
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-7 border-b bg-muted/30">
                      {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
                        <div key={day} className="py-2 text-center text-[10px] font-black uppercase text-muted-foreground tracking-widest border-r last:border-r-0">
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 border-l border-t">
                      {calendarDays.map((day, idx) => {
                        const dateKey = format(day, 'yyyy-MM-dd');
                        const dayInterviews = interviewsByDate[dateKey] || [];
                        const isCurrentMonth = isSameMonth(day, currentMonth);
                        const isToday = isSameDay(day, new Date());

                        return (
                          <div 
                            key={idx} 
                            className={cn(
                              "min-h-[140px] p-2 border-r border-b transition-colors group relative",
                              !isCurrentMonth ? "bg-slate-50/50 opacity-40" : "bg-white",
                              isToday && "bg-blue-50/20"
                            )}
                            onClick={() => dayInterviews.length > 0 && setSelectedDay(day)}
                          >
                            <div className="flex justify-between items-center mb-2">
                               <span className={cn(
                                 "text-[11px] font-bold px-1.5 py-0.5 rounded-full",
                                 isToday ? "bg-primary text-white" : "text-muted-foreground"
                               )}>
                                 {format(day, 'd')}
                               </span>
                               {dayInterviews.length > 0 && (
                                 <Badge variant="secondary" className="text-[8px] h-4 px-1 font-black bg-primary/5 text-primary border-none">
                                    {dayInterviews.length}
                                 </Badge>
                               )}
                            </div>

                            <div className="space-y-1">
                               {dayInterviews.slice(0, 3).map((interview) => (
                                 <button
                                   key={interview.interviewId}
                                   className={cn(
                                     "w-full text-left px-2 py-1 rounded text-[9px] font-bold border truncate transition-all hover:ring-2 ring-primary/20",
                                     getEventStatusClasses(interview)
                                   )}
                                   onClick={(e) => {
                                      e.stopPropagation();
                                      handleEdit(interview);
                                   }}
                                 >
                                    {format(parseSafeDate(interview.scheduledAt) || new Date(), 'HH:mm')} • {interview.candidateDisplayName}
                                 </button>
                               ))}
                               {dayInterviews.length > 3 && (
                                 <div className="text-[9px] font-black text-primary/60 text-center py-1 bg-secondary/30 rounded cursor-pointer hover:bg-secondary/50">
                                   + {dayInterviews.length - 3} autres
                                 </div>
                               )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {interviewsWithoutDate.length > 0 && (
                  <div className="bg-orange-50 border border-orange-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                       <AlertCircle className="w-5 h-5 text-orange-600" />
                       <h3 className="text-sm font-black uppercase text-orange-800 tracking-wider">Entretiens avec date invalide ({interviewsWithoutDate.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                       {interviewsWithoutDate.map(i => (
                         <div key={i.interviewId} className="bg-white p-3 rounded-xl border border-orange-200 shadow-sm flex items-center justify-between">
                            <div className="min-w-0">
                               <p className="text-xs font-bold text-slate-800 truncate">{i.candidateDisplayName}</p>
                               <p className="text-[10px] text-muted-foreground uppercase">{i.positionApplied}</p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(i)} className="h-8 w-8 text-orange-600 hover:bg-orange-50">
                               <Edit className="w-4 h-4" />
                            </Button>
                         </div>
                       ))}
                    </div>
                  </div>
                )}
             </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Day Detail Sheet */}
      <Sheet open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <SheetContent className="sm:max-w-[500px]">
          <SheetHeader className="pb-6 border-b">
             <div className="flex items-center gap-3">
                <div className="bg-primary p-2 rounded-xl text-white">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                   <SheetTitle className="text-xl font-black text-primary">
                     {selectedDay && format(selectedDay, 'EEEE d MMMM yyyy', { locale: fr })}
                   </SheetTitle>
                   <SheetDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Programme de la journée
                   </SheetDescription>
                </div>
             </div>
          </SheetHeader>
          
          <ScrollArea className="h-[calc(100vh-140px)] pr-4">
             <div className="py-8 space-y-6">
                {selectedDay && interviewsByDate[format(selectedDay, 'yyyy-MM-dd')]?.sort((a,b) => {
                   const da = parseSafeDate(a.scheduledAt)?.getTime() || 0;
                   const db = parseSafeDate(b.scheduledAt)?.getTime() || 0;
                   return da - db;
                }).map((i) => (
                  <div key={i.interviewId} className="group relative pl-8 border-l-2 border-primary/10 pb-8 last:pb-0">
                     <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full border-2 border-white bg-primary shadow-sm" />
                     <div className="space-y-3">
                        <div className="flex items-center justify-between">
                           <div className="flex items-center gap-2">
                             <Clock className="w-3.5 h-3.5 text-primary" />
                             <span className="text-sm font-black text-primary">
                               {format(parseSafeDate(i.scheduledAt) || new Date(), 'HH:mm')}
                             </span>
                           </div>
                           {getStatusBadge(i.status)}
                        </div>
                        
                        <Card className="border-primary/5 shadow-sm overflow-hidden group-hover:border-primary/20 transition-colors">
                           <CardContent className="p-4 space-y-3">
                              <div className="flex items-start justify-between">
                                 <div className="space-y-0.5">
                                    <h4 className="font-black text-slate-900 leading-tight">{i.candidateDisplayName}</h4>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{i.positionApplied}</p>
                                 </div>
                                 <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(i)}>
                                       <Eye className="w-4 h-4" />
                                    </Button>
                                    {canDecide && i.status !== 'inactive' && (
                                       <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleOpenDecision(i)}>
                                          <CheckCircle2 className="w-4 h-4" />
                                       </Button>
                                    )}
                                 </div>
                              </div>

                              <Separator className="bg-slate-50" />

                              <div className="grid grid-cols-2 gap-3">
                                 <DetailMini label="Recruteur" value={i.interviewerName} icon={UserCircle} />
                                 <DetailMini label="Format" value={i.interviewType} icon={MapPinned} />
                              </div>
                           </CardContent>
                        </Card>
                     </div>
                  </div>
                ))}
             </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog with Tabs */}
      <Dialog open={isFormVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier l'entretien" : "Planifier un entretien"}</DialogTitle>
            <DialogDescription>Configurez les détails et le message de convocation.</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSave}>
            <Tabs defaultValue="details" className="py-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details" className="gap-2"><Info className="w-4 h-4" /> Détails</TabsTrigger>
                <TabsTrigger value="email" className="gap-2"><Mail className="w-4 h-4" /> Message Candidat</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4 pt-4">
                {!editingId && (
                  <div className="space-y-2">
                    <Label>Candidat éligible</Label>
                    <Select value={formData.candidateId} onValueChange={(v) => setFormData(p => ({...p, candidateId: v}))}>
                      <SelectTrigger>
                        <SelectValue placeholder={loadingCandidates ? "Chargement..." : "Sélectionner un candidat"} />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleCandidates.map(c => (
                          <SelectItem key={c.candidateId} value={c.candidateId}>{c.displayName} — {c.positionApplied}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scheduledAt">Date et Heure</Label>
                    <Input id="scheduledAt" type="datetime-local" value={formData.scheduledAt} onChange={handleInputChange} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="interviewType">Type d'entretien</Label>
                    <Select value={formData.interviewType} onValueChange={(v) => setFormData(p => ({...p, interviewType: v as InterviewType}))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone">Téléphone</SelectItem>
                        <SelectItem value="video">Visioconférence</SelectItem>
                        <SelectItem value="onsite">Sur site</SelectItem>
                        <SelectItem value="technical">Technique</SelectItem>
                        <SelectItem value="hr">RH</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="interviewerName">Nom du Recruteur</Label>
                    <Input id="interviewerName" value={formData.interviewerName} onChange={handleInputChange} placeholder="Ex: Jean Dupont" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Lieu / Lien Meet</Label>
                    <Input id="location" value={formData.location} onChange={handleInputChange} placeholder="Ex: Google Meet ou Bureau 4" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes Internes (Préparation)</Label>
                  <Textarea id="notes" value={formData.notes} onChange={handleInputChange} placeholder="Points à aborder..." />
                </div>
              </TabsContent>

              <TabsContent value="email" className="space-y-6 pt-4">
                <div className="flex items-center space-x-2 bg-secondary/20 p-4 rounded-xl border border-dashed border-primary/20">
                  <Checkbox 
                    id="email-enabled" 
                    checked={emailConfig.enabled} 
                    onCheckedChange={(checked) => setEmailConfig(p => ({...p, enabled: !!checked}))} 
                  />
                  <Label htmlFor="email-enabled" className="text-sm font-bold cursor-pointer">Envoyer une convocation par email au candidat</Label>
                </div>

                {emailConfig.enabled && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Sujet de l'email</Label>
                        <Input value={emailConfig.subject} onChange={(e) => setEmailConfig(p => ({...p, subject: e.target.value}))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Corps du message</Label>
                        <Textarea 
                          value={emailConfig.message} 
                          onChange={(e) => setEmailConfig(p => ({...p, message: e.target.value}))} 
                          className="min-h-[250px] text-xs font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground italic">Variables: {'{{candidateName}}, {{jobTitle}}, {{interviewDate}}, {{interviewTime}}, {{locationOrLink}}, {{recruiterName}}'}</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <Label className="flex items-center gap-2 text-primary font-bold"><Eye className="w-4 h-4" /> Aperçu du rendu</Label>
                      <Card className="border-accent/20 bg-slate-50 h-[330px] overflow-y-auto">
                        <CardContent className="p-4 space-y-4">
                          <div className="border-b pb-2">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Sujet</p>
                            <p className="text-xs font-bold">{getEmailPreview().renderedSubject}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Message</p>
                            <div className="text-[11px] whitespace-pre-wrap leading-relaxed text-slate-700">
                              {getEmailPreview().renderedMessage}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || (!editingId && !formData.candidateId)}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
                {editingId ? "Enregistrer" : "Confirmer et Planifier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Decision Dialog */}
      <Dialog open={isDecisionVisible} onOpenChange={(open) => !open && handleReset()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Évaluation de l'entretien</DialogTitle>
            <DialogDescription>Enregistrez le résultat final.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveDecision} className="space-y-6 py-4">
            <div className="space-y-3">
              <Label>Score Global (0 à 5)</Label>
              <div className="flex items-center gap-4">
                <Slider value={[decisionData.score]} min={0} max={5} step={0.5} onValueChange={(v) => setDecisionData(p => ({...p, score: v[0]}))} className="flex-1" />
                <span className="text-xl font-bold text-primary">{decisionData.score}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Décision finale</Label>
              <Select value={decisionData.decision} onValueChange={(v) => setDecisionData(p => ({...p, decision: v as InterviewDecision}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">En attente / À revoir</SelectItem>
                  <SelectItem value="accepted">Retenu (À embaucher)</SelectItem>
                  <SelectItem value="rejected">Refusé</SelectItem>
                  <SelectItem value="on_hold">Vivier / Stand-by</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Feedback détaillé</Label>
              <Textarea value={decisionData.feedback} onChange={(e) => setDecisionData(p => ({...p, feedback: e.target.value}))} className="min-h-[120px]" placeholder="..." />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading}>Fermer</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Clôturer l'entretien
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Standard Confirmations */}
      <AlertDialog open={!!disablingId} onOpenChange={() => setDisablingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver l'entretien ?</AlertDialogTitle>
            <AlertDialogDescription>L'entretien sera marqué comme inactif.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDisable(); }} className="bg-red-600 hover:bg-red-700" disabled={loading}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivatingId} onOpenChange={() => setReactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurer l'entretien ?</AlertDialogTitle>
            <AlertDialogDescription>L'entretien redeviendra planifié.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmReactivate(); }} className="bg-green-600 hover:bg-green-700" disabled={loading}>Réactiver</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailMini({ label, value, icon: Icon }: { label: string, value: any, icon: any }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="truncate">{value || "N/A"}</span>
      </div>
    </div>
  );
}

function formatDateDisplay(val: any): string {
  const d = parseSafeDate(val);
  if (!d) return "Date non disponible";
  return format(d, "dd/MM/yyyy HH:mm", { locale: fr });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'scheduled': return <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[9px] font-bold">Planifié</Badge>;
    case 'completed': return <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 uppercase text-[9px] font-bold">Terminé</Badge>;
    case 'cancelled': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase text-[9px] font-bold">Annulé</Badge>;
    case 'inactive': return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 uppercase text-[9px] font-bold">Inactif</Badge>;
    default: return <Badge variant="outline" className="uppercase text-[9px] font-bold">{status}</Badge>;
  }
}

function getEmailStatusBadge(status: string | undefined) {
  switch (status) {
    case 'sent': return <Badge variant="outline" className="text-green-600 border-green-100 bg-green-50 gap-1 text-[9px]"><Mail className="w-3 h-3" /> Envoyé</Badge>;
    case 'queued': return <Badge variant="outline" className="text-blue-600 border-blue-100 bg-blue-50 gap-1 animate-pulse text-[9px]"><Loader2 className="w-3 h-3 animate-spin" /> Envoi...</Badge>;
    case 'failed': return <Badge variant="outline" className="text-red-600 border-red-100 bg-red-50 gap-1 text-[9px]"><AlertCircle className="w-3 h-3" /> Échec</Badge>;
    default: return null;
  }
}

function getEventStatusClasses(i: Interview) {
  if (i.status === 'completed') return "bg-green-50 border-green-100 text-green-700";
  if (i.status === 'cancelled') return "bg-red-50 border-red-100 text-red-700";
  if (i.status === 'inactive') return "bg-slate-50 border-slate-100 text-slate-400 opacity-60";
  return "bg-blue-50 border-blue-100 text-blue-700";
}

