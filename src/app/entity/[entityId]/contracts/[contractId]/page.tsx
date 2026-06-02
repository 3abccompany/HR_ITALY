"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Briefcase, Building2, FileSignature,
  Info, Euro, Clock, History, 
  Scale, Fingerprint, Calendar, FileText,
  MapPin, CheckCircle2, Ban, Archive, 
  RefreshCcw, ScrollText, Globe,
  Edit, Save, X, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFirebase, useDoc, useUser } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { Contract, ContractStatus } from "@/types/contract";
import { Employee } from "@/types/employee";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  sendContractToSignature, 
  activateContractAction, 
  terminateContractAction, 
  archiveContractAction,
  rollbackToDraft,
  updateContract
} from "@/services/contract.service";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const contractId = params.contractId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const [processing, setProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<Contract>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isValidationDialogOpen, setIsValidationDialogOpen] = useState(false);

  const contractRef = useMemo(() => 
    db ? (doc(db, `entities/${entityId}/contracts`, contractId) as DocumentReference<Contract>) : null,
  [db, entityId, contractId]);

  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  useEffect(() => {
    if (contract) setFormData(contract);
  }, [contract]);

  const formatMoney = (value: any, decimals = 2) => {
    if (value === undefined || value === null) return "-";
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return num.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatDate = (val: any) => {
    if (!val) return "-";
    try {
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const [y, m, d] = val.split('-');
        return `${d}/${m}/${y}`;
      }
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      return "-";
    }
  };

  const formatDateTime = (val: any) => {
    if (!val) return "-";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleString('fr-FR', { 
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return "-";
    }
  };

  const getUserLabel = (uid: string | undefined) => {
    if (!uid) return "-";
    if (uid === "system" || uid === "candidate_portal" || uid === "server") return "Système";
    return "Utilisateur interne";
  };

  const validateContractForSignature = () => {
    const missing: string[] = [];
    if (!contract) return [];

    if (!contract.entityLegalName) missing.push("Raison sociale de l'employeur");
    if (!contract.companyAddressSnapshot) missing.push("Adresse du siège");
    if (!contract.employeeDisplayName) missing.push("Nom complet du salarié");
    if (!contract.taxCode) missing.push("Code fiscal / Identifiant national");
    if (!contract.employeeAddressSnapshot) missing.push("Adresse de résidence du salarié");
    if (!contract.contractType) missing.push("Type de contrat");
    if (!contract.startDate) missing.push("Date de début");
    if (!contract.jobTitleName) missing.push("Intitulé du poste");
    if (!contract.worksiteName) missing.push("Site d'affectation");
    if (!contract.ccnlName) missing.push("Convention collective (CCNL)");
    if (!contract.levelCode && !contract.levelLabel) missing.push("Niveau de classification");
    if (!contract.weeklyHours) missing.push("Temps de travail (heures)");
    if (!contract.grossMonthly && !contract.grossAnnual) missing.push("Rémunération (Brut)");

    return missing;
  };

  const handleTransitionToSignature = async () => {
    const missing = validateContractForSignature();
    if (missing.length > 0) {
      setValidationErrors(missing);
      setIsValidationDialogOpen(true);
      return;
    }

    handleTransition(() => sendContractToSignature(entityId, contractId, user!.uid), "Contrat prêt pour signature.");
  };

  const handleTransition = async (action: () => Promise<any>, successMsg: string) => {
    if (!user || !contract) return;
    setProcessing(true);
    try {
      await action();
      toast({ title: "Succès", description: successMsg });
    } catch (err: any) {
      let msg = err.message || "Une erreur est survenue.";
      if (err.message === "ALREADY_HAS_ACTIVE_CONTRACT") {
        msg = "Un autre contrat actif existe déjà pour cet employé.";
      }
      toast({ variant: "destructive", title: "Erreur", description: msg });
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!user || !contract) return;
    setProcessing(true);
    try {
      await updateContract(entityId, contractId, formData, user.uid);
      setIsEditing(false);
      toast({ title: "Modifications enregistrées" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setProcessing(false);
    }
  };

  if (membershipLoading || loadingContract) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!contract) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><FileText className="w-10 h-10 text-muted-foreground" /></div>
        <h2 className="text-2xl font-black text-primary">Contrat introuvable</h2>
        <Button onClick={() => router.push(`/entity/${entityId}/contracts`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  const businessReference = contract.employeeCode || "Brouillon d'intégration";
  const canUpdate = hasPermission("contracts.update");
  const isDraft = contract.status === 'draft';

  return (
    <div className="p-8 max-w-6xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 sticky top-0 z-40 bg-background/80 backdrop-blur py-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/contracts`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-primary tracking-tight">Modèle de Contrat</h1>
              {getStatusBadge(contract.status)}
            </div>
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mt-1">Référence : {businessReference}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
           {isDraft && !isEditing && (
             <Button variant="outline" onClick={() => setIsEditing(true)} className="gap-2 bg-white rounded-xl font-bold">
                <Edit className="w-4 h-4" /> Éditer les informations
             </Button>
           )}

           {isEditing && (
             <>
               <Button variant="ghost" onClick={() => { setIsEditing(false); setFormData(contract); }} disabled={processing}>Annuler</Button>
               <Button onClick={handleSave} disabled={processing} className="gap-2 bg-green-600 text-white font-bold rounded-xl">
                 {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                 Enregistrer
               </Button>
             </>
           )}

           {!isEditing && canUpdate && isDraft && (
             <Button 
               onClick={handleTransitionToSignature}
               disabled={processing}
               className="gap-2 bg-accent text-white font-bold rounded-xl"
             >
               {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
               Prêt pour signature
             </Button>
           )}

           {!isEditing && canUpdate && contract.status === 'pending_signature' && (
             <>
               <Button variant="outline" onClick={() => handleTransition(() => rollbackToDraft(entityId, contractId, user!.uid), "Retour au statut brouillon.")} disabled={processing} className="gap-2 bg-white rounded-xl">
                 <RefreshCcw className="w-4 h-4" /> Brouillon
               </Button>
               <Button onClick={() => handleTransition(() => activateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat activé avec succès.")} disabled={processing || !contract.employeeId} className="gap-2 bg-primary text-white font-black rounded-xl">
                 {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                 Confirmer signature et activer
               </Button>
             </>
           )}

           {!isEditing && canUpdate && contract.status === 'active' && (
             <Button variant="destructive" onClick={() => handleTransition(() => terminateContractAction(entityId, contractId, contract.employeeId, user!.uid), "Contrat résilié.")} disabled={processing} className="gap-2 font-bold rounded-xl">
               <Ban className="w-4 h-4" /> Résilier / Terminer
             </Button>
           )}

           {!isEditing && canUpdate && (isDraft || contract.status === 'terminated') && (
             <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => handleTransition(() => archiveContractAction(entityId, contractId, user!.uid), "Contrat archivé.")} disabled={processing}>
               <Archive className="w-4 h-4" />
             </Button>
           )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          
          {/* Employer Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Building2 className="w-4 h-4" /> Employeur
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Raison Sociale" value={formData.entityLegalName} isEditing={isEditing} id="entityLegalName" required onChange={(v) => setFormData(p => ({...p, entityLegalName: v}))} />
                   <DetailEditable label="Nom commercial" value={formData.entityName} isEditing={isEditing} id="entityName" onChange={(v) => setFormData(p => ({...p, entityName: v}))} />
                   <DetailEditable label="Numéro TVA / Code Fiscal" value={formData.entityVatNumber} isEditing={isEditing} id="entityVatNumber" onChange={(v) => setFormData(p => ({...p, entityVatNumber: v}))} />
                   <DetailEditable label="Représentant Légal" value={formData.legalRepresentativeName} isEditing={isEditing} id="legalRepresentativeName" onChange={(v) => setFormData(p => ({...p, legalRepresentativeName: v}))} />
                   <DetailEditable label="Adresse du Siège" value={formData.companyAddressSnapshot} isEditing={isEditing} id="companyAddressSnapshot" required className="col-span-full" onChange={(v) => setFormData(p => ({...p, companyAddressSnapshot: v}))} />
                </div>
             </CardContent>
          </Card>

          {/* Employee Card */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <User className="w-4 h-4" /> Salarié
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Nom Complet" value={formData.employeeDisplayName} isEditing={isEditing} id="employeeDisplayName" required onChange={(v) => setFormData(p => ({...p, employeeDisplayName: v}))} />
                   <DetailEditable label="Code Fiscal / ID National" value={formData.taxCode} isEditing={isEditing} id="taxCode" required className="font-mono uppercase" onChange={(v) => setFormData(p => ({...p, taxCode: v}))} />
                   <DetailEditable label="Date de Naissance" value={formData.dateOfBirth} isEditing={isEditing} id="dateOfBirth" type="date" onChange={(v) => setFormData(p => ({...p, dateOfBirth: v}))} />
                   <DetailEditable label="Lieu de Naissance" value={formData.placeOfBirth} isEditing={isEditing} id="placeOfBirth" onChange={(v) => setFormData(p => ({...p, placeOfBirth: v}))} />
                   <DetailEditable label="Adresse de Résidence" value={formData.employeeAddressSnapshot} isEditing={isEditing} id="employeeAddressSnapshot" required className="col-span-full" onChange={(v) => setFormData(p => ({...p, employeeAddressSnapshot: v}))} />
                </div>
                {!isEditing && contract.employeeId && (
                  <div className="mt-8 pt-6 border-t flex gap-4">
                     <Link href={`/entity/${entityId}/employees/${contract.employeeId}`}>
                        <Button variant="outline" size="sm" className="h-9 rounded-xl font-bold gap-2 bg-white">
                           <UserCheck className="w-3.5 h-3.5" /> Voir Profil Employé
                        </Button>
                     </Link>
                  </div>
                )}
             </CardContent>
          </Card>

          {/* Job & workplace */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Briefcase className="w-4 h-4" /> Poste & Lieu de Travail
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Intitulé du Poste" value={formData.jobTitleName} isEditing={isEditing} id="jobTitleName" required icon={Briefcase} onChange={(v) => setFormData(p => ({...p, jobTitleName: v}))} />
                   <DetailEditable label="Département" value={formData.departmentName} isEditing={isEditing} id="departmentName" icon={Building2} onChange={(v) => setFormData(p => ({...p, departmentName: v}))} />
                   <DetailEditable label="Site d'Affectation" value={formData.worksiteName} isEditing={isEditing} id="worksiteName" required icon={MapPin} className="col-span-full" onChange={(v) => setFormData(p => ({...p, worksiteName: v}))} />
                </div>
                {isEditing ? (
                  <div className="space-y-2 pt-4">
                    <Label className="text-[10px] font-black uppercase text-muted-foreground">Missions Snapshot (Un par ligne)</Label>
                    <Textarea 
                      value={formData.missionsSnapshot?.join('\n') || ""} 
                      onChange={(e) => setFormData(p => ({...p, missionsSnapshot: e.target.value.split('\n').filter(Boolean)}))}
                      className="min-h-[120px] rounded-xl"
                    />
                  </div>
                ) : (
                  formData.missionsSnapshot && formData.missionsSnapshot.length > 0 && (
                    <div className="space-y-3 pt-6 border-t">
                       <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Missions & Responsabilités</p>
                       <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700">
                             {formData.missionsSnapshot.map((m, i) => <li key={i}>{m}</li>)}
                          </ul>
                       </div>
                    </div>
                  )
                )}
             </CardContent>
          </Card>

          {/* Terms & Classification */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <ScrollText className="w-4 h-4" /> Conditions & Classification
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-12">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Type de Contrat" value={formData.contractType} isEditing={isEditing} id="contractType" required onChange={(v) => setFormData(p => ({...p, contractType: v}))} />
                   <DetailEditable label="Date de Début" value={formData.startDate} isEditing={isEditing} id="startDate" type="date" required icon={Calendar} onChange={(v) => setFormData(p => ({...p, startDate: v}))} />
                   <DetailEditable label="Date de Fin (Optionnel)" value={formData.endDate} isEditing={isEditing} id="endDate" type="date" icon={Calendar} onChange={(v) => setFormData(p => ({...p, endDate: v}))} />
                   <DetailEditable label="Période d'essai (jours)" value={formData.trialPeriodDays} isEditing={isEditing} id="trialPeriodDays" type="number" onChange={(v) => setFormData(p => ({...p, trialPeriodDays: parseInt(v) || 0}))} />
                </div>
                
                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Temps de Travail Hebdo (h)" value={formData.weeklyHours} isEditing={isEditing} id="weeklyHours" type="number" required icon={Clock} onChange={(v) => setFormData(p => ({...p, weeklyHours: parseFloat(v) || 0}))} />
                   <DetailEditable label="Format Part-time ?" value={formData.isPartTime ? "OUI" : "NON"} isEditing={isEditing} id="isPartTime" type="checkbox" onChange={(v) => setFormData(p => ({...p, isPartTime: !!v}))} />
                   <DetailEditable label="Notes Planning" value={formData.workingScheduleNotes} isEditing={isEditing} id="workingScheduleNotes" className="col-span-full" onChange={(v) => setFormData(p => ({...p, workingScheduleNotes: v}))} />
                </div>

                <Separator className="bg-slate-100" />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Convention Collective (CCNL)" value={formData.ccnlName} isEditing={isEditing} id="ccnlName" required onChange={(v) => setFormData(p => ({...p, ccnlName: v}))} />
                   <DetailEditable label="Niveau" value={formData.levelCode} isEditing={isEditing} id="levelCode" required onChange={(v) => setFormData(p => ({...p, levelCode: v}))} />
                   <DetailEditable label="Qualification" value={formData.qualificationCategory} isEditing={isEditing} id="qualificationCategory" onChange={(v) => setFormData(p => ({...p, qualificationCategory: v}))} />
                </div>
             </CardContent>
          </Card>

          {/* Remuneration */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Euro className="w-4 h-4" /> Rémunération
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                   <DetailEditable label="Brut Mensuel (€)" value={formData.grossMonthly} isEditing={isEditing} id="grossMonthly" type="number" required onChange={(v) => setFormData(p => ({...p, grossMonthly: parseFloat(v) || 0}))} />
                   <DetailEditable label="Brut Annuel / RAL (€)" value={formData.grossAnnual} isEditing={isEditing} id="grossAnnual" type="number" onChange={(v) => setFormData(p => ({...p, grossAnnual: parseFloat(v) || 0}))} />
                   <DetailEditable label="Mensualités" value={formData.monthlyPayments} isEditing={isEditing} id="monthlyPayments" type="number" onChange={(v) => setFormData(p => ({...p, monthlyPayments: parseInt(v) || 13}))} />
                </div>
                <DetailEditable label="Notes Variables / Heures Supp." value={formData.overtimeNote} isEditing={isEditing} id="overtimeNote" className="mt-8" onChange={(v) => setFormData(p => ({...p, overtimeNote: v}))} />
             </CardContent>
          </Card>

          {/* Compliance */}
          <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-4 px-8">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <Globe className="w-4 h-4" /> Compliance & UniLav
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   <DetailEditable label="Protocole UniLav" value={formData.uniLavProtocolNumber} isEditing={isEditing} id="uniLavProtocolNumber" onChange={(v) => setFormData(p => ({...p, uniLavProtocolNumber: v}))} />
                   <DetailEditable label="Date Soumission" value={formData.uniLavSubmissionDate} isEditing={isEditing} id="uniLavSubmissionDate" type="date" onChange={(v) => setFormData(p => ({...p, uniLavSubmissionDate: v}))} />
                </div>
             </CardContent>
          </Card>
        </div>

        {/* Audit Sidebar */}
        <div className="space-y-8">
          <Card className="border-primary/10 rounded-[2rem] shadow-lg bg-secondary/5 overflow-hidden">
             <CardHeader className="py-4 border-b bg-secondary/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                   <History className="w-4 h-4" /> Historique & Audit
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-6">
                <div className="space-y-4">
                   <AuditRow label="Créé le" value={formatDateTime(contract.createdAt)} />
                   <AuditRow label="Auteur" value={getUserLabel(contract.createdBy)} />
                   <Separator className="opacity-20" />
                   {contract.sentForSignatureAt && <AuditRow label="Envoyé sign. le" value={formatDateTime(contract.sentForSignatureAt)} />}
                   {contract.activatedAt && <AuditRow label="Activé le" value={formatDateTime(contract.activatedAt)} />}
                   <Separator className="opacity-20" />
                   <AuditRow label="Dernière modif." value={formatDateTime(contract.updatedAt)} />
                   <AuditRow label="Modifié par" value={getUserLabel(contract.updatedBy)} />
                </div>
             </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isValidationDialogOpen} onOpenChange={setIsValidationDialogOpen}>
        <DialogContent className="rounded-[2.5rem] sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" /> Dossier contrat incomplet
            </DialogTitle>
            <DialogDescription>Certaines informations obligatoires sont manquantes pour l'envoi en signature.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="max-h-[300px] rounded-xl border p-4 bg-slate-50">
               <ul className="space-y-2">
                  {validationErrors.map((err, i) => (
                    <li key={i} className="text-xs font-bold text-slate-700 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                       {err}
                    </li>
                  ))}
               </ul>
            </ScrollArea>
          </div>
          <DialogFooter>
             <Button onClick={() => setIsValidationDialogOpen(false)} className="w-full rounded-xl">Corriger les informations</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailEditable({ label, value, isEditing, id, type = "text", required = false, icon: Icon, className, onChange }: { 
  label: string, value: any, isEditing: boolean, id: string, type?: string, required?: boolean, icon?: any, className?: string, onChange: (v: any) => void 
}) {
  const displayValue = value === undefined || value === null || value === "" ? "Non renseigné" : value;
  const isMissing = required && (value === undefined || value === null || value === "");

  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={cn("text-[10px] font-black uppercase tracking-tight mb-1 opacity-70", isMissing && "text-red-600 opacity-100")}>
        {label} {required && "*"}
      </Label>
      {isEditing ? (
        type === "checkbox" ? (
          <div className="flex items-center h-10 px-3 border rounded-xl bg-white">
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 text-primary" />
          </div>
        ) : (
          <Input 
            id={id} 
            type={type} 
            value={value || ""} 
            onChange={(e) => onChange(e.target.value)} 
            className={cn("h-10 rounded-xl bg-white", isMissing && "border-red-300 ring-red-100")} 
          />
        )
      ) : (
        <div className={cn("flex items-center gap-2 text-sm font-bold", isMissing ? "text-red-400 italic font-medium" : "text-slate-800")}>
           {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />}
           {displayValue}
        </div>
      )}
    </div>
  );
}

function AuditRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
       <span className="text-muted-foreground font-medium">{label}</span>
       <span className="font-bold text-slate-700 text-right ml-2">{value}</span>
    </div>
  );
}

function getStatusBadge(status: ContractStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-slate-100 text-slate-700 uppercase font-black text-[9px] px-2">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 uppercase font-black text-[9px] px-2">En signature</Badge>;
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white uppercase font-black text-[9px] px-2">Actif</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200 uppercase font-black text-[9px] px-2">Terminé</Badge>;
    case 'archived': return <Badge variant="outline" className="text-muted-foreground uppercase font-black text-[9px] px-2">Archivé</Badge>;
    default: return <Badge variant="outline" className="uppercase font-black text-[9px] px-2">{status}</Badge>;
  }
}
