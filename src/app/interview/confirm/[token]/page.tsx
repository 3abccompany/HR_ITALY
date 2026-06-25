"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { 
  Loader2, CheckCircle2, Calendar, Clock, 
  User, Briefcase, MapPin, AlertCircle, ShieldCheck,
  XCircle
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicInterviewAction, confirmInterviewAttendanceAction } from "./actions";

export default function InterviewConfirmationPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [interview, setInterview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<"confirmed" | "declined" | null>(null);

  useEffect(() => {
    async function load() {
      if (!token) return;
      try {
        const result = await getPublicInterviewAction(token);
        if (result.success && result.interview) {
          setInterview(result.interview);
          if (result.interview.confirmationStatus === "confirmed") setSuccess("confirmed");
          if (result.interview.confirmationStatus === "declined") setSuccess("declined");
        } else {
          setError(result.error || "Une erreur est survenue.");
        }
      } catch (err) {
        setError("Impossible de charger l'invitation.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleResponse = async (choice: "confirmed" | "declined") => {
    setProcessing(true);
    try {
      const result = await confirmInterviewAttendanceAction(token, choice);
      if (result.success) {
        setSuccess(choice);
      } else {
        alert("Erreur: " + ((result as any).error || "Une erreur est survenue."));
      }
    } catch (err: any) {
      alert("Erreur technique lors de la réponse.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Vérification de votre invitation...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-xl border-none text-center p-12 rounded-[2.5rem]">
          <div className="mx-auto bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center mb-6 text-destructive">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Lien invalide</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">{error}</p>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl border-none rounded-[2.5rem] overflow-hidden">
          <div className={`h-32 flex items-center justify-center relative ${success === 'confirmed' ? 'bg-primary' : 'bg-slate-200'}`}>
            <div className="absolute -bottom-10 bg-white p-4 rounded-full shadow-xl">
               {success === 'confirmed' ? (
                 <CheckCircle2 className="w-12 h-12 text-green-500" />
               ) : (
                 <XCircle className="w-12 h-12 text-slate-400" />
               )}
            </div>
          </div>
          <CardContent className="pt-16 pb-12 px-10 text-center space-y-6">
            <h1 className="text-3xl font-black text-slate-900">
              {success === 'confirmed' ? "Présence confirmée !" : "Réponse enregistrée"}
            </h1>
            <p className="text-slate-500 font-medium leading-relaxed">
              {success === 'confirmed' 
                ? <>Merci <strong>{interview.candidateName}</strong>, nous avons bien pris note de votre participation à l'entretien.</>
                : <>Merci <strong>{interview.candidateName}</strong>, nous avons pris note de votre indisponibilité pour ce créneau.</>
              }
            </p>
            {success === 'confirmed' && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-sm text-slate-600">
                Rendez-vous le <strong>{new Date(interview.scheduledAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</strong> à <strong>{new Date(interview.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong>.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <main className="max-w-lg w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="bg-primary text-white p-4 rounded-3xl shadow-lg shadow-primary/20 inline-block">
             <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Répondre à votre invitation</h1>
          <p className="text-slate-500 font-medium leading-relaxed">
            Bonjour <strong>{interview.candidateName}</strong>, veuillez confirmer votre participation à l'entretien programmé.
          </p>
        </div>

        <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
           <CardContent className="p-8 space-y-8">
              <div className="space-y-6">
                 <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="bg-white p-2 rounded-xl shadow-sm text-primary"><Briefcase className="w-5 h-5" /></div>
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Poste</p>
                       <p className="text-sm font-bold text-slate-800">{interview.jobTitle}</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Date</p>
                       <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <Calendar className="w-4 h-4 text-primary/40" />
                          {new Date(interview.scheduledAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                       </div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Heure</p>
                       <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <Clock className="w-4 h-4 text-primary/40" />
                          {new Date(interview.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                       </div>
                    </div>
                 </div>

                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                       <User className="w-3 h-3" /> Votre interlocuteur
                    </p>
                    <p className="text-sm font-bold text-slate-800">{interview.interviewerName || "Équipe Recrutement"}</p>
                 </div>

                 {interview.location && (
                   <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                         <MapPin className="w-3 h-3" /> Lieu / Lien
                      </p>
                      <p className="text-sm font-bold text-slate-800 truncate">{interview.location}</p>
                   </div>
                 )}
              </div>

              <div className="pt-4 flex flex-col gap-3">
                 <Button 
                   onClick={() => handleResponse("confirmed")} 
                   disabled={processing}
                   className="w-full h-16 rounded-2xl text-md font-black shadow-xl shadow-primary/20 gap-3"
                 >
                    {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                    Je confirme ma présence
                 </Button>
                 <Button 
                   onClick={() => handleResponse("declined")} 
                   disabled={processing}
                   variant="outline"
                   className="w-full h-12 rounded-xl text-sm font-bold text-muted-foreground border-slate-200"
                 >
                    Je ne peux pas venir
                 </Button>
              </div>
           </CardContent>
        </Card>

        <footer className="text-center text-[10px] text-slate-400 uppercase font-black tracking-widest">
           HR Nexus Studio — Système de Recrutement Sécurisé
        </footer>
      </main>
    </div>
  );
}
