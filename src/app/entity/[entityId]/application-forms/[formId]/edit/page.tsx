
"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ArrowLeft, Save, 
  Settings, LayoutDashboard, Plus, Trash2,
  Eye, Clock, Globe, AlertCircle, Info,
  ListTodo, CheckSquare, Type, Calendar, Hash,
  ChevronDown, X, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useFirebase, useDoc, useUser } from "@/firebase";
import { doc, DocumentReference } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { ApplicationForm, ApplicationFormField, ApplicationFormFieldType } from "@/types/application-form";
import { updateApplicationForm } from "@/services/application-form.service";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription,
  DialogTrigger
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
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

/**
 * Utility to find and report undefined values in a payload before Firestore write.
 */
function findUndefinedPaths(value: unknown, basePath = "payload"): string[] {
  const paths: string[] = [];
  if (value === undefined) {
    paths.push(basePath);
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...findUndefinedPaths(item, `${basePath}[${index}]`));
    });
    return paths;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      paths.push(...findUndefinedPaths(val, `${basePath}.${key}`));
    });
  }
  return paths;
}

/**
 * Normalizes an object by removing undefined properties.
 */
function sanitizePayload<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (key, value) => (value === undefined ? null : value)));
}

export default function EditApplicationFormPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const formId = params.formId as string;
  
  const { db } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();
  const { loading: membershipLoading, hasPermission } = useActiveMembership(entityId);

  const formRef = useMemo(() => 
    db && entityId && formId ? (doc(db, `entities/${entityId}/applicationForms`, formId) as DocumentReference<ApplicationForm>) : null,
  [db, entityId, formId]);

  const { data: form, loading: loadingForm } = useDoc<ApplicationForm>(formRef);

  const [formData, setFormData] = useState<Partial<ApplicationForm>>({});
  const [saving, setSaving] = useState(false);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<string | null>(null);

  // New Field State
  const [newField, setNewField] = useState<{
    label: string;
    type: ApplicationFormFieldType;
    required: boolean;
    options: string[];
  }>({
    label: "",
    type: "text",
    required: false,
    options: []
  });
  const [currentOption, setCurrentOption] = useState("");

  useEffect(() => {
    if (form) setFormData(form);
  }, [form]);

  const handleSave = async () => {
    if (!user || !entityId || !formId) return;
    setSaving(true);
    
    try {
      // 1. Diagnosis
      const undefinedPaths = findUndefinedPaths(formData);
      if (undefinedPaths.length > 0) {
        console.warn("Undefined values found and sanitized:", undefinedPaths);
      }

      // 2. Normalization
      const cleanData = sanitizePayload(formData);

      await updateApplicationForm(entityId, formId, cleanData, user.uid);
      toast({ title: "Configuration enregistrée" });
    } catch (err: any) {
      console.error("Save error:", err);
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (fieldId: string, updates: Partial<ApplicationFormField>) => {
    setFormData(prev => {
      const newFields = prev.fields?.map(f => 
        f.fieldId === fieldId ? { ...f, ...updates } : f
      );
      return { ...prev, fields: newFields };
    });
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    setFormData(prev => {
      if (!prev.fields) return prev;
      const sortedFields = [...prev.fields].sort((a, b) => a.order - b.order);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= sortedFields.length) return prev;

      const temp = sortedFields[index];
      sortedFields[index] = sortedFields[targetIndex];
      sortedFields[targetIndex] = temp;

      const reorderedFields = sortedFields.map((f, i) => ({ ...f, order: i + 1 }));
      return { ...prev, fields: reorderedFields };
    });
  };

  const addOption = () => {
    if (!currentOption.trim()) return;
    setNewField(prev => ({
      ...prev,
      options: [...prev.options, currentOption.trim()]
    }));
    setCurrentOption("");
  };

  const removeOption = (index: number) => {
    setNewField(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }));
  };

  const handleAddNewQuestion = () => {
    if (!newField.label.trim()) {
      toast({ variant: "destructive", title: "Erreur", description: "Le libellé est obligatoire." });
      return;
    }

    if ((newField.type === 'select' || newField.type === 'checkboxGroup') && newField.options.length === 0) {
      toast({ variant: "destructive", title: "Erreur", description: "Veuillez ajouter au moins une option." });
      return;
    }

    const fieldId = `c${Date.now()}`;
    const safeKey = `custom_${newField.label.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    
    const field: ApplicationFormField = {
      fieldId,
      key: safeKey,
      label: newField.label.trim(),
      type: newField.type,
      required: newField.required,
      systemField: false,
      enabled: true,
      options: newField.options.length > 0 ? newField.options : [],
      order: (formData.fields?.length || 0) + 1
    };

    setFormData(prev => ({
      ...prev,
      fields: [...(prev.fields || []), field]
    }));

    setNewField({ label: "", type: "text", required: false, options: [] });
    setIsBuilderOpen(false);
    toast({ title: "Question ajoutée" });
  };

  const deleteField = (fieldId: string) => {
    const field = formData.fields?.find(f => f.fieldId === fieldId);
    if (!field || field.required) return;

    setFormData(prev => {
      if (field.systemField) {
        const newFields = prev.fields?.map(f => 
          f.fieldId === fieldId ? { ...f, enabled: false } : f
        );
        return { ...prev, fields: newFields };
      } else {
        const filtered = prev.fields?.filter(f => f.fieldId !== fieldId) || [];
        const reordered = filtered
          .sort((a, b) => a.order - b.order)
          .map((f, i) => ({ ...f, order: i + 1 }));
        return { ...prev, fields: reordered };
      }
    });
    setFieldToDelete(null);
  };

  if (membershipLoading || loadingForm) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!form) return <div className="p-8 text-center">Formulaire introuvable.</div>;

  const isRequiredIdentity = (key: string) => 
    ["firstName", "lastName", "email", "phone", "nationalId", "cv", "consent"].includes(key);

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <div className="flex items-center justify-between mb-8 sticky top-0 bg-background/80 backdrop-blur py-4 z-40 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-primary truncate max-w-md">{formData.title}</h1>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Configuration du formulaire</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.push(`/entity/${entityId}/application-forms/${formId}/preview`)} className="gap-2">
            <Eye className="w-4 h-4" /> Aperçu
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2 px-8">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="border-primary/10 shadow-sm">
            <CardHeader className="bg-primary/5 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" /> Identité du formulaire
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Titre interne / Affichage public</Label>
                <Input id="title" value={formData.title} onChange={(e) => setFormData(p => ({...p, title: e.target.value}))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Texte de l'annonce / Description</Label>
                <Textarea id="description" value={formData.description} onChange={(e) => setFormData(p => ({...p, description: e.target.value}))} className="min-h-[150px]" />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5" /> Configuration des champs
              </h2>
              
              <Dialog open={isBuilderOpen} onOpenChange={setIsBuilderOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Plus className="w-3 h-3" /> Question personnalisée
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[450px]">
                  <DialogHeader>
                    <DialogTitle>Nouvelle question</DialogTitle>
                    <DialogDescription>Ajoutez un champ spécifique pour ce recrutement.</DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Libellé de la question</Label>
                      <Input 
                        placeholder="Ex: Pourquoi souhaitez-vous nous rejoindre ?" 
                        value={newField.label} 
                        onChange={(e) => setNewField(p => ({...p, label: e.target.value}))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Type de réponse</Label>
                      <Select 
                        value={newField.type} 
                        onValueChange={(v) => setNewField(p => ({...p, type: v as ApplicationFormFieldType, options: []}))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Réponse courte</SelectItem>
                          <SelectItem value="textarea">Réponse longue</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="number">Nombre</SelectItem>
                          <SelectItem value="select">Liste déroulante</SelectItem>
                          <SelectItem value="checkbox">Case à cocher simple</SelectItem>
                          <SelectItem value="checkboxGroup">Cases à cocher multiples</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(newField.type === 'select' || newField.type === 'checkboxGroup') && (
                      <div className="space-y-3 p-3 bg-secondary/20 rounded-lg border">
                        <Label className="text-xs font-bold uppercase">Options</Label>
                        <div className="flex gap-2">
                          <Input 
                            placeholder="Valeur..." 
                            value={currentOption} 
                            onChange={(e) => setCurrentOption(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addOption()}
                          />
                          <Button type="button" size="sm" onClick={addOption} variant="secondary">Ajouter</Button>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {newField.options.map((opt, i) => (
                            <Badge key={i} variant="secondary" className="gap-1">
                              {opt}
                              <button onClick={() => removeOption(i)}><X className="w-3 h-3" /></button>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="new-req" 
                        checked={newField.required} 
                        onCheckedChange={(checked) => setNewField(p => ({...p, required: !!checked}))}
                      />
                      <Label htmlFor="new-req">Réponse obligatoire</Label>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsBuilderOpen(false)}>Annuler</Button>
                    <Button onClick={handleAddNewQuestion}>Ajouter au formulaire</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-3">
              {formData.fields?.sort((a,b) => a.order - b.order).map((field, index) => (
                <Card key={field.fieldId} className={`border-l-4 transition-all ${field.enabled ? 'border-l-accent border-primary/10' : 'border-l-muted opacity-50 bg-secondary/10'}`}>
                  <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex flex-col gap-0.5">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 hover:bg-secondary" 
                          disabled={index === 0}
                          onClick={() => moveField(index, 'up')}
                        >
                          <ChevronUp className="w-3 h-3 text-muted-foreground" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 hover:bg-secondary" 
                          disabled={index === (formData.fields?.length || 0) - 1}
                          onClick={() => moveField(index, 'down')}
                        >
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </div>

                      <div className="bg-secondary p-2 rounded text-xs font-bold text-muted-foreground w-8 h-8 flex items-center justify-center shrink-0">
                        {field.order}
                      </div>
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm text-primary truncate max-w-[200px]">{field.label}</p>
                          {field.systemField ? (
                            <Badge variant="outline" className="text-[8px] h-3 uppercase py-0 leading-none">Système</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[8px] h-3 uppercase py-0 leading-none bg-accent/10 text-accent-foreground border-accent/20">Personnalisée</Badge>
                          )}
                          {field.required && <Badge variant="secondary" className="text-[8px] h-3 uppercase py-0 leading-none bg-red-50 text-red-700">Requis</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground uppercase font-mono">Type: {field.type}</p>
                        {field.type === 'file' && (
                          <p className="text-[9px] text-primary/60 font-bold">
                            Formats acceptés : PDF, DOC, DOCX — 5 Mo maximum.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {!isRequiredIdentity(field.key) && (
                        <div className="flex items-center gap-2">
                          <Checkbox 
                            id={`req-${field.fieldId}`} 
                            checked={field.required} 
                            onCheckedChange={(checked) => updateField(field.fieldId, { required: !!checked })}
                          />
                          <Label htmlFor={`req-${field.fieldId}`} className="text-[10px] cursor-pointer">Requis</Label>
                        </div>
                      )}
                      
                      {!isRequiredIdentity(field.key) && (
                        <div className="flex items-center gap-2">
                          <Checkbox 
                            id={`en-${field.fieldId}`} 
                            checked={field.enabled} 
                            onCheckedChange={(checked) => updateField(field.fieldId, { enabled: !!checked })}
                          />
                          <Label htmlFor={`en-${field.fieldId}`} className="text-[10px] cursor-pointer">Activé</Label>
                        </div>
                      )}

                      {!field.required && (
                        <Button variant="ghost" size="icon" onClick={() => setFieldToDelete(field.fieldId)} className="text-destructive shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="border-accent/20 bg-accent/5">
            <CardHeader className="bg-accent/10 border-b">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-accent-foreground">Contexte RH</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Poste</p>
                <p className="font-bold text-primary">{form?.jobTitleName || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Département</p>
                <p className="font-semibold">{form?.departmentName || "N/A"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Site</p>
                <p className="font-semibold">{form?.worksiteName || "N/A"}</p>
              </div>
              <Separator />
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span>Statut: {form?.status}</span>
              </div>
            </CardContent>
          </Card>

          <div className="bg-slate-100 rounded-xl p-6 space-y-4">
             <div className="flex items-center gap-2 text-primary font-bold">
               <Globe className="w-5 h-5" />
               <p className="text-sm">Publication</p>
             </div>
             <p className="text-[10px] text-muted-foreground leading-relaxed">
               Une fois publié, le formulaire sera accessible publiquement via une URL unique. Les modifications après publication doivent être faites avec prudence.
             </p>
             <Button variant="outline" className="w-full bg-white text-xs font-bold" onClick={() => router.push(`/entity/${entityId}/application-forms/${formId}/preview`)}>
               Voir le rendu candidat
             </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={!!fieldToDelete} onOpenChange={() => setFieldToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la question ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action retirera la question du formulaire. {formData.fields?.find(f => f.fieldId === fieldToDelete)?.systemField ? "Elle restera accessible dans la configuration mais sera masquée pour les candidats." : "Cette action est irréversible pour les questions personnalisées."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if(fieldToDelete) { deleteField(fieldToDelete); } }}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
