"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, User, UserCheck, 
  Mail, Phone, Fingerprint, Calendar,
  Briefcase, Building2, MapPin, FileSignature,
  Info, Euro, Clock, History, ExternalLink,
  ShieldCheck, GraduationCap, CheckCircle2,
  FileText, AlertTriangle, FolderOpen, ShieldAlert,
  Download, Eye, Lock, FileBadge, ListTodo, Search,
  ChevronDown, RefreshCcw, Save, X, Plus, Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Tabs, TabsContent, TabsList, TabsTrigger 
} from "@/components/ui/tabs";
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from "@/components/ui/collapsible";
import { useFirebase, useDoc, useCollection, useUser } from "@/firebase";
import { doc, DocumentReference, query, collection, where } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { Contract } from "@/types/contract";
import { EmploymentOffer } from "@/types/employment-offer";
import { HRDocument, DOCUMENT_TYPE_LABELS, STATUS_LABELS } from "@/types/hr-document";
import { getDocumentDownloadUrl, replaceHRDocument } from "@/services/document.service";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { format, isBefore, differenceInDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription 
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDateSafe(val: any, formatStr: string = "dd/MM/yyyy"): string {
  const date = parseSafeDate(val);
  if (!date) return "-";
  return format(date, formatStr, { locale: fr });
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const employeeId = params.employeeId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission, membership } = useActiveMembership(entityId);

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [replacingDoc, setReplacingDoc] = useState<HRDocument | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementExpiry, setReplacementExpiry] = useState("");
  const [isReplacing, setIsReplacing] = useState(false);

  const employeeRef = useMemo(() => 
    db ? (doc(db, `entities/${entityId}/employees`, employeeId) as DocumentReference<Employee>) : null,
  [db, entityId, employeeId]);

  const { data: employee, loading: loadingEmployee } = useDoc<Employee>(employeeRef);

  // Active Contract Query
  const contractRef = useMemo(() => 
    db && employee?.activeContractId ? (doc(db, `entities/${entityId}/contracts`, employee.activeContractId) as DocumentReference<Contract>) : null,
  [db, entityId, employee?.activeContractId]);

  const { data: contract, loading: loadingContract } = useDoc<Contract>(contractRef);

  // Pending Contract Query (Draft from Onboarding)
  const pendingContractRef = useMemo(() => 
    db && employee?.pendingContractId ? (doc(db, `entities/${entityId}/contracts`, employee.pendingContractId) as DocumentReference<Contract>) : null,
  [db, entityId, employee?.pendingContractId]);

  const { data: pendingContract, loading: loadingPendingContract } = useDoc<Contract>(pendingContractRef);

  // Fallback data from source offer
  const offerRef = useMemo(() => 
    db && employee?.sourceOfferId ? (doc(db, `entities/${entityId}/employmentOffers`, employee.sourceOfferId) as DocumentReference<EmploymentOffer>) : null,
  [db, entityId, employee?.sourceOfferId]);

  const { data: offer } = useDoc<EmploymentOffer>(offerRef);

  // --- Documents Logic ---
  const canReadDocs = hasPermission("documents.read");
  const canUploadDocs = hasPermission("documents.upload");

  // Query A: By EmployeeId
  const docsByEmployeeQuery = useMemo(() => {
    if (!db || !entityId || !employeeId || !canReadDocs) return null;
    return query(
      collection(db, `entities/${entityId}/documents`),
      where("employeeId", "==", employeeId)
    );
  }, [db, entityId, employeeId, canReadDocs]);

  // Query B: By PersonId (to catch pre-hire docs)
  const docsByPersonQuery = useMemo(() => {
    if (!db || !entityId || !employee?.personId || !canReadDocs) return null;
    return query(
      collection(db, `entities/${entityId}/documents`),
      where("personId", "==", employee.personId)
    );
  }, [db, entityId, employee?.personId, canReadDocs]);

  const { data: employeeDocs, loading: loadingEmpDocs } = useCollection<HRDocument>(docsByEmployeeQuery);
  const { data: personDocs, loading: loadingPersonDocs } = useCollection<HRDocument>(docsByPersonQuery);

  const allDocs = useMemo(() => {
    const map = new Map<string, HRDocument>();
    employeeDocs?.forEach(d => map.set(d.id, d));
    personDocs?.forEach(d => map.set(d.id, d));
    
    return Array.from(map.values()).sort((a, b) => {
      const getBestDate = (doc: HRDocument) => {
        const d = parseSafeDate(doc.uploadedAt) || 
                  parseSafeDate(doc.generatedAt) || 
                  parseSafeDate(doc.createdAt) || 
                  parseSafeDate(doc.updatedAt) || 
                  parseSafeDate(doc.issuedAt);
        return d ? d.getTime() : 0;
      };
      return getBestDate(b) - getBestDate(a);
    });
  }, [employeeDocs, personDocs]);

  // --- VERSIONING GROUPING LOGIC ---
  const documentBundles = useMemo(() => {
    const bundles: Record<string, { current?: HRDocument, history: HRDocument[] }> = {};

    allDocs.forEach(doc => {
      // Logic for bundle key: 
      // 1. Identity/Residence/Tax -> group by type
      // 2. Contracts -> group by contractId
      // 3. Training/Medical -> group by relatedId
      // 4. Everything else -> group by rootDocumentId
      let key = doc.rootDocumentId || doc.id;
      
      const identityTypes = ['identity_document', 'fiscal_code', 'residence_permit', 'work_permit'];
      if (identityTypes.includes(doc.documentType)) {
        key = `type_${doc.documentType}`;
      } else if (doc.contractId) {
        key = `contract_${doc.contractId}`;
      } else if (doc.relatedId) {
        key = `related_${doc.relatedId}`;
      }

      if (!bundles[key]) bundles[key] = { history: [] };

      // Current document is the one that hasn't been replaced
      if (doc.status !== "replaced" && !doc.replacedById) {
        // If there's already a "current", the newest one takes precedence
        if (!bundles[key].current) {
          bundles[key].current = doc;
        } else {
          // Compare dates
          const currentT = parseSafeDate(bundles[key].current!.uploadedAt)?.getTime() || 0;
          const newT = parseSafeDate(doc.uploadedAt)?.getTime() || 0;
          if (newT > currentT) {
            bundles[key].history.push(bundles[key].current!);
            bundles[key].current = doc;
          } else {
            bundles[key].history.push(doc);
          }
        }
      } else {
        bundles[key].history.push(doc);
      }
    });

    // Final sorting of histories
    Object.values(bundles).forEach(b => {
      b.history.sort((x, y) => {
        const tx = parseSafeDate(x.uploadedAt)?.getTime() || 0;
        const ty = parseSafeDate(y.uploadedAt)?.getTime() || 0;
        return ty - tx;
      });
    });

    return bundles;
  }, [allDocs]);

  const groupedDocsByTab = useMemo(() => {
    const groups = {
      contracts: [] as { current?: HRDocument, history: HRDocument[] }[],
      identity: [] as { current?: HRDocument, history: HRDocument[] }[],
      hiring: [] as { current?: HRDocument, history: HRDocument[] }[],
      safety: [] as { current?: HRDocument, history: HRDocument[] }[],
      others: [] as { current?: HRDocument, history: HRDocument[] }[]
    };

    Object.values(documentBundles).forEach(bundle => {
      const doc = bundle.current || bundle.history[0];
      if (!doc) return;

      const type = doc.documentType;
      if (['generated_contract_pdf', 'signed_contract', 'contract', 'termination_document'].includes(type)) {
        groups.contracts.push(bundle);
      } else if (['identity_document', 'identity_card', 'fiscal_code', 'tax_code', 'residence_permit', 'work_permit', 'privacy'].includes(type)) {
        groups.identity.push(bundle);
      } else if (['cpi_receipt', 'unilav_receipt', 'mandatory_communication', 'prehire_required_document'].includes(type)) {
        groups.hiring.push(bundle);
      } else if (['training_certificate', 'medical_certificate', 'dpi_delivery_report', 'safety_document'].includes(type)) {
        groups.safety.push(bundle);
      } else {
        groups.others.push(bundle);
      }
    });

    return groups;
  }, [documentBundles]);

  const handleOpenDoc = async (storagePath: string, id: string) => {
    setLoadingAction(id);
    try {
      const url = await getDocumentDownloadUrl(storagePath);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible d'ouvrir le document." });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExecuteReplacement = async () => {
    if (!user || !replacingDoc || !replacementFile || !replacementReason) return;
    
    setIsReplacing(true);
    try {
      const metadata: Partial<HRDocument> = {
        expiresAt: replacementExpiry || null,
        title: `Version renouvelée : ${replacingDoc.title}`,
      };

      await replaceHRDocument(
        entityId, 
        replacingDoc.id, 
        replacementFile, 
        user.uid, 
        replacementReason, 
        metadata,
        membership?.userDisplayName
      );

      toast({ title: "Document renouvelé", description: "La nouvelle version a été enregistrée." });
      setReplacingDoc(null);
      setReplacementReason("");
      setReplacementFile(null);
      setReplacementExpiry("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Échec du renouvellement", description: err.message });
    } finally {
      setIsReplacing(false);
    }
  };

  const formatDate = (val: any) => {
    const d = parseSafeDate(val);
    if (!d) return null;
    return d.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric'
    });
  };

  if (membershipLoading || loadingEmployee) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!employee) {
    return (
      <div className="p-8 text-center mt-20 max-w-md mx-auto">
        <div className="bg-secondary/20 p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <User className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-black text-primary">Employé introuvable</h2>
        <p className="text-muted-foreground mt-2">Désolé, nous ne trouvons pas le dossier de ce collaborateur.</p>
        <Button onClick={() => router.push(`/entity/${entityId}/employees`)} className="mt-8">Retour au registre</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/entity/${entityId}/employees`)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-primary tracking-tight">{employee.displayName}</h1>
              {getStatusBadge(employee.status)}
            </div>
            <div className="flex items-center gap-4 text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">
              <span className="flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> {employee.employeeCode}</span>
              <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {employee.jobTitle || offer?.jobTitleName || "Non renseigné"}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Tabs defaultValue="profil" className="space-y-8">
            <TabsList className="bg-white border p-1 h-11 rounded-xl shadow-sm w-full sm:w-auto">
              <TabsTrigger value="profil" className="rounded-lg font-bold px-8">Informations</TabsTrigger>
              <TabsTrigger value="documents" className="rounded-lg font-bold px-8 gap-2">
                Documents
                {canReadDocs && allDocs.length > 0 && (
                  <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px] px-1.5 h-4 min-w-[1.2rem] flex items-center justify-center">
                    {allDocs.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profil" className="mt-0 space-y-8 animate-in fade-in slide-in-from-left-2 duration-300">
              {/* Identity Card */}
              <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
                <CardHeader className="bg-primary/5 border-b py-4 px-8">
                    <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                      <User className="w-4 h-4" /> Identité & Contact
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <DetailRow label="Prénom" value={employee.firstName} />
                      <DetailRow label="Nom" value={employee.lastName} />
                      <DetailRow label="Email" value={employee.email} />
                      <DetailRow label="Téléphone" value={employee.phone} />
                      <DetailRow label="Identifiant National" value={employee.taxCode} className="font-mono uppercase" />
                      <DetailRow label="Date de naissance" value={formatDate(employee.birthDate)} />
                    </div>
                </CardContent>
              </Card>

              {/* Professional Context */}
              <Card className="border-primary/10 shadow-xl shadow-primary/5 rounded-[2rem] overflow-hidden">
                <CardHeader className="bg-primary/5 border-b py-4 px-8">
                    <CardTitle className="text-xs font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                      <Building2 className="w-4 h-4" /> Contexte Professionnel
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <DetailRow label="Département" value={employee.departmentName || offer?.departmentName} icon={Building2} />
                      <DetailRow label="Site Principal" value={employee.worksiteName || offer?.worksiteName} icon={MapPin} />
                      <DetailRow label="Date d'embauche" value={formatDate(employee.hireDate)} icon={Calendar} />
                      <DetailRow label="Poste Officiel" value={employee.jobTitle || offer?.jobTitleName} icon={Briefcase} />
                    </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="mt-0 animate-in fade-in slide-in-from-right-2 duration-300">
              {!canReadDocs ? (
                <Alert variant="destructive" className="rounded-3xl border-none shadow-lg">
                  <Lock className="h-5 w-5" />
                  <AlertTitle className="font-bold">Accès restreint</AlertTitle>
                  <AlertDescription>
                    Vous n'avez pas l'autorisation de consulter les documents de cet employé.
                  </AlertDescription>
                </Alert>
              ) : (loadingEmpDocs || loadingPersonDocs) ? (
                <div className="py-20 text-center"><Loader2 className="w-10 h-10 animate-spin mx-auto text-primary/20" /></div>
              ) : allDocs.length === 0 ? (
                <Card className="border-dashed border-2 rounded-[2rem] py-20 bg-secondary/5">
                  <div className="text-center max-w-sm mx-auto space-y-4">
                      <div className="bg-white p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto shadow-sm">
                        <FolderOpen className="w-10 h-10 text-muted-foreground/30" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-primary">Aucun document</h3>
                        <p className="text-sm text-muted-foreground">Aucun document n'est rattaché au dossier de {employee.displayName}.</p>
                      </div>
                      {canUploadDocs && (
                        <Button onClick={() => router.push(`/entity/${entityId}/documents`)} variant="outline" size="sm" className="rounded-xl font-bold bg-white">
                          Gérer dans le registre global
                        </Button>
                      )}
                  </div>
                </Card>
              ) : (
                <div className="space-y-12">
                  <DocumentGroupSection title="Contrats & Clôture" bundles={groupedDocsByTab.contracts} icon={FileBadge} onOpen={handleOpenDoc} onReplace={setReplacingDoc} loadingId={loadingAction} canReplace={canUploadDocs} />
                  <DocumentGroupSection title="Identité & Conformité" bundles={groupedDocsByTab.identity} icon={Fingerprint} onOpen={handleOpenDoc} onReplace={setReplacingDoc} loadingId={loadingAction} canReplace={canUploadDocs} />
                  <DocumentGroupSection title="Embauche & Compliance" bundles={groupedDocsByTab.hiring} icon={ListTodo} onOpen={handleOpenDoc} onReplace={setReplacingDoc} loadingId={loadingAction} canReplace={canUploadDocs} />
                  <DocumentGroupSection title="Santé & Sécurité" bundles={groupedDocsByTab.safety} icon={ShieldCheck} onOpen={handleOpenDoc} onReplace={setReplacingDoc} loadingId={loadingAction} canReplace={canUploadDocs} />
                  <DocumentGroupSection title="Autres documents" bundles={groupedDocsByTab.others} icon={FolderOpen} onOpen={handleOpenDoc} onReplace={setReplacingDoc} loadingId={loadingAction} canReplace={canUploadDocs} />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-8">
          {/* Active Contract Summary */}
          <Card className="border-primary/20 bg-primary/90 text-white shadow-2xl shadow-primary/20 rounded-[2.5rem] overflow-hidden">
             <CardHeader className="bg-white/10 py-6 px-8 border-b border-white/10">
                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <FileSignature className="w-4 h-4" /> Contrat Actif
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                {loadingContract ? (
                   <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin" /></div>
                ) : !contract ? (
                   <div className="space-y-2">
                     <p className="text-xs italic opacity-60">Aucun contrat signé et actif pour le moment.</p>
                     {employee.pendingContractId && (
                       <div className="p-3 bg-white/10 rounded-xl border border-white/20 flex items-center gap-2 text-[10px] font-bold">
                         <Info className="w-3.5 h-3.5" />
                         <span>Un contrat est en cours de préparation (Onboarding)</span>
                       </div>
                     )}
                   </div>
                ) : (
                   <>
                      <SummaryRow label="Type" value={contract.contractType} />
                      <SummaryRow label="Début" value={formatDate(contract.startDate)} />
                      {contract.endDate && <SummaryRow label="Fin (CDD)" value={formatDate(contract.endDate)} />}
                      <SummaryRow label="Hebdo" value={`${contract.weeklyHours}h`} />
                      <Separator className="bg-white/10" />
                      <SummaryRow label="CCNL" value={contract.ccnlName} />
                      <SummaryRow label="Niveau" value={contract.levelCode} />
                      <Separator className="bg-white/10" />
                      <div className="pt-2 flex justify-between items-end">
                         <p className="text-[10px] font-black uppercase text-white/50 tracking-widest">Salaire Brut Annuel</p>
                         <p className="text-2xl font-black">€ {contract.grossAnnual?.toLocaleString('fr-FR')}</p>
                      </div>
                   </>
                )}
             </CardContent>
          </Card>

          {/* Pending / Onboarding Contract */}
          {employee.pendingContractId && !contract && (
            <Card className="border-dashed border-2 border-accent/30 bg-white shadow-lg rounded-[2.5rem] overflow-hidden animate-in fade-in slide-in-from-top-2">
               <CardHeader className="bg-accent/5 py-4 px-8 border-b">
                  <CardTitle className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-2">
                     <Clock className="w-4 h-4" /> 
                     {pendingContract?.status === 'pending_signature' ? "Contrat en attente de signature" : "Contrat en préparation"}
                  </CardTitle>
               </CardHeader>
               <CardContent className="p-8 space-y-4">
                  {loadingPendingContract ? (
                    <div className="flex justify-center py-2"><Loader2 className="w-5 h-5 animate-spin text-accent/30" /></div>
                  ) : pendingContract ? (
                    <>
                      <div className="grid grid-cols-1 gap-3">
                         <DetailRow label="Type de contrat" value={pendingContract.contractType} className="opacity-80" />
                         <div className="flex items-center justify-between">
                            <DetailRow label="Date début" value={formatDate(pendingContract.startDate)} className="opacity-80" />
                            {getContractStatusBadge(pendingContract.status)}
                         </div>
                         <DetailRow label="Classification" value={`${pendingContract.ccnlName} • ${pendingContract.levelCode}`} className="opacity-80" />
                         <div className="flex items-center justify-between pt-2">
                            <span className="text-[10px] font-black uppercase text-muted-foreground">Brut Annuel</span>
                            <span className="text-sm font-black text-primary">€ {pendingContract.grossAnnual?.toLocaleString('fr-FR')}</span>
                         </div>
                      </div>
                      <Separator className="border-dashed" />
                      <div className="bg-accent/5 p-3 rounded-xl border border-accent/10 flex items-start gap-3">
                         <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                         <p className="text-[10px] font-bold text-accent-foreground leading-relaxed">
                            {pendingContract.status === 'pending_signature' 
                              ? "Ce contrat est prêt et en attente de signature. Il n’est pas encore actif."
                              : "Ce contrat est en cours de préparation et n’est pas encore prêt pour signature."
                            }
                         </p>
                      </div>
                      <Button variant="outline" className="w-full rounded-xl border-accent/20 text-accent font-bold h-10 gap-2" asChild>
                         <Link href={`/entity/${entityId}/contracts/${pendingContract.contractId}`}>
                            Gérer dans le module contrats
                         </Link>
                      </Button>
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">Chargement des détails du dossier...</p>
                  )}
               </CardContent>
            </Card>
          )}

          {/* Quick Shortcuts */}
          <div className="space-y-3">
             <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Actions Rapides</p>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <History className="w-4 h-4" /> Historique (Bientôt)
             </Button>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <ShieldCheck className="w-4 h-4" /> Sécurité (Bientôt)
             </Button>
             <Button variant="outline" className="w-full h-11 rounded-xl justify-start gap-3 border-primary/10 opacity-50 cursor-not-allowed">
                <GraduationCap className="w-4 h-4" /> Formations (Bientôt)
             </Button>
          </div>
        </div>
      </div>

      {/* Replacement Dialog */}
      <Dialog open={!!replacingDoc} onOpenChange={(open) => !open && setReplacingDoc(null)}>
        <DialogContent className="sm:max-w-[500px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-primary flex items-center gap-2">
              <RefreshCcw className="w-6 h-6" /> Renouveler le document
            </DialogTitle>
            <DialogDescription>
              Remplacez la version actuelle de "{replacingDoc?.title}" par un nouveau fichier.
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 space-y-6">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Motif du renouvellement (Requis)</Label>
              <Select value={replacementReason} onValueChange={setReplacementReason}>
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder="Choisir un motif..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expiration">Document arrivé à expiration</SelectItem>
                  <SelectItem value="correction">Correction d'erreur / Erreur de saisie</SelectItem>
                  <SelectItem value="update">Mise à jour des informations</SelectItem>
                  <SelectItem value="other">Autre raison</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Nouvelle date d'expiration (Optionnel)</Label>
              <Input 
                type="date" 
                value={replacementExpiry} 
                onChange={(e) => setReplacementExpiry(e.target.value)}
                className="h-12 rounded-xl"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Nouveau fichier (PDF, PNG, JPG)</Label>
              <div className={cn(
                "border-2 border-dashed rounded-2xl p-8 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                replacementFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
              )}>
                <Input 
                  type="file" 
                  accept=".pdf,.png,.jpg,.jpeg" 
                  onChange={(e) => setReplacementFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                {replacementFile ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-green-500 mb-1" />
                    <p className="text-xs font-bold text-green-800">{replacementFile.name}</p>
                    <p className="text-[9px] uppercase font-black text-green-600">Fichier prêt</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-slate-300 mb-1" />
                    <p className="text-xs font-bold text-slate-600">Cliquez pour sélectionner le fichier</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setReplacingDoc(null)} disabled={isReplacing}>Annuler</Button>
            <Button 
              onClick={handleExecuteReplacement} 
              disabled={isReplacing || !replacementFile || !replacementReason}
              className="rounded-xl px-8 font-black gap-2"
            >
              {isReplacing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer la nouvelle version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentGroupSection({ title, bundles, icon: Icon, onOpen, onReplace, loadingId, canReplace }: { 
  title: string, 
  bundles: { current?: HRDocument, history: HRDocument[] }[], 
  icon: any, 
  onOpen: any, 
  onReplace: (doc: HRDocument) => void,
  loadingId: string | null,
  canReplace: boolean
}) {
  if (bundles.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon className="w-3.5 h-3.5 text-primary/40" />
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-6">
        {bundles.map((bundle, i) => (
          <div key={i} className="space-y-3">
             {bundle.current ? (
               <DocumentRow 
                 doc={bundle.current} 
                 onOpen={onOpen} 
                 onReplace={onReplace}
                 loadingId={loadingId} 
                 isMain 
                 canReplace={canReplace}
               />
             ) : bundle.history.length > 0 ? (
               <DocumentRow 
                 doc={bundle.history[0]} 
                 onOpen={onOpen} 
                 onReplace={onReplace}
                 loadingId={loadingId} 
                 isMain 
                 canReplace={canReplace}
               />
             ) : null}

             {bundle.history.length > 0 && (bundle.current ? true : bundle.history.length > 1) && (
                <div className="pl-4 sm:pl-8">
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-[9px] font-black uppercase tracking-widest gap-2 hover:bg-white">
                        <ChevronDown className="w-3 h-3" />
                        Historique des versions ({bundle.current ? bundle.history.length : bundle.history.length - 1})
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 mt-2 animate-in fade-in slide-in-from-top-1">
                      {bundle.history
                        .filter(h => h.id !== bundle.current?.id)
                        .map(d => (
                          <DocumentRow key={d.id} doc={d} onOpen={onOpen} onReplace={onReplace} loadingId={loadingId} compactVersion canReplace={false} />
                        ))}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
             )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentRow({ 
  doc, 
  onOpen, 
  onReplace,
  loadingId, 
  isMain, 
  compactVersion, 
  customLabel,
  canReplace
}: { 
  doc: HRDocument, 
  onOpen: any, 
  onReplace: (doc: HRDocument) => void,
  loadingId: string | null,
  isMain?: boolean,
  compactVersion?: boolean,
  customLabel?: string,
  canReplace: boolean
}) {
  const isLoading = loadingId === doc.id;
  const expiryDate = parseSafeDate(doc.expiresAt);
  const today = startOfDay(new Date());
  const isExpired = expiryDate && isBefore(expiryDate, today);
  const isExpiringSoon = expiryDate && !isExpired && differenceInDays(expiryDate, today) <= 30;

  return (
    <Card className={cn(
      "border-primary/5 hover:border-primary/20 transition-all shadow-sm rounded-2xl group overflow-hidden bg-white",
      isMain && "border-primary/20 shadow-md ring-1 ring-primary/5",
      compactVersion && "rounded-xl opacity-80"
    )}>
      <CardContent className={cn("p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4", compactVersion && "p-3")}>
        <div className="flex items-start gap-4">
          <div className={cn("bg-primary/5 p-3 rounded-xl text-primary shrink-0", compactVersion && "p-2")}>
            <FileText className={cn("w-5 h-5", compactVersion && "w-4 h-4")} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn("font-bold text-slate-900 truncate max-w-[200px] sm:max-w-md", compactVersion && "text-xs")}>{doc.title}</p>
              {doc.isSensitive && <Badge variant="destructive" className="h-4 text-[8px] uppercase font-black px-1.5 border-none">Sensible</Badge>}
              {doc.version > 1 && <Badge variant="outline" className="h-4 text-[8px] uppercase font-black border-primary/20">V{doc.version}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-black uppercase text-muted-foreground/60">
                {customLabel || DOCUMENT_TYPE_LABELS[doc.documentType]}
              </span>
              <span className="text-slate-200 text-[8px]">•</span>
              <span className="text-[9px] font-bold text-muted-foreground/50 italic">
                {formatDateSafe(doc.uploadedAt || doc.generatedAt || doc.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-6 pl-12 sm:pl-0">
           {expiryDate && (
             <div className="flex flex-col items-end">
                <p className="text-[8px] font-black uppercase text-muted-foreground tracking-tighter">Échéance</p>
                <div className="flex items-center gap-1.5">
                   <span className={cn("text-[10px] font-black", isExpired ? "text-red-600" : isExpiringSoon ? "text-orange-600" : "text-slate-600")}>
                     {formatDateSafe(doc.expiresAt)}
                   </span>
                   {isExpired ? (
                     <AlertTriangle className="w-3 h-3 text-red-500" />
                   ) : isExpiringSoon ? (
                     <Clock className="w-3 h-3 text-orange-500" />
                   ) : null}
                </div>
             </div>
           )}

           <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("text-[9px] uppercase font-black h-5 border-primary/10", 
                isExpired ? "bg-red-50 text-red-700 border-red-100" :
                isExpiringSoon ? "bg-orange-50 text-orange-700 border-orange-100" :
                doc.status === 'valid' ? "bg-green-50 text-green-700" : 
                doc.status === 'replaced' ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-400")}>
                {isExpired ? "Expiré" : isExpiringSoon ? "Échéance proche" : STATUS_LABELS[doc.status]}
              </Badge>
              
              <div className="flex gap-1">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className={cn("h-8 rounded-xl font-bold bg-primary/5 text-primary hover:bg-primary hover:text-white transition-all gap-2", compactVersion && "h-7 px-2 text-[10px]")}
                  onClick={() => onOpen(doc.storagePath, doc.id)}
                  disabled={!!loadingId}
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Consulter</span>
                </Button>

                {canReplace && isMain && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-xl font-bold border-primary/10 gap-2 hover:bg-secondary/50"
                    onClick={() => onReplace(doc)}
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Renouveler</span>
                  </Button>
                )}
              </div>
           </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, className, icon: Icon }: { label: string, value: any, className?: string, icon?: any }) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tight mb-1 opacity-70">{label}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
         {Icon && <Icon className="w-3.5 h-3.5 text-primary/40" />}
         {value || "Non renseigné"}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string, value: any }) {
  return (
    <div className="flex justify-between items-start gap-4">
       <span className="text-[10px] font-black uppercase text-white/50 tracking-widest shrink-0">{label}</span>
       <span className="text-sm font-bold text-right truncate">{value || "-"}</span>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active': return <Badge className="bg-green-500 hover:bg-green-600 border-none text-white">ACTIF</Badge>;
    case 'suspended': return <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200">SUSPENDU</Badge>;
    case 'terminated': return <Badge variant="destructive" className="bg-red-50 text-red-700 border-red-200">TERMINE</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function getContractStatusBadge(status: string) {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="text-[8px] h-4 px-1 bg-slate-100 text-slate-500 uppercase font-black">Brouillon</Badge>;
    case 'pending_signature': return <Badge variant="secondary" className="text-[8px] h-4 px-1 bg-orange-50 text-orange-600 border-orange-200 uppercase font-black">En signature</Badge>;
    case 'active': return <Badge className="text-[8px] h-4 px-1 bg-green-500 text-white border-none uppercase font-black">Actif</Badge>;
    default: return <Badge variant="outline" className="text-[8px] h-4 px-1 uppercase font-black">{status}</Badge>;
  }
}
