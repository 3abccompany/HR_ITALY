"use client";

import { useState, useMemo, useRef } from "react";
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
  Columns,
  Table as TableIcon,
  X,
  ArrowRight,
  ShieldCheck,
  FileWarning,
  ListFilter,
  Search
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCollection, useFirebase } from "@/firebase";
import { collection, query, where, Query } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { Department } from "@/types/organization";
import { Worksite } from "@/types/worksite";
import { AttendancePreviewRow, AttendancePunch } from "@/types/attendance";
import { validatePreviewRow, calculatePunchHours } from "@/services/attendance.service";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addDays, 
  startOfDay,
  startOfWeek,
  parseISO
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
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
 * Phase 3: Excel Upload and Preview with Validation.
 * Phase 2B-Harden: Improved Pause handling.
 */
export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // --- Template State ---
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("monthly");
  const [inputMode, setInputMode] = useState<"detailed" | "compact">("detailed");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Upload / Preview State ---
  const [isReading, setIsReading] = useState(false);
  const [previewRows, setPreviewRows] = useState<AttendancePreviewRow[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Permissions ---
  const canRead = hasPermission("attendances.read");

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

  const employeesMapByCode = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeCode, e));
    return map;
  }, [employees]);

  // --- Excel Parsing Logic ---

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    setUploadError(null);
    setPreviewRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const sheet = workbook.getWorksheet("Présences");
      if (!sheet) throw new Error("La feuille 'Présences' est introuvable dans le fichier.");

      // 1. Detect Mode
      let mode: 'compact' | 'detailed' = 'detailed';
      const row1 = sheet.getRow(1);
      row1.eachCell((cell) => {
        const val = cell.value?.toString() || "";
        if (val.includes("Lundi") && val.includes("Heures")) mode = 'compact';
      });

      const rows: AttendancePreviewRow[] = [];
      const getVal = (row: ExcelJS.Row, col: number) => {
        const cell = row.getCell(col);
        if (cell.value && typeof cell.value === 'object' && 'result' in cell.value) {
          return cell.value.result;
        }
        return cell.value;
      };

      if (mode === 'detailed') {
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const firstCell = row.getCell(1).value?.toString() || "";
          if (firstCell.startsWith("Employé:") || firstCell.includes("Code employé") || firstCell.includes("TOTAL")) return;

          const code = row.getCell(1).value?.toString();
          if (!code) return;

          const rawDate = getVal(row, 3);
          let dateStr = "";
          if (rawDate instanceof Date) dateStr = format(rawDate, "yyyy-MM-dd");
          else if (typeof rawDate === 'string') dateStr = rawDate;

          const punches: AttendancePunch[] = [
            { type: 'AM', timeIn: row.getCell(7).value?.toString(), timeOut: row.getCell(8).value?.toString() },
            { type: 'PM', timeIn: row.getCell(9).value?.toString(), timeOut: row.getCell(10).value?.toString() },
            { type: 'OT', timeIn: row.getCell(11).value?.toString(), timeOut: row.getCell(12).value?.toString() },
          ];

          // Refined Pause handling: default to 0 if empty
          const pauseVal = getVal(row, 13);
          const pause = (pauseVal === null || pauseVal === undefined || pauseVal === "") ? 0 : Number(pauseVal);

          const calc = calculatePunchHours(punches, pause);
          
          // Refined Validated Hours: default to calc if empty
          const validVal = getVal(row, 15);
          const valid = (validVal === null || validVal === undefined || validVal === "") ? calc : Number(validVal);

          const previewRow: AttendancePreviewRow = {
            rowId: `${rowNumber}`,
            status: "valid",
            messages: [],
            employeeCode: code,
            employeeName: row.getCell(2).value?.toString() || "",
            date: dateStr,
            dayName: row.getCell(4).value?.toString() || "",
            worksite: row.getCell(6).value?.toString() || "",
            punches,
            pauseMinutes: pause,
            calculatedHours: calc,
            validatedHours: valid,
            absenceCode: row.getCell(16).value?.toString() || undefined,
            isHoliday: row.getCell(17).value?.toString() === "Oui",
            notes: row.getCell(18).value?.toString() || undefined
          };

          rows.push(validatePreviewRow(previewRow, employeesMapByCode));
        });
      } else {
        // COMPACT MODE UNPIVOTING
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const code = row.getCell(1).value?.toString();
          if (!code) return;

          const name = row.getCell(2).value?.toString() || "";
          const site = row.getCell(4).value?.toString() || "";

          // Day columns mapping
          const dayMap = [
            { label: "Lundi", h: 5, a: 6 },
            { label: "Mardi", h: 7, a: 8 },
            { label: "Mercredi", h: 9, a: 10 },
            { label: "Jeudi", h: 11, a: 12 },
            { label: "Vendredi", h: 13, a: 14 },
            { label: "Samedi", h: 15, a: 16 },
            { label: "Dimanche", h: 17, a: 18 },
          ];

          dayMap.forEach((day, index) => {
            const hVal = getVal(row, day.h);
            const h = (hVal === null || hVal === undefined || hVal === "") ? 0 : Number(hVal);
            const a = row.getCell(day.a).value?.toString();

            if (h === 0 && !a) return;

            const previewRow: AttendancePreviewRow = {
              rowId: `${rowNumber}_${index}`,
              status: "valid",
              messages: [],
              employeeCode: code,
              employeeName: name,
              date: "TBD", // Compact mode unpivoting date to be resolved later or inferred
              dayName: day.label,
              worksite: site,
              punches: [],
              pauseMinutes: 0, // No pause columns in compact
              calculatedHours: h,
              validatedHours: h,
              absenceCode: a,
              isHoliday: false,
              notes: ""
            };

            rows.push(validatePreviewRow(previewRow, employeesMapByCode));
          });
        });
      }

      setPreviewRows(rows);
      toast({ title: "Fichier analysé", description: `${rows.length} lignes extraites pour vérification.` });
    } catch (err: any) {
      console.error("[Excel Parsing Error]", err);
      setUploadError(err.message || "Erreur lors de la lecture du fichier.");
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

      if (inputMode === "detailed") {
        setupDetailedSheet(sheet1, periodType, selectedYear, selectedMonth, startDate, employees);
      } else {
        setupCompactSheet(sheet1, startDate, employees);
      }

      setupGuideSheet(sheet2, departments, worksites);

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

    let days: Date[] = [];
    if (periodType === "monthly") {
      const pStart = startOfMonth(new Date(year, month - 1));
      days = eachDayOfInterval({ start: pStart, end: endOfMonth(pStart) });
      
      employees.forEach(emp => {
        const empHeaderRow = sheet.addRow([`Employé: ${emp.displayName} — Code: ${emp.employeeCode} — Département: ${emp.departmentName || "N/A"} — Site: ${emp.worksiteName || "N/A"}`]);
        empHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        empHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F66" } };
        sheet.mergeCells(empHeaderRow.number, 1, empHeaderRow.number, columns.length);

        const tableHeader = sheet.addRow(columns.map(c => c.header));
        tableHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
        tableHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };

        const startRow = (sheet.lastRow?.number || 0) + 1;
        
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

          const currentRow = row.number;
          row.getCell(3).numFmt = 'yyyy-mm-dd';
          ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');
          
          row.getCell(14).value = { 
            formula: `IFERROR(MAX(0, (H${currentRow}-G${currentRow})*24) + MAX(0, (J${currentRow}-I${currentRow})*24) + MAX(0, (L${currentRow}-K${currentRow})*24) - M${currentRow}/60, 0)`,
            result: 0 
          };
          row.getCell(14).numFmt = '0.00';
          row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
          row.getCell(16).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
          row.getCell(17).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non"'] };
        });

        const endRow = sheet.lastRow?.number || startRow;
        const totalRow = sheet.addRow([]);
        totalRow.getCell(1).value = "TOTAL MENSUEL";
        totalRow.getCell(14).value = { formula: `SUM(N${startRow}:N${endRow})` };
        totalRow.getCell(14).numFmt = '0.00';
        totalRow.getCell(15).value = { formula: `SUM(O${startRow}:O${endRow})` };
        totalRow.getCell(15).numFmt = '0.00';
        totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        
        const breakRow = sheet.lastRow;
        if (breakRow) (breakRow as any).addPageBreak?.();
      });
      
    } else {
      const pStart = startOfDay(new Date(start));
      days = eachDayOfInterval({ start: pStart, end: addDays(pStart, 6) });
      
      sheet.columns = columns;
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F66" } };

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

          row.getCell('C').numFmt = 'yyyy-mm-dd';
          ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');

          row.getCell('N').value = { 
            formula: `IFERROR(MAX(0, (H${currentRow}-G${currentRow})*24) + MAX(0, (J${currentRow}-I${currentRow})*24) + MAX(0, (L${currentRow}-K${currentRow})*24) - M${currentRow}/60, 0)`,
            result: 0 
          };
          row.getCell('N').numFmt = '0.00';
          row.getCell('N').fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
          row.getCell('P').dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
          row.getCell('Q').dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non"'] };
          currentRow++;
        });
      });
    }
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
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } };

    let currentRow = 2;
    employees.forEach(emp => {
      const row = sheet.addRow({
        employeeCode: emp.employeeCode,
        employeeName: emp.displayName,
        department: emp.departmentName || "",
        worksite: emp.worksiteName || ""
      });

      const absCols = ['F', 'H', 'J', 'L', 'N', 'P', 'R'];
      absCols.forEach(col => {
        row.getCell(col).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
      });

      row.getCell('S').value = { 
        formula: `SUM(E${currentRow}, G${currentRow}, I${currentRow}, K${currentRow}, M${currentRow}, O${currentRow}, Q${currentRow})`,
        result: 0 
      };
      row.getCell('S').fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      currentRow++;
    });
  };

  const setupGuideSheet = (sheet: ExcelJS.Worksheet, departments?: Department[], worksites?: Worksite[]) => {
    sheet.getColumn('A').width = 40;
    sheet.addRow(["GUIDE DE SAISIE"]).font = { bold: true, size: 14 };
    sheet.addRow(["1. Mode Détaillé : Saisir horaires HH:mm."]);
    sheet.addRow(["2. Mode Compact : Saisir totaux décimaux (ex: 6.5)."]);
    sheet.addRow(["3. Pause : Saisir en minutes réelles (ex: 30, 45). Si pas de pause : 0 ou laisser vide."]);
    sheet.addRow(["4. Ne pas saisir 30 par défaut si la pause n'a pas été prise."]);
    sheet.addRow(["5. Mode Compact : La pause doit déjà être déduite du total saisi (heures nettes)."]);
    sheet.addRow([]);
    sheet.addRow(["CODES ABSENCE VALIDES"]).font = { bold: true };
    ABSENCE_CODES.forEach(c => sheet.addRow([c]));
  };

  const previewStats = useMemo(() => {
    return {
      total: previewRows.length,
      valid: previewRows.filter(r => r.status === 'valid').length,
      warning: previewRows.filter(r => r.status === 'warning').length,
      error: previewRows.filter(r => r.status === 'error').length,
    };
  }, [previewRows]);

  if (membershipLoading) return <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  if (!canRead) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-32">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20"><Clock className="w-6 h-6" /></div>
          <div><h1 className="text-3xl font-black text-primary tracking-tight">Présences</h1><p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p></div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Template Generation */}
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
                      <Select value={periodType} onValueChange={(v: any) => { setPeriodType(v); setInputMode(v === 'monthly' ? 'detailed' : 'compact'); }}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="monthly">Mensuel</SelectItem><SelectItem value="weekly">Hebdomadaire</SelectItem></SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Mode de saisie</Label>
                      <Select value={inputMode} onValueChange={(v: any) => setInputMode(v)}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="detailed">Détaillé horaires (HH:mm)</SelectItem><SelectItem value="compact">Compact hebdomadaire (Décimal)</SelectItem></SelectContent>
                      </Select>
                   </div>
                   {periodType === "monthly" ? (
                      <div className="grid grid-cols-2 gap-3 animate-in fade-in">
                        <div className="space-y-2"><Label className="text-[10px] uppercase font-black">Mois</Label><Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => (<SelectItem key={m} value={String(m)}>{format(new Date(2024, m - 1), "MMMM", { locale: fr })}</SelectItem>))}</SelectContent></Select></div>
                        <div className="space-y-2"><Label className="text-[10px] uppercase font-black">Année</Label><Input type="number" value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))} className="rounded-xl" /></div>
                      </div>
                   ) : (
                      <div className="space-y-2 animate-in fade-in"><Label className="text-[10px] uppercase font-black">Date de début</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl" /></div>
                   )}
                </div>
                <Button onClick={handleDownloadTemplate} disabled={isDownloading} className="w-full h-12 rounded-xl font-black gap-2 shadow-lg shadow-primary/10">
                   {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                   Télécharger le modèle
                </Button>
             </CardContent>
          </Card>

          {/* Upload Card */}
          <Card className="rounded-[2rem] border-accent/20 shadow-xl shadow-accent/5 overflow-hidden">
             <CardHeader className="bg-accent/10 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-accent-foreground flex items-center gap-2">
                   <Upload className="w-4 h-4" /> Importer un fichier Excel
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-4">
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-10 transition-all relative flex flex-col items-center justify-center gap-2 text-center",
                  isReading ? "bg-slate-50 opacity-50" : "bg-slate-50/30 hover:bg-white hover:border-accent/40 cursor-pointer"
                )}>
                   <input type="file" ref={fileInputRef} accept=".xlsx" onChange={handleFileChange} disabled={isReading} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                   {isReading ? <Loader2 className="w-8 h-8 animate-spin text-accent" /> : <TableIcon className="w-8 h-8 text-accent/30" />}
                   <p className="text-xs font-bold text-slate-600">{isReading ? "Analyse en cours..." : "Cliquer ou glisser le fichier rempli"}</p>
                   <p className="text-[10px] text-muted-foreground uppercase font-black">Format .xlsx uniquement</p>
                </div>
                {uploadError && <Alert variant="destructive" className="rounded-xl"><AlertCircle className="w-4 h-4" /><AlertDescription>{uploadError}</AlertDescription></Alert>}
             </CardContent>
          </Card>
        </div>

        {/* Preview Area */}
        <div className="lg:col-span-2 space-y-6">
           {previewRows.length > 0 ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                 <div className="flex items-center justify-between bg-white p-6 rounded-[2rem] border shadow-lg">
                    <div className="flex gap-4">
                       <SummaryStat label="Lignes" value={previewStats.total} color="slate" />
                       <SummaryStat label="Valides" value={previewStats.valid} color="green" />
                       <SummaryStat label="Alerte" value={previewStats.warning} color="orange" />
                       <SummaryStat label="Erreur" value={previewStats.error} color="red" />
                    </div>
                    <div className="flex gap-2">
                       <Button variant="ghost" onClick={() => setPreviewRows([])} className="rounded-xl h-12 px-6 font-bold uppercase text-xs">Annuler</Button>
                       <Button disabled className="h-12 rounded-xl px-10 font-black shadow-lg shadow-green-100 gap-2 opacity-50">
                          <CheckCircle2 className="w-4 h-4" /> Importer
                       </Button>
                    </div>
                 </div>

                 <Card className="rounded-[2rem] border-primary/10 shadow-xl overflow-hidden bg-white">
                    <ScrollArea className="h-[600px] w-full">
                       <Table>
                          <TableHeader className="bg-slate-50 sticky top-0 z-10">
                             <TableRow>
                                <TableHead className="pl-6 w-[80px]">Status</TableHead>
                                <TableHead>Collaborateur</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-center">Heures (Val.)</TableHead>
                                <TableHead>Absence</TableHead>
                                <TableHead className="pr-6">Messages</TableHead>
                             </TableRow>
                          </TableHeader>
                          <TableBody>
                             {previewRows.map((row) => (
                               <TableRow key={row.rowId} className={cn("group transition-colors", row.status === 'error' ? "bg-red-50/30" : row.status === 'warning' ? "bg-orange-50/30" : "hover:bg-slate-50")}>
                                  <TableCell className="pl-6">{getStatusIcon(row.status)}</TableCell>
                                  <TableCell>
                                     <div className="flex flex-col">
                                        <span className="font-bold text-slate-800 text-xs">{row.employeeName || row.employeeCode}</span>
                                        <span className="text-[10px] text-muted-foreground font-mono">{row.employeeCode}</span>
                                     </div>
                                  </TableCell>
                                  <TableCell>
                                     <div className="flex flex-col">
                                        <span className="text-xs font-medium">
                                          {(() => {
                                            if (row.date === "TBD") return row.dayName;
                                            try {
                                              const d = parseISO(row.date);
                                              if (!isNaN(d.getTime())) return format(d, "dd/MM");
                                            } catch(e) {}
                                            return "Date invalide";
                                          })()}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground uppercase">{row.dayName}</span>
                                     </div>
                                  </TableCell>
                                  <TableCell className="text-center font-black text-xs text-primary">{row.validatedHours.toFixed(2)}</TableCell>
                                  <TableCell>
                                     {row.absenceCode ? <Badge variant="outline" className="text-[9px] uppercase font-bold border-orange-200 text-orange-700 bg-orange-50">{row.absenceCode}</Badge> : "—"}
                                  </TableCell>
                                  <TableCell className="pr-6">
                                     <div className="space-y-1">
                                        {row.messages.map((m, idx) => (
                                          <div key={idx} className={cn("text-[10px] font-bold leading-tight", row.status === 'error' ? "text-red-600" : "text-orange-600")}>
                                             • {m}
                                          </div>
                                        ))}
                                     </div>
                                  </TableCell>
                               </TableRow>
                             ))}
                          </TableBody>
                       </Table>
                       <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <div className="bg-secondary/20 p-4 border-t flex items-center justify-between text-[10px] font-black uppercase text-muted-foreground tracking-widest px-8">
                       <span>Aperçu de validation</span>
                       <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Import réel prévu en phase suivante</span>
                    </div>
                 </Card>
              </div>
           ) : (
              <div className="flex flex-col items-center justify-center min-h-[500px] border-2 border-dashed rounded-[3rem] bg-secondary/5 opacity-50 space-y-4">
                 <div className="bg-white p-6 rounded-full shadow-sm"><TableIcon className="w-12 h-12 text-slate-200" /></div>
                 <div className="text-center space-y-1">
                   <h3 className="font-black text-slate-400 uppercase text-xs tracking-widest">Prévisualisation d'import</h3>
                   <p className="text-xs text-slate-400 italic">Téléversez un fichier pour voir le rapport de conformité.</p>
                 </div>
              </div>
           )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string, value: number, color: string }) {
   const colors: any = {
      slate: "bg-slate-50 text-slate-600 border-slate-100",
      green: "bg-green-50 text-green-600 border-green-100",
      orange: "bg-orange-50 text-orange-600 border-orange-100",
      red: "bg-red-50 text-red-600 border-red-100"
   };
   return (
      <div className={cn("px-4 py-2 rounded-2xl border flex flex-col items-center min-w-[80px]", colors[color])}>
         <span className="text-[9px] font-black uppercase tracking-tighter opacity-70">{label}</span>
         <span className="text-lg font-black leading-none mt-1">{value}</span>
      </div>
   );
}

function getStatusIcon(status: string) {
   switch (status) {
      case 'valid': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'warning': return <FileWarning className="w-5 h-5 text-orange-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      default: return null;
   }
}

function XCircle(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
  );
}
