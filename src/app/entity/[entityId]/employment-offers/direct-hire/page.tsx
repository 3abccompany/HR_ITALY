"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Briefcase, CheckCircle2, Euro, FileSignature, Loader2, UserPlus } from "lucide-react";
import { collection, orderBy, query, Query, where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { useAuth, useCollection, useFirebase, useUser } from "@/firebase";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useOneShotSubmission } from "@/hooks/use-one-shot-submission";
import { useToast } from "@/hooks/use-toast";
import { getLevelsForCcnlAction } from "@/app/actions/ccnl-actions";
import { createDirectHireOfferAction } from "./actions";
import { Department } from "@/types/organization";
import { Worksite } from "@/types/worksite";
import { CCNL } from "@/types/ccnl";
import { JobProfile } from "@/types/job-profile";
import { RecruitmentNeed } from "@/types/recruitment-need";
import { cn } from "@/lib/utils";

type PayCalculationMode = "monthly" | "actual_worked_hours";

const PAY_CALCULATION_MODE_OPTIONS: Array<{ value: PayCalculationMode; label: string; description: string }> = [
  {
    value: "monthly",
    label: "Mensualisé",
    description: "Base mensuelle contractuelle avec le brut mensuel de référence.",
  },
  {
    value: "actual_worked_hours",
    label: "Heures réellement travaillées",
    description: "Le futur calcul mensuel utilisera les heures validées et le taux horaire applicable.",
  },
];

const initialForm = {
  firstName: "",
  lastName: "",
  codiceFiscale: "",
  email: "",
  phone: "",
  birthDate: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  country: "Italie",
  departmentId: "",
  departmentName: "",
  worksiteId: "",
  worksiteName: "",
  worksiteAddress: "",
  recruitmentNeedId: "",
  recruitmentNeedTitle: "",
  jobProfileId: "",
  jobTitleName: "",
  contractType: "Tempo indeterminato",
  startDate: new Date().toISOString().split("T")[0],
  endDate: "",
  ccnlId: "",
  ccnlName: "",
  cnelCode: "",
  levelId: "",
  levelCode: "",
  levelLabel: "",
  qualificationLabel: "",
  weeklyHours: 40,
  workingTime: "Tempo pieno (Full-time)",
  trialPeriodDays: 30,
  monthlyPayments: 13,
  hourlyDivisor: 0,
  grossMonthly: 0,
  grossHourly: 0,
  grossAnnual: 0,
  payCalculationMode: "monthly" as PayCalculationMode,
  notes: "",
};

function isActiveStatus(status?: string) {
  return ["active", "actif", "ACTIVE"].includes(status || "");
}

function toSafeNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : fallback;
}

function calculateGrossAnnual(grossMonthly: unknown, monthlyPayments: unknown) {
  return Math.round(toSafeNumber(grossMonthly) * toSafeNumber(monthlyPayments, 13) * 100) / 100;
}

function getRecruitmentNeedTitle(need: RecruitmentNeed) {
  return need.recruitmentNeedTitle || [need.jobTitleName, need.departmentName].filter(Boolean).join(" — ") || need.needId;
}

function getRecruitmentNeedOptionLabel(need: RecruitmentNeed) {
  const title = getRecruitmentNeedTitle(need);
  const remaining = typeof need.remainingHeadcount === "number" ? ` · ${need.remainingHeadcount} restant(s)` : "";
  return `${title}${remaining}`;
}

export default function DirectHireOfferPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const { tryStartSubmission, resetSubmission } = useOneShotSubmission();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [formData, setFormData] = useState(initialForm);
  const [activeLevels, setActiveLevels] = useState<any[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(false);
  const [levelsError, setLevelsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const departmentsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/departments`), orderBy("name", "asc")) as Query<Department> : null, [db, entityId]);
  const worksitesQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/worksites`), orderBy("name", "asc")) as Query<Worksite> : null, [db, entityId]);
  const ccnlsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/ccnls`), orderBy("name", "asc")) as Query<CCNL> : null, [db, entityId]);
  const profilesQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/jobProfiles`), orderBy("jobTitleName", "asc")) as Query<JobProfile> : null, [db, entityId]);
  const recruitmentNeedsQuery = useMemo(() => db ? query(collection(db, `entities/${entityId}/recruitmentNeeds`), where("status", "in", ["open", "partially_fulfilled"])) as Query<RecruitmentNeed> : null, [db, entityId]);

  const { data: rawDepartments } = useCollection<Department>(departmentsQuery, "directHire.departments");
  const { data: rawWorksites } = useCollection<Worksite>(worksitesQuery, "directHire.worksites");
  const { data: rawCcnls } = useCollection<CCNL>(ccnlsQuery, "directHire.ccnls");
  const { data: rawJobProfiles } = useCollection<JobProfile>(profilesQuery, "directHire.jobProfiles");
  const { data: rawRecruitmentNeeds } = useCollection<RecruitmentNeed>(recruitmentNeedsQuery, "directHire.recruitmentNeeds");

  const departments = useMemo(() => rawDepartments?.filter((d) => isActiveStatus(d.status)) || [], [rawDepartments]);
  const worksites = useMemo(() => rawWorksites?.filter((w) => isActiveStatus(w.status)) || [], [rawWorksites]);
  const ccnls = useMemo(() => rawCcnls?.filter((c) => isActiveStatus(c.status)) || [], [rawCcnls]);
  const jobProfiles = useMemo(() => rawJobProfiles?.filter((p) => isActiveStatus(p.status)) || [], [rawJobProfiles]);
  const recruitmentNeeds = useMemo(() => rawRecruitmentNeeds || [], [rawRecruitmentNeeds]);

  const canCreateDirectHire = hasPermission("contracts.create");

  useEffect(() => {
    async function fetchLevels() {
      if (!formData.ccnlId || !user) {
        setActiveLevels([]);
        setLevelsError(null);
        return;
      }

      setLoadingLevels(true);
      setLevelsError(null);
      try {
        const currentUser = auth.currentUser;
        const idToken = await currentUser?.getIdToken(true);
        if (!idToken) throw new Error("Session expirée. Veuillez vous reconnecter.");
        const levels = await getLevelsForCcnlAction(entityId, formData.ccnlId, idToken);
        setActiveLevels(levels);
      } catch (err: any) {
        setActiveLevels([]);
        setLevelsError(err.message || "Impossible de charger les niveaux CCNL.");
      } finally {
        setLoadingLevels(false);
      }
    }

    fetchLevels();
  }, [auth, entityId, formData.ccnlId, user]);

  const handleJobProfileChange = (profileId: string) => {
    const profile = jobProfiles.find((item) => item.jobProfileId === profileId);
    if (!profile) return;
    const linkedCcnl = profile.defaultCcnlId ? ccnls.find((item) => item.ccnlId === profile.defaultCcnlId) : undefined;
    const monthlyPayments = toSafeNumber(linkedCcnl?.monthlyPayments || profile.defaultMonthlyPayments || formData.monthlyPayments, 13);
    const grossMonthly = toSafeNumber(profile.defaultMinimumGrossMonthly || formData.grossMonthly);

    setFormData((previous) => ({
      ...previous,
      jobProfileId: profile.jobProfileId,
      jobTitleName: profile.jobTitleName,
      departmentId: profile.departmentId || previous.departmentId,
      departmentName: profile.departmentName || previous.departmentName,
      contractType: profile.defaultContractType || previous.contractType,
      ccnlId: profile.defaultCcnlId || previous.ccnlId,
      ccnlName: linkedCcnl?.name || profile.defaultCcnlName || previous.ccnlName,
      cnelCode: linkedCcnl?.cnelCode || previous.cnelCode,
      hourlyDivisor: linkedCcnl?.hourlyDivisor || previous.hourlyDivisor,
      levelId: profile.defaultLevelId || previous.levelId,
      levelCode: profile.defaultLevelCode || previous.levelCode,
      levelLabel: profile.defaultLevelLabel || previous.levelLabel,
      weeklyHours: linkedCcnl?.standardWeeklyHours || profile.defaultWeeklyHours || previous.weeklyHours,
      monthlyPayments,
      grossMonthly,
      grossHourly: toSafeNumber(profile.defaultMinimumGrossHourly || previous.grossHourly),
      grossAnnual: calculateGrossAnnual(grossMonthly, monthlyPayments),
    }));
  };

  const handleRecruitmentNeedChange = (needId: string) => {
    if (needId === "none") {
      setFormData((previous) => ({
        ...previous,
        recruitmentNeedId: "",
        recruitmentNeedTitle: "",
      }));
      return;
    }

    const need = recruitmentNeeds.find((item) => item.needId === needId);
    if (!need) return;

    if (need.jobProfileId && !formData.jobProfileId) {
      handleJobProfileChange(need.jobProfileId);
    }

    const worksite = need.worksiteId ? worksites.find((item) => item.worksiteId === need.worksiteId) : undefined;
    const needTitle = getRecruitmentNeedTitle(need);
    setFormData((previous) => ({
      ...previous,
      recruitmentNeedId: need.needId,
      recruitmentNeedTitle: needTitle,
      jobProfileId: previous.jobProfileId || need.jobProfileId || "",
      jobTitleName: previous.jobTitleName || need.jobTitleName || need.jobProfileTitle || "",
      departmentId: previous.departmentId || need.departmentId || "",
      departmentName: previous.departmentName || need.departmentName || "",
      worksiteId: previous.worksiteId || need.worksiteId || "",
      worksiteName: previous.worksiteName || need.worksiteNameSnapshot || need.worksiteName || "",
      worksiteAddress: previous.worksiteAddress || (worksite ? [worksite.address, (worksite as any).postalCode, worksite.city, worksite.province].filter(Boolean).join(", ") : ""),
      contractType: previous.contractType === initialForm.contractType ? need.contractType || previous.contractType : previous.contractType,
      workingTime: previous.workingTime === initialForm.workingTime ? need.workingTime || previous.workingTime : previous.workingTime,
      startDate: previous.startDate === initialForm.startDate ? need.desiredAvailabilityDate || previous.startDate : previous.startDate,
    }));
  };

  const handleCcnlChange = (ccnlId: string) => {
    const ccnl = ccnls.find((item) => item.ccnlId === ccnlId);
    const monthlyPayments = toSafeNumber(ccnl?.monthlyPayments || formData.monthlyPayments, 13);
    setLevelsError(null);
    setActiveLevels([]);
    setFormData((previous) => ({
      ...previous,
      ccnlId,
      ccnlName: ccnl?.name || "",
      cnelCode: ccnl?.cnelCode || "",
      hourlyDivisor: ccnl?.hourlyDivisor || 0,
      levelId: "",
      levelCode: "",
      levelLabel: "",
      qualificationLabel: "",
      weeklyHours: ccnl?.standardWeeklyHours || previous.weeklyHours,
      monthlyPayments,
      grossMonthly: 0,
      grossHourly: 0,
      grossAnnual: calculateGrossAnnual(0, monthlyPayments),
    }));
  };

  const handleLevelChange = (levelId: string) => {
    const level = activeLevels.find((item) => item.levelId === levelId || item.id === levelId);
    const grossMonthly = toSafeNumber(level?.minimumGrossMonthly || formData.grossMonthly);
    setFormData((previous) => ({
      ...previous,
      levelId,
      levelCode: level?.levelCode || "",
      levelLabel: level?.label || level?.levelLabel || "",
      qualificationLabel: level?.qualificationLabel || level?.qualificationCategory || "",
      grossMonthly,
      grossHourly: toSafeNumber(level?.minimumGrossHourly || previous.grossHourly),
      grossAnnual: calculateGrossAnnual(grossMonthly, previous.monthlyPayments),
    }));
  };

  const handleWorksiteChange = (worksiteId: string) => {
    const worksite = worksites.find((item) => item.worksiteId === worksiteId);
    setFormData((previous) => ({
      ...previous,
      worksiteId,
      worksiteName: worksite?.name || "",
      worksiteAddress: worksite ? [worksite.address, (worksite as any).postalCode, worksite.city, worksite.province].filter(Boolean).join(", ") : "",
    }));
  };

  const validateBeforeConfirm = () => {
    if (!formData.firstName || !formData.lastName || !formData.email) {
      toast({ variant: "destructive", title: "Identité incomplète", description: "Nom, prénom et email sont obligatoires." });
      return false;
    }
    if (!formData.jobProfileId || !formData.ccnlId || !formData.levelId) {
      toast({ variant: "destructive", title: "Contrat incomplet", description: "Fiche de poste, CCNL et niveau sont obligatoires." });
      return false;
    }
    if (formData.contractType !== "Tempo indeterminato" && !formData.endDate) {
      toast({ variant: "destructive", title: "Date de fin manquante", description: "La date de fin est obligatoire pour ce type de contrat." });
      return false;
    }
    return true;
  };

  const handleConfirmDirectHire = async () => {
    if (!user || !entityId) return;
    if (!tryStartSubmission()) return;
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Session expirée. Veuillez vous reconnecter.");
      const grossMonthly = toSafeNumber(formData.grossMonthly);
      const monthlyPayments = toSafeNumber(formData.monthlyPayments, 13);
      const result = await createDirectHireOfferAction({
        ...formData,
        entityId,
        idToken,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        codiceFiscale: formData.codiceFiscale.trim().toUpperCase(),
        email: formData.email.trim().toLowerCase(),
        weeklyHours: toSafeNumber(formData.weeklyHours),
        trialPeriodDays: toSafeNumber(formData.trialPeriodDays),
        monthlyPayments,
        hourlyDivisor: toSafeNumber(formData.hourlyDivisor),
        grossMonthly,
        grossHourly: toSafeNumber(formData.grossHourly),
        grossAnnual: calculateGrossAnnual(grossMonthly, monthlyPayments),
      });

      if (!result.success) throw new Error(result.error);
      toast({ title: "Embauche directe initialisée", description: "Le dossier de pré-embauche et UniLav sont prêts dans le funnel existant." });
      window.location.assign(`/entity/${entityId}/employment-offers/${result.offerId}`);
    } catch (err: any) {
      resetSubmission();
      setSubmitting(false);
      setConfirmOpen(false);
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    }
  };

  if (membershipLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!canCreateDirectHire) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Alert variant="destructive" className="rounded-2xl">
          <UserPlus className="h-4 w-4" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>Permission contracts.create requise.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8 pb-32">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" type="button" asChild className="rounded-full">
          <a href={`/entity/${entityId}/employment-offers`} aria-label="Retour aux propositions">
            <ArrowLeft className="h-5 w-5" />
          </a>
        </Button>
        <div>
          <h1 className="text-3xl font-black tracking-tight text-primary">Embauche directe</h1>
          <p className="text-sm text-muted-foreground">Créer une proposition acceptée par décision RH, sans email candidat ni portail public.</p>
        </div>
      </div>

      <form
        className="space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (validateBeforeConfirm()) setConfirmOpen(true);
        }}
      >
        <Card className="overflow-hidden rounded-[2rem] border-primary/10 shadow-xl">
          <CardHeader className="border-b bg-primary/5 px-8 py-6">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary/70">
              <UserPlus className="h-4 w-4" /> 1. Identité
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 p-8 md:grid-cols-2">
            <Field label="Prénom *" value={formData.firstName} onChange={(v) => setFormData((p) => ({ ...p, firstName: v }))} required />
            <Field label="Nom *" value={formData.lastName} onChange={(v) => setFormData((p) => ({ ...p, lastName: v }))} required />
            <Field label="Codice fiscale" value={formData.codiceFiscale} onChange={(v) => setFormData((p) => ({ ...p, codiceFiscale: v.toUpperCase() }))} className="font-mono uppercase" />
            <Field label="Email *" type="email" value={formData.email} onChange={(v) => setFormData((p) => ({ ...p, email: v.toLowerCase() }))} required />
            <Field label="Téléphone" value={formData.phone} onChange={(v) => setFormData((p) => ({ ...p, phone: v }))} />
            <Field label="Date de naissance" type="date" value={formData.birthDate} onChange={(v) => setFormData((p) => ({ ...p, birthDate: v }))} />
            <Field label="Adresse" value={formData.address} onChange={(v) => setFormData((p) => ({ ...p, address: v }))} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="CP" value={formData.postalCode} onChange={(v) => setFormData((p) => ({ ...p, postalCode: v }))} />
              <Field label="Ville" value={formData.city} onChange={(v) => setFormData((p) => ({ ...p, city: v }))} />
              <Field label="Province" value={formData.province} onChange={(v) => setFormData((p) => ({ ...p, province: v }))} />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[2rem] border-primary/10 shadow-xl">
          <CardHeader className="border-b bg-secondary/10 px-8 py-6">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary/70">
              <Briefcase className="h-4 w-4" /> 2. Poste
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 p-8 md:grid-cols-2">
            <SelectField label="Besoin RH lié" value={formData.recruitmentNeedId || "none"} onValueChange={handleRecruitmentNeedChange} placeholder="Aucun besoin RH">
              <SelectItem value="none">Aucun besoin RH</SelectItem>
              {recruitmentNeeds.map((need) => (
                <SelectItem key={need.needId} value={need.needId}>
                  {getRecruitmentNeedOptionLabel(need)}
                </SelectItem>
              ))}
            </SelectField>
            <SelectField label="Job Profile *" value={formData.jobProfileId} onValueChange={handleJobProfileChange} placeholder="Choisir une fiche de poste...">
              {jobProfiles.map((profile) => (
                <SelectItem key={profile.jobProfileId} value={profile.jobProfileId}>{profile.jobTitleName} ({profile.versionLabel})</SelectItem>
              ))}
            </SelectField>
            <SelectField label="Département" value={formData.departmentId} onValueChange={(v) => {
              const department = departments.find((item) => item.departmentId === v);
              setFormData((p) => ({ ...p, departmentId: v, departmentName: department?.name || "" }));
            }} placeholder="Choisir un département...">
              {departments.map((department) => (
                <SelectItem key={department.departmentId} value={department.departmentId}>{department.name}</SelectItem>
              ))}
            </SelectField>
            <SelectField label="Site de travail" value={formData.worksiteId} onValueChange={handleWorksiteChange} placeholder="Choisir un site...">
              {worksites.map((worksite) => (
                <SelectItem key={worksite.worksiteId} value={worksite.worksiteId}>{worksite.name}</SelectItem>
              ))}
            </SelectField>
            <Field label="Intitulé du poste" value={formData.jobTitleName} onChange={(v) => setFormData((p) => ({ ...p, jobTitleName: v }))} required />
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[2rem] border-primary/10 shadow-xl">
          <CardHeader className="border-b bg-primary/5 px-8 py-6">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary/70">
              <FileSignature className="h-4 w-4" /> 3. Contrat & rémunération
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 p-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <SelectField label="Type de contrat" value={formData.contractType} onValueChange={(v) => setFormData((p) => ({ ...p, contractType: v }))}>
                {["Tempo indeterminato", "Tempo determinato", "Apprendistato", "Stage"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectField>
              <Field label="Date de début *" type="date" value={formData.startDate} onChange={(v) => setFormData((p) => ({ ...p, startDate: v }))} required />
              {formData.contractType !== "Tempo indeterminato" && (
                <Field label="Date de fin *" type="date" value={formData.endDate} onChange={(v) => setFormData((p) => ({ ...p, endDate: v }))} required />
              )}
              <SelectField label="CCNL *" value={formData.ccnlId} onValueChange={handleCcnlChange} placeholder="Sélectionner CCNL...">
                {ccnls.map((ccnl) => <SelectItem key={ccnl.ccnlId} value={ccnl.ccnlId}>{ccnl.name}</SelectItem>)}
              </SelectField>
              <SelectField label="Niveau *" value={formData.levelId} onValueChange={handleLevelChange} disabled={!formData.ccnlId || loadingLevels || !!levelsError} placeholder={loadingLevels ? "Chargement..." : "Sélectionner niveau..."}>
                {activeLevels.map((level) => <SelectItem key={level.levelId || level.id} value={level.levelId || level.id}>{level.levelCode} — {level.label || level.levelLabel}</SelectItem>)}
              </SelectField>
              <Field label="Heures hebdomadaires" type="number" value={String(formData.weeklyHours)} onChange={(v) => setFormData((p) => ({ ...p, weeklyHours: toSafeNumber(v) }))} />
            </div>

            {levelsError && (
              <Alert variant="destructive" className="rounded-2xl">
                <AlertTitle>Niveaux indisponibles</AlertTitle>
                <AlertDescription>{levelsError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase">Mode de calcul</Label>
              <RadioGroup
                value={formData.payCalculationMode}
                onValueChange={(value: PayCalculationMode) => setFormData((p) => ({ ...p, payCalculationMode: value }))}
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                {PAY_CALCULATION_MODE_OPTIONS.map((option) => (
                  <Label
                    key={option.value}
                    htmlFor={`direct-pay-mode-${option.value}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all",
                      formData.payCalculationMode === option.value ? "border-primary bg-primary/5 shadow-sm" : "border-primary/10 bg-white hover:bg-slate-50"
                    )}
                  >
                    <RadioGroupItem value={option.value} id={`direct-pay-mode-${option.value}`} className="mt-1" />
                    <span className="space-y-1">
                      <span className="block text-sm font-black text-slate-900">{option.label}</span>
                      <span className="block text-xs font-medium leading-relaxed text-muted-foreground">{option.description}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-6 border-t border-dashed pt-6 md:grid-cols-3">
              <Field label="Brut Mensuel (€)" type="number" value={String(formData.grossMonthly)} onChange={(v) => {
                const grossMonthly = toSafeNumber(v);
                setFormData((p) => ({ ...p, grossMonthly, grossAnnual: calculateGrossAnnual(grossMonthly, p.monthlyPayments) }));
              }} />
              <Field label="Mensualités" type="number" value={String(formData.monthlyPayments)} onChange={(v) => {
                const monthlyPayments = toSafeNumber(v, 13);
                setFormData((p) => ({ ...p, monthlyPayments, grossAnnual: calculateGrossAnnual(p.grossMonthly, monthlyPayments) }));
              }} />
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Brut Annuel (RAL)</Label>
                <div className="flex h-10 items-center rounded-xl border bg-slate-50 px-3 font-black text-primary">
                  <Euro className="mr-2 h-4 w-4" /> {formData.grossAnnual.toLocaleString("fr-FR")}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase">Notes RH</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))} className="min-h-[90px] rounded-xl" />
            </div>
          </CardContent>
        </Card>

        <Alert className="rounded-2xl border-primary/20 bg-primary/5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertTitle>Confirmation requise</AlertTitle>
          <AlertDescription>
            Cette action crée une proposition acceptée comme état de workflow RH, sans envoi de proposition au candidat et sans acceptation via le portail candidat.
          </AlertDescription>
        </Alert>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" asChild disabled={submitting}>
            <a href={`/entity/${entityId}/employment-offers`}>Annuler</a>
          </Button>
          <Button type="submit" disabled={submitting || loadingLevels} className="h-14 rounded-2xl px-10 font-black shadow-xl shadow-primary/20">
            {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <UserPlus className="mr-2 h-5 w-5" />}
            Créer et poursuivre l'embauche directe
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'embauche directe ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette embauche sera poursuivie directement par RH sans envoi de proposition au candidat ni acceptation via le portail candidat.
              Le dossier de pré-embauche et la communication UniLav seront initialisés dans le funnel existant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Retour</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); handleConfirmDirectHire(); }} disabled={submitting} className="bg-primary font-black text-white hover:bg-primary/90">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[10px] font-black uppercase">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className={cn("rounded-xl", className)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[10px] font-black uppercase">{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="rounded-xl"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
