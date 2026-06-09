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

interface DocumentsTableProps {
  docs: HRDocument[];
  loadingId: string | null;
  onOpen: (path: string, id: string) => void;
  onArchive: (id: string) => void;
  onViewDetails: (doc: HRDocument) => void;
  canArchive: boolean;
}

function DocumentsTable({ docs, loadingId, onOpen, onArchive, onViewDetails, canArchive }: DocumentsTableProps) {
  return (
    <Table>
      <TableHeader className="bg-secondary/10">
        <TableRow><TableHead>Titre & Type</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {docs.length === 0 ? (
          <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground italic">Aucun document.</TableCell></TableRow>
        ) : docs.map((d: HRDocument) => (
          <TableRow key={d.id}>
            <TableCell><div className="font-bold text-primary">{d.title}</div><div className="text-[9px] uppercase">{DOCUMENT_TYPE_LABELS[d.documentType]}</div></TableCell>
            <TableCell><Badge variant="outline" className={d.status === 'valid' ? "bg-green-50 text-green-700" : ""}>{STATUS_LABELS[d.status]}</Badge></TableCell>
            <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => onOpen(d.storagePath, d.id)} disabled={loadingId === d.id}>{loadingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-4 h-4" />}</Button></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
