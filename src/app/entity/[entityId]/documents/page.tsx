"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { 
  FolderOpen, Plus, Search, FileText, Loader2, 
  Download, Archive, Eye, User, FileBadge, 
  Calendar, AlertCircle, Filter, X, ChevronRight,
  ShieldAlert, Clock, Building2, ListFilter
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
import { format, isBefore, addDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Employee } from "@/types/employee";

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

export default function DocumentsRegistryPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, membership } = useActiveMembership(entityId);

  // Registry State
  const [viewMode, setViewMode] = useState("all");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Upload State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    documentType: "other" as HRDocumentType,
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
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/documents`), orderBy("uploadedAt", "desc")) as Query<HRDocument>;
  }, [db, entityId, canRead]);

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/employees`), orderBy("displayName", "asc")) as Query<Employee>;
  }, [db, entityId, canRead]);

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
      if (!d.expiresAt) {
        groups.no_expiry.push(d);
        return;
      }
      const expiry = new Date(d.expiresAt);
      if (isBefore(expiry, today)) {
        groups.expired.push(d);
      } else if (isBefore(expiry, addDays(today, 30))) {
        groups.due_30.push(d);
      } else if (isBefore(expiry, addDays(today, 60))) {
        groups.due_60.push(d);
      } else if (isBefore(expiry, addDays(today, 90))) {
        groups.due_90.push(d);
      } else {
        groups.no_expiry.push(d);
      }
    });

    return groups;
  }, [filteredDocs]);

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
    if (!user || !selectedFile) return;

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
      setUploadForm({ title: "", documentType: "other", employeeId: "none", expiresAt: "", isSensitive: false, description: "" });
      setSelectedFile(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'envoi", description: err.message });
    } finally {
      setUploading(false);
    }
  };

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

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

        <Tabs value={viewMode} onValueChange={setViewMode} className="space-y-6">
          <TabsList className="bg-white border p-1 h-11 rounded-xl">
            <TabsTrigger value="all" className="rounded-lg font-bold px-6">Tous les documents</TabsTrigger>
            <TabsTrigger value="employee" className="rounded-lg font-bold px-6">Par employé</TabsTrigger>
            <TabsTrigger value="type" className="rounded-lg font-bold px-6">Par type</TabsTrigger>
            <TabsTrigger value="expiry" className="rounded-lg font-bold px-6">Échéances</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-0">
             <Card className="rounded-[2rem] border-primary/10 overflow-hidden shadow-xl shadow-primary/5">
                <DocumentsTable 
                  docs={filteredDocs} 
                  loadingId={loadingAction} 
                  onOpen={handleOpenDoc} 
                  onArchive={handleArchive}
                  canArchive={canArchive}
                />
             </Card>
          </TabsContent>

          <TabsContent value="employee" className="mt-0 space-y-6">
            {docsByEmployee.length === 0 ? (
               <div className="py-20 text-center text-muted-foreground italic">Aucun document trouvé.</div>
            ) : docsByEmployee.map(([key, group]) => (
              <div key={key} className="space-y-3">
                 <div className="flex items-center gap-3 px-2">
                    <h3 className="font-black text-sm uppercase tracking-wider text-primary">{group.name}</h3>
                    <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px]">{group.docs.length}</Badge>
                 </div>
                 <Card className="rounded-3xl border-primary/5 overflow-hidden shadow-sm">
                    <DocumentsTable 
                      docs={group.docs} 
                      loadingId={loadingAction} 
                      onOpen={handleOpenDoc} 
                      onArchive={handleArchive}
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
                    <h3 className="font-black text-sm uppercase tracking-wider text-primary">
                      {DOCUMENT_TYPE_LABELS[type as HRDocumentType]}
                    </h3>
                    <Badge variant="secondary" className="bg-accent/10 text-accent text-[10px]">{docs.length}</Badge>
                 </div>
                 <Card className="rounded-3xl border-primary/5 overflow-hidden shadow-sm">
                    <DocumentsTable 
                      docs={docs} 
                      loadingId={loadingAction} 
                      onOpen={handleOpenDoc} 
                      onArchive={handleArchive}
                      canArchive={canArchive}
                      compact
                    />
                 </Card>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="expiry" className="mt-0 space-y-8">
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <ExpirySection title="Expirés" docs={docsByExpiry.expired} variant="danger" onOpen={handleOpenDoc} onArchive={handleArchive} loadingId={loadingAction} />
                <ExpirySection title="Sous 30 jours" docs={docsByExpiry.due_30} variant="warning" onOpen={handleOpenDoc} onArchive={handleArchive} loadingId={loadingAction} />
                <ExpirySection title="Sous 60 jours" docs={docsByExpiry.due_60} variant="info" onOpen={handleOpenDoc} onArchive={handleArchive} loadingId={loadingAction} />
                <ExpirySection title="Sous 90 jours" docs={docsByExpiry.due_90} variant="secondary" onOpen={handleOpenDoc} onArchive={handleArchive} loadingId={loadingAction} />
             </div>
             {docsByExpiry.no_expiry.length > 0 && (
               <div className="pt-8">
                  <h3 className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 mb-4">Autres documents (Sans échéance)</h3>
                  <Card className="rounded-3xl overflow-hidden opacity-80">
                     <DocumentsTable docs={docsByExpiry.no_expiry} onOpen={handleOpenDoc} onArchive={handleArchive} loadingId={loadingAction} canArchive={canArchive} compact />
                  </Card>
               </div>
             )}
          </TabsContent>
        </Tabs>
      </div>

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
                <Input value={uploadForm.title} onChange={(e) => setUploadForm(p => ({...p, title: e.target.value}))} required placeholder="Ex: CNI Recto-Verso" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Type de document</Label>
                <Select value={uploadForm.documentType} onValueChange={(v) => setUploadForm(p => ({...p, documentType: v as HRDocumentType}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Sél. collaborateur" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--- Aucun ---</SelectItem>
                    {employees?.map(e => <SelectItem key={e.employeeId} value={e.employeeId}>{e.displayName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-muted-foreground">Date d'expiration</Label>
                <Input type="date" value={uploadForm.expiresAt} onChange={(e) => setUploadForm(p => ({...p, expiresAt: e.target.value}))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Description / Notes</Label>
              <Textarea value={uploadForm.description} onChange={(e) => setUploadForm(p => ({...p, description: e.target.value}))} className="min-h-[80px]" />
            </div>

            <div className="flex items-center space-x-2 bg-secondary/20 p-4 rounded-2xl border border-dashed border-primary/20">
               <Checkbox id="sensitive" checked={uploadForm.isSensitive} onCheckedChange={(v) => setUploadForm(p => ({...p, isSensitive: !!v}))} />
               <Label htmlFor="sensitive" className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                 <ShieldAlert className="w-4 h-4 text-orange-500" /> Ce document contient des données sensibles
               </Label>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Fichier (PDF, Images - Max 10Mo)</Label>
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} required className="pt-2 h-12" />
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Annuler</Button>
              <Button type="submit" disabled={uploading || !selectedFile || !uploadForm.title} className="rounded-xl px-8 font-black">
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

function DocumentsTable({ 
  docs, 
  loadingId, 
  onOpen, 
  onArchive, 
  canArchive,
  compact = false 
}: { 
  docs: HRDocument[], 
  loadingId: string | null, 
  onOpen: any, 
  onArchive: any, 
  canArchive?: boolean,
  compact?: boolean 
}) {
  return (
    <Table>
      <TableHeader className={cn("bg-secondary/10", compact && "hidden")}>
        <TableRow>
          <TableHead>Titre & Type</TableHead>
          <TableHead className="hidden md:table-cell">Fichier</TableHead>
          <TableHead className="hidden lg:table-cell">Propriétaire</TableHead>
          <TableHead>Expiration</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground italic">Aucun document trouvé.</TableCell></TableRow>
        ) : docs.map(d => {
          const isLoading = loadingId === d.id;
          return (
            <TableRow key={d.id} className="hover:bg-muted/50 transition-colors">
              <TableCell>
                <div className="font-bold text-primary">{d.title}</div>
                <div className="flex items-center gap-2 mt-1">
                   <div className="text-[10px] font-black uppercase text-muted-foreground">{DOCUMENT_TYPE_LABELS[d.documentType]}</div>
                   {d.isSensitive && <Badge variant="secondary" className="bg-orange-50 text-orange-700 text-[8px] h-4 px-1 uppercase font-black border-none">Sensible</Badge>}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[150px]">{d.fileName}</div>
                <div className="text-[9px] uppercase font-bold text-muted-foreground/60">{(d.sizeBytes / 1024 / 1024).toFixed(2)} MB</div>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {d.employeeDisplayName ? (
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <User className="w-3 h-3 text-primary/50" /> {d.employeeDisplayName}
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">Général</span>
                )}
              </TableCell>
              <TableCell>
                {d.expiresAt ? (
                  <div className={cn("text-xs font-bold", isBefore(new Date(d.expiresAt), new Date()) ? "text-destructive" : "text-slate-600")}>
                    {format(new Date(d.expiresAt), "dd/MM/yyyy")}
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                 <Badge variant="outline" className={cn("text-[9px] uppercase font-black h-5", 
                   d.status === 'valid' ? "bg-green-50 text-green-700 border-green-100" : 
                   d.status === 'archived' ? "bg-slate-50 text-slate-400 border-slate-100" : "bg-red-50 text-red-700 border-red-100")}>
                   {STATUS_LABELS[d.status]}
                 </Badge>
              </TableCell>
              <TableCell className="text-right">
                 <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onOpen(d.storagePath, d.id)} disabled={!!loadingId}>
                       {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => onOpen(d.storagePath, d.id)} disabled={!!loadingId}>
                       <Download className="w-4 h-4" />
                    </Button>
                    {canArchive && d.status !== 'archived' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onArchive(d.id)} disabled={!!loadingId}>
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

function ExpirySection({ title, docs, variant, onOpen, onArchive, loadingId }: any) {
  const colorClass = variant === 'danger' ? "text-red-700 bg-red-50 border-red-100" : 
                     variant === 'warning' ? "text-orange-700 bg-orange-50 border-orange-100" :
                     variant === 'info' ? "text-blue-700 bg-blue-50 border-blue-100" : "text-slate-700 bg-slate-50 border-slate-100";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
         <h3 className="font-black text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</h3>
         <Badge className={cn("border font-black", colorClass)}>{docs.length}</Badge>
      </div>
      <Card className="rounded-[2rem] border-primary/5 overflow-hidden shadow-sm min-h-[100px]">
        {docs.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground italic">Aucun document dans cette période.</div>
        ) : (
          <div className="divide-y">
            {docs.map((d: HRDocument) => (
              <div key={d.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                 <div className="flex items-center gap-4 min-w-0">
                    <div className={cn("p-2 rounded-xl border", colorClass)}>
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                       <p className="font-bold text-sm text-slate-800 truncate">{d.title}</p>
                       <p className="text-[10px] text-muted-foreground uppercase font-black truncate">
                         {d.employeeDisplayName || "Général"} • Exp. {d.expiresAt ? format(new Date(d.expiresAt), "dd MMM yy") : "?"}
                       </p>
                    </div>
                 </div>
                 <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpen(d.storagePath, d.id)} disabled={!!loadingId}><Eye className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onArchive(d.id)} disabled={!!loadingId}><Archive className="w-3.5 h-3.5" /></Button>
                 </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
