
"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Building2, MapPin, Briefcase, 
  Loader2, Upload, AlertCircle, Send, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebase, useDoc } from "@/firebase";
import { doc } from "firebase/firestore";
import { ApplicationForm } from "@/types/application-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

export default function ApplicationFormPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const formId = params.formId as string;
  
  const { db } = useFirebase();

  const formRef = useMemo(() => 
    db && entityId && formId ? doc(db, `entities/${entityId}/applicationForms`, formId) : null,
  [db, entityId, formId]);

  const { data: form, loading } = useDoc<ApplicationForm>(formRef);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!form) return <div className="p-8 text-center">Formulaire introuvable.</div>;

  const enabledFields = form.fields?.filter(f => f.enabled).sort((a,b) => a.order - b.order) || [];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Admin Header */}
      <header className="sticky top-0 z-50 h-16 bg-white/80 backdrop-blur border-b px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Retour à l'édition
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-tight">
            <Globe className="w-4 h-4" /> Mode Aperçu Candidat
          </div>
        </div>
        <Badge variant="outline" className="bg-slate-100 font-bold px-3">
          {form.status.toUpperCase()}
        </Badge>
      </header>

      <main className="max-w-[800px] mx-auto py-12 px-4 space-y-8">
        {/* Offer Summary Header */}
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">{form.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-500">
               <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4 text-primary/60" /> {form.departmentName}</span>
               <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary/60" /> {form.worksiteName}</span>
               <span className="flex items-center gap-1.5"><Briefcase className="w-4 h-4 text-primary/60" /> {form.jobTitleName}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 border shadow-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
            {form.description}
          </div>
        </div>

        <Separator />

        {/* The Form Mockup */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Postuler à cette offre
          </h2>
          
          <Card className="border-none shadow-xl overflow-hidden rounded-2xl">
            <CardContent className="p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {enabledFields.map((field) => (
                  <div key={field.fieldId} className={field.type === 'textarea' || field.type === 'checkbox' || field.type === 'checkboxGroup' || field.type === 'file' ? "col-span-full space-y-2" : "space-y-2"}>
                    <div className="flex items-center gap-1">
                      <Label className="text-sm font-bold text-slate-700">{field.label}</Label>
                      {field.required && <span className="text-red-500 text-lg">*</span>}
                    </div>

                    {field.type === 'textarea' ? (
                      <Textarea placeholder="..." className="min-h-[120px] rounded-xl bg-slate-50/50 border-slate-200" disabled />
                    ) : field.type === 'select' ? (
                      <div className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 flex items-center text-slate-400 text-sm">
                        {field.options && field.options.length > 0 ? "Sélectionner une option..." : "Aucune option configurée"}
                      </div>
                    ) : field.type === 'checkbox' ? (
                      <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-100 bg-slate-50/30">
                        <div className="w-5 h-5 rounded border-2 border-slate-300" />
                        <span className="text-xs text-slate-600 leading-tight">{field.label}</span>
                      </div>
                    ) : field.type === 'checkboxGroup' ? (
                      <div className="space-y-2 p-4 rounded-xl border border-slate-100 bg-slate-50/30">
                        {field.options?.map((opt, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="w-4 h-4 rounded border-2 border-slate-300" />
                            <span className="text-xs text-slate-600">{opt}</span>
                          </div>
                        ))}
                        {(!field.options || field.options.length === 0) && <p className="text-xs text-muted-foreground italic">Aucune option configurée.</p>}
                      </div>
                    ) : field.type === 'file' ? (
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 bg-slate-50/30 hover:bg-slate-50 transition-colors">
                        <div className="bg-white p-3 rounded-full shadow-sm">
                          <Upload className="w-5 h-5 text-primary" />
                        </div>
                        <p className="text-xs font-bold text-slate-600">Cliquez ou glissez votre {field.label}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-medium">PDF, DOCX (Max 5Mo)</p>
                      </div>
                    ) : (
                      <Input type={field.type} className="h-11 rounded-xl bg-slate-50/50 border-slate-200" disabled placeholder={`Votre ${field.label.toLowerCase()}`} />
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-8 border-t flex flex-col gap-4">
                <Button className="h-14 rounded-xl text-md font-black shadow-lg shadow-primary/20 gap-2 w-full" disabled>
                   <Send className="w-5 h-5" />
                   Soumettre ma candidature
                </Button>
                <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                   <AlertCircle className="w-3.5 h-3.5" />
                   <span>Ceci est un aperçu. Soumission disponible prochaine étape.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <footer className="pt-12 text-center text-[10px] text-slate-400 uppercase font-black tracking-[0.2em]">
          HR Nexus Studio — Propulsé par GenKit AI
        </footer>
      </main>
    </div>
  );
}
