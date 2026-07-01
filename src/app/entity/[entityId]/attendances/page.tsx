"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { 
  Clock, 
  FileSpreadsheet, 
  Download, 
  Upload, 
  AlertCircle,
  Calendar,
  CheckCircle2,
  Info,
  Loader2,
  FileDown,
  ChevronDown
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useCollection, useFirebase } from "@/firebase";
import { collection, query, where, orderBy, Query } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { Department, JobTitle } from "@/types/organization";
import { Worksite } from "@/types/worksite";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addDays, 
  startOfDay 
} from "date-fns";
import { fr } from "date-fns/locale";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import ExcelJS from "exceljs";

/**
 * Attendance Registry Page.
 * Phase 2: Excel Template Generation.
 */
export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // --- Template State ---
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("monthly");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Permissions ---
  const canRead = hasPermission("attendances.read");
  const canCreate = hasPermission("attendances.create") || hasPermission("attendances.write");

  // --- Registry Data Fetching ---
  const empQuery = useMemo(() => 
    db ? query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active")) as Query<Employee> : null,
  [db, entityId]);
  
  const deptsQuery = useMemo(() => 
    db ? query(collection(db, `entities/${entityId}/departments`), where("status", "==", "active")) as Query<Department> : null,
  [db, entityId]);

  const worksitesQuery = useMemo(() => 
    db ? query(collection(db, `entities/${entityId}/worksites`), where("status", "==", "active")) as Query<Worksite> : null,
  [db, entityId]);

  const { data: employees } = useCollection<Employee>(empQuery);
  const { data: departments } = useCollection<Department>(deptsQuery);
  const { data: worksites } = useCollection<Worksite>(worksitesQuery);

  const handleDownloadTemplate = async () => {
    if (!employees || employees.length === 0) {
      alert("Aucun employé actif trouvé pour générer le modèle.");
      return;
    }

    setIsDownloading(true);
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "HR Nexus Studio";
      workbook.lastModifiedBy = "HR Nexus Studio";
      workbook.created = new Date();
      
      const sheet1 = workbook.addWorksheet("Présences");
      const sheet2 = workbook.addWorksheet("Guide & Référentiels");

      // --- Sheet 1: Columns Definition ---
      const columns = [
        { header: "Code employé", key: "employeeCode", width: 15 },
        { header: "Nom employé", key: "employeeName", width: 25 },
        { header: "Date", key: "date", width: 15 },
        { header: "Jour", key: "day", width: 10 },
        { header: "Département", key: "department", width: 20 },
        { header: "Site", key: "worksite", width: 20 },
        { header: "AM Entrée", key: "amIn", width: 10 },
        { header: "AM Sortie", key: "amOut", width: 10 },
        { header: "PM Entrée", key: "pmIn", width: 10 },
        { header: "PM Sortie", key: "pmOut", width: 10 },
        { header: "HS Entrée", key: "otIn", width: 10 },
        { header: "HS Sortie", key: "otOut", width: 10 },
        { header: "Pause minutes", key: "pause", width: 15 },
        { header: "Heures calculées", key: "calcHours", width: 15 },
        { header: "Heures validées", key: "validHours", width: 15 },
        { header: "Code absence", key: "absence", width: 15 },
        { header: "Férié", key: "holiday", width: 10 },
        { header: "Notes / Correction", key: "notes", width: 40 },
      ];

      sheet1.columns = columns;

      // Styling Headers
      const headerRow = sheet1.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F1F66" } // Primary Indigo
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      sheet1.views = [{ state: 'frozen', ySplit: 1 }];

      // --- Data Generation ---
      let days: Date[] = [];
      if (periodType === "monthly") {
        const start = startOfMonth(new Date(selectedYear, selectedMonth - 1));
        const end = endOfMonth(start);
        days = eachDayOfInterval({ start, end });
      } else {
        const start = startOfDay(new Date(startDate));
        days = eachDayOfInterval({ start, end: addDays(start, 6) });
      }

      employees.forEach(emp => {
        days.forEach(day => {
          const row = sheet1.addRow({
            employeeCode: emp.employeeCode,
            employeeName: emp.displayName,
            date: format(day, "yyyy-MM-dd"),
            day: format(day, "EEEE", { locale: fr }),
            department: emp.departmentName || "",
            worksite: emp.worksiteName || "",
            amIn: "", amOut: "", pmIn: "", pmOut: "", otIn: "", otOut: "",
            pause: 0,
            calcHours: "",
            validHours: "",
            absence: "",
            holiday: "",
            notes: ""
          });

          // Cell formating for time columns
          ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => {
            row.getCell(col).numFmt = 'hh:mm';
          });
          row.getCell('C').numFmt = 'yyyy-mm-dd';
        });
      });

      // --- Sheet 2: Guide & Masters ---
      sheet2.getColumn('A').width = 40;
      sheet2.getColumn('B').width = 40;

      sheet2.addRow(["GUIDE DE SAISIE"]).font = { bold: true, size: 14 };
      sheet2.addRow(["1. Format heure : HH:mm (ex: 08:30)"]);
      sheet2.addRow(["2. Format date : YYYY-MM-DD (ne pas modifier les dates pré-remplies)"]);
      sheet2.addRow(["3. Ne pas modifier le 'Code employé' : c'est la clé d'importation."]);
      sheet2.addRow(["4. 'Heures validées' : si rempli, cette valeur sera utilisée pour la paie."]);
      sheet2.addRow(["5. 'Code absence' : utiliser uniquement les codes listés ci-dessous."]);
      sheet2.addRow([]);

      sheet2.addRow(["CODES ABSENCE"]).font = { bold: true };
      const absenceCodes = [
        ["paid_leave", "Congé payé"],
        ["paid_permission", "Autorisation rémunérée"],
        ["unpaid_permission", "Autorisation non rémunérée"],
        ["sickness", "Maladie"],
        ["justified_absence", "Absence justifiée"],
        ["expectation", "Aspettativa / disponibilité"],
        ["other", "Autre"]
      ];
      absenceCodes.forEach(c => sheet2.addRow(c));
      sheet2.addRow([]);

      sheet2.addRow(["RÉFÉRENTIELS ACTIFS"]).font = { bold: true };
      sheet2.addRow(["Départements :", departments?.map(d => d.name).join(", ") || "Aucun"]);
      sheet2.addRow(["Sites :", worksites?.map(w => w.name).join(", ") || "Aucun"]);

      // --- Finalize and Download ---
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const fileName = `modele_presences_${periodType}_${format(new Date(), "yyyyMMdd")}.xlsx`;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
      
    } catch (err: any) {
      console.error("[Template Generation Error]", err);
      alert("Une erreur est survenue lors de la génération du fichier.");
    } finally {
      setIsDownloading(false);
    }
  };

  if (membershipLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary opacity-20" />
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.2em]">Chargement...</p>
      </div>
    );
  }

  if (!canRead) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 pb-32">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-primary tracking-tight">Présences</h1>
            <p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Template Generation Card */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden">
             <CardHeader className="bg-primary/5 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                   <FileSpreadsheet className="w-4 h-4" /> Modèle Excel
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-6">
                <div className="space-y-4">
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Type de période</Label>
                      <Select value={periodType} onValueChange={(v: any) => setPeriodType(v)}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                           <SelectItem value="monthly">Mensuel</SelectItem>
                           <SelectItem value="weekly">Hebdomadaire</SelectItem>
                        </SelectContent>
                      </Select>
                   </div>

                   {periodType === "monthly" ? (
                      <div className="grid grid-cols-2 gap-3 animate-in fade-in">
                        <div className="space-y-2">
                           <Label className="text-[10px] uppercase font-black">Mois</Label>
                           <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                 {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                   <SelectItem key={m} value={String(m)}>{format(new Date(2024, m - 1), "MMMM", { locale: fr })}</SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-[10px] uppercase font-black">Année</Label>
                           <Input 
                            type="number" 
                            value={selectedYear} 
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))} 
                            className="rounded-xl"
                           />
                        </div>
                      </div>
                   ) : (
                      <div className="space-y-2 animate-in fade-in">
                         <Label className="text-[10px] uppercase font-black">Date de début (Lundi conseillé)</Label>
                         <Input 
                          type="date" 
                          value={startDate} 
                          onChange={(e) => setStartDate(e.target.value)} 
                          className="rounded-xl"
                         />
                      </div>
                   )}
                </div>

                <Separator className="opacity-50" />

                <Button 
                  onClick={handleDownloadTemplate} 
                  disabled={isDownloading || !canCreate} 
                  className="w-full h-12 rounded-xl font-black gap-2 shadow-lg shadow-primary/10"
                >
                   {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                   Télécharger le modèle
                </Button>

                <p className="text-[10px] text-muted-foreground text-center italic">
                   Le fichier sera pré-rempli avec les {employees?.length || 0} employés actifs.
                </p>
             </CardContent>
          </Card>
        </div>

        {/* Workflow & Instructions */}
        <div className="lg:col-span-2 space-y-6">
          <Alert className="bg-blue-50 border-blue-100 text-blue-800 rounded-[2rem] p-6 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <div className="ml-2">
              <AlertTitle className="font-black text-xs uppercase tracking-widest mb-1">Comment ça marche ?</AlertTitle>
              <AlertDescription className="text-sm leading-relaxed opacity-90">
                Utilisez le générateur à gauche pour obtenir une matrice vierge adaptée à votre effectif. Remplissez les colonnes d'entrées/sorties et importez le fichier pour validation.
              </AlertDescription>
            </div>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <WorkflowStepCard 
              step="1"
              title="Préparation"
              description="Téléchargez le modèle Excel pré-rempli avec vos employés et la période choisie."
              icon={Download}
              active={true}
            />
            <WorkflowStepCard 
              step="2"
              title="Saisie"
              description="Remplissez les horaires AM/PM et les éventuels codes d'absence dans Excel."
              icon={FileSpreadsheet}
              active={false}
            />
            <WorkflowStepCard 
              step="3"
              title="Importation"
              description="Téléversez le fichier pour valider et enregistrer les présences dans le registre."
              icon={Upload}
              active={false}
            />
            <WorkflowStepCard 
              step="4"
              title="Validation"
              description="Contrôlez les anomalies détectées et validez les heures pour la paie."
              icon={CheckCircle2}
              active={false}
            />
          </div>
        </div>

      </div>

      <Separator className="my-12 opacity-50" />

      <Card className="rounded-[2rem] border-dashed border-2 bg-secondary/5 opacity-50 flex flex-col items-center justify-center p-16 text-center grayscale">
        <Calendar className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
        <h3 className="font-black text-muted-foreground uppercase text-xs tracking-[0.2em]">Registre des pointages</h3>
        <p className="text-xs text-muted-foreground mt-2 italic max-w-xs">
          Les données importées apparaîtront ici sous forme de calendrier et de liste après votre première importation.
        </p>
      </Card>
    </div>
  );
}

function WorkflowStepCard({ step, title, description, icon: Icon, active }: any) {
  return (
    <Card className={cn(
      "rounded-[2rem] border-primary/10 shadow-sm relative overflow-hidden transition-all group",
      !active ? "opacity-50 grayscale" : "hover:shadow-md hover:border-primary/20 bg-white"
    )}>
      <div className="absolute top-4 right-6 text-4xl font-black text-primary/5 group-hover:text-primary/10 transition-colors select-none">
        0{step}
      </div>
      <CardContent className="p-8 space-y-4">
        <div className={cn("p-3 rounded-2xl w-fit", active ? "bg-primary/5 text-primary" : "bg-secondary text-muted-foreground")}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="font-black text-lg text-slate-800">{title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
