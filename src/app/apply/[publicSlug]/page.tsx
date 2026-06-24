"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Building2, MapPin, Briefcase, 
  Loader2, AlertCircle, Calendar,
  Clock, Info
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PublicFormRenderer } from "@/components/application-forms/PublicFormRenderer";
import { getPublicFormBySlugAction } from "@/app/apply/actions";

export default function PublicApplicationPage() {
  const params = useParams();
  const publicSlug = params.publicSlug as string;

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!publicSlug) return;
      setLoading(true);
      try {
        const data = await getPublicFormBySlugAction(publicSlug);
        if (!data) {
          setError("unavailable");
        } else {
          setForm(data);
        }
      } catch (err) {
        console.error("Error loading public form:", err);
        setError("error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [publicSlug]);

  const isAvailable = useMemo(() => {
    return form && form.status === "published";
  }, [form]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Chargement de l'offre...</p>
      </div>
    );
  }

  if (!form || !isAvailable || error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-xl border-none text-center p-12 rounded-[2rem]">
          <div className="mx-auto bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Offre non disponible</h1>
          <p className="text-slate-500 mb-8">
            Désolé, ce poste n'est plus ouvert aux candidatures ou le lien est invalide.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <main className="max-w-[800px] mx-auto py-12 px-4 space-y-8">
        {/* Job Offer Header */}
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-widest text-[10px]">
              <Building2 className="w-3.5 h-3.5" />
              {form.entityName}
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight">
              {form.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-500">
               <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border shadow-sm"><Building2 className="w-4 h-4 text-primary/60" /> {form.departmentName}</span>
               <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border shadow-sm"><MapPin className="w-4 h-4 text-primary/60" /> {form.worksiteName}</span>
               <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border shadow-sm"><Briefcase className="w-4 h-4 text-primary/60" /> {form.jobTitleName}</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 md:p-10 border shadow-sm leading-relaxed text-slate-700 whitespace-pre-wrap relative overflow-hidden">
            <div className="absolute top-0 left-0 w-2 h-full bg-primary" />
            <h3 className="text-xs font-black uppercase text-primary mb-4 tracking-widest">Description du poste</h3>
            {form.description}
          </div>

          {/* Offer Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {form.jobOfferLocation && <DetailCard icon={MapPin} label="Localisation précise" value={form.jobOfferLocation} />}
             {form.jobOfferPlanning && <DetailCard icon={Clock} label="Planning" value={form.jobOfferPlanning} />}
             {form.jobOfferBenefits && <DetailCard icon={Info} label="Avantages" value={form.jobOfferBenefits} />}
             {form.desiredAvailabilityDate && <DetailCard icon={Calendar} label="Prise de poste" value={new Date(form.desiredAvailabilityDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} />}
          </div>
        </div>

        <Separator className="bg-slate-200" />

        {/* The Application Form */}
        <div className="space-y-8">
          <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-900">Postuler à cette offre</h2>
            <p className="text-slate-500 font-medium">Veuillez remplir les informations ci-dessous pour nous envoyer votre candidature.</p>
          </div>
          
          <Card className="border-none shadow-2xl overflow-hidden rounded-[2rem]">
            <CardContent className="p-8 md:p-12">
              <PublicFormRenderer form={form} />
            </CardContent>
          </Card>
        </div>

        <footer className="pt-12 text-center">
          <p className="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] mb-4">
            Propulsé par HR Nexus Studio
          </p>
          <div className="flex justify-center gap-6 text-[10px] font-bold text-slate-400 uppercase">
             <span>Mentions Légales</span>
             <span>Politique de Confidentialité</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function DetailCard({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-100 flex items-start gap-3 shadow-sm">
      <div className="bg-slate-50 p-2 rounded-xl text-primary">
        <Icon className="w-4 h-4" />
      </div>
      <div className="space-y-0.5">
        <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{label}</p>
        <p className="text-sm font-bold text-slate-700">{value}</p>
      </div>
    </div>
  );
}
