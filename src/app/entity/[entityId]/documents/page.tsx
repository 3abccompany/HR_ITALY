"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  FolderOpen, Plus, Search, FileText, Loader2, 
  Download, Archive, Eye, User, FileBadge, 
  Calendar, AlertCircle, Filter, X, ChevronRight,
  ShieldAlert, Clock, Building2, ListFilter,
  FileCheck, ShieldCheck, AlertTriangle, Info,
  RefreshCcw, Upload, ChevronDown, ChevronUp,
  Briefcase
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebase, useCollection, useUser } from "@/firebase";
import { collection, query, orderBy, Query } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { 
  HRDocument, 
  HRDocumentType, 
  DOCUMENT_TYPE_LABELS, 
  STATUS_LABELS 
} from "@/types/hr-document";
import { 
  uploadHRDocument, 
  archiveHRDocument, 
  getDocumentDownloadUrl,
  replaceHRDocument
} from "@/services/document.service";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter, 
  DialogDescription 
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { format, isBefore, addDays, startOfDay, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Employee } from "@/types/employee";
import { Separator } from "@/components/ui/separator";
import React from "react";
import Link from "next/link";

interface Filters {
  search: string;
  type: string;
  status: string;
  employee: string;
}

const initialFilters: Filters = {
  search: "",
  type: "all",
  status: "all",
  employee: "all"
};

const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
    if (isNaN(d.getTime())) return null;
    return d;
  }
  
  return null;
}

function formatDateSafe(val: any, formatStr: string = "dd/MM/yyyy"): string {
  const date = parseSafeDate(val);
  if (!date) return "-";
  return format(date, formatStr, { locale: fr });
}

/**
 * Renders the contract lifecycle context (Active/Future/Historical) for a document.
 */
function renderContractContext(doc: HRDocument, employee?: Employee) {
  const isContractDoc = ['signed_contract', 'generated_contract_pdf', 'unilav_receipt', 'cpi_receipt'].includes(doc.documentType);
  if (!isContractDoc && doc.relatedModule !== 'contracts') return null;
  if (!doc.contractId) return null;

  const isCoreContract = ['signed_contract', 'generated_contract_pdf'].includes(doc.documentType);
  let label = doc.contractType || "Contrat";
  let color = "bg-slate-50 text-slate-500 border-slate-200";

  if (employee) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = parseSafeDate(doc.contractStartDate);
    const isFuture = startDate && startDate > today;

    if (employee.activeContractId === doc.contractId) {
      label = isCoreContract ? "Contrat actif" : "Lié au contrat actif";
      color = "bg-blue-50 text-blue-700 border-blue-200";
    } else if (employee.pendingContractId === doc.contractId || isFuture) {
      label = isCoreContract ? "Contrat à venir" : "Lié au contrat à venir";
      color = "bg-teal-50 text-teal-700 border-teal-100";
    } else {
      label = isCoreContract ? "Contrat précédent" : "Lié au contrat précédent";
      color = "bg-slate-50 text-slate-500 border-slate-200";
    }
  }

  return (
    <Badge variant="outline" className={cn("text-[8px] h-4 px-1.5 font-black uppercase", color)}>
       {label}
    </Badge>
  );
}

export default function DocumentsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  // Registry State
  const [viewMode, setViewMode] = useState("all");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [selectedDocForDetails, setSelectedDocForDetails] = useState<HRDocument | null>(null);

  // Upload State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    documentType: "" as HRDocumentType | "",
    employeeId: "none",
    expiresAt: "",
    isSensitive: false,
    description: ""
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Renewal / Replacement State
  const [selectedDocForReplacement, setSelectedDocForReplacement] = useState<HRDocument | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [replacementExpiresAt, setReplacementExpiresAt] = useState("");
  const [isReplacing, setIsReplacing] = useState(false);

  // Permissions
  const canRead = hasPermission("documents.read");
  const canUpload = hasPermission("documents.upload");
  const canArchive = hasPermission("documents.archive");

  // Queries
  const docsQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/documents`), orderBy("uploadedAt", "desc")) as Query<HRDocument>;
  }, [db, entityId, canRead, permissionsReady]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`), orderBy("displayName", "asc")) as Query<Employee>;
  }, [db, entityId, canRead, permissionsReady]);

  const { data: documents, loading: loadingDocs } = useCollection<HRDocument>(docsQuery, "documents.registry");
  const { data: employees } = useCollection<Employee>(employeesQuery, "documents.employees_lookup");

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeId, e));
    return map;
  }, [employees]);

  const filteredDocs = useMemo(() => {
    if (!documents) return [];
    return documents.filter(d => {
      if (filters.search) {
        const term = filters.search.toLowerCase();
        if (!d.title.toLowerCase().includes(term) && !d.fileName.toLowerCase().includes(term)) return false;
      }
      if (filters.type !== "all" && d.documentType !== filters.type) return false;
      if (filters.status !== "all" && d.status !== filters.status) return false;
      if (filters.employee !== "all") {
        if (filters.employee === "none" && d.employeeId) return false;
        if (filters.employee !== "none" && d.employeeId !== filters.employee) return false;
      }
      return true;
    });
  }, [documents, filters]);

  // --- Grouping Logic ---

  const docsByEmployee = useMemo(() => {
    const groups: Record<string, { name: string, docs: HRDocument[] }> = {};
    filteredDocs.forEach(d => {
      const key = d.employeeId || "none";
      if (!groups[key]) {
        groups[key] = { 
          name: d.employeeDisplayName || (key === "none" ? "Documents non liés à un employé" : "Employé inconnu"), 
          docs: [] 
        };
      }
      groups[key].docs.push(d);
    });
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === "none") return 1;
      if (b[0] === "none") return -1;
      return a[1].name.localeCompare(b[1].name);
    });
  }, [filteredDocs]);

  const docsByType = useMemo(() => {
    const groups: Record<string, HRDocument[]> = {};
    filteredDocs.forEach(d => {
      if (!groups[d.documentType]) groups[d.documentType] = [];
      groups[d.documentType].push(d);
    });
    return Object.entries(groups).sort((a, b) => 
      DOCUMENT_TYPE_LABELS[a[0] as HRDocumentType].localeCompare(DOCUMENT_TYPE_LABELS[b[0] as HRDocumentType])
    );
  }, [filteredDocs]);

  const docsByExpiry = useMemo(() => {
    const today = startOfDay(new Date());
    const groups = {
      expired: [] as HRDocument[],
      due_30: [] as HRDocument[],
      due_60: [] as HRDocument[],
      due_90: [] as HRDocument[],
      no_expiry: [] as HRDocument[]
    };

    filteredDocs.forEach(d => {
      const expiry = parseSafeDate(d.expiresAt);
      if (!expiry) {
        groups.no_expiry.push(d);
        return;
      }
      const daysLeft = differenceInDays(expiry, today);

      if (isBefore(expiry, today)) {
        groups.expired.push(d);
      } else if (daysLeft <= 30) {
        groups.due_30.push(d);
      } else if (daysLeft <= 60) {
        groups.due_60.push(d);
      } else if (daysLeft <= 90) {
        groups.due_90.push(d);
      } else {
        groups.no_expiry.push(d);
      }
    });

    return groups;
  }, [filteredDocs]);

  // --- Summary Statistics ---
  const stats = useMemo(() => {
    if (!documents) return { total: 0, sensitive: 0, expired: 0, due30: 0 };
    const today = startOfDay(new Date());
    
    return documents.reduce((acc, d) => {
      acc.total++;
      if (d.isSensitive) acc.sensitive++;
      
      const expiry = parseSafeDate(d.expiresAt);
      if (expiry) {
        if (isBefore(expiry, today)) {
          acc.expired++;
        } else if (differenceInDays(expiry, today) <= 30) {
          acc.due30++;
        }
      }
      return acc;
    }, { total: 0, sensitive: 0, expired: 0, due30: 0 });
  }, [documents]);

  // --- Handlers ---

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

  const handleArchive = async (id: string) => {
    if (!user) return;
    setLoadingAction(id);
    try {
      await archiveHRDocument(entityId, id, user.uid);
      toast({ title: "Document archivé" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedFile || !uploadForm.documentType) return;

    setUploading(true);
    try {
      const employee = uploadForm.employeeId !== "none" ? employees?.find(e => e.employeeId === uploadForm.employeeId) : null;
      
      const metadata: Partial<HRDocument> = {
        title: uploadForm.title,
        documentType: uploadForm.documentType,
        description: uploadForm.description || null,
        employeeId: employee?.employeeId || null,
        employeeDisplayName: employee?.displayName || null,
        personId: employee?.personId || null,
        expiresAt: uploadForm.expiresAt || null,
        isSensitive: uploadForm.isSensitive,
        status: "valid"
      };

      await uploadHRDocument(entityId, selectedFile, metadata, user.uid, membership?.userDisplayName);
      
      toast({ title: "Document téléversé", description: "Le fichier a été enregistré dans le registre." });
      setIsUploadOpen(false);
      setUploadForm({ title: "", documentType: "", employeeId: "none", expiresAt: "", isSensitive: false, description: "" });
      setSelectedFile(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleExecuteReplacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedDocForReplacement || !replacementFile || !replacementExpiresAt) return;

    setIsReplacing(true);
    try {
      await replaceHRDocument(
        entityId,
        selectedDocForReplacement.id,
        replacementFile,
        user.uid,
        replacementReason,
        { expiresAt: replacementExpiresAt },
        membership?.userDisplayName || undefined
      );

      toast({ title: "Document renouvelé", description: "La nouvelle version a été enregistrée avec la nouvelle échéance." });
      setSelectedDocForReplacement(null);
      setReplacementFile(null);
      setReplacementReason("");
      setReplacementExpiresAt("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur de renouvellement", description: err.message });
    } finally {
      setIsReplacing(false);
    }
  };

  const validateFile = (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Format non supporté. PDF, PNG ou JPEG uniquement.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Fichier trop volumineux. Max 10Mo.";
    }
    return null;
  };

  if (membershipLoading || !canRead) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  const isFormValid = uploadForm.title.trim() !== "" && uploadForm.documentType !== "" && selectedFile !== null;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-32">
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Gestion Documentaire</h1>
          <p className="text-muted-foreground text-sm">Registre centralisé des documents RH, contrats et justificatifs.</p>
        </div>
        {canUpload && (
          <Button onClick={() => setIsUploadOpen(true)} className="gap-2 rounded-xl shadow-lg shadow-primary/10">
            <Plus className="w-4 h-4" /> Ajouter un document
          </Button>
        )}
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total documents" value={stats.total} icon={FileText} color="blue" />
        <StatCard title="Sensibles" value={stats.sensitive} icon={ShieldCheck} color="orange" />
        <StatCard title="Expirés" value={stats.expired} icon={AlertTriangle} color="red" />
        <StatCard title="Renouveler (30j)" value={stats.due30} icon={Clock} color="indigo" />
      </div>

      <div className="space-y-6">
        {/* Filter Bar */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                className="pl-10 rounded-xl" 
                placeholder="Rechercher par titre ou nom de fichier..." 
                value={filters.search} 
                onChange={(e) => setFilters(p => ({...p, search: e.target.value}))} 
              />
            </div>
            
            <Select value={filters.type} onValueChange={(v) => setFilters(p => ({...p, type: v}))}>
              <SelectTrigger className="w-[180px] rounded-xl"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}>
              <SelectTrigger className="w-[150px] rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" onClick={() => setFilters(initialFilters)} className="text-muted-foreground text-xs font-bold uppercase">
              <X className="w-3.5 h-3.5 mr-1" /> Réinitialiser
            </Button>
          </div>
        </div>

        {loadingDocs ? (
          <div className="py-20 text-center"><Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" /></div>
        ) : documents?.length === 0 ? (
          <Card className="border-dashed border-2 rounded-[2rem] py-20 bg-secondary/5">
             <div className="text-center max-sm mx-auto space-y-4">
                <div className="bg-white p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto shadow-sm">
                   <FolderOpen className="w-10 h-10 text-muted-foreground/30" />
                </div>
                <div className="space-y-1">
                   <h3 className="font-bold text-primary">Aucun document</h3>
                   <p className="text-sm text-muted-foreground leading-relaxed">
                     Commencez par ajouter un document RH.
                   </p>
                </div>
                {canUpload && (
                  <Button onClick={() => setIsUploadOpen(true)} size="sm" className="rounded-xl font-bold">
                    Ajouter le premier document
                  </Button>
                )}
             </div>
          </Card>
        ) : (
          <Tabs value={viewMode} onValueChange={setViewMode} className="space-y-6">
            <TabsList className="bg-white border p-1 h-12 rounded-xl shadow-sm">
              <TabsTrigger value="all" className="rounded-lg font-bold px-6">Tous</TabsTrigger>
              <TabsTrigger value="employee" className="rounded-lg font-bold px-6">Par employé</TabsTrigger>
              <TabsTrigger value="type" className="rounded-lg font-bold px-6">Par type</TabsTrigger>
              <TabsTrigger value="expiry" className="rounded-lg font-bold px-6">Échéances</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-0">
               <Card className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white">
                  <DocumentsTable 
                    docs={filteredDocs} 
                    employeesMap={employeesMap}
                    loadingId={loadingAction} 
                    onOpen={handleOpenDoc} 
                    onArchive={handleArchive}
                    onReplace={setSelectedDocForReplacement}
                    onViewDetails={setSelectedDocForDetails}
                    canArchive={canArchive}
                  />
               </Card>
            </TabsContent>

            <TabsContent value="employee" className="mt-0 space-y-6">
              {docsByEmployee.map(([key, group]) => (
                <div key={key} className="space-y-3">
                   <div className="flex items-center gap-3 px-2">
                      <h3 className="font-black text-xs uppercase tracking-wider text-primary">{group.name}</h3>
                      <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px] font-black h-5">{group.docs.length}</Badge>
                   </div>
                   <Card className="rounded-3xl border-primary/5 overflow-hidden shadow-sm bg-white">
                      <DocumentsTable 
                        docs={group.docs} 
                        employeesMap={employeesMap}
                        loadingId={loadingAction} 
                        onOpen={handleOpenDoc} 
                        onArchive={handleArchive}
                        onReplace={setSelectedDocForReplacement}
                        onViewDetails={setSelectedDocForDetails}
                        canArchive={canArchive}
                        compact
                      />
                   </Card>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="type" className="mt-0 space-y-6">
              {docsByType.map(([type, docs]) => (
                <div key={type} className="space-y-3">
                   <div className="flex items-center gap-3 px-2">
                      <h3 className="font-black text-xs uppercase tracking-wider text-primary">
                        {DOCUMENT_TYPE_LABELS[type as HRDocumentType]}
                      </h3>
                      <Badge variant="secondary" className="bg-accent/10 text-accent text-[10px] font-black h-5">{docs.length}</Badge>
                   </div>
                   <Card className="rounded-3xl border-primary/5 overflow-hidden shadow-sm bg-white">
                      <DocumentsTable 
                        docs={docs} 
                        employeesMap={employeesMap}
                        loadingId={loadingAction} 
                        onOpen={handleOpenDoc} 
                        onArchive={handleArchive}
                        onReplace={setSelectedDocForReplacement}
                        onViewDetails={setSelectedDocForDetails}
                        canArchive={canArchive}
                        compact
                      />
                   </Card>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="expiry" className="mt-0 space-y-8">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <ExpirySection title="Expirés" docs={docsByExpiry.expired} variant="danger" onOpen={handleOpenDoc} onArchive={handleArchive} onReplace={setSelectedDocForReplacement} onViewDetails={setSelectedDocForDetails} loadingId={loadingAction} />
                  <ExpirySection title="Sous 30 jours" docs={docsByExpiry.due_30} variant="warning" onOpen={handleOpenDoc} onArchive={handleArchive} onReplace={setSelectedDocForReplacement} onViewDetails={setSelectedDocForDetails} loadingId={loadingAction} />
                  <ExpirySection title="Sous 60 jours" docs={docsByExpiry.due_60} variant="info" onOpen={handleOpenDoc} onArchive={handleArchive} onReplace={setSelectedDocForReplacement} onViewDetails={setSelectedDocForDetails} loadingId={loadingAction} />
                  <ExpirySection title="Sous 90 jours" docs={docsByExpiry.due_90} variant="secondary" onOpen={handleOpenDoc} onArchive={handleArchive} onReplace={setSelectedDocForReplacement} onViewDetails={setSelectedDocForDetails} loadingId={loadingAction} />
               </div>
               {docsByExpiry.no_expiry.length > 0 && (
                 <div className="pt-8">
                    <h3 className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 mb-4">Autres documents (Sans échéance)</h3>
                    <Card className="rounded-3xl overflow-hidden opacity-80 border-primary/5 bg-white">
                       <DocumentsTable docs={docsByExpiry.no_expiry} employeesMap={employeesMap} onOpen={handleOpenDoc} onArchive={handleArchive} onReplace={setSelectedDocForReplacement} onViewDetails={setSelectedDocForDetails} loadingId={loadingAction} canArchive={canArchive} compact />
                    </Card>
                 </div>
               )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Details Dialog */}
      <Dialog open={!!selectedDocForDetails} onOpenChange={() => setSelectedDocForDetails(null)}>
        <DialogContent className="sm:max-w-[500px] rounded-[2.5rem]">
           <DialogHeader>
              <DialogTitle className="text-xl font-black text-primary">Détails du document</DialogTitle>
              <DialogDescription>Consultez les métadonnées enregistrées pour ce fichier.</DialogDescription>
           </DialogHeader>
           
           {selectedDocForDetails && (
             <div className="py-6 space-y-6">
                <div className="flex items-center gap-4">
                   <div className="bg-primary/5 p-4 rounded-[1.5rem] text-primary">
                      <FileText className="w-8 h-8" />
                   </div>
                   <div className="min-w-0">
                      <h3 className="font-black text-lg text-slate-900 truncate">{selectedDocForDetails.title}</h3>
                      <p className="text-xs font-bold text-accent uppercase tracking-widest">{DOCUMENT_TYPE_LABELS[selectedDocForDetails.documentType]}</p>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                   <DetailItem label="Statut" value={<Badge variant="outline" className="h-5 uppercase text-[9px] font-black bg-slate-50">{STATUS_LABELS[selectedDocForDetails.status]}</Badge>} />
                   <DetailItem label="Employé" value={selectedDocForDetails.employeeDisplayName || "Non lié"} />
                   <DetailItem label="Nom du fichier" value={selectedDocForDetails.fileName} code />
                   <DetailItem label="Version" value={`V${selectedDocForDetails.version || 1}`} />
                   <DetailItem label="Téléversé le" value={formatDateSafe(selectedDocForDetails.uploadedAt, "dd/MM/yyyy HH:mm")} />
                   {selectedDocForDetails.expiresAt && <DetailItem label="Expiration" value={<span className={cn("font-black", isBefore(parseSafeDate(selectedDocForDetails.expiresAt) || new Date(), startOfDay(new Date())) ? "text-red-600" : "text-slate-800")}>{formatDateSafe(selectedDocForDetails.expiresAt)}</span>} />}
                </div>

                {selectedDocForDetails.replacementReason && (
                  <div className="space-y-1">
                     <p className="text-[9px] font-black uppercase text-muted-foreground">Motif du renouvellement</p>
                     <p className="text-xs text-slate-600 bg-secondary/20 p-3 rounded-xl border border-dashed italic">"{selectedDocForDetails.replacementReason}"</p>
                  </div>
                )}
             </div>
           )}

           <DialogFooter className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelectedDocForDetails(null)} className="rounded-xl font-bold">Fermer</Button>
              {selectedDocForDetails && (
                <Button onClick={() => handleOpenDoc(selectedDocForDetails.storagePath, selectedDocForDetails.id)} className="rounded-xl font-black gap-2">
                   <Eye className="w-4 h-4" /> Ouvrir le document
                </Button>
              )}
           </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-primary">Ajouter un document</DialogTitle>
            <DialogDescription>Importez un nouveau fichier dans le registre de l'entité.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Titre du document (Requis)</Label>
                <Input 
                  value={uploadForm.title} 
                  onChange={(e) => setUploadForm(p => ({...p, title: e.target.value}))} 
                  required 
                  placeholder="Ex: CNI Recto-Verso" 
                  className="rounded-xl h-11"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Type de document</Label>
                <Select value={uploadForm.documentType} onValueChange={(v) => setUploadForm(p => ({...p, documentType: v as HRDocumentType}))}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Lier à un employé (Optionnel)</Label>
                <Select value={uploadForm.employeeId} onValueChange={(v) => setUploadForm(p => ({...p, employeeId: v}))}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Sél. collaborateur" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--- Aucun ---</SelectItem>
                    {employees?.map(e => <SelectItem key={e.employeeId} value={e.employeeId}>{e.displayName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Date d'expiration</Label>
                <Input type="date" value={uploadForm.expiresAt} onChange={(e) => setUploadForm(p => ({...p, expiresAt: e.target.value}))} className="rounded-xl h-11" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Description / Notes</Label>
              <Textarea value={uploadForm.description} onChange={(e) => setUploadForm(p => ({...p, description: e.target.value}))} className="min-h-[80px] rounded-2xl" />
            </div>

            <div className="flex items-center space-x-2 bg-secondary/20 p-4 rounded-2xl border border-dashed border-primary/20">
               <Checkbox id="sensitive" checked={uploadForm.isSensitive} onCheckedChange={(v) => setUploadForm(p => ({...p, isSensitive: !!v}))} />
               <Label htmlFor="sensitive" className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                 <ShieldAlert className="w-4 h-4 text-orange-500" /> Ce document contient des données sensibles
               </Label>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Fichier (PDF, PNG, JPG - Max 10Mo)</Label>
              <div className={cn(
                "border-2 border-dashed rounded-2xl p-6 transition-all relative flex flex-col items-center justify-center gap-2 text-center",
                selectedFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
              )}>
                 <Input 
                   type="file" 
                   accept=".pdf,.png,.jpg,.jpeg" 
                   onChange={(e) => {
                     const file = e.target.files?.[0] || null;
                     if (file) {
                        const error = validateFile(file);
                        if (error) {
                          toast({ variant: "destructive", title: "Fichier invalide", description: error });
                          e.target.value = "";
                          return;
                        }
                     }
                     setSelectedFile(file);
                   }} 
                   className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                 />
                 {selectedFile ? (
                   <>
                      <div className="bg-green-100 p-2 rounded-xl text-green-600 mb-1"><FileCheck className="w-5 h-5" /></div>
                      <p className="text-xs font-bold text-green-800">{selectedFile.name}</p>
                      <p className="text-[10px] text-green-600 font-bold uppercase">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB — Cliquez pour changer</p>
                   </>
                 ) : (
                   <>
                      <Plus className="w-5 h-5 text-muted-foreground/50 mb-1" />
                      <p className="text-xs font-bold text-slate-600">Cliquez ou glissez un fichier ici</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">PDF, PNG, JPG (10 Mo max)</p>
                   </>
                 )}
              </div>
            </div>

            <div className="DialogFooter pt-4 border-t flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Annuler</Button>
              <Button type="submit" disabled={uploading || !isFormValid} className="rounded-xl px-8 font-black shadow-lg shadow-primary/10">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Importer le document
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Replacement / Renewal Dialog */}
      <Dialog open={!!selectedDocForReplacement} onOpenChange={(open) => !open && setSelectedDocForReplacement(null)}>
        <DialogContent className="sm:max-w-[500px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
              <RefreshCcw className="w-6 h-6 text-accent" />
              Renouveler le document
            </DialogTitle>
            <DialogDescription>
              Vous remplacez : <span className="font-bold text-slate-900">{selectedDocForReplacement?.title}</span> (V{selectedDocForReplacement?.version || 1})
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleExecuteReplacement} className="space-y-6 py-4">
            <div className="space-y-4">
              {selectedDocForReplacement?.expiresAt && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
                   <Clock className="w-4 h-4 text-muted-foreground" />
                   <p className="text-xs text-muted-foreground font-medium">Échéance actuelle : <span className="font-bold text-slate-700">{formatDateSafe(selectedDocForReplacement.expiresAt)}</span></p>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Nouveau fichier (PDF, PNG, JPG)</Label>
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-8 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                  replacementFile ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                )}>
                   <Input 
                     type="file" 
                     accept=".pdf,.png,.jpg,.jpeg" 
                     className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                     onChange={(e) => setReplacementFile(e.target.files?.[0] || null)}
                     required
                   />
                   {replacementFile ? (
                      <>
                        <div className="bg-green-100 p-2 rounded-xl text-green-600 mb-1"><FileCheck className="w-5 h-5" /></div>
                        <p className="text-xs font-bold text-green-800">{replacementFile.name}</p>
                        <p className="text-[10px] text-green-600 font-bold uppercase">Cliquer pour changer</p>
                      </>
                   ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-300 mb-1" />
                        <p className="text-xs font-bold text-slate-600">Cliquez ou glissez le nouveau document</p>
                      </>
                   )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Nouvelle date d'expiration (Requis)</Label>
                <Input 
                  type="date"
                  value={replacementExpiresAt}
                  onChange={(e) => setReplacementExpiresAt(e.target.value)}
                  required
                  className="rounded-xl h-11"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Motif du renouvellement (Requis)</Label>
                <Textarea 
                  placeholder="Ex: Document arrivé à échéance, mise à jour annuelle..."
                  value={replacementReason}
                  onChange={(e) => setReplacementReason(e.target.value)}
                  required
                  className="rounded-xl min-h-[80px]"
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSelectedDocForReplacement(null)} disabled={isReplacing}>Annuler</Button>
              <Button 
                type="submit" 
                disabled={isReplacing || !replacementFile || !replacementExpiresAt || !replacementReason.trim()}
                className="rounded-xl px-8 font-black shadow-lg"
              >
                {isReplacing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                Remplacer le document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailItem({ label, value, code = false }: { label: string, value: any, code?: boolean }) {
  return (
    <div className="space-y-1">
       <p className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{label}</p>
       <div className={cn("text-xs font-bold text-slate-800 truncate", code && "font-mono text-[10px]")}>
          {value}
       </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string, value: number, icon: any, color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };

  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border", colors[color] || colors.blue)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">{title}</p>
          <p className="text-2xl font-black text-primary">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpirySection({ title, docs, variant, onOpen, onArchive, onReplace, onViewDetails, loadingId }: any) {
  const colorClass = variant === 'danger' ? "text-red-700 bg-red-50 border-red-100" : 
                     variant === 'warning' ? "text-orange-700 bg-orange-50 border-orange-100" :
                     variant === 'info' ? "text-blue-700 bg-blue-50 border-blue-100" : "text-slate-700 bg-slate-50 border-slate-100";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
         <h3 className="font-black text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{title}</h3>
         <Badge className={cn("border font-black text-[10px] h-5", colorClass)}>{docs.length}</Badge>
      </div>
      <Card className="rounded-[2rem] border-primary/5 overflow-hidden shadow-sm min-h-[100px] bg-white">
        {docs.length === 0 ? (
          <div className="p-8 text-center text-[10px] font-bold text-muted-foreground uppercase italic tracking-widest">Vide</div>
        ) : (
          <DocumentsTable 
            docs={docs} 
            onOpen={onOpen} 
            onArchive={onArchive} 
            onReplace={onReplace} 
            onViewDetails={onViewDetails} 
            loadingId={loadingId} 
            compact 
          />
        )}
      </Card>
    </div>
  );
}

interface DocumentsTableProps {
  docs: HRDocument[];
  employeesMap?: Map<string, Employee>;
  loadingId: string | null;
  onOpen: (path: string, id: string) => void;
  onArchive: (id: string) => void;
  onReplace?: (doc: HRDocument) => void;
  onViewDetails: (doc: HRDocument) => void;
  canArchive?: boolean;
  compact?: boolean;
}

function DocumentsTable({ 
  docs, 
  employeesMap,
  loadingId, 
  onOpen, 
  onArchive, 
  onReplace, 
  onViewDetails, 
  canArchive, 
  compact 
}: DocumentsTableProps) {
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  const toggleRoot = (id: string) => {
    setExpandedRoots(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build document version chains: group by rootDocumentId || id
  const docChains = useMemo(() => {
    const groups: Record<string, HRDocument[]> = {};
    docs.forEach(d => {
      const rootId = d.rootDocumentId || d.id;
      if (!groups[rootId]) groups[rootId] = [];
      groups[rootId].push(d);
    });

    return Object.values(groups).map(group => {
      const sorted = [...group].sort((a, b) => (b.version || 1) - (a.version || 1));
      
      // Current document rule: status === "valid" and replacedById is missing/null/empty
      // Fallback: If multiple valid exist, use highest version. If none valid, use newest overall.
      let current = sorted.find(d => d.status === 'valid' && !d.replacedById);
      if (!current) current = sorted[0];

      const history = sorted.filter(d => d.id !== current!.id);
      
      return { 
        current, 
        history, 
        rootId: current.rootDocumentId || current.id 
      };
    }).sort((a, b) => {
       const dateA = parseSafeDate(a.current.uploadedAt || a.current.createdAt || 0)?.getTime() || 0;
       const dateB = parseSafeDate(b.current.uploadedAt || b.current.createdAt || 0)?.getTime() || 0;
       return dateB - dateA;
    });
  }, [docs]);

  return (
    <Table>
      {!compact && (
        <TableHeader className="bg-secondary/10">
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead className="pl-2 text-[10px] font-black uppercase tracking-widest">Titre & Type</TableHead>
            <TableHead className="text-[10px] font-black uppercase tracking-widest">Échéance</TableHead>
            <TableHead className="text-[10px] font-black uppercase tracking-widest">Statut</TableHead>
            <TableHead className="text-right pr-6 text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {docChains.length === 0 ? (
          <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic text-xs">Aucun document.</TableCell></TableRow>
        ) : docChains.map(({ current, history, rootId }) => (
          <React.Fragment key={current.id}>
            <DocRow 
              doc={current} 
              onOpen={onOpen} 
              onArchive={onArchive} 
              onReplace={onReplace} 
              onViewDetails={onViewDetails} 
              loadingId={loadingId} 
              canArchive={canArchive}
              hasHistory={history.length > 0}
              isExpanded={expandedRoots.has(rootId)}
              onToggleHistory={() => toggleRoot(rootId)}
              employee={current.employeeId ? employeesMap?.get(current.employeeId) : undefined}
            />
            {history.length > 0 && expandedRoots.has(rootId) && history.map(h => (
              <DocRow 
                key={h.id} 
                doc={h} 
                onOpen={onOpen} 
                onArchive={onArchive} 
                onReplace={onReplace} 
                onViewDetails={onViewDetails} 
                loadingId={loadingId} 
                canArchive={canArchive}
                isHistory
                employee={h.employeeId ? employeesMap?.get(h.employeeId) : undefined}
              />
            ))}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function DocRow({ 
  doc, 
  onOpen, 
  onArchive, 
  onReplace, 
  onViewDetails, 
  loadingId, 
  canArchive,
  isHistory = false,
  hasHistory = false,
  isExpanded = false,
  onToggleHistory,
  employee
}: { 
  doc: HRDocument, 
  onOpen: any, 
  onArchive: any, 
  onReplace?: any, 
  onViewDetails: any, 
  loadingId: string | null, 
  canArchive?: boolean,
  isHistory?: boolean,
  hasHistory?: boolean,
  isExpanded?: boolean,
  onToggleHistory?: () => void,
  employee?: Employee
}) {
  const params = useParams();
  const entityId = params?.entityId as string;
  const isLoading = loadingId === doc.id;
  const expiryDate = parseSafeDate(doc.expiresAt);
  const today = startOfDay(new Date());
  const isExpired = expiryDate && isBefore(expiryDate, today);
  const isExpiringSoon = expiryDate && !isExpired && differenceInDays(expiryDate, today) <= 60;
  
  const isContractDoc = ['signed_contract', 'generated_contract_pdf', 'unilav_receipt', 'cpi_receipt'].includes(doc.documentType) || doc.relatedModule === 'contracts';
  
  // UI replacement rule: Only allow renewal/replacement on current documents (not historical versions) AND NOT on contract docs
  const isRenewable = !isHistory && !isContractDoc && doc.status === 'valid' && !doc.replacedById && expiryDate && (isExpired || isExpiringSoon);

  return (
    <TableRow className={cn(
      "hover:bg-muted/50 transition-colors group",
      isHistory && "bg-slate-50/50 border-l-4 border-l-muted"
    )}>
      <TableCell className="w-[40px] text-center">
        {hasHistory && !isHistory && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleHistory}>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </TableCell>
      <TableCell className={cn("py-3", isHistory && "pl-8")}>
        <div className="flex items-center gap-2">
           <div className="font-bold text-slate-800 text-sm truncate max-w-[250px]">{doc.title}</div>
           {renderContractContext(doc, employee)}
           <Badge variant="outline" className="text-[8px] h-4 px-1 font-black bg-slate-50">V{doc.version || 1}</Badge>
           {isHistory && <Badge variant="secondary" className="text-[8px] h-4 px-1 font-bold uppercase opacity-70">Ancienne version</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
           <div className="text-[9px] uppercase text-muted-foreground/60">{DOCUMENT_TYPE_LABELS[doc.documentType] || doc.documentType}</div>
           {doc.contractStartDate && (
             <>
               <span className="text-slate-200 text-[8px]">•</span>
               <span className="text-[9px] font-bold text-muted-foreground/60 italic">
                 Période: {formatDateSafe(doc.contractStartDate)} {doc.contractEndDate ? `- ${formatDateSafe(doc.contractEndDate)}` : ''}
               </span>
             </>
           )}
           <span className="text-slate-200 text-[8px]">•</span>
           <div className="text-[9px] text-muted-foreground font-medium">{doc.employeeDisplayName || "Général"}</div>
        </div>
      </TableCell>
      <TableCell>
        {expiryDate ? (
          <div className={cn("text-xs font-black", isExpired ? "text-red-600" : isExpiringSoon ? "text-orange-600" : "text-slate-600")}>
            {formatDateSafe(doc.expiresAt)}
            {isExpired && <AlertTriangle className="w-3 h-3 inline ml-1 align-text-bottom" />}
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/30">—</span>
        )}
      </TableCell>
      <TableCell>
         <Badge variant="outline" className={cn("text-[9px] uppercase font-black h-5 border-primary/5", 
           doc.status === 'valid' ? "bg-green-50 text-green-700" : 
           doc.status === 'replaced' ? "bg-slate-100 text-slate-500" : "bg-slate-50")}>
           {STATUS_LABELS[doc.status]}
         </Badge>
         {isHistory && doc.replacedAt && (
           <p className="text-[8px] text-muted-foreground mt-0.5 italic">Remplacé le {formatDateSafe(doc.replacedAt)}</p>
         )}
      </TableCell>
      <TableCell className="text-right pr-6">
         <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isContractDoc && doc.contractId && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" asChild title="Gérer le contrat">
                 <Link href={`/entity/${entityId}/contracts/${doc.contractId}`}>
                    <Briefcase className="w-4 h-4" />
                 </Link>
              </Button>
            )}
            {isRenewable && onReplace && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-accent" onClick={() => onReplace(doc)} title="Renouveler">
                 <RefreshCcw className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onViewDetails(doc)} title="Détails">
               <Eye className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onOpen(doc.storagePath, doc.id)} disabled={loadingId === doc.id} title="Ouvrir">
               {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
            </Button>
            {canArchive && doc.status !== 'archived' && !isHistory && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onArchive(doc.id)} disabled={loadingId === doc.id} title="Archiver">
                 <Archive className="w-4 h-4" />
              </Button>
            )}
         </div>
      </TableCell>
    </TableRow>
  );
}