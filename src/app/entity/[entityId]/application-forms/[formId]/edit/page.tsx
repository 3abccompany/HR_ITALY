
"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Loader2, ShieldCheck, ArrowLeft, Save, 
  Settings, LayoutDashboard, Plus, Trash2,
  CheckCircle2, AlertCircle, Info, Eye,
  Clock, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useFirebase, useDoc, useUser } from "@/firebase";
import { doc } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { ApplicationForm, ApplicationFormField } from "@/types/application-form";
import { updateApplicationForm } from "@/services/application-form.service";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
    db && entityId && formId ? doc(db, `entities/${entityId}/applicationForms`, formId) : null,
  [db, entityId, formId]);

  const { data: form, loading: loadingForm } = useDoc<ApplicationForm>(formRef);

  const [formData, setFormData] = useState<Partial<ApplicationForm>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (form) setFormData(form);
  }, [form]);

  const handleSave = async () => {
    if (!user || !entityId || !formId) return;
    setSaving(true);
    try {
      await updateApplicationForm(entityId, formId, formData, user.uid);
      toast({ title: "Configuration enregistrée" });
    } catch (err: any) {
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

  const addCustomField = () => {
    const fieldId = `c${Date.now()}`;
    const newField: ApplicationFormField = {
      fieldId,
      key: `custom_${fieldId}`,
      label: "Nouvelle question",
      type: "text",
      required: false,
      systemField: false,
      enabled: true,
      order: (formData.fields?.length || 0) + 1
    };
    setFormData(prev => ({ ...prev, fields: [...(prev.fields || []), newField] }));
  };

  const deleteField = (fieldId: string) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields?.filter(f => f.fieldId !== fieldId || f.systemField)
    }));
  };

  const canUpdate = hasPermission("applicationForms.update");

  if (membershipLoading || loadingForm) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!form) return <div className="p-8 text-center">Formulaire introuvable.</div>;

  const isRequiredIdentity = (key: string) => 
    ["firstName", "lastName", "email", "phone", "nationalId", "consent"].includes(key);

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
          {/* Identity Section */}
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

          {/* Fields Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5" /> Configuration des champs
              </h2>
              <Button onClick={addCustomField} variant="outline" size="sm" className="gap-1">
                <Plus className="w-3 h-3" /> Question personnalisée
              </Button>
            </div>

            <div className="space-y-3">
              {formData.fields?.sort((a,b) => a.order - b.order).map((field) => (
                <Card key={field.fieldId} className={`border-l-4 transition-all ${field.enabled ? 'border-l-accent border-primary/10' : 'border-l-muted opacity-50 bg-secondary/10'}`}>
                  <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="bg-secondary p-2 rounded text-xs font-bold text-muted-foreground w-8 h-8 flex items-center justify-center">
                        {field.order}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm text-primary">{field.label}</p>
                          {field.systemField && <Badge variant="outline" className="text-[8px] h-3 uppercase py-0 leading-none">Système</Badge>}
                          {field.required && <Badge variant="secondary" className="text-[8px] h-3 uppercase py-0 leading-none bg-red-50 text-red-700">Requis</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground uppercase font-mono">Type: {field.type}</p>
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

                      {!field.systemField && (
                        <Button variant="ghost" size="icon" onClick={() => deleteField(field.fieldId)} className="text-destructive">
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

        {/* Info Column */}
        <div className="space-y-6">
          <Card className="border-accent/20 bg-accent/5">
            <CardHeader className="bg-accent/10 border-b">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-accent-foreground">Contexte RH</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Poste</p>
                <p className="font-bold text-primary">{form.jobTitleName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Département</p>
                <p className="font-semibold">{form.departmentName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground font-bold uppercase text-[9px]">Site</p>
                <p className="font-semibold">{form.worksiteName}</p>
              </div>
              <Separator />
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span>Statut: {form.status}</span>
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
    </div>
  );
}
