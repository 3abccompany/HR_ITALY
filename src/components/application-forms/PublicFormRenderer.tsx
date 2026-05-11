
"use client";

import { useState } from "react";
import { ApplicationForm, ApplicationFormField } from "@/types/application-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, AlertCircle } from "lucide-react";
import { executeSubmissionTransaction } from "@/services/application-submission.service";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

interface PublicFormRendererProps {
  form: ApplicationForm;
}

export function PublicFormRenderer({ form }: PublicFormRendererProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledFields = [...(form.fields || [])]
    .filter(f => f.enabled !== false)
    .sort((a, b) => a.order - b.order);

  const handleInputChange = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Basic validation check (Required fields)
      for (const field of enabledFields) {
        if (field.required && !answers[field.key]) {
          throw new Error(`Le champ "${field.label}" est obligatoire.`);
        }
      }

      await executeSubmissionTransaction(form.entityId, form, answers);
      router.push(`/apply/${form.publicSlug}/success`);
    } catch (err: any) {
      console.error("Submission error:", err);
      setError(err.message || "Une erreur est survenue lors de l'envoi.");
      toast({ variant: "destructive", title: "Erreur", description: err.message });
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
                  <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/30 flex flex-col items-center justify-center gap-2">
                     <p className="text-sm font-bold text-slate-500">Dépôt de fichier bientôt disponible</p>
                     <p className="text-[10px] text-muted-foreground uppercase">Prochaine version du Studio</p>
                     {/* Temporary placeholder to not block submission if required */}
                     <Input 
                       type="text" 
                       placeholder="[Simulé] Tapez 'OK' pour confirmer la possession du document" 
                       className="mt-2"
                       value={answers[field.key] || ""}
                       onChange={(e) => handleInputChange(field.key, e.target.value)}
                     />
                  </div>
                ) : (
                  <Input 
                    type={field.type} 
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
