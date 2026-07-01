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
  ChevronDown,
  LayoutList,
  Columns
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
  startOfDay,
  startOfWeek
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

const ABSENCE_CODES = [
  "paid_leave",
  "paid_permission",
  "unpaid_permission",
  "sickness",
  "justified_absence",
  "expectation",
  "other"
];

/**
 * Attendance Registry Page.
 * Phase 2B: Advanced Excel Template Generation with Formulas and Compact View.
 */
export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // --- Template State ---
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("monthly");
  const [inputMode, setInputMode] = useState<"detailed" | "compact">("detailed");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
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

      // --- Setup Columns & Logic based on Mode ---
      
      if (inputMode === "detailed") {
        setupDetailedSheet(sheet1, periodType, selectedYear, selectedMonth, startDate, employees);
      } else {
        setupCompactSheet(sheet1, startDate, employees);
      }

      // --- Sheet 2: Guide & Masters ---
      setupGuideSheet(sheet2, departments, worksites);

      // --- Finalize and Download ---
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const fileName = `modele_presences_${inputMode}_${periodType}_${format(new Date(), "yyyyMMdd")}.xlsx`;
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

  const setupDetailedSheet = (sheet: ExcelJS.Worksheet, periodType: string, year: number, month: number, start: string, employees: Employee[]) => {
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

    sheet.columns = columns;

    // Header Style
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F66" } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Data Generation
    let days: Date[] = [];
    if (periodType === "monthly") {
      const pStart = startOfMonth(new Date(year, month - 1));
      days = eachDayOfInterval({ start: pStart, end: endOfMonth(pStart) });
    } else {
      const pStart = startOfDay(new Date(start));
      days = eachDayOfInterval({ start: pStart, end: addDays(pStart, 6) });
    }

    let currentRow = 2;
    employees.forEach(emp => {
      days.forEach(day => {
        const row = sheet.addRow({
          employeeCode: emp.employeeCode,
          employeeName: emp.displayName,
          date: format(day, "yyyy-MM-dd"),
          day: format(day, "EEEE", { locale: fr }),
          department: emp.departmentName || "",
          worksite: emp.worksiteName || "",
          pause: 0
        });

        // Formatting
        row.getCell('C').numFmt = 'yyyy-mm-dd';
        ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');
        
        // Identity shading
        ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
           row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        });

        // Formula for Calculated Hours (N)
        // G=AM_In, H=AM_Out, I=PM_In, J=PM_Out, K=HS_In, L=HS_Out, M=Pause
        row.getCell('N').value = { 
          formula: `IFERROR(MAX(0, (H${currentRow}-G${currentRow})*24) + MAX(0, (J${currentRow}-I${currentRow})*24) + MAX(0, (L${currentRow}-K${currentRow})*24) - M${currentRow}/60, 0)`,
          result: 0 
        };
        row.getCell('N').numFmt = '0.00';
        row.getCell('N').fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
        row.getCell('N').font = { bold: true };

        // Data Validation (Dropdowns)
        row.getCell('P').dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${ABSENCE_CODES.join(',')}"`]
        };

        row.getCell('Q').dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"Oui,Non"']
        };

        currentRow++;
      });
    });
  };

  const setupCompactSheet = (sheet: ExcelJS.Worksheet, start: string, employees: Employee[]) => {
    const pStart = startOfDay(new Date(start));
    const weekDays = eachDayOfInterval({ start: pStart, end: addDays(pStart, 6) });
    
    const columns = [
      { header: "Code employé", key: "employeeCode", width: 15 },
      { header: "Nom employé", key: "employeeName", width: 25 },
      { header: "Département", key: "department", width: 20 },
      { header: "Site", key: "worksite", width: 20 },
    ];

    weekDays.forEach(day => {
      const dayLabel = format(day, "EEEE dd/MM", { locale: fr });
      columns.push({ header: `${dayLabel} - Heures`, key: `h_${format(day, "dd")}`, width: 15 });
      columns.push({ header: `${dayLabel} - Absence`, key: `a_${format(day, "dd")}`, width: 15 });
    });

    columns.push({ header: "Total semaine", key: "total", width: 15 });
    columns.push({ header: "Notes générales", key: "notes", width: 40 });

    sheet.columns = columns;

    // Header Style
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } }; // Sky 700
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    let currentRow = 2;
    employees.forEach(emp => {
      const row = sheet.addRow({
        employeeCode: emp.employeeCode,
        employeeName: emp.displayName,
        department: emp.departmentName || "",
        worksite: emp.worksiteName || ""
      });

      // Identity shading (A-D)
      ['A', 'B', 'C', 'D'].forEach(col => {
         row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });

      // Daily Hour cells format and Absence validation
      // Hours are in E, G, I, K, M, O, Q
      // Absences are in F, H, J, L, N, P, R
      const hourCols = ['E', 'G', 'I', 'K', 'M', 'O', 'Q'];
      const absCols = ['F', 'H', 'J', 'L', 'N', 'P', 'R'];

      hourCols.forEach(col => {
        row.getCell(col).numFmt = '0.00';
      });

      absCols.forEach(col => {
        row.getCell(col).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${ABSENCE_CODES.join(',')}"`]
        };
      });

      // Formula for Total (S)
      row.getCell('S').value = { 
        formula: `SUM(E${currentRow}, G${currentRow}, I${currentRow}, K${currentRow}, M${currentRow}, O${currentRow}, Q${currentRow})`,
        result: 0 
      };
      row.getCell('S').fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      row.getCell('S').font = { bold: true };

      currentRow++;
    });
  };

  const setupGuideSheet = (sheet: ExcelJS.Worksheet, departments?: Department[], worksites?: Worksite[]) => {
    sheet.getColumn('A').width = 40;
    sheet.getColumn('B').width = 40;

    sheet.addRow(["GUIDE DE SAISIE"]).font = { bold: true, size: 14 };
    sheet.addRow(["MODES DISPONIBLES :"]);
    sheet.addRow(["1. Mode Détaillé : Saisir les horaires au format HH:mm (ex: 08:30)."]);
    sheet.addRow(["2. Mode Compact : Saisir les totaux quotidiens en décimal (ex: 6.5 pour 6h30)."]);
    sheet.addRow([]);
    sheet.addRow(["RÈGLES D'IMPORTATION :"]);
    sheet.addRow(["- Ne pas modifier le 'Code employé' : c'est la clé d'identification."]);
    sheet.addRow(["- Le 'Code absence' doit correspondre exactement aux valeurs de la liste."]);
    sheet.addRow(["- 'Heures validées' (Mode détaillé) : si rempli, ce montant sera prioritaire."]);
    sheet.addRow([]);

    sheet.addRow(["CODES ABSENCE VALIDES"]).font = { bold: true };
    const absenceDetails = [
      ["paid_leave", "Congé payé"],
      ["paid_permission", "Autorisation rémunérée"],
      ["unpaid_permission", "Autorisation non rémunérée"],
      ["sickness", "Maladie"],
      ["justified_absence", "Absence justifiée"],
      ["expectation", "Aspettativa / disponibilité"],
      ["other", "Autre"]
    ];
    absenceDetails.forEach(c => sheet.addRow(c));
    sheet.addRow([]);

    sheet.addRow(["RÉFÉRENTIELS ACTIFS"]).font = { bold: true };
    sheet.addRow(["Départements :", departments?.map(d => d.name).join(", ") || "Aucun"]);
    sheet.addRow(["Sites :", worksites?.map(w => w.name).join(", ") || "Aucun"]);
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
                      <Select value={periodType} onValueChange={(v: any) => {
                        setPeriodType(v);
                        if (v === 'monthly') setInputMode('detailed');
                        else setInputMode('compact');
                      }}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                           <SelectItem value="monthly">Mensuel</SelectItem>
                           <SelectItem value="weekly">Hebdomadaire</SelectItem>
                        </SelectContent>
                      </Select>
                   </div>

                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Mode de saisie</Label>
                      <Select value={inputMode} onValueChange={(v: any) => setInputMode(v)}>
                        <SelectTrigger className="rounded-xl">
                          <div className="flex items-center gap-2">
                            {inputMode === 'detailed' ? <Clock className="w-3.5 h-3.5" /> : <LayoutList className="w-3.5 h-3.5" />}
                            <SelectValue />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="detailed">Détaillé horaires (HH:mm)</SelectItem>
                           <SelectItem value="compact">Compact hebdomadaire (Décimal)</SelectItem>
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
                   Généré pour {employees?.length || 0} employés actifs.
                </p>
             </CardContent>
          </Card>
        </div>

        {/* Workflow & Instructions */}
        <div className="lg:col-span-2 space-y-6">
          <Alert className="bg-blue-50 border-blue-100 text-blue-800 rounded-[2rem] p-6 shadow-sm">
            <Info className="h-5 w-5 text-blue-600" />
            <div className="ml-2">
              <AlertTitle className="font-black text-xs uppercase tracking-widest mb-1">Amélioration du flux de saisie</AlertTitle>
              <AlertDescription className="text-sm leading-relaxed opacity-90">
                Le modèle Excel inclut désormais des <strong>formules de calcul automatique</strong> et des <strong>listes de choix</strong> pour les codes d'absence, réduisant les erreurs de saisie avant l'importation.
              </AlertDescription>
            </div>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <WorkflowStepCard 
              step="1"
              title="Préparation"
              description="Téléchargez le modèle. Choisissez 'Détaillé' pour un suivi heure par heure ou 'Compact' pour une saisie rapide par jour."
              icon={Download}
              active={true}
            />
            <WorkflowStepCard 
              step="2"
              title="Saisie assistée"
              description="Utilisez les menus déroulants pour les absences. Excel calcule les totaux en temps réel via des formules intégrées."
              icon={FileSpreadsheet}
              active={false}
            />
            <WorkflowStepCard 
              step="3"
              title="Importation"
              description="Bientôt : Téléversez le fichier pour synchroniser les données avec le registre Firestore de l'entité."
              icon={Upload}
              active={false}
            />
            <WorkflowStepCard 
              step="4"
              title="Validation RH"
              description="Contrôlez les écarts entre les heures calculées et validées avant clôture de la période."
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
          Les données importées apparaîtront ici après la mise en service du module d'importation (Phase 3).
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
