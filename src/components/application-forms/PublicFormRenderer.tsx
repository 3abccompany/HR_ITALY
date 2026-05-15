"use client";

import { useState } from "react";
import { ApplicationForm } from "@/types/application-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, AlertCircle, Upload, FileText, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

interface PublicFormRendererProps {
  form: ApplicationForm;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

export function PublicFormRenderer({ form }: PublicFormRendererProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledFields = [...(form.fields || [])]
    .filter(f => f.enabled !== false)
    .sort((a, b) => a.order - b.order);

  const handleInputChange = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleFileChange = (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ 
        variant: "destructive", 
        title: "Format non supporté", 
        description: "Veuillez envoyer un fichier PDF, DOC ou DOCX." 
      });
      e.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast({ 
        variant: "destructive", 
        title: "Fichier trop volumineux", 
        description: "La taille maximale autorisée est de 5 Mo." 
      });
      e.target.value = "";
      return;
    }

    setFiles(prev => ({ ...prev, [key]: file }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Basic validation check (Required fields)
      for (const field of enabledFields) {
        if (field.type === 'file') {
          if (field.required && !files[field.key]) {
            setError(`Le document "${field.label}" est obligatoire.`);
            setLoading(false);
            return;
          }
          continue;
        }

        const val = answers[field.key];
        const isEmpty = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);

        if (field.required && isEmpty) {
          setError(`Le champ "${field.label}" est obligatoire.`);
          setLoading(false);
          return;
        }
      }

      // Build FormData for multipart submission
      const formData = new FormData();
      formData.append("publicSlug", form.publicSlug);
      
      // Sanitize answers
      const sanitizedAnswers: Record<string, any> = {};
      Object.entries(answers).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          sanitizedAnswers[key] = value;
        }
      });
      formData.append("answers", JSON.stringify(sanitizedAnswers));

      // Append files
      if (files["cv"]) formData.append("cv", files["cv"]);
      if (files["coverLetter"]) formData.append("coverLetter", files["coverLetter"]);

      const response = await fetch('/api/public/applications/submit', {
        method: 'POST',
        body: formData,
      });

      let result: any = null;
      try {
        const rawText = await response.text();
        result = rawText ? JSON.parse(rawText) : null;
      } catch {
        result = null;
      }

      if (!response.ok) {
        if (result?.error?.code === "ALREADY_APPLIED_TO_THIS_JOB") {
          setError("Vous avez déjà postulé à ce poste.");
        } else {
          setError(result?.error?.message || result?.error || "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.");
        }
        setLoading(false);
        return;
      }

      router.push(`/apply/${form.publicSlug}/success`);
    } catch (err: any) {
      console.error("Submission error:", err);
      setError("Une erreur technique est survenue. Veuillez vérifier votre connexion et réessayer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive text-sm font-medium animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {enabledFields.map((field) => {
          const isFullWidth = ["textarea", "checkbox", "checkboxGroup", "file"].includes(field.type);
          
          return (
            <div key={field.fieldId} className={isFullWidth ? "col-span-full" : ""}>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label className="text-sm font-bold text-slate-700">{field.label}</Label>
                  {field.required && <span className="text-red-500 font-bold">*</span>}
                </div>

                {field.type === 'textarea' ? (
                  <Textarea 
                    placeholder="Votre réponse..." 
                    className="min-h-[120px] rounded-xl border-slate-200 focus:ring-primary/20" 
                    value={answers[field.key] || ""}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    required={field.required}
                  />
                ) : field.type === 'select' ? (
                  <Select 
                    value={answers[field.key]} 
                    onValueChange={(v) => handleInputChange(field.key, v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl border-slate-200">
                      <SelectValue placeholder="Sélectionner..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt, i) => (
                        <SelectItem key={i} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'checkbox' ? (
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 bg-slate-50/30">
                    <Checkbox 
                      id={field.fieldId} 
                      checked={!!answers[field.key]}
                      onCheckedChange={(checked) => handleInputChange(field.key, !!checked)}
                    />
                    <label htmlFor={field.fieldId} className="text-xs text-slate-600 leading-tight cursor-pointer">
                      {field.label}
                    </label>
                  </div>
                ) : field.type === 'checkboxGroup' ? (
                  <div className="space-y-3 p-4 rounded-xl border border-slate-100 bg-slate-50/30">
                    {field.options?.map((opt, i) => {
                      const currentVals = answers[field.key] || [];
                      const isChecked = currentVals.includes(opt);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <Checkbox 
                            id={`${field.fieldId}-${i}`} 
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              const newVals = checked 
                                ? [...currentVals, opt] 
                                : currentVals.filter((v: string) => v !== opt);
                              handleInputChange(field.key, newVals);
                            }}
                          />
                          <label htmlFor={`${field.fieldId}-${i}`} className="text-xs text-slate-600 cursor-pointer">{opt}</label>
                        </div>
                      );
                    })}
                  </div>
                ) : field.type === 'file' ? (
                  <div className="relative group">
                    <Input 
                      type="file" 
                      className="hidden" 
                      id={`file-${field.key}`}
                      accept=".pdf,.doc,.docx"
                      onChange={(e) => handleFileChange(field.key, e)}
                    />
                    <Label 
                      htmlFor={`file-${field.key}`}
                      className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                        files[field.key] 
                          ? 'border-green-200 bg-green-50/30 hover:bg-green-50/50' 
                          : 'border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-primary/30'
                      }`}
                    >
                      {files[field.key] ? (
                        <>
                          <div className="bg-green-100 p-3 rounded-full text-green-600">
                             <CheckCircle2 className="w-6 h-6" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-green-800">{files[field.key].name}</p>
                            <p className="text-[10px] text-green-600 uppercase font-bold tracking-tighter">Fichier prêt — Cliquer pour changer</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="bg-white p-3 rounded-full shadow-sm text-primary/60 group-hover:text-primary transition-colors">
                             <Upload className="w-6 h-6" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-slate-600">Cliquez pour ajouter votre {field.label}</p>
                            <p className="text-[10px] text-muted-foreground uppercase font-medium">PDF, DOCX (Max 5Mo)</p>
                          </div>
                        </>
                      )}
                    </Label>
                  </div>
                ) : (
                  <Input 
                    type={field.type === 'phone' ? 'tel' : field.type} 
                    className="h-11 rounded-xl border-slate-200 focus:ring-primary/20" 
                    placeholder={field.label}
                    value={answers[field.key] || ""}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    required={field.required}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-8 border-t">
        <Button 
          type="submit" 
          disabled={loading} 
          className="h-14 rounded-xl text-md font-black shadow-lg shadow-primary/20 gap-2 w-full"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          Soumettre ma candidature
        </Button>
      </div>
    </form>
  );
}