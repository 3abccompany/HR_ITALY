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
  Search,
  Coffee,
  Moon,
  Sun,
  AlertTriangle,
  Layout,
  XCircle
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
import { validatePreviewRow, calculateAttendanceSplits } from "@/services/attendance.service";
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
 * Helper to convert various ExcelJS cell values (Date, Number, String) 
 * into a standard "HH:mm" format for internal processing.
 */
function formatExcelTimeValue(value: any): string {
  if (value === null || value === undefined || value === "") return "";
  
  let effectiveValue = value;
  if (typeof value === 'object' && 'result' in value) {
    effectiveValue = value.result;
  }

  if (effectiveValue instanceof Date) {
    const h = effectiveValue.getHours().toString().padStart(2, '0');
    const m = effectiveValue.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  if (typeof effectiveValue === 'number') {
    const totalMinutes = Math.round(effectiveValue * 24 * 60);
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  if (typeof effectiveValue === 'string') {
    const clean = effectiveValue.trim();
    if (/^\d{1,2}:\d{2}$/.test(clean)) {
      const [h, m] = clean.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    }
  }

  return "INVALID";
}

function formatRowDate(dateStr: string, dayName: string): string {
  if (dateStr === "TBD") return dayName;
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) return format(d, "dd/MM");
  } catch (e) {}
  return "Date invalide";
}

export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // --- Template State ---
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("weekly");
  const [inputMode, setInputMode] = useState<"detailed" | "compact_time" | "compact">("compact_time");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [defaultPause, setDefaultPause] = useState("0");
  const [customPause, setCustomPause] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Upload / Preview State ---
  const [isReading, setIsReading] = useState(false);
  const [previewRows, setPreviewRows] = useState<AttendancePreviewRow[]>([]);
  const [ignoredRowsCount, setIgnoredRowsCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canRead = hasPermission("attendances.read");

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    setUploadError(null);
    setPreviewRows([]);
    setIgnoredRowsCount(0);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const sheet = workbook.getWorksheet("Présences");
      if (!sheet) throw new Error("Format de fichier non reconnu. Veuillez utiliser un modèle généré par le système.");

      // Detection
      let mode: 'compact' | 'compact_time' | 'detailed' = 'detailed';
      const row1 = sheet.getRow(1);
      let isCompactTime = false;
      row1.eachCell((cell) => {
        const val = cell.value?.toString() || "";
        if (val.includes("Entrée") && val.includes("/")) isCompactTime = true;
      });

      if (isCompactTime) {
        mode = 'compact_time';
      } else {
        row1.eachCell((cell) => {
          const val = cell.value?.toString() || "";
          if (val.includes("Lundi") && val.includes("Heures")) mode = 'compact';
        });
      }

      const rows: AttendancePreviewRow[] = [];
      let ignoredCount = 0;

      const getVal = (row: ExcelJS.Row, col: number) => {
        const cell = row.getCell(col);
        if (cell.value && typeof cell.value === 'object' && 'result' in cell.value) {
          return (cell.value as any).result;
        }
        return cell.value;
      };

      if (mode === 'compact_time') {
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const code = row.getCell(1).value?.toString();
          if (!code) return;

          const dayMap = [
            { label: "Lundi", in: 5, out: 6, pause: 7, abs: 8 },
            { label: "Mardi", in: 9, out: 10, pause: 11, abs: 12 },
            { label: "Mercredi", in: 13, out: 14, pause: 15, abs: 16 },
            { label: "Jeudi", in: 17, out: 18, pause: 19, abs: 20 },
            { label: "Vendredi", in: 21, out: 22, pause: 23, abs: 24 },
            { label: "Samedi", in: 25, out: 26, pause: 27, abs: 28 },
            { label: "Dimanche", in: 29, out: 30, pause: 31, abs: 32 },
          ];

          dayMap.forEach((day, index) => {
            const timeIn = formatExcelTimeValue(row.getCell(day.in).value);
            const timeOut = formatExcelTimeValue(row.getCell(day.out).value);
            const pause = Number(getVal(row, day.pause)) || 0;
            const absence = row.getCell(day.abs).value?.toString();

            const punches: AttendancePunch[] = (timeIn && timeOut && timeIn !== "INVALID" && timeOut !== "INVALID") 
              ? [{ type: 'AM' as const, timeIn, timeOut }] 
              : [];
            
            const hasInput = punches.length > 0 || !!absence;

            if (!hasInput) {
              ignoredCount++;
              return;
            }

            const splits = calculateAttendanceSplits(punches, pause, false);

            const previewRow: AttendancePreviewRow = {
              rowId: `${rowNumber}_${index}`,
              status: "valid",
              messages: [],
              employeeCode: code,
              employeeName: row.getCell(2).value?.toString() || "",
              date: "TBD",
              dayName: day.label,
              worksite: row.getCell(4).value?.toString() || "",
              punches,
              pauseMinutes: pause,
              calculatedHours: splits.total,
              dayHours: splits.day,
              nightHours: splits.night,
              overtimeHours: splits.overtime,
              holidayWorkedHours: splits.holiday,
              validatedHours: splits.total,
              absenceCode: absence || undefined,
              isHoliday: false,
              notes: ""
            };

            rows.push(validatePreviewRow(previewRow, employeesMapByCode));
          });
        });
      } else if (mode === 'detailed') {
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const firstCell = row.getCell(1).value?.toString() || "";
          if (firstCell.startsWith("Employé:") || firstCell.includes("Code employé") || firstCell.includes("TOTAL")) return;

          const code = row.getCell(1).value?.toString();
          if (!code) return;

          const amIn = formatExcelTimeValue(row.getCell(7).value);
          const amOut = formatExcelTimeValue(row.getCell(8).value);
          const pmIn = formatExcelTimeValue(row.getCell(9).value);
          const pmOut = formatExcelTimeValue(row.getCell(10).value);
          const otIn = formatExcelTimeValue(row.getCell(11).value);
          const otOut = formatExcelTimeValue(row.getCell(12).value);
          const pause = Number(getVal(row, 13)) || 0;
          const valHVal = getVal(row, 15);
          const absence = row.getCell(16).value?.toString();
          const isHoliday = row.getCell(17).value?.toString() === "Oui";
          const notes = row.getCell(18).value?.toString();

          const punches: AttendancePunch[] = [
            { type: 'AM' as const, timeIn: amIn, timeOut: amOut },
            { type: 'PM' as const, timeIn: pmIn, timeOut: pmOut },
            { type: 'OT' as const, timeIn: otIn, timeOut: otOut },
          ].filter(p => !!(p.timeIn && p.timeOut && p.timeIn !== "INVALID"));

          const hasManualEntry = !(valHVal === null || valHVal === undefined || valHVal === "");
          const hasInput = punches.length > 0 || hasManualEntry || !!absence || isHoliday || !!notes;

          if (!hasInput) {
            ignoredCount++;
            return;
          }

          const splits = calculateAttendanceSplits(punches, pause, isHoliday);
          const finalValid = hasManualEntry ? Number(valHVal) : splits.total;

          const rawDate = getVal(row, 3);
          const dateStr = rawDate instanceof Date ? format(rawDate, "yyyy-MM-dd") : (rawDate?.toString() || "");

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
            calculatedHours: splits.total,
            dayHours: splits.day,
            nightHours: splits.night,
            overtimeHours: splits.overtime,
            holidayWorkedHours: splits.holiday,
            validatedHours: finalValid,
            absenceCode: absence || undefined,
            isHoliday,
            notes: notes || undefined
          };

          rows.push(validatePreviewRow(previewRow, employeesMapByCode));
        });
      } else {
        // Legacy Compact mode decimal unpivoting
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const code = row.getCell(1).value?.toString();
          if (!code) return;

          const dayMap = [
            { label: "Lundi", h: 5, a: 6 }, { label: "Mardi", h: 7, a: 8 }, { label: "Mercredi", h: 9, a: 10 },
            { label: "Jeudi", h: 11, a: 12 }, { label: "Vendredi", h: 13, a: 14 }, { label: "Samedi", h: 15, a: 16 },
            { label: "Dimanche", h: 17, a: 18 },
          ];

          dayMap.forEach((day, index) => {
            const hVal = getVal(row, day.h);
            const h = Number(hVal) || 0;
            const a = row.getCell(day.a).value?.toString();

            if (h === 0 && !a) {
              ignoredCount++;
              return;
            }

            const previewRow: AttendancePreviewRow = {
              rowId: `${rowNumber}_${index}`,
              status: "valid",
              messages: [],
              employeeCode: code,
              employeeName: row.getCell(2).value?.toString() || "",
              date: "TBD",
              dayName: day.label,
              worksite: row.getCell(4).value?.toString() || "",
              punches: [],
              pauseMinutes: 0, 
              calculatedHours: h,
              dayHours: h, 
              nightHours: 0,
              overtimeHours: 0,
              holidayWorkedHours: 0,
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
      setIgnoredRowsCount(ignoredCount);
      toast({ title: "Fichier analysé", description: `${rows.length} lignes extraites.` });
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
      alert("Aucun employé actif trouvé.");
      return;
    }

    setIsDownloading(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const resolvedPause = defaultPause === 'custom' ? (parseInt(customPause) || 0) : parseInt(defaultPause);

      const sheet1 = workbook.addWorksheet("Présences");
      if (inputMode === "detailed") {
        setupDetailedSheet(sheet1, periodType, selectedYear, selectedMonth, startDate, employees, resolvedPause);
      } else if (inputMode === "compact_time") {
        setupCompactTimeEntrySheet(sheet1, startDate, employees, resolvedPause);
      } else {
        setupCompactSheet(sheet1, startDate, employees);
      }

      const guideSheet = workbook.addWorksheet("Guide & Référentiels");
      setupGuideSheet(guideSheet);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `modele_presences_${inputMode}_${periodType}_${format(new Date(), "yyyyMMdd")}.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

  const setupDetailedSheet = (sheet: ExcelJS.Worksheet, periodType: string, year: number, month: number, start: string, employees: Employee[], prefillPause: number) => {
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
            pause: prefillPause
          });

          const currentRow = row.number;
          row.getCell(3).numFmt = 'yyyy-mm-dd';
          ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');
          
          const fAM = `IF(AND(G${currentRow}<>"",H${currentRow}<>""),IF(H${currentRow}>=G${currentRow},(H${currentRow}-G${currentRow})*24,(H${currentRow}+1-G${currentRow})*24),0)`;
          const fPM = `IF(AND(I${currentRow}<>"",J${currentRow}<>""),IF(J${currentRow}>=I${currentRow},(J${currentRow}-I${currentRow})*24,(J${currentRow}+1-I${currentRow})*24),0)`;
          const fHS = `IF(AND(K${currentRow}<>"",L${currentRow}<>""),IF(L${currentRow}>=K${currentRow},(L${currentRow}-K${currentRow})*24,(L${currentRow}+1-K${currentRow})*24),0)`;

          row.getCell(14).value = { 
            formula: `IFERROR(MAX(0, (${fAM} + ${fPM} + ${fHS}) - M${currentRow}/60), 0)`,
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
        
        const lastRowObj = sheet.lastRow;
        if (lastRowObj) {
           lastRowObj.addPageBreak();
        }
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
            pause: prefillPause
          });

          row.getCell('C').numFmt = 'yyyy-mm-dd';
          ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');

          const fAM = `IF(AND(G${currentRow}<>"",H${currentRow}<>""),IF(H${currentRow}>=G${currentRow},(H${currentRow}-G${currentRow})*24,(H${currentRow}+1-G${currentRow})*24),0)`;
          const fPM = `IF(AND(I${currentRow}<>"",J${currentRow}<>""),IF(J${currentRow}>=I${currentRow},(J${currentRow}-I${currentRow})*24,(J${currentRow}+1-I${currentRow})*24),0)`;
          const fHS = `IF(AND(K${currentRow}<>"",L${currentRow}<>""),IF(L${currentRow}>=K${currentRow},(L${currentRow}-K${currentRow})*24,(L${currentRow}+1-K${currentRow})*24),0)`;

          row.getCell('N').value = { 
            formula: `IFERROR(MAX(0, (${fAM} + ${fPM} + ${fHS}) - M${currentRow}/60), 0)`,
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

  const setupCompactTimeEntrySheet = (sheet: ExcelJS.Worksheet, start: string, employees: Employee[], prefillPause: number) => {
    const pStart = startOfDay(new Date(start));
    const weekDays = eachDayOfInterval({ start: pStart, end: addDays(pStart, 6) });
    
    const columns: any[] = [
      { header: "Code employé", key: "employeeCode", width: 15 },
      { header: "Nom employé", key: "employeeName", width: 25 },
      { header: "Département", key: "department", width: 20 },
      { header: "Site", key: "worksite", width: 20 },
    ];

    weekDays.forEach(day => {
      const dayLabel = format(day, "EEEE dd/MM", { locale: fr });
      columns.push({ header: `${dayLabel} - Entrée`, width: 12 });
      columns.push({ header: `${dayLabel} - Sortie`, width: 12 });
      columns.push({ header: `${dayLabel} - Pause`, width: 10 });
      columns.push({ header: `${dayLabel} - Absence`, width: 15 });
    });

    sheet.columns = columns as any;
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } };

    employees.forEach(emp => {
      const rowData: any = [
        emp.employeeCode,
        emp.displayName,
        emp.departmentName || "",
        emp.worksiteName || "",
      ];

      weekDays.forEach(() => {
        rowData.push("", "", prefillPause, "");
      });

      const row = sheet.addRow(rowData);
      
      // Time Formats and Validation
      for (let i = 0; i < 7; i++) {
        const startIdx = 5 + (i * 4);
        row.getCell(startIdx).numFmt = 'hh:mm';
        row.getCell(startIdx + 1).numFmt = 'hh:mm';
        row.getCell(startIdx + 3).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
      }
    });

    sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
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

  const setupGuideSheet = (sheet: ExcelJS.Worksheet) => {
    sheet.getColumn('A').width = 40;
    sheet.addRow(["GUIDE DE SAISIE"]).font = { bold: true, size: 14 };
    sheet.addRow(["1. Mode Détaillé : Saisissez les horaires HH:mm."]);
    sheet.addRow(["2. Mode Compact Horaires : Une ligne par employé, saisie des horaires jour par jour."]);
    sheet.addRow(["3. Mode Compact Décimal : Saisissez les totaux décimaux nets (ex: 6.5)."]);
    sheet.addRow(["4. Pause : Saisir en minutes réelles (ex: 30, 45). Si pas de pause : 0."]);
    sheet.addRow(["5. En mode compact décimal, la pause doit être déjà déduite de votre saisie."]);
    sheet.addRow([]);
    sheet.addRow(["CODES ABSENCE VALIDES"]).font = { bold: true };
    ABSENCE_CODES.forEach(c => sheet.addRow([c]));
  };

  const previewStats = useMemo(() => {
    const stats = {
      total: previewRows.length,
      valid: previewRows.filter(r => r.status === 'valid').length,
      warning: previewRows.filter(r => r.status === 'warning').length,
      error: previewRows.filter(r => r.status === 'error').length,
      totalHours: 0,
      dayHours: 0,
      nightHours: 0,
      overtimeHours: 0,
      absencesCount: previewRows.filter(r => !!r.absenceCode).length,
    };

    previewRows.forEach(r => {
      stats.totalHours += r.validatedHours || 0;
      stats.dayHours += r.dayHours || 0;
      stats.nightHours += r.nightHours || 0;
      stats.overtimeHours += r.overtimeHours || 0;
    });

    return stats;
  }, [previewRows]);

  if (membershipLoading) return <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  if (!canRead) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 pb-24">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20"><Clock className="w-6 h-6" /></div>
          <div><h1 className="text-3xl font-black text-primary tracking-tight">Présences</h1><p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p></div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                      <Label className="text-[10px] uppercase font-black">Mode de saisie</Label>
                      <Select value={inputMode} onValueChange={(v: any) => setInputMode(v)}>
                        <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compact_time">Compact horaires hebdomadaire</SelectItem>
                          <SelectItem value="detailed">Détaillé horizontal (HH:mm)</SelectItem>
                          <SelectItem value="compact">Saisie manuelle heures totales (Décimal)</SelectItem>
                        </SelectContent>
                      </Select>
                   </div>
                   
                   {inputMode !== 'compact' && (
                      <div className="space-y-2">
                         <Label className="text-[10px] uppercase font-black flex items-center gap-1">
                           <Coffee className="w-3 h-3" /> Pause par défaut
                         </Label>
                         <div className="flex gap-2">
                            <Select value={defaultPause} onValueChange={setDefaultPause}>
                              <SelectTrigger className="rounded-xl flex-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">0 min</SelectItem>
                                <SelectItem value="15">15 min</SelectItem>
                                <SelectItem value="30">30 min</SelectItem>
                                <SelectItem value="45">45 min</SelectItem>
                                <SelectItem value="60">60 min</SelectItem>
                                <SelectItem value="custom">Perso...</SelectItem>
                              </SelectContent>
                            </Select>
                            {defaultPause === 'custom' && (
                              <Input type="number" placeholder="Min..." value={customPause} onChange={(e) => setCustomPause(e.target.value)} className="w-20 rounded-xl" />
                            )}
                         </div>
                      </div>
                   )}

                   <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-black">Type de période</Label>
                      <Select value={periodType} onValueChange={(v: any) => setPeriodType(v)} disabled={inputMode === 'compact_time' || inputMode === 'compact'}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="weekly">Hebdomadaire</SelectItem><SelectItem value="monthly">Mensuel</SelectItem></SelectContent>
                      </Select>
                   </div>

                   {periodType === "monthly" ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label className="text-[10px] uppercase font-black">Mois</Label><Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => (<SelectItem key={m} value={String(m)}>{format(new Date(2024, m - 1), "MMMM", { locale: fr })}</SelectItem>))}</SelectContent></Select></div>
                        <div className="space-y-2"><Label className="text-[10px] uppercase font-black">Année</Label><Input type="number" value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))} className="rounded-xl" /></div>
                      </div>
                   ) : (
                      <div className="space-y-2"><Label className="text-[10px] uppercase font-black">Date de début</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl" /></div>
                   )}
                </div>
                <Button onClick={handleDownloadTemplate} disabled={isDownloading} className="w-full h-12 rounded-xl font-black gap-2 shadow-lg shadow-primary/10">
                   {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                   Générer le modèle
                </Button>
             </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-accent/20 shadow-xl shadow-accent/5 overflow-hidden">
             <CardHeader className="bg-accent/10 border-b py-6 px-8">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-accent-foreground flex items-center gap-2">
                   <Upload className="w-4 h-4" /> Importer
                </CardTitle>
             </CardHeader>
             <CardContent className="p-8 space-y-4">
                <div className={cn(
                  "border-2 border-dashed rounded-2xl p-10 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer",
                  isReading ? "bg-slate-50 opacity-50" : "bg-slate-50/30 hover:bg-white hover:border-accent/40"
                )}>
                   <input type="file" ref={fileInputRef} accept=".xlsx" onChange={handleFileChange} disabled={isReading} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                   {isReading ? <Loader2 className="w-8 h-8 animate-spin text-accent" /> : <Layout className="w-8 h-8 text-accent/30" />}
                   <p className="text-xs font-bold text-slate-600">Cliquer pour importer le fichier rempli</p>
                   <p className="text-[10px] text-muted-foreground uppercase font-black">.xlsx uniquement</p>
                </div>
                {uploadError && <Alert variant="destructive" className="rounded-xl"><AlertCircle className="w-4 h-4" /><AlertDescription>{uploadError}</AlertDescription></Alert>}
             </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
           {previewRows.length > 0 ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 bg-white p-6 rounded-[2rem] border shadow-lg">
                    <SummaryStat label="H. Totales" value={previewStats.totalHours.toFixed(1)} color="blue" />
                    <SummaryStat label="H. Jour" value={previewStats.dayHours.toFixed(1)} color="slate" />
                    <SummaryStat label="H. Nuit" value={previewStats.nightHours.toFixed(1)} color="indigo" />
                    <SummaryStat label="H. Sup" value={previewStats.overtimeHours.toFixed(1)} color="orange" />
                    <SummaryStat label="Absences" value={previewStats.absencesCount} color="slate" />
                    <SummaryStat label="Alertes" value={previewStats.warning} color="orange" />
                    <SummaryStat label="Erreurs" value={previewStats.error} color="red" />
                    <SummaryStat label="Ignorées" value={ignoredRowsCount} color="slate" />
                 </div>

                 <Card className="rounded-[2rem] border-primary/10 shadow-xl overflow-hidden bg-white">
                    {previewRows[0]?.date === "TBD" && (
                       <div className="bg-blue-50 p-4 border-b flex items-center gap-3 text-blue-800">
                          <Info className="w-5 h-5 shrink-0" />
                          <p className="text-xs font-bold leading-tight">
                            Mode compact détecté : Les dates précises sont extrapolées à partir du jour de la semaine.
                          </p>
                       </div>
                    )}
                    <ScrollArea className="h-[600px] w-full">
                       <Table>
                          <TableHeader className="bg-slate-50 sticky top-0 z-10">
                             <TableRow>
                                <TableHead className="pl-6 w-[80px]">Status</TableHead>
                                <TableHead>Collaborateur</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-center">H. Totales</TableHead>
                                <TableHead className="text-center">Jour</TableHead>
                                <TableHead className="text-center">Nuit</TableHead>
                                <TableHead className="text-center">Sup.</TableHead>
                                <TableHead>Messages</TableHead>
                             </TableRow>
                          </TableHeader>
                          <TableBody>
                             {previewRows.map((row) => (
                               <TableRow key={row.rowId} className={cn("group transition-colors", row.status === 'error' ? "bg-red-50/30" : row.status === 'warning' ? "bg-orange-50/30" : "hover:bg-slate-50")}>
                                  <TableCell className="pl-6">{getStatusIcon(row.status)}</TableCell>
                                  <TableCell>
                                     <div className="flex flex-col">
                                        <span className="font-bold text-slate-800 text-xs">{row.employeeName}</span>
                                        <span className="text-[10px] text-muted-foreground font-mono">{row.employeeCode}</span>
                                     </div>
                                  </TableCell>
                                  <TableCell>
                                     <div className="flex flex-col">
                                        <span className="text-xs font-medium">{formatRowDate(row.date, row.dayName)}</span>
                                        <span className="text-[10px] text-muted-foreground uppercase">{row.dayName}</span>
                                     </div>
                                  </TableCell>
                                  <TableCell className="text-center font-black text-xs text-primary bg-primary/5">{row.validatedHours.toFixed(2)}</TableCell>
                                  <TableCell className="text-center text-xs font-medium text-slate-600"><div className="flex items-center justify-center gap-1">{row.dayHours > 0 && <Sun className="w-2.5 h-2.5 text-orange-400" />} {row.dayHours.toFixed(2)}</div></TableCell>
                                  <TableCell className="text-center text-xs font-medium text-slate-600"><div className="flex items-center justify-center gap-1">{row.nightHours > 0 && <Moon className="w-2.5 h-2.5 text-indigo-400" />} {row.nightHours.toFixed(2)}</div></TableCell>
                                  <TableCell className="text-center text-xs font-black text-orange-600">{row.overtimeHours > 0 ? `+${row.overtimeHours.toFixed(2)}` : "—"}</TableCell>
                                  <TableCell className="pr-6">
                                     <div className="space-y-1">
                                        {row.messages.map((m, idx) => (
                                          <div key={idx} className={cn("text-[10px] font-bold leading-tight", row.status === 'error' ? "text-red-600" : "text-orange-600")}>• {m}</div>
                                        ))}
                                        {row.absenceCode && <Badge variant="outline" className="text-[8px] uppercase border-orange-200 text-orange-700 bg-orange-50 font-black">{row.absenceCode}</Badge>}
                                        {row.isHoliday && <Badge variant="outline" className="text-[8px] uppercase border-blue-200 text-blue-700 bg-blue-50 font-black ml-1">Férié</Badge>}
                                     </div>
                                  </TableCell>
                                </TableRow>
                             ))}
                          </TableBody>
                       </Table>
                       <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                    <div className="bg-secondary/20 p-4 border-t flex items-center justify-between text-[10px] font-black uppercase text-muted-foreground tracking-widest px-8">
                       <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> {previewStats.valid} lignes prêtes.</span>
                       <span className="flex items-center gap-2 font-bold"><ShieldCheck className="w-4 h-4" /> Import réel prévu en phase suivante</span>
                    </div>
                 </Card>
              </div>
           ) : (
              <div className="flex flex-col items-center justify-center min-h-[500px] border-2 border-dashed rounded-[3rem] bg-secondary/5 opacity-50 space-y-4">
                 <div className="bg-white p-6 rounded-full shadow-sm"><TableIcon className="w-12 h-12 text-slate-200" /></div>
                 <div className="text-center space-y-1">
                   <h3 className="font-black text-slate-400 uppercase text-xs tracking-widest">Prévisualisation</h3>
                   <p className="text-xs text-slate-400 italic">Téléversez un fichier pour voir la ventilation des heures.</p>
                 </div>
              </div>
           )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string, value: number | string, color: string }) {
  const colorMap: Record<string, string> = {
    slate: "bg-slate-50 text-slate-600 border-slate-100",
    green: "bg-green-50 text-green-600 border-green-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    red: "bg-red-50 text-red-600 border-red-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100"
  };
  
  return (
    <div className={cn("p-2 rounded-2xl border flex flex-col items-center min-w-[70px]", colorMap[color] || colorMap.slate)}>
      <span className="text-[7px] font-black uppercase tracking-tighter opacity-70 whitespace-nowrap">{label}</span>
      <span className="text-sm font-black leading-none mt-1">{value}</span>
    </div>
  );
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'valid': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'warning': return <FileWarning className="w-4 h-4 text-orange-500" />;
    case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
    default: return null;
  }
}
