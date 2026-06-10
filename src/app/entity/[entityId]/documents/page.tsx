"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  FolderOpen, Plus, Search, FileText, Loader2, 
  Download, Archive, Eye, User, FileBadge, 
  Calendar, AlertCircle, Filter, X, ChevronRight,
  ShieldAlert, Clock, Building2, ListFilter,
  FileCheck, ShieldCheck, AlertTriangle, Info,
  RefreshCcw, Upload
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

export default function DocumentsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

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

  // Renewal/Replacement State
  const [selectedDocForReplacement, setSelectedDocForReplacement] = useState<HRDocument | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [isReplacing, setIsReplacing] = useState(false);

  const canRead = hasPermission("documents.read");
  const canUpload = hasPermission("documents.upload");
  const canArchive = hasPermission("documents.archive");

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

  const docsGroupedByEmployee = useMemo(() => {
    const groups = new Map<string, { employeeId: string; employeeName: string; docs: HRDocument[] }>();
  
    filteredDocs.forEach((doc) => {
      const employeeId = doc.employeeId || "none";
  
      const employeeName =
        doc.employeeDisplayName ||
        employees?.find((e) => e.employeeId === doc.employeeId)?.displayName ||
        "Sans employé lié";
  
      if (!groups.has(employeeId)) {
        groups.set(employeeId, {
          employeeId,
          employeeName,
          docs: [],
        });
      }
  
      groups.get(employeeId)!.docs.push(doc);
    });
  
    return Array.from(groups.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, "fr")
    );
  }, [filteredDocs, employees]);

  const docsGroupedByType = useMemo(() => {
    const groups = new Map<string, HRDocument[]>();
    filteredDocs.forEach((doc) => {
      const type = doc.documentType || "other";
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(doc);
    });
    return Array.from(groups.entries()).sort((a, b) => {
      const labelA = DOCUMENT_TYPE_LABELS[a[0] as HRDocumentType] || a[0];
      const labelB = DOCUMENT_TYPE_LABELS[b[0] as HRDocumentType] || b[0];
      return labelA.localeCompare(labelB, "fr");
    });
  }, [filteredDocs]);

  const docsGroupedByExpiry = useMemo(() => {
    const today = startOfDay(new Date());
    const thirtyDays = addDays(today, 30);
    const sixtyDays = addDays(today, 60);

    const buckets = {
      expired: [] as HRDocument[],
      soon30: [] as HRDocument[],
      soon60: [] as HRDocument[],
    };

    filteredDocs.forEach((doc) => {
      const expiry = parseSafeDate(doc.expiresAt);
      if (!expiry) return;

      if (isBefore(expiry, today)) {
        buckets.expired.push(doc);
      } else if (isBefore(expiry, thirtyDays)) {
        buckets.soon30.push(doc);
      } else if (isBefore(expiry, sixtyDays)) {
        buckets.soon60.push(doc);
      }
    });

    const sortFn = (a: HRDocument, b: HRDocument) => {
      const da = parseSafeDate(a.expiresAt)?.getTime() || 0;
      const db = parseSafeDate(b.expiresAt)?.getTime() || 0;
      return da - db;
    };

    return {
      expired: buckets.expired.sort(sortFn),
      soon30: buckets.soon30.sort(sortFn),
      soon60: buckets.soon60.sort(sortFn),
    };
  }, [filteredDocs]);

  const stats = useMemo(() => {
    if (!documents) return { total: 0, sensitive: 0, expired: 0, due30: 0 };
    const today = startOfDay(new Date());
    return documents.reduce((acc, d) => {
      acc.total++;
      if (d.isSensitive) acc.sensitive++;
      const expiry = parseSafeDate(d.expiresAt);
      if (expiry) {
        if (isBefore(expiry, today)) acc.expired++;
        else if (differenceInDays(expiry, today) <= 30) acc.due30++;
      }
      return acc;
    }, { total: 0, sensitive: 0, expired: 0, due30: 0 });
  }, [documents]);

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
      await uploadHRDocument(entityId, selectedFile, metadata, user.uid, membership?.userDisplayName || "Utilisateur");
      toast({ title: "Document téléversé" });
      setIsUploadOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleExecuteReplacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedDocForReplacement || !replacementFile) return;

    setIsReplacing(true);
    try {
      await replaceHRDocument(
        entityId,
        selectedDocForReplacement.id,
        replacementFile,
        user.uid,
        replacementReason,
        {},
        membership?.userDisplayName || undefined
      );
      toast({ title: "Document renouvelé", description: "Une nouvelle version a été créée." });
      setSelectedDocForReplacement(null);
      setReplacementFile(null);
      setReplacementReason("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setIsReplacing(false);
    }
  };

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total documents" value={stats.total} icon={FileText} color="blue" />
        <StatCard title="Sensibles" value={stats.sensitive} icon={ShieldCheck} color="orange" />
        <StatCard title="Expirés" value={stats.expired} icon={AlertTriangle} color="red" />
        <StatCard title="Renouveler (30j)" value={stats.due30} icon={Clock} color="indigo" />
      </div>

      <div className="space-y-6">
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
             <div className="text-center max-w-sm mx-auto space-y-4">
                <div className="bg-white p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto shadow-sm">
                   <FolderOpen className="w-10 h-10 text-muted-foreground/30" />
                </div>
                <div className="space-y-1">
                   <h3 className="font-bold text-primary">Aucun document</h3>
                   <p className="text-sm text-muted-foreground leading-relaxed">Commencez par ajouter un document RH.</p>
                </div>
             </div>
          </Card>
        ) : (
          <Tabs value={viewMode} onValueChange={setViewMode} className="space-y-6">
            <TabsList className="bg-white border p-1 h-11 rounded-xl shadow-sm">
              <TabsTrigger value="all" className="rounded-lg font-bold px-6">Tous</TabsTrigger>
              <TabsTrigger value="employee" className="rounded-lg font-bold px-6">Par employé</TabsTrigger>
              <TabsTrigger value="type" className="rounded-lg font-bold px-6">Par type</TabsTrigger>
              <TabsTrigger value="expiry" className="rounded-lg font-bold px-6">Échéances</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-0">
               <Card className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white">
                  <DocumentsTable 
                    docs={filteredDocs} 
                    loadingId={loadingAction} 
                    onOpen={handleOpenDoc} 
                    onArchive={handleArchive}
                    onReplace={setSelectedDocForReplacement}
                    onViewDetails={setSelectedDocForDetails}
                    canArchive={canArchive}
                    viewMode={viewMode}
                  />
               </Card>
            </TabsContent>
            <TabsContent value="employee" className="mt-0 space-y-6">
            {docsGroupedByEmployee.length === 0 ? (
              <Card className="border-dashed border-2 rounded-[2rem] py-16 bg-secondary/5">
                <div className="text-center max-w-sm mx-auto space-y-3">
                  <User className="w-10 h-10 mx-auto text-muted-foreground/30" />
                  <h3 className="font-bold text-primary">Aucun document par employé</h3>
                  <p className="text-sm text-muted-foreground">
                    Aucun document lié à un employé ne correspond aux filtres actuels.
                  </p>
                </div>
              </Card>
            ) : (
              docsGroupedByEmployee.map((group) => (
                <Card
                  key={group.employeeId}
                  className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white"
                >
                  <CardHeader className="bg-secondary/10 border-b">
                    <CardTitle className="flex items-center justify-between text-sm font-black text-primary">
                      <span className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        {group.employeeName}
                      </span>
                      <Badge variant="secondary" className="font-black">
                        {group.docs.length} document{group.docs.length > 1 ? "s" : ""}
                      </Badge>
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="p-0">
                    <DocumentsTable
                      docs={group.docs}
                      loadingId={loadingAction}
                      onOpen={handleOpenDoc}
                      onArchive={handleArchive}
                      onReplace={setSelectedDocForReplacement}
                      onViewDetails={setSelectedDocForDetails}
                      canArchive={canArchive}
                      viewMode={viewMode}
                    />
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
          <TabsContent value="type" className="mt-0 space-y-6">
            {docsGroupedByType.map(([type, docs]) => (
              <Card key={type} className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white">
                <CardHeader className="bg-secondary/10 border-b">
                  <CardTitle className="flex items-center justify-between text-sm font-black text-primary">
                    <span className="flex items-center gap-2">
                      <FileBadge className="w-4 h-4" />
                      {DOCUMENT_TYPE_LABELS[type as HRDocumentType] || type}
                    </span>
                    <Badge variant="secondary" className="font-black">
                      {docs.length} document{docs.length > 1 ? "s" : ""}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <DocumentsTable
                    docs={docs}
                    loadingId={loadingAction}
                    onOpen={handleOpenDoc}
                    onArchive={handleArchive}
                    onReplace={setSelectedDocForReplacement}
                    onViewDetails={setSelectedDocForDetails}
                    canArchive={canArchive}
                    viewMode={viewMode}
                  />
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          <TabsContent value="expiry" className="mt-0 space-y-8">
            <ExpirySection 
              title="Documents Expirés" 
              docs={docsGroupedByExpiry.expired} 
              variant="expired"
              loadingId={loadingAction}
              onOpen={handleOpenDoc}
              onArchive={handleArchive}
              onReplace={setSelectedDocForReplacement}
              onViewDetails={setSelectedDocForDetails}
              canArchive={canArchive}
            />
            <ExpirySection 
              title="Échéance sous 30 jours" 
              docs={docsGroupedByExpiry.soon30} 
              variant="soon30"
              loadingId={loadingAction}
              onOpen={handleOpenDoc}
              onArchive={handleArchive}
              onReplace={setSelectedDocForReplacement}
              onViewDetails={setSelectedDocForDetails}
              canArchive={canArchive}
            />
            <ExpirySection 
              title="Échéance sous 60 jours" 
              docs={docsGroupedByExpiry.soon60} 
              variant="soon60"
              loadingId={loadingAction}
              onOpen={handleOpenDoc}
              onArchive={handleArchive}
              onReplace={setSelectedDocForReplacement}
              onViewDetails={setSelectedDocForDetails}
              canArchive={canArchive}
            />
          </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-[2.5rem]">
          <DialogHeader><DialogTitle className="text-2xl font-black text-primary">Ajouter un document</DialogTitle></DialogHeader>
          <form onSubmit={handleUpload} className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Titre</Label>
                <Input value={uploadForm.title} onChange={(e) => setUploadForm(p => ({...p, title: e.target.value}))} required className="rounded-xl h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black">Type</Label>
                <Select value={uploadForm.documentType} onValueChange={(v) => setUploadForm(p => ({...p, documentType: v as HRDocumentType}))}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Sél..." /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Annuler</Button>
              <Button type="submit" disabled={uploading || !uploadForm.title || !uploadForm.documentType} className="rounded-xl px-8 font-black shadow-lg">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />} Importer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedDocForReplacement} onOpenChange={(open) => !open && setSelectedDocForReplacement(null)}>
        <DialogContent className="sm:max-w-[500px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
              <RefreshCcw className="w-6 h-6 text-accent" />
              Renouveler le document
            </DialogTitle>
            <DialogDescription>
              Vous remplacez : <span className="font-bold text-slate-900">{selectedDocForReplacement?.title}</span>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleExecuteReplacement} className="space-y-6 py-4">
            <div className="space-y-4">
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
                <Label className="text-[10px] uppercase font-black">Motif du renouvellement</Label>
                <Textarea 
                  placeholder="Ex: Document arrivé à échéance, mise à jour annuelle..."
                  value={replacementReason}
                  onChange={(e) => setReplacementReason(e.target.value)}
                  required
                  className="rounded-xl min-h-[100px]"
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setSelectedDocForReplacement(null)} disabled={isReplacing}>Annuler</Button>
              <Button 
                type="submit" 
                disabled={isReplacing || !replacementFile || !replacementReason.trim()}
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

function StatCard({ title, value, icon: Icon, color }: { title: string, value: number, icon: any, color: string }) {
  const colors: Record<string, string> = { blue: "bg-blue-50 text-blue-600 border-blue-100", orange: "bg-orange-50 text-orange-600 border-orange-100", red: "bg-red-50 text-red-600 border-red-100", indigo: "bg-indigo-50 text-indigo-600 border-indigo-100" };
  return (
    <Card className="border-primary/5 shadow-sm rounded-2xl">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={cn("p-3 rounded-2xl border", colors[color])}><Icon className="w-5 h-5" /></div>
        <div><p className="text-[10px] font-black uppercase text-muted-foreground">{title}</p><p className="text-2xl font-black text-primary">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function ExpirySection({ title, docs, variant, loadingId, onOpen, onArchive, onReplace, onViewDetails, canArchive }: any) {
  if (docs.length === 0) return null;

  const config: any = {
    expired: { color: "text-red-700", icon: AlertTriangle, bg: "bg-red-50" },
    soon30: { color: "text-orange-700", icon: Clock, bg: "bg-orange-50" },
    soon60: { color: "text-indigo-700", icon: Calendar, bg: "bg-indigo-50" },
  };

  const { color, icon: Icon, bg } = config[variant];

  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-3 px-6 py-3 rounded-2xl border border-primary/5 shadow-sm bg-white")}>
        <div className={cn("p-2 rounded-xl", bg, color)}><Icon className="w-4 h-4" /></div>
        <h3 className={cn("font-black uppercase text-xs tracking-widest", color)}>{title}</h3>
        <Badge variant="outline" className={cn("ml-auto border-none font-black", bg, color)}>{docs.length}</Badge>
      </div>
      <Card className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5 bg-white">
        <DocumentsTable 
          docs={docs} 
          loadingId={loadingId} 
          onOpen={onOpen} 
          onArchive={onArchive} 
          onReplace={onReplace}
          onViewDetails={onViewDetails} 
          canArchive={canArchive}
          viewMode="expiry"
        />
      </Card>
    </div>
  );
}

interface DocumentsTableProps {
  docs: HRDocument[];
  loadingId: string | null;
  onOpen: (path: string, id: string) => void;
  onArchive: (id: string) => void;
  onReplace?: (doc: HRDocument) => void;
  onViewDetails: (doc: HRDocument) => void;
  canArchive: boolean;
  viewMode?: string;
}

function DocumentsTable({ docs, loadingId, onOpen, onArchive, onReplace, onViewDetails, canArchive, viewMode }: DocumentsTableProps) {
  return (
    <Table>
      <TableHeader className="bg-secondary/10">
        <TableRow>
          <TableHead className="pl-6">Titre & Type</TableHead>
          <TableHead>Employé</TableHead>
          <TableHead>Échéance</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right pr-6">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.length === 0 ? (
          <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic">Aucun document.</TableCell></TableRow>
        ) : docs.map((d: HRDocument) => {
          const expiryDate = parseSafeDate(d.expiresAt);
          const today = startOfDay(new Date());
          const isExpired = expiryDate && isBefore(expiryDate, today);
          const isExpiringSoon = expiryDate && !isExpired && differenceInDays(expiryDate, today) <= 60;
          const canRenew = onReplace && d.status === 'valid' && (isExpired || isExpiringSoon || viewMode === 'expiry') && !!expiryDate;

          return (
            <TableRow key={d.id} className="hover:bg-muted/50 transition-colors">
              <TableCell className="pl-6">
                <div className="font-bold text-primary">{d.title}</div>
                <div className="text-[9px] uppercase text-muted-foreground">{DOCUMENT_TYPE_LABELS[d.documentType] || d.documentType}</div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <User className="w-3 h-3 text-muted-foreground" />
                  {d.employeeDisplayName || "—"}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 text-xs">
                  <Calendar className="w-3 h-3 text-muted-foreground" />
                  {formatDateSafe(d.expiresAt)}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("text-[10px] font-bold", d.status === 'valid' ? "bg-green-50 text-green-700 border-green-200" : "")}>
                  {STATUS_LABELS[d.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-right pr-6">
                <div className="flex justify-end gap-1">
                  {canRenew && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-accent" 
                      onClick={() => onReplace!(d)} 
                      title="Renouveler"
                    >
                      <RefreshCcw className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => onOpen(d.storagePath, d.id)} disabled={loadingId === d.id}>
                    {loadingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4 text-primary" />}
                  </Button>
                  {canArchive && d.status !== 'archived' && (
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onArchive(d.id)} disabled={loadingId === d.id}>
                      <Archive className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
