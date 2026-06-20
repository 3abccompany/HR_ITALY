"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, Building2, MapPin, 
  Calendar, Briefcase, ShieldCheck, Search, AlertCircle,
  Link as LinkIcon, Euro, Clock, Save, Info, Plus, FileSignature
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useFirebase, useCollection, useUser, useAuth } from "@/firebase";
import { collection, query, orderBy, where, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { executeEmployeeIntake, findExistingPersonForIntake } from "@/services/employee-intake.service";
import { getLevelsForCcnlAction } from "@/app/actions/ccnl-actions";
import { Department, JobTitle } from "@/types/organization";
import { Worksite } from "@/types/worksite";
import { CCNL, CCNLLevel } from "@/types/ccnl";
import { JobProfile } from "@/types/job-profile";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const initialForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  birthDate: "",
  nationality: "Italienne",
  codiceFiscale: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  country: "Italie",
  
  employeeCode: "",
  departmentId: "",
  departmentName: "",
  jobProfileId: "",
  jobTitle: "",
  worksiteId: "",
  worksiteName: "",
  hireDate: new Date().toISOString().split('T')[0],
  
  contractType: "Tempo indeterminato",
  contractStartDate: "",
  contractEndDate: "",
  ccnlId: "",
  ccnlName: "",
  levelId: "",
  levelCode: "",
  weeklyHours: 40,
  grossMonthly: 0,
  monthlyPayments: 13,
  grossAnnual: 0,
  
  openingFerie: { report: 0, acquis: 0, utilisé: 0 },
  openingRol: { report: 0, acquis: 0, utilisé: 0 },
  openingExFest: { report: 0, acquis: 0, utilisé: 0 }
};

export default function EmployeeIntakePage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [searchingPerson, setSearchingPerson] = useState(false);
  const [existingPerson, setExistingPerson] = useState<any>(null);
  const [searchAttempted, setSearchAttempted] = useState(false);

  // Masters with index-safe ordering
  const deptsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc")) as Query<Department> : null, [db, entityId]);
  const worksitesQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/worksites`), orderBy("name", "asc")) as Query<Worksite> : null, [db, entityId]);
  const ccnlsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/ccnls`), orderBy("name", "asc")) as Query<CCNL> : null, [db, entityId]);
  const profilesQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("jobTitleName", "asc")) as Query<JobProfile> : null, [db, entityId]);

  const { data: rawDepartments } = useCollection<Department>(deptsQuery);
  const { data: rawWorksites } = useCollection<Worksite>(worksitesQuery);
  const { data: rawCcnls } = useCollection<CCNL>(ccnlsQuery);
  const { data: rawJobProfiles } = useCollection<JobProfile>(profilesQuery);

  // In-memory robust active filtering
  const isActiveStatus = (status?: string) => ['active', 'actif', 'ACTIVE'].includes(status || '');

  const departments = useMemo(() => rawDepartments?.filter(d => isActiveStatus(d.status)) || [], [rawDepartments]);
  const worksites = useMemo(() => rawWorksites?.filter(w => isActiveStatus(w.status)) || [], [rawWorksites]);
  const ccnls = useMemo(() => rawCcnls?.filter(c => isActiveStatus(c.status)) || [], [rawCcnls]);
  const jobProfiles = useMemo(() => rawJobProfiles?.filter(p => isActiveStatus(p.status)) || [], [rawJobProfiles]);

  const [activeLevels, setActiveLevels] = useState<any[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);

  const canCreate = hasPermission("employees.create") && hasPermission("contracts.create");

  // Load levels when CCNL changes
  useEffect(() => {
    async function fetchLevels() {
      if (!formData.ccnlId || !user) {
        setActiveLevels([]);
        return;
      }
      setLoadingLevels(true);
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const levels = await getLevelsForCcnlAction(entityId, formData.ccnlId, idToken!);
        setActiveLevels(levels);
      } catch (err) {
        console.error("Error fetching levels:", err);
      } finally {
        setLoadingLevels(false);
      }
    }
    fetchLevels();
  }, [formData.ccnlId, entityId, user, auth]);

  const handleSearchPerson = async () => {
    const identifier = formData.codiceFiscale || formData.email;
    if (!identifier) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez saisir un Code Fiscal ou un Email pour la recherche." });
      return;
    }

    setSearchingPerson(true);
    setSearchAttempted(true);
    try {
      const person = await findExistingPersonForIntake(entityId, identifier);
      if (person) {
        setExistingPerson(person);
        setFormData(p => ({
          ...p,
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          phone: person.phone || "",
          birthDate: person.dateOfBirth || "",
          codiceFiscale: person.codiceFiscale,
          address: person.address || "",
          city: person.city || "",
          province: person.province || "",
          postalCode: person.postalCode || "",
          country: person.country || "Italie"
        }));
        toast({ title: "Profil trouvé", description: "L'identité a été récupérée du registre." });
      } else {
        setExistingPerson(null);
        toast({ title: "Nouveau profil", description: "Aucune correspondance trouvée. Vous créez une nouvelle identité." });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchingPerson(false);
    }
  };

  const handleJobProfileChange = (profileId: string) => {
    const profile = jobProfiles.find(p => p.jobProfileId === profileId);
    if (!profile) return;

    setFormData(p => ({
      ...p,
      jobProfileId: profileId,
      jobTitle: profile.jobTitleName,
      departmentId: profile.departmentId || p.departmentId,
      departmentName: profile.departmentName || p.departmentName,
      // Prefill recommendations
      ccnlId: profile.defaultCcnlId || p.ccnlId,
      ccnlName: profile.defaultCcnlName || p.ccnlName,
      levelId: profile.defaultLevelId || p.levelId,
      levelCode: profile.defaultLevelCode || p.levelCode,
      weeklyHours: profile.defaultWeeklyHours || p.weeklyHours,
      monthlyPayments: profile.defaultMonthlyPayments || p.monthlyPayments,
      grossMonthly: profile.defaultMinimumGrossMonthly || p.grossMonthly,
      grossAnnual: (profile.defaultMinimumGrossMonthly || p.grossMonthly) * (profile.defaultMonthlyPayments || p.monthlyPayments)
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !entityId) return;

    if (!formData.ccnlId || !formData.levelId) {
      toast({ variant: "destructive", title: "Action bloquée", description: "Le CCNL et le niveau sont obligatoires pour créer un contrat actif." });
      return;
    }

    if (new Date(formData.hireDate) > new Date()) {
      toast({ variant: "destructive", title: "Date invalide", description: "La date d'embauche ne peut pas être dans le futur." });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        personId: existingPerson?.personId || null,
        isNewPerson: !existingPerson,
        intakeSource: "historical_import",
        departmentName: departments?.find(d => d.departmentId === formData.departmentId)?.name || "",
        worksiteName: worksites?.find(w => w.worksiteId === formData.worksiteId)?.name || "",
        ccnlName: ccnls?.find(c => c.ccnlId === formData.ccnlId)?.name || "",
        levelCode: activeLevels.find(l => l.levelId === formData.levelId)?.levelCode || formData.levelCode
      };

      await executeEmployeeIntake(entityId, payload, user.uid);
      toast({ title: "Importation réussie", description: "L'employé et son contrat actif ont été créés." });
      router.push(`/entity/${entityId}/employees`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!canCreate) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="bg-destructive/5 border-destructive/20 rounded-[2rem]">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Permissions "employees.create" et "contracts.create" requises.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" type="button" onClick={() => router.back()} className="rounded-full">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Reprise employé existant</h1>
          <p className="text-muted-foreground text-sm">Créez un dossier complet pour un collaborateur déjà en poste.</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Section 1: Identity */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-primary/5 border-b py-6 px-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
              <User className="w-4 h-4" /> 1. Identité & Vérification
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Code Fiscal (Italie) / ID</Label>
                <div className="flex gap-2">
                  <Input 
                    value={formData.codiceFiscale} 
                    onChange={(e) => setFormData(p => ({...p, codiceFiscale: e.target.value.toUpperCase()}))}
                    placeholder="Saisir pour vérifier..."
                    className="rounded-xl font-mono uppercase"
                  />
                  <Button type="button" onClick={handleSearchPerson} disabled={searchingPerson} variant="secondary" className="rounded-xl px-6">
                    {searchingPerson ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Email Personnel</Label>
                 <Input 
                   type="email" 
                   value={formData.email} 
                   onChange={(e) => setFormData(p => ({...p, email: e.target.value.toLowerCase()}))}
                   className="rounded-xl"
                 />
              </div>
            </div>

            {searchAttempted && (
               <div className={cn("p-4 rounded-2xl border flex items-center gap-3 transition-all", existingPerson ? "bg-blue-50 border-blue-100" : "bg-green-50 border-green-100")}>
                  {existingPerson ? <LinkIcon className="w-5 h-5 text-blue-600" /> : <Plus className="w-5 h-5 text-green-600" />}
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                       {existingPerson ? `Identité existante trouvée : ${existingPerson.displayName}` : "Nouvelle identité (création d'une fiche Personne)"}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase font-medium">
                       {existingPerson ? "Les données seront synchronisées with le profil existant." : "Une fiche Personne sera créée automatiquement."}
                    </p>
                  </div>
               </div>
            )}

            <Separator className="opacity-50" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Prénom</Label>
                 <Input value={formData.firstName} onChange={(e) => setFormData(p => ({...p, firstName: e.target.value}))} required className="rounded-xl" />
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Nom</Label>
                 <Input value={formData.lastName} onChange={(e) => setFormData(p => ({...p, lastName: e.target.value}))} required className="rounded-xl" />
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Date de naissance</Label>
                 <Input type="date" value={formData.birthDate} onChange={(e) => setFormData(p => ({...p, birthDate: e.target.value}))} className="rounded-xl" />
               </div>
               <div className="space-y-2">
                 <Label className="text-[10px] uppercase font-black">Téléphone</Label>
                 <Input value={formData.phone} onChange={(e) => setFormData(p => ({...p, phone: e.target.value}))} className="rounded-xl" />
               </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Employee */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-secondary/10 border-b py-6 px-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> 2. Contexte Professionnel
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Matricule / Code Interne</Label>
                  <Input value={formData.employeeCode} onChange={(e) => setFormData(p => ({...p, employeeCode: e.target.value}))} placeholder="Ex: E-00123" className="rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Date d'embauche réelle</Label>
                  <Input type="date" value={formData.hireDate} onChange={(e) => setFormData(p => ({...p, hireDate: e.target.value}))} required className="rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Lieu de travail</Label>
                  <Select value={formData.worksiteId} onValueChange={(v) => handleWorksiteChange(v)}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choisir site..." /></SelectTrigger>
                    <SelectContent>
                      {worksites.map(w => <SelectItem key={w.worksiteId} value={w.worksiteId}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Département</Label>
                  <Select value={formData.departmentId} onValueChange={(v) => setFormData(p => ({...p, departmentId: v}))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choisir dépt..." /></SelectTrigger>
                    <SelectContent>
                      {departments.map(d => <SelectItem key={d.departmentId} value={d.departmentId}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label className="text-[10px] uppercase font-black">Intitulé du poste (Fiche de Poste)</Label>
                  <Select value={formData.jobProfileId} onValueChange={handleJobProfileChange}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choisir une fiche de poste..." /></SelectTrigger>
                    <SelectContent>
                      {jobProfiles.map(jp => <SelectItem key={p.jobProfileId} value={jp.jobProfileId}>{jp.jobTitleName} ({jp.versionLabel})</SelectItem>)}
                      {jobProfiles.length === 0 && <SelectItem value="none" disabled>Aucune fiche de poste active</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
             </div>
          </CardContent>
        </Card>

        {/* Section 3: Contract */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-primary/5 border-b py-6 px-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
              <FileSignature className="w-4 h-4" /> 3. Contrat Actif (Classification mandatory)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-8">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Type de contrat</Label>
                  <Select value={formData.contractType} onValueChange={(v) => setFormData(p => ({...p, contractType: v}))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Tempo indeterminato", "Tempo determinato", "Apprendistato", "Stage"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Convention Collective (CCNL) *</Label>
                  <Select value={formData.ccnlId} onValueChange={(v) => handleCcnlChange(v)}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sélectionner CCNL..." /></SelectTrigger>
                    <SelectContent>
                      {ccnls.map(c => <SelectItem key={c.ccnlId} value={c.ccnlId}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Niveau de classification *</Label>
                  <Select value={formData.levelId} onValueChange={handleLevelChange} disabled={!formData.ccnlId || loadingLevels}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder={loadingLevels ? "Chargement..." : "Sélectionner niveau..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {activeLevels.map(l => <SelectItem key={l.levelId} value={l.levelId}>{l.levelCode} — {l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Heures hebdomadaires</Label>
                  <Input type="number" step="0.5" value={formData.weeklyHours} onChange={(e) => setFormData(p => ({...p, weeklyHours: parseFloat(e.target.value)}))} className="rounded-xl" />
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-dashed">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Brut Mensuel (€)</Label>
                  <Input type="number" value={formData.grossMonthly} onChange={(e) => {
                    const m = parseFloat(e.target.value) || 0;
                    setFormData(p => ({...p, grossMonthly: m, grossAnnual: m * p.monthlyPayments}));
                  }} className="rounded-xl font-bold" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Mensualités</Label>
                  <Input type="number" value={formData.monthlyPayments} onChange={(e) => {
                    const mp = parseInt(e.target.value) || 13;
                    setFormData(p => ({...p, monthlyPayments: mp, grossAnnual: p.grossMonthly * mp}));
                  }} className="rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black">Brut Annuel (RAL)</Label>
                  <div className="h-10 bg-slate-50 border rounded-xl flex items-center px-3 font-black text-primary">
                    € {formData.grossAnnual.toLocaleString('fr-FR')}
                  </div>
                </div>
             </div>
          </CardContent>
        </Card>

        {/* Section 4: Balances */}
        <Card className="border-primary/10 shadow-xl rounded-[2rem] overflow-hidden">
          <CardHeader className="bg-secondary/10 border-b py-6 px-8">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
              <Clock className="w-4 h-4" /> 4. Reprise des Soldes de Congés
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Ferie */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-blue-700 uppercase border-b pb-1">Congés / Ferie (Jours)</p>
                   <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                        <Input type="number" step="0.5" value={formData.openingFerie.report} onChange={(e) => setFormData(p => ({...p, openingFerie: {...p.openingFerie, report: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis YTD</Label>
                        <Input type="number" step="0.5" value={formData.openingFerie.acquis} onChange={(e) => setFormData(p => ({...p, openingFerie: {...p.openingFerie, acquis: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                   </div>
                   <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex justify-between items-center">
                      <span className="text-[10px] font-bold text-blue-800 uppercase">Restant initial</span>
                      <span className="font-black text-blue-700">{formData.openingFerie.report + formData.openingFerie.acquis} j</span>
                   </div>
                </div>

                {/* ROL */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-indigo-700 uppercase border-b pb-1">ROL (Heures)</p>
                   <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                        <Input type="number" step="0.5" value={formData.openingRol.report} onChange={(e) => setFormData(p => ({...p, openingRol: {...p.openingRol, report: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis YTD</Label>
                        <Input type="number" step="0.5" value={formData.openingRol.acquis} onChange={(e) => setFormData(p => ({...p, openingRol: {...p.openingRol, acquis: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                   </div>
                   <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 flex justify-between items-center">
                      <span className="text-[10px] font-bold text-indigo-800 uppercase">Restant initial</span>
                      <span className="font-black text-indigo-700">{formData.openingRol.report + formData.openingRol.acquis} h</span>
                   </div>
                </div>

                {/* Ex Fest */}
                <div className="space-y-4">
                   <p className="text-[11px] font-black text-teal-700 uppercase border-b pb-1">Ex Fest. (Heures)</p>
                   <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Report N-1</Label>
                        <Input type="number" step="0.5" value={formData.openingExFest.report} onChange={(e) => setFormData(p => ({...p, openingExFest: {...p.openingExFest, report: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground">Acquis YTD</Label>
                        <Input type="number" step="0.5" value={formData.openingExFest.acquis} onChange={(e) => setFormData(p => ({...p, openingExFest: {...p.openingExFest, acquis: parseFloat(e.target.value) || 0}}))} className="h-9" />
                      </div>
                   </div>
                   <div className="bg-teal-50 p-3 rounded-xl border border-teal-100 flex justify-between items-center">
                      <span className="text-[10px] font-bold text-teal-800 uppercase">Restant initial</span>
                      <span className="font-black text-teal-700">{formData.openingExFest.report + formData.openingExFest.acquis} h</span>
                   </div>
                </div>
             </div>
          </CardContent>
        </Card>

        {/* Footer Actions */}
        <div className="flex flex-col gap-4">
           {!formData.ccnlId && (
             <Alert variant="destructive" className="rounded-2xl">
               <AlertCircle className="h-4 w-4" />
               <AlertTitle>Action requise</AlertTitle>
               <AlertDescription>Le CCNL et le niveau sont obligatoires pour créer un contrat actif.</AlertDescription>
             </Alert>
           )}
           <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => router.back()} disabled={loading}>Annuler</Button>
              <Button type="submit" disabled={loading || !formData.ccnlId || !formData.levelId} className="h-14 px-12 rounded-2xl font-black shadow-xl shadow-primary/20 gap-2">
                 {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                 Intégrer le collaborateur
              </Button>
           </div>
        </div>
      </form>
    </div>
  );

  function handleWorksiteChange(id: string) {
    const w = worksites.find(item => item.worksiteId === id);
    setFormData(p => ({...p, worksiteId: id, worksiteName: w?.name || ""}));
  }

  function handleCcnlChange(ccnlId: string) {
    const ccnl = ccnls.find(c => c.ccnlId === ccnlId);
    setFormData(p => ({
      ...p,
      ccnlId,
      ccnlName: ccnl?.name || "",
      levelId: "",
      levelCode: "",
      weeklyHours: ccnl?.standardWeeklyHours || p.weeklyHours,
      monthlyPayments: ccnl?.monthlyPayments || p.monthlyPayments
    }));
  }

  function handleLevelChange(levelId: string) {
    const level = activeLevels.find(l => l.levelId === levelId);
    setFormData(p => ({
      ...p,
      levelId,
      levelCode: level?.levelCode || "",
      grossMonthly: level?.minimumGrossMonthly || p.grossMonthly,
      grossAnnual: (level?.minimumGrossMonthly || p.grossMonthly) * p.monthlyPayments
    }));
  }
}
