
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { 
  Loader2, User, Calendar, Clock, FolderOpen, 
  ShieldCheck, UserCircle, Briefcase, 
  MapPin, Building2, Fingerprint, Info,
  Calculator, Plane, Plus, RefreshCw,
  History, Send, CheckCircle2, XCircle, Ban,
  Save, AlertCircle, Upload, FileText
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useUser, useCollection, useAuth } from "@/firebase";
import { collection, query, where, limit, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Employee } from "@/types/employee";
import { 
  LeaveBalance, 
  normalizeBalance, 
  LeaveBalanceCounter, 
  TimeOffRequest, 
  TimeOffRequestType,
  TIME_OFF_TYPE_LABELS
} from "@/types/time-off";
import { submitTimeOffRequestAction, cancelTimeOffRequestAction } from "@/app/actions/time-off-actions";
import { calculateDuration } from "@/services/time-off.service";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const initialRequestForm = {
  requestType: "paid_leave" as TimeOffRequestType,
  startDate: new Date().toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0],
  startTime: "09:00",
  endTime: "10:00",
  dayPart: "full_day" as any,
  reason: ""
};

/**
 * Calculates decimal hours from HH:mm strings.
 */
function calculateDecimalHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const diff = (eH * 60 + eM) - (sH * 60 + sM);
  return Math.max(0, diff / 60);
}

export default function MySpacePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, entity, membership } = useActiveMembership(entityId);

  const currentYear = new Date().getFullYear();

  // --- States ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(initialRequestForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // --- Queries ---
  const employeeQuery = useMemo(() => {
    if (!db || !entityId || !user) return null;
    return query(
      collection(db, `entities/${entityId}/employees`), 
      where("userId", "==", user.uid),
      limit(1)
    );
  }, [db, entityId, user]);

  const { data: employeeData, loading: loadingEmployee } = useCollection<Employee>(employeeQuery as any, "my-space.profile");
  const employee = employeeData?.[0];

  const balanceQuery = useMemo(() => {
    if (!db || !entityId || !employee) return null;
    return query(
      collection(db, `entities/${entityId}/leaveBalances`),
      where("employeeId", "==", employee.employeeId),
      where("year", "==", currentYear),
      limit(1)
    );
  }, [db, entityId, employee, currentYear]);

  const { data: rawBalanceData, loading: loadingBalance } = useCollection<LeaveBalance>(balanceQuery as any, "my-space.balance");
  const balance = rawBalanceData?.[0] ? normalizeBalance(rawBalanceData[0]) : null;

  const requestsQuery = useMemo(() => {
    if (!db || !entityId || !employee) return null;
    return query(
      collection(db, `entities/${entityId}/timeOffRequests`),
      where("employeeId", "==", employee.employeeId),
      orderBy("createdAt", "desc")
    );
  }, [db, entityId, employee]);

  const { data: requests, loading: loadingRequests } = useCollection<TimeOffRequest>(requestsQuery as any, "my-space.requests");

  const isHourly = ["rol_permission", "ex_holiday_permission"].includes(requestForm.requestType);

  const calculatedHours = useMemo(() => {
    if (!isHourly) return 0;
    return calculateDecimalHours(requestForm.startTime, requestForm.endTime);
  }, [isHourly, requestForm.startTime, requestForm.endTime]);

  const calculatedDays = useMemo(() => {
    if (isHourly) return 0;
    return calculateDuration(requestForm.startDate, requestForm.endDate, requestForm.dayPart);
  }, [isHourly, requestForm.startDate, requestForm.endDate, requestForm.dayPart]);

  const isFormValid = () => {
    if (!employee) return false;
    if (isHourly) {
      if (!requestForm.startTime || !requestForm.endTime) return false;
      if (calculatedHours <= 0) return false;
    } else {
      if (!requestForm.startDate || !requestForm.endDate) return false;
      if (requestForm.endDate < requestForm.startDate) return false;
      if (calculatedDays <= 0) return false;
    }
    return true;
  };

  // --- Handlers ---
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId || !employee) return;

    setLoading(true);
    try {
      const idToken = await auth.currentUser!.getIdToken();
      
      // Step 1: Submit the request data
      const result = await submitTimeOffRequestAction({
        entityId,
        idToken,
        payload: {
          ...requestForm,
          durationHours: isHourly ? calculatedHours : undefined
        }
      });

      // Note: Full file upload integration requires documents.upload permission, 
      // which is usually restricted to HR. We report this safely.
      if (selectedFile) {
        toast({ 
          title: "Demande envoyée", 
          description: "Note : Le justificatif devra être transmis séparément à votre gestionnaire RH si l'accès direct est restreint." 
        });
      } else {
        toast({ title: "Demande envoyée", description: "Votre demande est en attente de validation RH." });
      }

      setIsFormOpen(false);
      setRequestForm(initialRequestForm);
      setSelectedFile(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de soumission", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!user || !entityId || !cancellingId) return;
    setLoading(true);
    try {
      const idToken = await auth.currentUser!.getIdToken();
      await cancelTimeOffRequestAction({
        entityId,
        idToken,
        requestId: cancellingId
      });
      toast({ title: "Demande annulée" });
      setCancellingId(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading || loadingEmployee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Accès à votre espace...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-12 pb-32">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
              <UserCircle className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Mon Espace Employé</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">Bienvenue dans votre portail RH personnel chez {entity?.nomEntreprise}.</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setIsFormOpen(true)} className="rounded-xl font-bold gap-2 shadow-lg shadow-primary/10">
             <Plus className="w-4 h-4" /> Nouvelle demande
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-12">
          
          {/* Main Leave Balances */}
          <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
             <CardHeader className="bg-primary/5 border-b py-6 px-8 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                   <Plane className="w-4 h-4" /> Solde Congés {currentYear}
                </CardTitle>
                <Badge variant="outline" className="bg-white border-primary/10 font-bold uppercase text-[10px]">Ferie (Congés)</Badge>
             </CardHeader>
             <CardContent className="p-8">
                {loadingBalance ? (
                   <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-primary/20" /></div>
                ) : balance?.counters?.paid_leave ? (
                   <div className="space-y-8">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <BalanceStat label="Report N-1" value={balance.counters.paid_leave.carriedOver} unit="j" />
                        <BalanceStat label={`Acquis ${currentYear}`} value={balance.counters.paid_leave.accrued} unit="j" />
                        <BalanceStat label="Déjà Pris" value={balance.counters.paid_leave.used} unit="j" color="red" />
                        <BalanceStat label="En attente RH" value={balance.counters.paid_leave.pending} unit="j" color="orange" />
                        <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10 text-center">
                           <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-1">Restant</p>
                           <p className="text-3xl font-black text-primary">{(balance.counters.paid_leave.remaining).toFixed(1)}</p>
                           <p className="text-[8px] font-bold text-primary/40 uppercase">jours</p>
                        </div>
                      </div>

                      {balance.counters.paid_leave.pending > 0 && (
                        <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                           <div className="flex items-center gap-3">
                              <Info className="w-4 h-4 text-orange-600" />
                              <p className="text-xs font-bold text-orange-800 uppercase tracking-tight">Disponible si demandes en attente acceptées</p>
                           </div>
                           <span className="text-sm font-black text-orange-600">{(balance.counters.paid_leave.remaining - balance.counters.paid_leave.pending).toFixed(1)} j</span>
                        </div>
                      )}
                   </div>
                ) : (
                   <div className="py-8 text-center bg-secondary/5 rounded-2xl border border-dashed">
                      <Calculator className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground font-medium">Votre solde n'a pas encore été initialisé pour {currentYear}.</p>
                   </div>
                )}
             </CardContent>
          </Card>

          {/* ROL & Ex-Festività secondary balances */}
          {balance?.counters && (balance.counters.rol.carriedOver > 0 || balance.counters.rol.accrued > 0 || balance.counters.ex_holidays.carriedOver > 0 || balance.counters.ex_holidays.accrued > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <SecondaryBalanceCard 
                 title="ROL (Heures)" 
                 counter={balance.counters.rol} 
                 icon={RefreshCw} 
                 color="indigo" 
                 year={currentYear}
               />
               <SecondaryBalanceCard 
                 title="Ex Festività (Heures)" 
                 counter={balance.counters.ex_holidays} 
                 icon={Calendar} 
                 color="teal" 
                 year={currentYear}
               />
            </div>
          )}

          {/* Request History */}
          <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden bg-white">
             <CardHeader className="bg-secondary/10 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                   <History className="w-4 h-4" /> Mes Demandes
                </CardTitle>
             </CardHeader>
             <CardContent className="p-0">
                <Table>
                   <TableHeader className="bg-slate-50/50">
                      <TableRow>
                        <TableHead className="pl-8 text-[10px] font-black uppercase tracking-widest">Type & Période</TableHead>
                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Durée</TableHead>
                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Statut</TableHead>
                        <TableHead className="text-right pr-8 text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
                      </TableRow>
                   </TableHeader>
                   <TableBody>
                      {loadingRequests ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary/20" /></TableCell></TableRow>
                      ) : !requests || requests.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-16 text-muted-foreground italic text-xs">Aucune demande effectuée.</TableCell></TableRow>
                      ) : (
                        requests.map(r => (
                          <TableRow key={r.requestId} className="hover:bg-muted/50 transition-colors">
                             <TableCell className="pl-8 py-4">
                                <p className="font-bold text-slate-800 text-sm">{TIME_OFF_TYPE_LABELS[r.requestType]}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                   {formatDate(r.startDate)} {r.endDate !== r.startDate ? ` au ${formatDate(r.endDate)}` : ''}
                                </p>
                                {r.unit === 'hours' && r.startTime && r.endTime && (
                                  <p className="text-[9px] font-bold text-primary/60 uppercase tracking-tighter mt-0.5">
                                    Créneau : {r.startTime} — {r.endTime}
                                  </p>
                                )}
                             </TableCell>
                             <TableCell>
                                <span className="font-black text-xs text-primary">
                                   {r.unit === 'hours' ? `${r.durationHours} h` : `${r.durationDays} j`}
                                </span>
                             </TableCell>
                             <TableCell>
                                <div className="flex flex-col gap-1">
                                   {getStatusBadge(r.status)}
                                   {r.justificationStatus === 'provided' && (
                                      <span className="text-[8px] font-black text-green-600 uppercase flex items-center gap-1">
                                         <FileText className="w-2 h-2" /> Justificatif joint
                                      </span>
                                   )}
                                </div>
                             </TableCell>
                             <TableCell className="text-right pr-8">
                                {r.status === 'submitted' && (
                                  <Button variant="ghost" size="sm" onClick={() => setCancellingId(r.requestId)} className="text-destructive font-bold h-8 rounded-lg hover:bg-red-50">
                                     Annuler
                                  </Button>
                                )}
                             </TableCell>
                          </TableRow>
                        ))
                      )}
                   </TableBody>
                </Table>
             </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-primary/5 bg-white shadow-xl shadow-primary/5 overflow-hidden">
            <CardHeader className="bg-primary/5 border-b py-6 px-8">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <User className="w-4 h-4" /> Mon Profil
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              {employee ? (
                <div className="space-y-4">
                  <DetailItem label="Nom Complet" value={employee.displayName} icon={User} />
                  <DetailItem label="Matricule" value={employee.employeeCode} icon={Fingerprint} />
                  <DetailItem label="Poste" value={employee.jobTitle} icon={Briefcase} />
                  <DetailItem label="Département" value={employee.departmentName} icon={Building2} />
                  <DetailItem label="Site" value={employee.worksiteName} icon={MapPin} />
                  <DetailItem label="Date d'embauche" value={employee.hireDate} icon={Calendar} />
                </div>
              ) : (
                <div className="py-8 text-center space-y-3 opacity-60">
                   <Info className="w-10 h-10 mx-auto text-muted-foreground/30" />
                   <p className="text-sm font-medium">Informations de profil en cours...</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-primary/10 bg-primary/95 text-white overflow-hidden shadow-lg">
             <CardContent className="p-8 flex flex-col items-center text-center space-y-4">
                <div className="bg-white/10 p-4 rounded-full">
                  <FolderOpen className="w-8 h-8 text-white" />
                </div>
                <div className="space-y-1">
                   <h4 className="font-bold text-sm uppercase tracking-widest">Mes Documents</h4>
                   <p className="text-[10px] opacity-70">Accédez à vos contrats et bulletins de paie.</p>
                </div>
                <Badge variant="outline" className="border-white/20 text-white text-[9px] font-black uppercase">Bientôt disponible</Badge>
             </CardContent>
          </Card>
        </div>
      </div>

      {/* Creation Modal - Improved Scrollable Layout */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[550px] flex flex-col h-[100dvh] max-h-[100dvh] md:h-auto md:max-h-[85vh] p-0 rounded-[2rem] overflow-hidden">
          <DialogHeader className="p-8 pb-4 shrink-0">
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
               <Plane className="w-5 h-5 text-accent" /> Nouvelle demande
            </DialogTitle>
            <DialogDescription>Remplissez les détails de votre demande de temps libre.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-8 py-4 min-h-0">
            <form id="request-form" onSubmit={handleCreateRequest} className="space-y-6 pb-8">
               <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground">Type de demande</Label>
                  <Select value={requestForm.requestType} onValueChange={(v: any) => {
                    setRequestForm(p => ({...p, requestType: v}));
                    setSelectedFile(null);
                  }}>
                     <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectItem value="paid_leave">Congé (Ferie)</SelectItem>
                        <SelectItem value="rol_permission">Permission ROL</SelectItem>
                        <SelectItem value="ex_holiday_permission">Ex Festività</SelectItem>
                        <SelectItem value="sickness">Maladie</SelectItem>
                     </SelectContent>
                  </Select>
               </div>

               <div className="space-y-4">
                  {!isHourly ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black">Date de début</Label>
                          <Input type="date" value={requestForm.startDate} onChange={(e) => setRequestForm(p => ({...p, startDate: e.target.value}))} required className="rounded-xl h-11" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black">Date de fin</Label>
                          <Input type="date" value={requestForm.endDate} onChange={(e) => setRequestForm(p => ({...p, endDate: e.target.value}))} required className="rounded-xl h-11" />
                        </div>
                      </div>
                      {requestForm.requestType === "paid_leave" && (
                        <div className="space-y-2">
                           <Label className="text-[10px] uppercase font-black">Partie de la journée</Label>
                           <Select value={requestForm.dayPart} onValueChange={(v) => setRequestForm(p => ({...p, dayPart: v}))}>
                              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                 <SelectItem value="full_day">Journée entière</SelectItem>
                                 <SelectItem value="morning">Matinée</SelectItem>
                                 <SelectItem value="afternoon">Après-midi</SelectItem>
                              </SelectContent>
                           </Select>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-black">Date de la permission</Label>
                        <Input type="date" value={requestForm.startDate} onChange={(e) => setRequestForm(p => ({...p, startDate: e.target.value, endDate: e.target.value}))} required className="rounded-xl h-11" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black">De (Heure début)</Label>
                          <Input type="time" value={requestForm.startTime} onChange={(e) => setRequestForm(p => ({...p, startTime: e.target.value}))} required className="rounded-xl h-11" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] uppercase font-black">À (Heure fin)</Label>
                          <Input type="time" value={requestForm.endTime} onChange={(e) => setRequestForm(p => ({...p, endTime: e.target.value}))} required className="rounded-xl h-11" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-4 bg-secondary/20 rounded-2xl border border-dashed flex justify-between items-center">
                     <span className="text-[10px] font-black uppercase text-primary/60">Durée calculée (Sans Dimanches)</span>
                     <span className={cn("text-sm font-black", 
                       (isHourly ? calculatedHours : calculatedDays) <= 0 ? "text-red-500" : "text-primary"
                     )}>
                        {isHourly ? `${calculatedHours.toFixed(2).replace(/\.00$/, "")} h` : `${calculatedDays} j`}
                     </span>
                  </div>
               </div>

               {requestForm.requestType === 'sickness' && (
                 <div className="space-y-3 p-5 bg-orange-50 border border-orange-100 rounded-[1.5rem] animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-1">
                       <FileText className="w-4 h-4 text-orange-600" />
                       <Label className="text-xs font-black uppercase text-orange-800 tracking-tight">Justificatif médical</Label>
                    </div>
                    <div className="flex flex-col gap-2">
                       <Input 
                         type="file" 
                         accept=".pdf,.png,.jpg,.jpeg" 
                         className="bg-white rounded-xl h-11 pt-2.5 cursor-pointer file:font-black file:text-[10px] file:uppercase file:bg-orange-100 file:text-orange-700 file:border-none file:rounded-md file:mr-4 hover:bg-orange-100/50 transition-colors"
                         onChange={(e) => {
                           const file = e.target.files?.[0];
                           if (file && file.size > 10 * 1024 * 1024) {
                             toast({ variant: "destructive", title: "Fichier trop volumineux", description: "La taille maximum est de 10 Mo." });
                             e.target.value = "";
                             return;
                           }
                           setSelectedFile(file || null);
                         }} 
                       />
                       <p className="text-[10px] text-orange-700 leading-relaxed font-medium">
                          Note : En raison des permissions de sécurité, l'envoi direct de fichiers est restreint. Veuillez également transmettre le document à votre gestionnaire RH.
                       </p>
                    </div>
                 </div>
               )}

               <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Commentaire (Optionnel)</Label>
                  <Textarea value={requestForm.reason} onChange={(e) => setRequestForm(p => ({...p, reason: e.target.value}))} placeholder="Détails complémentaires..." className="rounded-xl min-h-[80px]" />
               </div>
            </form>
          </div>

          <DialogFooter className="p-8 border-t bg-slate-50 shrink-0 flex gap-2">
             <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} disabled={loading}>Annuler</Button>
             <Button form="request-form" type="submit" disabled={!isFormValid() || loading} className="rounded-xl font-black px-8 shadow-lg shadow-primary/10">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />} Envoyer la demande
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation */}
      <AlertDialog open={!!cancellingId} onOpenChange={(o) => !o && setCancellingId(null)}>
         <AlertDialogContent className="rounded-[2rem]">
            <AlertDialogHeader>
               <AlertDialogTitle>Annuler votre demande ?</AlertDialogTitle>
               <AlertDialogDescription>Cette action retirera votre demande de la file d'attente RH.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
               <AlertDialogCancel disabled={loading}>Retour</AlertDialogCancel>
               <AlertDialogAction onClick={handleCancel} disabled={loading} className="bg-destructive hover:bg-destructive/90 text-white font-bold rounded-xl">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Ban className="w-4 h-4 mr-2" />} Confirmer l'annulation
               </AlertDialogAction>
            </AlertDialogFooter>
         </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

function BalanceStat({ label, value, unit, color }: { label: string, value: number, unit: string, color?: string }) {
   return (
      <div className="text-center p-2 rounded-xl bg-slate-50/50 border border-slate-100/50">
         <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest mb-1 whitespace-nowrap overflow-hidden text-ellipsis">{label}</p>
         <p className={cn("text-xl font-black", 
           color === 'red' ? "text-red-600" : 
           color === 'orange' ? "text-orange-600" : "text-slate-700"
         )}>{(value || 0).toFixed(1)}</p>
         <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-50">{unit}</p>
      </div>
   );
}

function SecondaryBalanceCard({ title, counter, icon: Icon, color, year }: { title: string, counter: LeaveBalanceCounter, icon: any, color: string, year: number }) {
  const colorMap: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-100",
    teal: "text-teal-600 bg-teal-50 border-teal-100"
  };

  const netAvailable = counter.remaining - counter.pending;

  return (
    <Card className="rounded-3xl border-primary/5 bg-white shadow-sm overflow-hidden">
      <CardHeader className="py-4 px-6 bg-slate-50/50 border-b">
         <CardTitle className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
            <Icon className="w-3.5 h-3.5" /> {title}
         </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
         <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
               <div className="text-center">
                  <p className="text-[8px] font-black text-muted-foreground uppercase">Report N-1</p>
                  <p className="text-sm font-bold text-slate-700">{counter.carriedOver.toFixed(1)}</p>
               </div>
               <div className="text-center">
                  <p className="text-[8px] font-black text-muted-foreground uppercase">Acquis {year}</p>
                  <p className="text-sm font-bold text-slate-700">{counter.accrued.toFixed(1)}</p>
               </div>
               <div className="text-center">
                  <p className="text-[8px] font-black text-muted-foreground uppercase">Déjà pris</p>
                  <p className="text-sm font-bold text-red-600">{counter.used.toFixed(1)}</p>
               </div>
               <div className="text-center">
                  <p className="text-[8px] font-black text-muted-foreground uppercase">En attente RH</p>
                  <p className="text-sm font-bold text-orange-600">{counter.pending.toFixed(1)}</p>
               </div>
            </div>
            
            <div className="flex items-center justify-between pt-4 border-t border-dashed">
               <div className="space-y-0.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Restant</p>
                  <p className="text-sm font-black text-primary">{counter.remaining.toFixed(1)} {counter.unit}</p>
               </div>
               {counter.pending > 0 && (
                  <div className={cn("px-3 py-1 rounded-xl border text-right", colorMap[color])}>
                     <p className="text-[7px] font-black uppercase opacity-60 leading-none">Disponible si validé</p>
                     <p className="text-sm font-black leading-none mt-1">{netAvailable.toFixed(1)} {counter.unit}</p>
                  </div>
               )}
            </div>
         </div>
      </CardContent>
    </Card>
  );
}

function DetailItem({ label, value, icon: Icon }: any) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest opacity-60">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <Icon className="w-3.5 h-3.5 text-primary/30" />
        <span className="truncate">{value || "Non renseigné"}</span>
      </div>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'submitted': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] h-5">En attente RH</Badge>;
    case 'approved': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white text-[10px] h-5">Acceptée</Badge>;
    case 'rejected': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5">Refusée</Badge>;
    case 'cancelled': return <Badge variant="outline" className="bg-slate-50 text-slate-400 border-slate-200 text-[10px] h-5">Annulée</Badge>;
    default: return <Badge variant="outline" className="text-[10px] h-5">{status}</Badge>;
  }
}

function formatDate(val: string) {
  if (!val) return "-";
  try {
    return format(parseISO(val), "dd/MM/yyyy", { locale: fr });
  } catch (e) { return "-"; }
}
