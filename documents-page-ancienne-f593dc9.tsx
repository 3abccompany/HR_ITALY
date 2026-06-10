"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  FolderOpen, Plus, Search, FileText, Loader2, 
  Download, Archive, Eye, User, FileBadge, 
  Calendar, AlertCircle, Filter, X, ChevronRight,
  ShieldAlert, Clock, Building2, ListFilter,
  FileCheck, ShieldCheck, AlertTriangle, Info
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
  getDocumentDownloadUrl 
} from "@/services/document.service";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
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

export default function DocumentsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  // Permission Readiness Guard
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

  const { data: documents, loading: loadingDocs } = useCollection<HRDocument>(docsQuery);
  const { data: employees } = useCollection<Employee>(employeesQuery);

  // --- Filtering & Sorting ---

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

  const validateFile = (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Format non supporté. PDF, PNG ou JPEG uniquement.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Fichier trop volumineux. Max 10Mo.";
    }
    return null;
  };

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  if (!canRead) {
    return (
      <div className="p-8">
        <Card className="bg-destructive/5 border-destructive/20 rounded-3xl">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ShieldAlert className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-primary mb-2">Accès Refusé</h2>
            <p className="text-muted-foreground">Vous n'avez pas la permission de consulter la gestion documentaire.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
             <div className="text-center max-w-sm mx-auto space-y-4">
                <div className="bg-white p-6 rounded-full w-20 h-20 flex items-center justify-center mx-auto shadow-sm">
                   <FolderOpen className="w-10 h-10 text-muted-foreground/30" />
                </div>
                <div className="space-y-1">
                   <h3 className="font-bold text-primary">Aucun document</h3>
                   <p className="text-sm text-muted-foreground leading-relaxed">
                     Commencez par ajouter un document RH : pièce d’identité, contrat signé, reçu UniLav ou document administratif.
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
                    onViewDetails={setSelectedDocForDetails}
                    canArchive={canArchive}
                  />
               </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-primary">Ajouter un document</DialogTitle>
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
            </div>
            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Annuler</Button>
              <Button type="submit" disabled={uploading || !isFormValid} className="rounded-xl px-8 font-black shadow-lg shadow-primary/10">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Importer le document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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

function DocumentsTable({ 
  docs, 
  loadingId, 
  onOpen, 
  onArchive, 
  onViewDetails,
  canArchive,
  compact = false 
}: { 
  docs: HRDocument[], 
  loadingId: string | null, 
  onOpen: any, 
  onArchive: any, 
  onViewDetails: (doc: HRDocument) => void,
  canArchive?: boolean,
  compact?: boolean 
}) {
  return (
    <Table>
      <TableHeader className={cn("bg-secondary/10", compact && "hidden")}>
        <TableRow>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Titre & Type</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Expiration</TableHead>
          <TableHead className="text-[10px] font-black uppercase tracking-widest">Statut</TableHead>
          <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.length === 0 ? (
          <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground italic text-xs">Aucun document dans cette vue.</TableCell></TableRow>
        ) : docs.map(d => (
          <TableRow key={d.id} className="hover:bg-muted/50 transition-colors group">
            <TableCell>
              <div className="font-bold text-primary truncate max-w-[200px]">{d.title}</div>
              <div className="text-[9px] font-black uppercase text-muted-foreground/60">{DOCUMENT_TYPE_LABELS[d.documentType]}</div>
            </TableCell>
            <TableCell>{formatDateSafe(d.expiresAt)}</TableCell>
            <TableCell>
               <Badge variant="outline" className={cn("text-[9px] uppercase font-black h-5", d.status === 'valid' ? "bg-green-50 text-green-700" : "bg-slate-50")}>
                 {STATUS_LABELS[d.status]}
               </Badge>
            </TableCell>
            <TableCell className="text-right">
               <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onViewDetails(d)}><Eye className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onOpen(d.storagePath, d.id)} disabled={!!loadingId}>
                     {loadingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}
                  </Button>
               </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
