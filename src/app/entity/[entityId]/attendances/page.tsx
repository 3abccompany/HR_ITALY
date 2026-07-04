"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
  XCircle,
  RefreshCw,
  Plus,
  Save,
  CheckCircle,
  FileBadge,
  History as HistoryIcon,
  ArrowUpRight,
  User,
  Building2,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  MoreVertical,
  CheckSquare,
  ChevronUp
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCollection, useFirebase, useUser } from "@/firebase";
import { collection, query, where, Query, orderBy, doc, getDoc, updateDoc } from "firebase/firestore";
import { Employee } from "@/types/employee";
import { 
  AttendancePreviewRow, 
  AttendancePunch, 
  AttendanceRecord, 
  AttendanceImportBatch 
} from "@/types/attendance";
import { Holiday } from "@/types/holiday";
import { TimeOffRequest, TIME_OFF_TYPE_LABELS } from "@/types/time-off";
import { 
  calculateAttendanceSplits, 
  executeAttendanceImport,
  validatePreviewRow,
  validateAttendanceRecords,
  buildAttendanceId
} from "@/services/attendance.service";
import { 
  format, 
  addDays, 
  startOfDay,
  startOfWeek,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isBefore,
  differenceInCalendarDays
} from "date-fns";
import { fr } from "date-fns/locale";
import { 
  Select, 
  SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
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

const STATUS_LABELS: Record<string, string> = {
  draft_imported: "Brouillon importé",
  draft: "Brouillon",
  validated: "Validée",
  corrected: "Corrigée",
  cancelled: "Annulée",
  locked: "Verrouillée",
  archived: "Archivée"
};

const DAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" }
];

const getValidationBlockReason = (
  a: AttendanceRecord, 
  holidaysMap: Map<string, string>, 
  timeOffRequests: TimeOffRequest[] | undefined
) => {
  const isWorked = (a.validatedHours || 0) > 0;
  const regHolidayName = holidaysMap.get(a.attendanceDate);
  const isRegHoliday = !!regHolidayName;
  
  const matchingRequest = timeOffRequests
    ?.filter(r => r.employeeId === a.employeeId && r.status !== 'cancelled')
    .find(r => a.attendanceDate >= r.startDate && a.attendanceDate <= r.endDate);

  const isJustified = matchingRequest && matchingRequest.status === 'approved';

  if (isRegHoliday) return null;
  if (!isWorked && isJustified) return null;

  if (isWorked) {
    if (a.anomalyFlag) {
       if (a.anomalyMessages?.some(m => m.toLowerCase().includes('pointage') || m.toLowerCase().includes('entrée') || m.toLowerCase().includes('sortie'))) return "Anomalie de pointage";
       if (a.anomalyMessages?.some(m => m.toLowerCase().includes('heures'))) return "Heures invalides";
       return "Anomalie non résolue";
    }
    return null;
  }

  if (matchingRequest && !isWorked) {
    if (matchingRequest.status === 'submitted') return "Demande en attente";
    if (matchingRequest.status === 'rejected') return "Demande refusée";
  }

  if (a.absenceCode && !isJustified && !isWorked) {
    const code = a.absenceCode.toLowerCase();
    if (code.includes('sick') || code.includes('malad') || code.includes('infort')) {
      return "Maladie Excel non confirmée";
    }
    if (code.includes('leave') || code.includes('cong') || code.includes('ferie') || code.includes('vac')) {
      return "Congé Excel non confirmé";
    }
    return "Absence Excel non confirmée";
  }

  const isAbsenceCandidate = a.validatedHours === 0 && !a.absenceCode && !isRegHoliday && a.anomalyMessages?.includes("Absence à analyser");
  if (isAbsenceCandidate) return "Absence à analyser";

  if (a.holidayFlag && !isRegHoliday) return "Férié Excel non confirmé";

  if (a.anomalyFlag && !isJustified) {
    return "Anomalie non résolue";
  }

  if (!isWorked && !a.absenceCode) return "Absence à analyser";

  return null;
};

/**
 * Robust date parser for mixed formats.
 */
function parseSafeDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    return null;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

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
  if (!dateStr || dateStr === "INVALID") return dayName;
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) return format(d, "dd/MM", { locale: fr });
  } catch (e) {}
  return "Date invalide";
}

interface GroupedEmployeeAttendance {
  employeeId: string;
  employeeCode: string;
  employeeDisplayName: string;
  departmentName?: string | null;
  worksiteName?: string | null;
  records: any[];
  totalHours: number;
  dayHours: number;
  nightHours: number;
  overtimeHours: number;
  absenceCount: number;
  anomalyCount: number;
  draftCount: number;
  validatedCount: number;
}

const initialRegistryFilters = {
  status: "all",
  search: "",
  absenceOnly: false,
  anomalyOnly: false
};

export default function AttendancesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { user } = useUser();
  const { auth } = useFirebase();
  const { toast } = useToast();
  const { hasPermission, loading: membershipLoading, entity } = useActiveMembership(entityId);

  // --- UI Layout State ---
  const [activeTab, setActiveTab] = useState("import");

  // --- Template / Global State ---
  const [periodType, setPeriodType] = useState<"monthly" | "weekly">("weekly");
  const [inputMode, setInputMode] = useState<"detailed" | "compact_time" | "compact">("detailed");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [defaultPause, setDefaultPause] = useState("0");
  const [customPause, setCustomPause] = useState("");
  const [expectedWorkingDays, setExpectedWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Upload / Preview State ---
  const [isReading, setIsReading] = useState(false);
  const [previewRows, setPreviewRows] = useState<AttendancePreviewRow[]>([]);
  const [ignoredRowsCount, setIgnoredRowsCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Import Action State ---
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // --- Registry State ---
  const [registryFilters, setRegistryFilters] = useState(initialRegistryFilters);
  const [dateSortDirection, setDateSortDirection] = useState<"asc" | "desc">("desc");
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());

  // --- Validation State ---
  const [isValidating, setIsValidating] = useState(false);
  const [isValidationConfirmOpen, setIsValidationConfirmOpen] = useState(false);
  const [validationBlockSummary, setValidationBlockSummary] = useState<{
    total: number;
    reasons: Record<string, number>;
  } | null>(null);

  const canRead = hasPermission("attendances.read");
  const canReadHolidays = hasPermission("holidays.read");
  const canCreate = hasPermission("attendances.create") || hasPermission("attendances.write");
  const canValidate = hasPermission("attendances.validate");

  // --- Collection Queries ---
  const empQuery = useMemo(() => 
    db ? query(collection(db, `entities/${entityId}/employees`), where("status", "==", "active")) as Query<Employee> : null,
  [db, entityId]);

  const attendancesQuery = useMemo(() => 
    db && entityId && canRead ? query(collection(db, `entities/${entityId}/attendances`)) as Query<AttendanceRecord> : null,
  [db, entityId, canRead]);

  const batchesQuery = useMemo(() => 
    db && entityId && canRead ? query(collection(db, `entities/${entityId}/attendanceImportBatches`), orderBy("createdAt", "desc")) as Query<AttendanceImportBatch> : null,
  [db, entityId, canRead]);

  const holidaysQuery = useMemo(() => {
    if (!db || !entityId || !canReadHolidays) return null;
    const start = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-01`;
    const end = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-31`;
    return query(
      collection(db, `entities/${entityId}/holidays`),
      where("date", ">=", start),
      where("date", "<=", end)
    ) as Query<Holiday>;
  }, [db, entityId, canReadHolidays, selectedMonth, selectedYear]);

  const timeOffRequestsQuery = useMemo(() => {
    if (!db || !entityId || !canRead) return null;
    return query(collection(db, `entities/${entityId}/timeOffRequests`)) as Query<TimeOffRequest>;
  }, [db, entityId, canRead]);

  const { data: employees } = useCollection<Employee>(empQuery, "attendances.employees");
  const { data: registryAttendances, loading: loadingRegistry } = useCollection<AttendanceRecord>(attendancesQuery, "attendances.registry");
  const { data: registryBatches, loading: loadingBatches } = useCollection<AttendanceImportBatch>(batchesQuery, "attendances.batches");
  const { data: holidays } = useCollection<Holiday>(holidaysQuery, "attendances.holidays");
  const { data: timeOffRequests } = useCollection<TimeOffRequest>(timeOffRequestsQuery, "attendances.timeOffRequests");

  const employeesMapByCode = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach(e => map.set(e.employeeCode, e));
    return map;
  }, [employees]);

  const holidaysMap = useMemo(() => {
    const map = new Map<string, string>();
    holidays?.forEach(h => {
      if (h.status === 'active') {
        map.set(h.date, h.name);
      }
    });
    return map;
  }, [holidays]);

  // --- Conflict Analysis for Import ---
  const conflictAnalysis = useMemo(() => {
    if (previewRows.length === 0 || !registryAttendances) return { new: 0, replaceable: 0, blocked: 0 };
    
    let n = 0;
    let r = 0;
    let b = 0;

    const REPLACEABLE_STATUSES = ["draft", "draft_imported"];

    previewRows.forEach(row => {
      if (!row.employeeId) return;
      const id = buildAttendanceId(row.employeeId, row.date);
      const existing = registryAttendances.find(a => a.id === id);
      
      if (!existing) {
        n++;
      } else if (REPLACEABLE_STATUSES.includes(existing.status)) {
        r++;
      } else {
        b++;
      }
    });

    return { new: n, replaceable: r, blocked: b };
  }, [previewRows, registryAttendances]);

  const filteredRegistry = useMemo(() => {
    if (!registryAttendances) return [];
    
    return registryAttendances.filter(a => {
      const date = parseISO(a.attendanceDate);
      if (date.getFullYear() !== selectedYear || (date.getMonth() + 1) !== selectedMonth) return false;

      if (registryFilters.status !== "all" && a.status !== registryFilters.status) return false;

      if (registryFilters.search) {
        const term = registryFilters.search.toLowerCase();
        const match = a.employeeDisplayName?.toLowerCase().includes(term) || a.employeeCode.toLowerCase().includes(term);
        if (!match) return false;
      }

      if (registryFilters.absenceOnly && !a.absenceCode) return false;
      if (registryFilters.anomalyOnly && !a.anomalyFlag) return false;

      return true;
    });
  }, [registryAttendances, selectedMonth, selectedYear, registryFilters]);

  const groupedEmployeeData = useMemo(() => {
    const groups = new Map<string, GroupedEmployeeAttendance>();

    filteredRegistry.forEach(a => {
      const key = a.employeeId || a.employeeCode;
      const isRegHoliday = holidaysMap.has(a.attendanceDate);

      const matchingRequest = timeOffRequests
        ?.filter(r => r.employeeId === a.employeeId && r.status !== 'cancelled')
        .filter(r => a.attendanceDate >= r.startDate && a.attendanceDate <= r.endDate)
        .sort((req1, req2) => {
          const priority: Record<string, number> = { approved: 1, submitted: 2, rejected: 3 };
          return (priority[req1.status] || 99) - (priority[req2.status] || 99);
        })[0];

      if (!groups.has(key)) {
        groups.set(key, {
          employeeId: a.employeeId,
          employeeCode: a.employeeCode,
          employeeDisplayName: a.employeeDisplayName || "Employé inconnu",
          departmentName: a.departmentName,
          worksiteName: a.worksiteName,
          records: [],
          totalHours: 0,
          dayHours: 0,
          nightHours: 0,
          overtimeHours: 0,
          absenceCount: 0,
          anomalyCount: 0,
          draftCount: 0,
          validatedCount: 0
        });
      }

      const group = groups.get(key)!;
      const enrichedRecord = { ...a, matchingRequest };
      group.records.push(enrichedRecord);
      
      group.totalHours += a.validatedHours || 0;
      group.dayHours += a.dayHours || 0;
      group.nightHours += a.nightHours || 0;
      group.overtimeHours += a.overtimeHours || 0;
      
      if (a.absenceCode) group.absenceCount++;
      
      const isJustified = matchingRequest && matchingRequest.status === 'approved';
      const isAbsenceCandidate = a.validatedHours === 0 && !a.absenceCode && !isRegHoliday && a.anomalyMessages?.includes("Absence à analyser");
      
      const shouldCountAsAnomaly = a.anomalyFlag && (!isRegHoliday || isAbsenceCandidate) && !isJustified;

      if (shouldCountAsAnomaly) {
        group.anomalyCount++;
      }
      
      if (a.status === 'draft_imported') group.draftCount++;
      if (a.status === 'validated') group.validatedCount++;
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => 
      a.employeeDisplayName.localeCompare(b.employeeDisplayName)
    );

    sortedGroups.forEach(g => {
      g.records.sort((r1, r2) => {
        const comparison = r1.attendanceDate.localeCompare(r2.attendanceDate);
        return dateSortDirection === 'asc' ? comparison : -comparison;
      });
    });

    return sortedGroups;
  }, [filteredRegistry, dateSortDirection, holidaysMap, timeOffRequests]);

  const registryStats = useMemo(() => {
    const stats = {
      total: filteredRegistry.length,
      draftCount: filteredRegistry.filter(a => a.status === 'draft_imported').length,
      validatedCount: filteredRegistry.filter(a => a.status === 'validated').length,
      totalHours: 0,
      dayHours: 0,
      nightHours: 0,
      overtimeHours: 0,
      absences: filteredRegistry.filter(a => !!a.absenceCode).length,
      anomalies: 0
    };
    
    filteredRegistry.forEach(a => {
      stats.totalHours += a.validatedHours || 0;
      stats.dayHours += a.dayHours || 0;
      stats.nightHours += a.nightHours || 0;
      stats.overtimeHours += a.overtimeHours || 0;
      
      const isRegHoliday = holidaysMap.has(a.attendanceDate);
      const isAbsenceCandidate = a.validatedHours === 0 && !a.absenceCode && !isRegHoliday && a.anomalyMessages?.includes("Absence à analyser");
      const matchingRequest = timeOffRequests
        ?.filter(r => r.employeeId === a.employeeId && r.status !== 'cancelled')
        .find(r => a.attendanceDate >= r.startDate && a.attendanceDate <= r.endDate);
      const isJustified = matchingRequest && matchingRequest.status === 'approved';

      if (a.anomalyFlag && (!isRegHoliday || isAbsenceCandidate) && !isJustified) {
        stats.anomalies++;
      }
    });
    return stats;
  }, [filteredRegistry, holidaysMap, timeOffRequests]);

  const draftIdsToValidate = useMemo(() => 
    filteredRegistry.filter(a => a.status === 'draft_imported').map(a => a.id),
  [filteredRegistry]);

  const handleUpdateRegistryFilter = (key: keyof typeof initialRegistryFilters, value: any) => {
    setRegistryFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleResetRegistryFilters = () => setRegistryFilters(initialRegistryFilters);

  const toggleWorkingDay = (day: number) => {
    setExpectedWorkingDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    setUploadError(null);
    setPreviewRows([]);
    setIgnoredRowsCount(0);
    setSourceFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const sheet = workbook.getWorksheet("Présences");
      if (!sheet) throw new Error("Format de fichier non reconnu. Veuillez utiliser un modèle généré par le système.");

      // Mode detection
      const row1 = sheet.getRow(1);
      let mode: 'compact' | 'compact_time' | 'detailed' = 'detailed';
      
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
        const baseDate = parseISO(startDate);
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
            const actualDateObj = addDays(baseDate, index);
            const actualDate = format(actualDateObj, "yyyy-MM-dd");
            const timeIn = formatExcelTimeValue(row.getCell(day.in).value);
            const timeOut = formatExcelTimeValue(row.getCell(day.out).value);
            const pause = Number(getVal(row, day.pause)) || 0;
            const absence = row.getCell(day.abs).value?.toString();

            const punches: AttendancePunch[] = (timeIn && timeOut && timeIn !== "INVALID" && timeOut !== "INVALID") 
              ? [{ type: 'AM' as const, timeIn, timeOut }] 
              : [];
            
            const dayNum = actualDateObj.getDay();
            const isExpected = expectedWorkingDays.includes(dayNum);
            let hasInput = punches.length > 0 || !!absence;
            
            if (!hasInput) {
              if (isExpected) {
                 hasInput = true;
              } else {
                 ignoredCount++;
                 return;
              }
            }

            const splits = calculateAttendanceSplits(punches, pause, false);
            const previewRow: AttendancePreviewRow = {
              rowId: `${rowNumber}_${index}`,
              status: "valid",
              messages: [],
              employeeCode: code,
              employeeName: row.getCell(2).value?.toString() || "",
              date: actualDate,
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
            
            const validated = validatePreviewRow(previewRow, employeesMapByCode);
            const isActuallyEmpty = punches.length === 0 && !absence;
            if (isActuallyEmpty && isExpected) {
               validated.status = "warning";
               if (!validated.messages.includes("Absence à analyser")) {
                  validated.messages.push("Absence à analyser");
               }
            }
            rows.push(validated);
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
          const splits = calculateAttendanceSplits(punches, pause, isHoliday);
          
          const rawDate = getVal(row, 3);
          let dateStr = "";
          if (rawDate instanceof Date) {
            dateStr = format(rawDate, "yyyy-MM-dd");
          } else if (typeof rawDate === 'number') {
            const date = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
            dateStr = format(date, "yyyy-MM-dd");
          } else if (rawDate) {
            dateStr = rawDate.toString();
          }

          const dateObj = parseISO(dateStr);
          const dayNum = dateObj.getDay();
          const isExpected = expectedWorkingDays.includes(dayNum);
          let hasInput = punches.length > 0 || hasManualEntry || !!absence || isHoliday || !!notes;
          
          if (!hasInput) {
            if (isExpected) {
              hasInput = true;
            } else {
              ignoredCount++;
              return;
            }
          }

          const finalValid = hasManualEntry ? Number(valHVal) : splits.total;

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
            notes: notes || ""
          };
          
          const validated = validatePreviewRow(previewRow, employeesMapByCode);
          const isActuallyEmpty = punches.length === 0 && !hasManualEntry && !absence && !isHoliday && !notes;
          if (isActuallyEmpty && isExpected) {
             validated.status = "warning";
             if (!validated.messages.includes("Absence à analyser")) {
                validated.messages.push("Absence à analyser");
             }
          }
          rows.push(validated);
        });
      } else {
        const baseDate = parseISO(startDate);
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
            const actualDateObj = addDays(baseDate, index);
            const actualDate = format(actualDateObj, "yyyy-MM-dd");
            const hVal = getVal(row, day.h);
            const h = Number(hVal) || 0;
            const a = row.getCell(day.a).value?.toString();

            const dayNum = actualDateObj.getDay();
            const isExpected = expectedWorkingDays.includes(dayNum);
            let hasInput = h > 0 || !!a;
            
            if (!hasInput) {
               if (isExpected) {
                  hasInput = true;
               } else {
                  ignoredCount++;
                  return;
               }
            }

            const previewRow: AttendancePreviewRow = {
              rowId: `${rowNumber}_${index}`,
              status: "valid",
              messages: [],
              employeeCode: code,
              employeeName: row.getCell(2).value?.toString() || "",
              date: actualDate,
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
            
            const validated = validatePreviewRow(previewRow, employeesMapByCode);
            if (h === 0 && !a && isExpected) {
               validated.status = "warning";
               if (!validated.messages.includes("Absence à analyser")) {
                  validated.messages.push("Absence à analyser");
               }
            }
            rows.push(validated);
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
      workbook.calcProperties.fullCalcOnLoad = true;
      const prefillPauseValue = defaultPause === 'custom' ? (parseInt(customPause) || 0) : parseInt(defaultPause);

      const sheet1 = workbook.addWorksheet("Présences");
      if (inputMode === "detailed") {
        setupDetailedSheet(sheet1, periodType, selectedYear, selectedMonth, startDate, employees, prefillPauseValue);
      } else if (inputMode === "compact_time") {
        setupCompactTimeEntrySheet(sheet1, startDate, employees, prefillPauseValue);
      } else {
        setupCompactSheet(sheet1, startDate, employees);
      }

      workbook.addWorksheet("Guide & Référentiels");
      setupGuideSheet(workbook.getWorksheet("Guide & Référentiels")!);

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

  const handleImportClick = () => {
    if (!previewRows.length) return;
    if (previewStats.error > 0) {
       toast({ variant: "destructive", title: "Action bloquée", description: "Veuillez corriger les erreurs avant d'importer." });
       return;
    }
    setIsImportConfirmOpen(true);
  };

  const handleExecuteImport = async (strategy: "fail" | "skip" | "overwrite" = "fail") => {
    if (!user || !entityId || !previewRows.length) return;
    setIsImporting(true);
    try {
      await executeAttendanceImport({
        entityId,
        actorUid: user.uid,
        previewRows,
        conflictStrategy: strategy,
        batchMetadata: {
          sourceFileName,
          templateMode: inputMode,
          periodType,
          periodStart: periodType === 'weekly' ? startDate : `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-01`,
          periodEnd: periodType === 'weekly' ? format(addDays(new Date(startDate), 6), "yyyy-MM-dd") : format(endOfMonth(new Date(selectedYear, selectedMonth - 1)), "yyyy-MM-dd"),
          totalPreviewRows: previewRows.length,
          importedRowsCount: previewRows.length,
          warningRowsCount: previewStats.warning,
          ignoredRowsCount,
          totalWorkedHours: previewStats.totalHours,
          dayHours: previewStats.dayHours,
          nightHours: previewStats.nightHours,
          overtimeHours: previewStats.overtimeHours,
          absenceRowsCount: previewStats.absencesCount,
        }
      });

      toast({ 
        title: strategy === 'overwrite' ? "Brouillons remplacés" : "Importation terminée", 
        description: `${previewRows.length} enregistrements ont été importés.` 
      });
      
      setPreviewRows([]);
      setIgnoredRowsCount(0);
      setIsImportConfirmOpen(false);
      setActiveTab("registry");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur d'importation", description: err.message });
    } finally {
      setIsImporting(false);
    }
  };

  const handleValidateSingle = async (attendance: AttendanceRecord) => {
    if (!user || !entityId || !canValidate) return;
    
    const blockReason = getValidationBlockReason(attendance, holidaysMap, timeOffRequests);
    if (blockReason) {
      toast({
        variant: "destructive",
        title: "Validation impossible",
        description: `Cette ligne contient une erreur (${blockReason}). Veuillez la résoudre avant de valider.`,
      });
      return;
    }

    setIsValidating(true);
    try {
      await validateAttendanceRecords({
        entityId,
        attendanceIds: [attendance.id],
        actorUid: user.uid
      });
      toast({ title: "Présence validée" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setIsValidating(false);
    }
  };

  const handleAttemptBulkValidation = () => {
    if (!user || !entityId || !canValidate || draftIdsToValidate.length === 0) return;

    const blockedRecords = filteredRegistry
      .filter(a => a.status === 'draft_imported')
      .map(a => ({ id: a.id, reason: getValidationBlockReason(a, holidaysMap, timeOffRequests) }))
      .filter(item => item.reason !== null);

    if (blockedRecords.length > 0) {
      const counts: Record<string, number> = {};
      blockedRecords.forEach(item => {
        counts[item.reason!] = (counts[item.reason!] || 0) + 1;
      });
      setValidationBlockSummary({ total: blockedRecords.length, reasons: counts });
      return;
    }

    setIsValidationConfirmOpen(true);
  };

  const handleValidateBulk = async () => {
    if (!user || !entityId || !canValidate || draftIdsToValidate.length === 0) return;
    setIsValidating(true);
    try {
      await validateAttendanceRecords({
        entityId,
        attendanceIds: draftIdsToValidate,
        actorUid: user.uid
      });
      toast({ title: "Validation terminée", description: `${draftIdsToValidate.length} enregistrements ont été validés.` });
      setIsValidationConfirmOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erreur", description: err.message });
    } finally {
      setIsValidating(false);
    }
  };

  const toggleEmployeeExpansion = (employeeId: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const previewStats = useMemo(() => {
    const stats = { total: previewRows.length, valid: previewRows.filter(r => r.status === 'valid').length, warning: previewRows.filter(r => r.status === 'warning').length, error: previewRows.filter(r => r.status === 'error').length, totalHours: 0, dayHours: 0, nightHours: 0, overtimeHours: 0, absencesCount: previewRows.filter(r => !!r.absenceCode).length };
    previewRows.forEach(r => { stats.totalHours += r.validatedHours || 0; stats.dayHours += r.dayHours || 0; stats.nightHours += r.nightHours || 0; stats.overtimeHours += r.overtimeHours || 0; });
    return stats;
  }, [previewRows]);

  if (membershipLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-primary tracking-tight">Présences</h1>
          <p className="text-muted-foreground text-sm font-medium">{entity?.nomEntreprise}</p>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
         <TabsList className="bg-white border rounded-xl p-1 h-11">
            <TabsTrigger value="import" className="rounded-lg px-6 font-bold gap-2"><Upload className="w-4 h-4" /> Importer</TabsTrigger>
            <TabsTrigger value="registry" className="rounded-lg px-6 font-bold gap-2"><HistoryIcon className="w-4 h-4" /> Registre & Historique</TabsTrigger>
         </TabsList>

         <TabsContent value="import" className="mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-6">
                <Card className="rounded-[2rem] border-primary/10 shadow-xl shadow-primary/5 overflow-hidden">
                  <CardHeader className="bg-primary/5 border-b py-6 px-8">
                      <CardTitle className="text-sm font-black uppercase tracking-widest text-primary/70 flex items-center gap-2">
                        <FileBadge className="w-4 h-4" /> Modèle Excel
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
                              <Label className="text-[10px] uppercase font-black flex items-center gap-1"><Coffee className="w-3 h-3" /> Pause par défaut</Label>
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
                          <Label className="text-[10px] uppercase font-black">Jours de présence attendus</Label>
                          <div className="flex flex-wrap gap-1">
                            {DAY_OPTIONS.map((day) => {
                              const isSelected = expectedWorkingDays.includes(day.value);
                              return (
                                <Button
                                  key={day.value}
                                  type="button"
                                  variant={isSelected ? "default" : "outline"}
                                  size="sm"
                                  className={cn(
                                    "h-8 w-10 p-0 text-[10px] font-black uppercase rounded-lg transition-all",
                                    isSelected ? "bg-primary text-white" : "text-muted-foreground bg-white"
                                  )}
                                  onClick={() => toggleWorkingDay(day.value)}
                                >
                                  {day.label}
                                </Button>
                              );
                            })}
                          </div>
                          <p className="text-[9px] text-muted-foreground italic">Les jours non sélectionnés seront ignorés si vides à l'import.</p>
                        </div>
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
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Générer le modèle
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
                      <div className={cn("border-2 border-dashed rounded-2xl p-10 transition-all relative flex flex-col items-center justify-center gap-2 text-center cursor-pointer", isReading ? "bg-slate-50 opacity-50" : "bg-slate-50/30 hover:bg-white hover:border-accent/40")}>
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
                                              {row.messages.map((m, idx) => (<div key={idx} className={cn("text-[10px] font-bold leading-tight", row.status === 'error' ? "text-red-600" : "text-orange-600")}>• {m}</div>))}
                                              {row.absenceCode && <Badge className="text-[8px] uppercase border-orange-200 text-orange-700 bg-orange-50 font-black h-4 px-1.5">{row.absenceCode}</Badge>}
                                              {row.isHoliday && <Badge className="text-[8px] uppercase border-blue-200 text-blue-700 bg-blue-50 font-black ml-1 h-4 px-1.5">Férié</Badge>}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                  ))}
                                </TableBody>
                            </Table>
                            <ScrollBar orientation="horizontal" />
                          </ScrollArea>
                          <div className="bg-secondary/20 p-4 border-t flex items-center justify-between px-8">
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                                <CheckCircle2 className="w-4 h-4 text-green-600" /> {previewStats.valid + previewStats.warning} lignes prêtes.
                            </div>
                            {canCreate && (
                              <Button onClick={handleImportClick} disabled={isImporting || previewRows.length === 0 || previewStats.error > 0} className="rounded-xl font-black gap-2 shadow-lg shadow-primary/10">
                                {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Lancer l'importation
                              </Button>
                            )}
                          </div>
                      </Card>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center min-h-[500px] border-2 border-dashed rounded-[3rem] bg-secondary/5 opacity-50 space-y-4">
                      <div className="bg-white p-6 rounded-full shadow-sm"><TableIcon className="w-12 h-12 text-slate-200" /></div>
                      <div className="text-center space-y-1"><h3 className="font-black text-slate-400 uppercase text-xs tracking-widest">Prévisualisation</h3><p className="text-xs text-slate-400 italic">Téléversez un fichier pour voir la ventilation des heures.</p></div>
                    </div>
                )}
              </div>
            </div>
         </TabsContent>

         <TabsContent value="registry" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
            <div className="space-y-6">
               <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center bg-white rounded-xl border p-1 shadow-sm h-11">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth(prev => prev === 1 ? 12 : prev - 1)}><ChevronLeft className="w-4 h-4" /></Button>
                    <span className="px-4 text-xs font-black uppercase tracking-widest text-primary min-w-[140px] text-center">{format(new Date(selectedYear, selectedMonth - 1), 'MMMM yyyy', { locale: fr })}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth(prev => prev === 12 ? 1 : prev + 1)}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                  <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Filtrer par employé ou matricule..." value={registryFilters.search} onChange={(e) => handleUpdateRegistryFilter('search', e.target.value)} className="h-11 rounded-xl pl-10 bg-white border-primary/10" /></div>
                  <Select value={registryFilters.status} onValueChange={(v) => handleUpdateRegistryFilter('status', v)}><SelectTrigger className="w-[180px] h-11 rounded-xl bg-white border-primary/10"><SelectValue placeholder="Tous statuts" /></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem>{Object.entries(STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}</SelectContent></Select>
                  <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border h-11"><input type="checkbox" id="abs-only" checked={registryFilters.absenceOnly} onChange={(e) => handleUpdateRegistryFilter('absenceOnly', e.target.checked)} className="rounded" /><Label htmlFor="abs-only" className="text-[10px] font-black uppercase text-muted-foreground cursor-pointer">Absences</Label></div>
                  <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border h-11"><input type="checkbox" id="ano-only" checked={registryFilters.anomalyOnly} onChange={(e) => handleUpdateRegistryFilter('anomalyOnly', e.target.checked)} className="rounded" /><Label htmlFor="ano-only" className="text-[10px] font-black uppercase text-muted-foreground cursor-pointer">Anomalies</Label></div>
                  {canValidate && draftIdsToValidate.length > 0 && (
                    <Button onClick={handleAttemptBulkValidation} className="h-11 rounded-xl font-bold bg-green-600 hover:bg-green-700 text-white gap-2 shadow-lg"><CheckSquare className="w-4 h-4" /> Valider les brouillons filtrés</Button>
                  )}
               </div>
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-4">
                  <SummaryStat label="Employés" value={groupedEmployeeData.length} color="indigo" />
                  <SummaryStat label="Lignes" value={registryStats.total} color="blue" />
                  <SummaryStat label="Brouillons" value={registryStats.draftCount} color="indigo" />
                  <SummaryStat label="Validées" value={registryStats.validatedCount} color="green" />
                  <SummaryStat label="H. Totales" value={registryStats.totalHours.toFixed(1)} color="slate" />
                  <SummaryStat label="H. Jour" value={registryStats.dayHours.toFixed(1)} color="slate" />
                  <SummaryStat label="H. Nuit" value={registryStats.nightHours.toFixed(1)} color="indigo" />
                  <SummaryStat label="H. Sup" value={registryStats.overtimeHours.toFixed(1)} color="orange" />
                  <SummaryStat label="Absences" value={registryStats.absences} color="slate" />
               </div>
            </div>

            <div className="space-y-4">
               {loadingRegistry ? (
                  <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/20" /></div>
               ) : groupedEmployeeData.length === 0 ? (
                  <Card className="rounded-3xl border-dashed border-2 py-24 bg-secondary/5">
                     <div className="text-center space-y-3">
                        <ListFilter className="w-12 h-12 text-muted-foreground/20 mx-auto" />
                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Aucune présence trouvée pour cette période.</p>
                     </div>
                  </Card>
               ) : (
                  <div className="space-y-4">
                     {groupedEmployeeData.map((group) => (
                        <Card key={group.employeeId || group.employeeCode} className="rounded-[1.5rem] border-primary/5 shadow-sm hover:shadow-md transition-all overflow-hidden bg-white">
                           <Collapsible 
                              open={expandedEmployees.has(group.employeeId || group.employeeCode)} 
                              onOpenChange={() => toggleEmployeeExpansion(group.employeeId || group.employeeCode)}
                           >
                              <div className="flex flex-col lg:flex-row lg:items-center justify-between p-5 gap-6">
                                 <div className="flex items-center gap-4 min-w-[280px]">
                                    <div className="bg-primary/5 p-3 rounded-2xl text-primary shrink-0">
                                       <User className="w-6 h-6" />
                                    </div>
                                    <div className="min-w-0">
                                       <h3 className="font-bold text-slate-900 truncate">{group.employeeDisplayName}</h3>
                                       <div className="flex items-center gap-2 mt-1">
                                          <span className="text-[10px] font-mono text-muted-foreground uppercase bg-slate-100 px-1.5 py-0.5 rounded">{group.employeeCode}</span>
                                          {group.departmentName && (
                                            <>
                                              <span className="text-slate-300 text-[8px]">•</span>
                                              <span className="text-[10px] font-bold text-primary/60 uppercase">{group.departmentName}</span>
                                            </>
                                          )}
                                       </div>
                                    </div>
                                 </div>

                                 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4 flex-1">
                                    <GroupStat label="H. Totales" value={group.totalHours.toFixed(1)} />
                                    <GroupStat label="H. Jour" value={group.dayHours.toFixed(1)} color="slate" />
                                    <GroupStat label="H. Nuit" value={group.nightHours.toFixed(1)} color="indigo" />
                                    <GroupStat label="H. Sup" value={group.overtimeHours.toFixed(1)} color="orange" />
                                    <div className="flex items-center gap-2">
                                       {group.absenceCount > 0 && <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-[9px] font-black">{group.absenceCount} Abs.</Badge>}
                                       {group.anomalyCount > 0 && <Badge variant="destructive" className="bg-red-600 text-white border-none text-[9px] font-black">{group.anomalyCount} Ano.</Badge>}
                                    </div>
                                 </div>

                                 <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right hidden sm:block">
                                       <p className="text-[9px] font-black uppercase text-muted-foreground tracking-tighter">{group.records.length} jour(s)</p>
                                       <div className="flex items-center gap-1.5 mt-0.5">
                                          {group.draftCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-slate-300" title="Brouillons" />}
                                          {group.validatedCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Validés" />}
                                       </div>
                                    </div>
                                    <CollapsibleTrigger asChild>
                                       <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10">
                                          {expandedEmployees.has(group.employeeId || group.employeeCode) ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                       </Button>
                                    </CollapsibleTrigger>
                                 </div>
                              </div>

                              <CollapsibleContent className="animate-in fade-in slide-in-from-top-2">
                                 <div className="px-5 pb-5 border-t bg-slate-50/30">
                                    <Table>
                                       <TableHeader>
                                          <TableRow className="hover:bg-transparent">
                                             <TableHead 
                                                className="h-10 text-[9px] font-black uppercase cursor-pointer hover:text-primary transition-colors group/sort"
                                                onClick={() => setDateSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                                              >
                                                <div className="flex items-center gap-1">
                                                  Date
                                                  {dateSortDirection === 'asc' ? (
                                                    <ArrowUp className="w-3 h-3 text-primary" />
                                                  ) : (
                                                    <ArrowDown className="w-3 h-3 text-primary" />
                                                  )}
                                                </div>
                                             </TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase">Lieu</TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase text-center">H. Totales</TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase text-center">Jour</TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase text-center">Nuit</TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase text-center">Sup.</TableHead>
                                             <TableHead className="h-10 text-[9px] font-black uppercase">Absence / Statut</TableHead>
                                             <TableHead className="h-10 text-right pr-4 text-[9px] font-black uppercase">Actions</TableHead>
                                          </TableRow>
                                       </TableHeader>
                                       <TableBody>
                                          {group.records.map(a => {
                                             const regHolidayName = holidaysMap.get(a.attendanceDate);
                                             const isRegHoliday = !!regHolidayName;
                                             const isWorked = (a.validatedHours || 0) > 0;
                                             
                                             const request = a.matchingRequest as TimeOffRequest | undefined;
                                             const isJustified = request && request.status === 'approved';
                                             
                                             const blockReason = getValidationBlockReason(a, holidaysMap, timeOffRequests);

                                             return (
                                             <TableRow key={a.id} className="hover:bg-white transition-colors">
                                                <TableCell className="py-3">
                                                   <span className="text-xs font-bold">{format(parseISO(a.attendanceDate), 'dd/MM/yyyy')}</span>
                                                </TableCell>
                                                <TableCell>
                                                   <span className="text-[10px] font-medium text-slate-500 truncate max-w-[100px] inline-block">{a.worksiteName || "—"}</span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                   <Badge variant="outline" className="font-black text-xs bg-primary/5 text-primary border-none">{a.validatedHours?.toFixed(2)}</Badge>
                                                </TableCell>
                                                <TableCell className="text-center text-xs text-slate-500">{a.dayHours?.toFixed(2)}</TableCell>
                                                <TableCell className="text-center text-xs text-slate-500">{a.nightHours?.toFixed(2)}</TableCell>
                                                <TableCell className="text-center text-xs font-black text-orange-600">{a.overtimeHours > 0 ? `+${a.overtimeHours.toFixed(2)}` : "—"}</TableCell>
                                                <TableCell>
                                                   <div className="flex items-center gap-2">
                                                      {isRegHoliday ? (
                                                         isWorked ? (
                                                            <Badge className="bg-green-600 text-white text-[8px] font-black uppercase border-none gap-1">
                                                               <Sun className="w-2.5 h-2.5" />
                                                               {regHolidayName} travaillé
                                                            </Badge>
                                                         ) : (
                                                            <Badge className="bg-indigo-600 text-white text-[8px] font-black uppercase border-none">
                                                               Jour férié: {regHolidayName}
                                                            </Badge>
                                                         )
                                                      ) : isJustified && !isWorked ? (
                                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[8px] font-black uppercase gap-1">
                                                          Absence justifiée · {TIME_OFF_TYPE_LABELS[request.requestType]}
                                                        </Badge>
                                                      ) : request && !isWorked ? (
                                                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase", 
                                                          request.status === 'submitted' ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-red-50 text-red-700 border-red-200")}>
                                                          {request.status === 'submitted' ? 'Demande en attente' : 'Demande refusée'} · {TIME_OFF_TYPE_LABELS[request.requestType]}
                                                        </Badge>
                                                      ) : blockReason ? (
                                                        <Badge variant="destructive" className={cn("text-[8px] font-black uppercase border-none h-4 px-1.5", (blockReason === "Demande en attente" || blockReason === "Absence à analyser") ? "bg-orange-500 animate-pulse" : "bg-red-600")}>
                                                           {blockReason}
                                                        </Badge>
                                                      ) : (
                                                         <Badge variant="outline" className={cn("text-[8px] font-black uppercase h-4 px-1.5", a.status === 'draft_imported' ? "bg-slate-100 text-slate-500" : "bg-green-50 text-green-700 border-green-200")}>
                                                            {STATUS_LABELS[a.status] || a.status}
                                                         </Badge>
                                                      )}
                                                      {!isRegHoliday && !isJustified && !blockReason && a.anomalyFlag && <AlertCircle className="w-3 h-3 text-red-500" />}
                                                   </div>
                                                </TableCell>
                                                <TableCell className="text-right pr-4">
                                                   {canValidate && a.status === 'draft_imported' && (
                                                      <Button variant="ghost" size="icon" onClick={() => handleValidateSingle(a)} disabled={isValidating || !!blockReason} className="h-7 w-7 text-green-600 disabled:opacity-20">
                                                         <CheckCircle2 className="w-3.5 h-3.5" />
                                                      </Button>
                                                   )}
                                                </TableCell>
                                             </TableRow>
                                          )})}
                                       </TableBody>
                                    </Table>
                                 </div>
                              </CollapsibleContent>
                           </Collapsible>
                        </Card>
                     ))}
                  </div>
               )}
            </div>

            <div className="space-y-4">
               <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground px-2 flex items-center gap-2"><HistoryIcon className="w-4 h-4" /> Historique des imports</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {loadingBatches ? (
                    <div className="col-span-full py-12 flex justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-primary/20" />
                    </div>
                  ) : !registryBatches || registryBatches.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-2">Aucun import enregistré.</p>
                  ) : (
                     registryBatches.map(b => (
                        <Card key={b.id} className="rounded-2xl border-primary/5 shadow-sm hover:shadow-md transition-all overflow-hidden bg-white group">
                          <CardContent className="p-0">
                            <div className="p-4 bg-slate-50/50 border-b flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="bg-primary/10 p-2 rounded-xl text-primary">
                                  <FileSpreadsheet className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-xs font-black text-slate-800 truncate max-w-[200px]">{b.sourceFileName}</p>
                                  <p className="text-[9px] text-muted-foreground font-bold uppercase">
                                    {format(parseSafeDate(b.createdAt) || new Date(), 'dd/MM/yyyy HH:mm', { locale: fr })}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline" className="bg-white text-[9px] font-black uppercase text-slate-400">
                                {b.status}
                              </Badge>
                            </div>
                            <div className="p-5 grid grid-cols-5 gap-2">
                              <BatchMiniStat label="Lignes" value={b.importedRowsCount} />
                              <BatchMiniStat label="Validées" value={b.validatedRowsCount} color="green" />
                              <BatchMiniStat label="Heures" value={b.totalWorkedHours?.toFixed(1)} />
                              <BatchMiniStat 
                                label="Alertes" 
                                value={b.warningRowsCount} 
                                color={b.warningRowsCount && b.warningRowsCount > 0 ? "orange" : "slate"} 
                              />
                              <BatchMiniStat label="Absences" value={b.absenceRowsCount} />
                            </div>
                          </CardContent>
                        </Card>
                     ))
                  )}
               </div>
            </div>
         </TabsContent>
      </Tabs>

      {/* Confirmation Dialog with Conflict Resolution UI */}
      <AlertDialog open={isImportConfirmOpen} onOpenChange={setIsImportConfirmOpen}>
        <AlertDialogContent className="rounded-[2.5rem] sm:max-w-[500px] overflow-hidden flex flex-col max-h-[90vh]">
          <AlertDialogHeader className="shrink-0 p-6 pb-2">
            <AlertDialogTitle className="text-xl font-black text-primary">
               {conflictAnalysis.blocked > 0 ? "Importation bloquée" : "Confirmer l'importation"}
            </AlertDialogTitle>
          </AlertDialogHeader>

          <ScrollArea className="flex-1 px-6 py-2">
            <div className="space-y-4 pr-2">
              {conflictAnalysis.blocked > 0 && (
                <Alert variant="destructive" className="rounded-2xl bg-red-50 border-red-100 text-red-800 py-4">
                   <XCircle className="h-5 w-5 text-red-600" />
                   <div className="ml-2 flex-1">
                      <AlertTitle className="font-black uppercase text-[10px] tracking-widest">Lignes verrouillées détectées</AlertTitle>
                      <AlertDescription className="text-xs font-bold mt-1 break-words leading-relaxed">
                        {conflictAnalysis.blocked} ligne(s) correspondent à des présences déjà validées ou verrouillées. L'importation est bloquée.
                      </AlertDescription>
                   </div>
                </Alert>
              )}

              {conflictAnalysis.blocked === 0 && conflictAnalysis.replaceable > 0 && (
                <Alert className="rounded-2xl bg-orange-50 border-orange-100 text-orange-800 py-4">
                   <AlertTriangle className="h-5 w-5 text-orange-600" />
                   <div className="ml-2 flex-1">
                      <AlertTitle className="font-black uppercase text-[10px] tracking-widest">Brouillons existants</AlertTitle>
                      <AlertDescription className="text-xs font-bold mt-1 break-words leading-relaxed">
                        {conflictAnalysis.replaceable} brouillon(s) existent déjà pour ces dates. Voulez-vous les remplacer ?
                      </AlertDescription>
                   </div>
                </Alert>
              )}

              <div className="p-6 bg-secondary/20 rounded-[2rem] border border-dashed border-primary/10 space-y-3">
                 <div className="flex justify-between items-center text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                    <span>Nouvelles lignes :</span>
                    <span className="text-primary">{conflictAnalysis.new}</span>
                 </div>
                 {conflictAnalysis.replaceable > 0 && (
                   <div className="flex justify-between items-center text-[10px] font-black uppercase text-orange-600 tracking-widest">
                      <span>Brouillons à remplacer :</span>
                      <span>{conflictAnalysis.replaceable}</span>
                   </div>
                 )}
                 <Separator className="bg-primary/5 my-2" />
                 <div className="flex justify-between items-center text-xs font-black uppercase">
                    <span className="text-muted-foreground tracking-widest">Heures Totales :</span>
                    <span className="text-primary">{previewStats.totalHours.toFixed(1)} h</span>
                 </div>
              </div>
            </div>
          </ScrollArea>

          <AlertDialogFooter className="shrink-0 p-6 pt-2 flex-col sm:flex-row gap-3">
            <AlertDialogCancel disabled={isImporting} className="rounded-xl font-bold w-full sm:w-auto">Annuler</AlertDialogCancel>
            
            {conflictAnalysis.blocked > 0 ? (
              <Button disabled className="rounded-xl font-black px-6 bg-slate-100 text-slate-400 border-none w-full sm:w-auto">
                Importation impossible
              </Button>
            ) : conflictAnalysis.replaceable > 0 ? (
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Button 
                  variant="outline"
                  onClick={() => handleExecuteImport("skip")} 
                  disabled={isImporting}
                  className="rounded-xl font-bold border-primary/20 bg-white flex-1 sm:flex-none"
                >
                   Ignorer existants
                </Button>
                <Button 
                  onClick={() => handleExecuteImport("overwrite")} 
                  disabled={isImporting}
                  className="bg-primary text-white font-black rounded-xl px-6 shadow-lg shadow-primary/20 gap-2 flex-1 sm:flex-none"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Remplacer brouillons
                </Button>
              </div>
            ) : (
              <Button 
                onClick={() => handleExecuteImport("fail")} 
                disabled={isImporting} 
                className="bg-primary font-black rounded-xl px-8 shadow-lg shadow-primary/20 gap-2 w-full sm:w-auto"
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmer l'importation
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isValidationConfirmOpen} onOpenChange={setIsValidationConfirmOpen}>
        <AlertDialogContent className="rounded-[2.5rem]">
           <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black text-primary">Valider les brouillons filtrés ?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                 <span className="text-muted-foreground text-sm">
                   Vous allez valider <strong>{draftIdsToValidate.length}</strong> enregistrements.
                 </span>
              </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter className="mt-6">
              <AlertDialogCancel disabled={isValidating}>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); handleValidateBulk(); }} disabled={isValidating} className="bg-green-600 hover:bg-green-700 font-black rounded-xl px-6 shadow-lg">
                 {isValidating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />} Confirmer
              </AlertDialogAction>
           </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Validation Block Summary Dialog */}
      <AlertDialog open={!!validationBlockSummary} onOpenChange={(o) => !o && setValidationBlockSummary(null)}>
        <AlertDialogContent className="rounded-[2.5rem] sm:max-w-[450px]">
           <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black text-red-600 flex items-center gap-2">
                 <XCircle className="w-6 h-6" /> Validation Impossible
              </AlertDialogTitle>
              <AlertDialogDescription>
                 Certaines lignes nécessitent une revue avant validation.
              </AlertDialogDescription>
           </AlertDialogHeader>
           
           <div className="py-4 space-y-4">
              <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                 <p className="text-xs font-bold text-red-800 mb-3 uppercase tracking-widest">Récapitulatif ({validationBlockSummary?.total})</p>
                 <div className="space-y-2">
                    {validationBlockSummary && Object.entries(validationBlockSummary.reasons).map(([reason, count]) => (
                      <div key={reason} className="flex items-center justify-between text-xs">
                         <span className="font-medium text-slate-700">{reason}</span>
                         <Badge variant="destructive" className="font-black h-5 min-w-[1.5rem] justify-center">{count}</Badge>
                      </div>
                    ))}
                 </div>
              </div>
           </div>

           <AlertDialogFooter>
              <AlertDialogAction onClick={() => setValidationBlockSummary(null)} className="rounded-xl font-black w-full">Compris</AlertDialogAction>
           </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    <div className={cn("p-3 rounded-2xl border flex flex-col items-center min-w-[70px] shadow-sm", colorMap[color] || colorMap.slate)}>
      <span className="text-[7px] font-black uppercase tracking-tighter opacity-70 whitespace-nowrap">{label}</span>
      <span className="text-sm font-black leading-none mt-1">{value}</span>
    </div>
  );
}

function GroupStat({ label, value, color = "blue" }: { label: string, value: string, color?: string }) {
   const colors: Record<string, string> = { blue: "text-blue-700 bg-blue-50", slate: "text-slate-600 bg-slate-50", orange: "text-orange-700 bg-orange-50", indigo: "text-indigo-700 bg-indigo-50" };
   return (
      <div className={cn("px-3 py-2 rounded-xl border border-transparent flex flex-col items-center justify-center", colors[color])}>
         <span className="text-[7px] font-black uppercase opacity-60 leading-none">{label}</span>
         <span className="text-xs font-black mt-1">{value}</span>
      </div>
   );
}

function BatchMiniStat({ label, value, color = "slate" }: { label: string, value: any, color?: string }) {
   const colors: Record<string, string> = { 
     slate: "text-slate-600", 
     orange: "text-orange-600", 
     blue: "text-blue-600", 
     green: "text-green-600" 
   };
   return (
     <div className="flex flex-col text-center">
       <span className="text-[7px] font-black uppercase text-muted-foreground opacity-60 tracking-widest">{label}</span>
       <span className={cn("text-xs font-black", colors[color])}>{value ?? 0}</span>
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

const setupDetailedSheet = (sheet: ExcelJS.Worksheet, periodType: string, year: number, month: number, start: string, employees: Employee[], prefillPause: number) => {
  const columns: any[] = [
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

  const tableHeader = sheet.getRow(1);
  tableHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  tableHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };

  let days: Date[] = [];
  if (periodType === "monthly") {
    const pStart = startOfMonth(new Date(year, month - 1));
    days = eachDayOfInterval({ start: pStart, end: endOfMonth(pStart) });
    employees.forEach(emp => {
      const empHeaderRow = sheet.addRow([`Employé: ${emp.displayName} — Code: ${emp.employeeCode}`]);
      empHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      empHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1F66" } };
      sheet.mergeCells(empHeaderRow.number, 1, empHeaderRow.number, columns.length);
      
      const startRow = (sheet.lastRow?.number || 0) + 1;
      days.forEach(day => {
        const row = sheet.addRow({
          employeeCode: emp.employeeCode, employeeName: emp.displayName, date: format(day, "yyyy-MM-dd"),
          day: format(day, "EEEE", { locale: fr }), department: emp.departmentName || "", worksite: emp.worksiteName || "",
          pause: prefillPause
        });
        const currentRow = row.number;
        row.getCell('C').numFmt = 'yyyy-mm-dd';
        ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');
        
        const fAM = `IF(AND(G${currentRow}<>"",H${currentRow}<>""),MOD(H${currentRow}-G${currentRow},1)*24,0)`;
        const fPM = `IF(AND(I${currentRow}<>"",J${currentRow}<>""),MOD(J${currentRow}-I${currentRow},1)*24,0)`;
        const fHS = `IF(AND(K${currentRow}<>"",L${currentRow}<>""),MOD(L${currentRow}-K${currentRow},1)*24,0)`;
        
        row.getCell('N').value = { formula: `IFERROR(MAX(0, (${fAM} + ${fPM} + ${fHS}) - M${currentRow}/60), 0)` };
        row.getCell('N').numFmt = '0.00';
        row.getCell('P').dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
        row.getCell('Q').dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non"'] };
      });
      const endRow = sheet.lastRow?.number || startRow;
      const totalRow = sheet.addRow([]);
      totalRow.getCell(1).value = "TOTAL MENSUEL";
      totalRow.getCell(14).value = { formula: `SUM(N${startRow}:N${endRow})` };
      totalRow.getCell(14).numFmt = '0.00';
      totalRow.getCell(15).value = { formula: `SUM(O${startRow}:O${endRow})` };
      totalRow.getCell(15).numFmt = '0.00';
      totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    });
  } else {
    const pStart = startOfDay(new Date(start));
    days = eachDayOfInterval({ start: pStart, end: addDays(pStart, 6) });
    employees.forEach(emp => {
      days.forEach(day => {
        const row = sheet.addRow({
          employeeCode: emp.employeeCode, employeeName: emp.displayName, date: format(day, "yyyy-MM-dd"),
          day: format(day, "EEEE", { locale: fr }), department: emp.departmentName || "", worksite: emp.worksiteName || "",
          pause: prefillPause
        });
        const currentRow = row.number;
        row.getCell('C').numFmt = 'yyyy-mm-dd';
        ['G', 'H', 'I', 'J', 'K', 'L'].forEach(col => row.getCell(col).numFmt = 'hh:mm');
        
        const fAM = `IF(AND(G${currentRow}<>"",H${currentRow}<>""),MOD(H${currentRow}-G${currentRow},1)*24,0)`;
        const fPM = `IF(AND(I${currentRow}<>"",J${currentRow}<>""),MOD(J${currentRow}-I${currentRow},1)*24,0)`;
        const fHS = `IF(AND(K${currentRow}<>"",L${currentRow}<>""),MOD(L${currentRow}-K${currentRow},1)*24,0)`;
        
        row.getCell('N').value = { formula: `IFERROR(MAX(0, (${fAM} + ${fPM} + ${fHS}) - M${currentRow}/60), 0)` };
        row.getCell('N').numFmt = '0.00';
        row.getCell('P').dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
        row.getCell('Q').dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non"'] };
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
    columns.push({ header: `${dayLabel} - Entrée`, key: `in_${format(day, "dd")}`, width: 12 });
    columns.push({ header: `${dayLabel} - Sortie`, key: `out_${format(day, "dd")}`, width: 12 });
    columns.push({ header: `${dayLabel} - Pause`, key: `pause_${format(day, "dd")}`, width: 10 });
    columns.push({ header: `${dayLabel} - Absence`, key: `abs_${format(day, "dd")}`, width: 15 });
  });
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } };
  employees.forEach(emp => {
    const rowData: any = { employeeCode: emp.employeeCode, employeeName: emp.displayName, department: emp.departmentName || "", worksite: emp.worksiteName || "" };
    weekDays.forEach(day => {
      const dd = format(day, "dd");
      rowData[`in_${dd}`] = ""; rowData[`out_${dd}`] = ""; rowData[`pause_${dd}`] = prefillPause; rowData[`abs_${dd}`] = "";
    });
    const row = sheet.addRow(rowData);
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
  const columns: any[] = [
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
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } };
  employees.forEach(emp => {
    const rowData: any = { employeeCode: emp.employeeCode, employeeName: emp.displayName, department: emp.departmentName || "", worksite: emp.worksiteName || "" };
    const row = sheet.addRow(rowData);
    const currentRow = row.number;
    const absCols = [6, 8, 10, 12, 14, 16, 18];
    absCols.forEach(col => {
      row.getCell(col).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ABSENCE_CODES.join(',')}"`] };
    });
    row.getCell(19).value = { formula: `SUM(E${currentRow}, G${currentRow}, I${currentRow}, K${currentRow}, M${currentRow}, O${currentRow}, Q${currentRow})` };
    row.getCell(19).numFmt = '0.00';
  });
};

const setupGuideSheet = (sheet: ExcelJS.Worksheet) => {
  sheet.getColumn('A').width = 40;
  sheet.addRow(["GUIDE DE SAISIE"]).font = { bold: true, size: 14 };
  sheet.addRow(["1. Mode Détaillé : Saisissez les horaires HH:mm."]);
  sheet.addRow(["2. Mode Compact Horaires : Une ligne par employé, saisie des horaires jour par jour."]);
  sheet.addRow(["3. Mode Compact Décimal : Saisissez les totaux décimaux nets (ex: 6.5)."]);
  sheet.addRow(["4. Pause : Saisir en minutes réelles (ex: 30)."]);
  sheet.addRow([]);
  sheet.addRow(["CODES ABSENCE VALIDES"]).font = { bold: true };
  ABSENCE_CODES.forEach(c => sheet.addRow([c]));
};
