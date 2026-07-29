"use client";

import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useParams } from "next/navigation";
import { collection, query, where, type Query } from "firebase/firestore";
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import {
  AlertTriangle,
  BarChart3,
  Download,
  Euro,
  Gift,
  Loader2,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { useCollection, useFirebase } from "@/firebase";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  allocateWeeklyOrdinaryOvertime,
  getAttendanceFullWeekRange,
  resolveDateAwareWeeklyThreshold,
} from "@/lib/attendance/weekly-overtime";
import type { CCNL } from "@/types/ccnl";
import type { Employee } from "@/types/employee";
import type { AttendanceRecord } from "@/types/attendance";
import type { Contract } from "@/types/contract";
import type { EmploymentRequest } from "@/types/employment-request";
import type { KilometerReimbursementMonthlySummary } from "@/types/kilometer-reimbursement";
import type { MealTicketMonthlySummary } from "@/types/meal-ticket";
import type { PayrollCalculation } from "@/types/payroll";
import type { MandatoryCommunication } from "@/types/post-acceptance-hiring";

type PayrollMode = NonNullable<PayrollCalculation["rateSnapshot"]["payCalculationMode"]>;

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  calculated: "Calculé",
  approved: "Approuvé",
  exported: "Exporté",
  locked: "Verrouillé",
  cancelled: "Annulé",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  calculated: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  exported: "bg-indigo-50 text-indigo-700 border-indigo-200",
  locked: "bg-slate-900 text-white border-slate-900",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

const MODE_LABELS: Record<PayrollMode, string> = {
  monthly: "Mensualisé",
  hourly: "Horaire historique",
  actual_worked_hours: "Heures réellement travaillées",
};

const MODE_STYLES: Record<PayrollMode, string> = {
  monthly: "bg-indigo-50 text-indigo-700 border-indigo-100",
  hourly: "bg-slate-100 text-slate-700 border-slate-200",
  actual_worked_hours: "bg-teal-50 text-teal-700 border-teal-100",
};

const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(2026, index, 1)),
}));

const euro = (value?: number | null) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value ?? 0);

const hours = (value?: number | null) =>
  `${(value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

const numberValue = (value?: number | null) =>
  (value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 });

const dateLabel = (value?: string | null) => {
  if (!value) return "Non renseigné";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const csvEscape = (value: unknown) => {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
};

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csvContent = [
    headers.map(csvEscape).join(";"),
    ...rows.map((row) => row.map(csvEscape).join(";")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getMonthRange(year: number, month: number) {
  const paddedMonth = String(month).padStart(2, "0");
  return {
    startDate: `${year}-${paddedMonth}-01`,
    endDate: new Date(year, month, 0).toISOString().slice(0, 10),
  };
}

function printReportPdf({
  title,
  entityName,
  periodLabel,
  search,
  headers,
  rows,
}: {
  title: string;
  entityName?: string;
  periodLabel: string;
  search?: string;
  headers: string[];
  rows: unknown[][];
}) {
  const printable = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
  if (!printable) return;

  const tableRows = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  printable.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page { size: landscape; margin: 14mm; }
          body { font-family: Arial, sans-serif; color: #0f172a; }
          h1 { margin: 0; font-size: 22px; }
          .meta { margin: 8px 0 18px; color: #475569; font-size: 12px; line-height: 1.5; }
          .note { margin-top: 18px; padding: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; color: #1e3a8a; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th { text-align: left; background: #f8fafc; border-bottom: 1px solid #cbd5e1; padding: 7px; }
          td { border-bottom: 1px solid #e2e8f0; padding: 7px; vertical-align: top; }
          tr:nth-child(even) td { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="meta">
          <div><strong>Entité :</strong> ${entityName || "Non renseignée"}</div>
          <div><strong>Période :</strong> ${periodLabel}</div>
          <div><strong>Généré le :</strong> ${new Date().toLocaleString("fr-FR")}</div>
          <div><strong>Filtre recherche :</strong> ${search || "Aucun"}</div>
        </div>
        <table>
          <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
          <tbody>${tableRows || `<tr><td colspan="${headers.length}">Aucune donnée.</td></tr>`}</tbody>
        </table>
        <div class="note">Rapport informatif — ne remplace pas une fiche de paie officielle.</div>
        <script>window.onload = () => {};</script>
      </body>
    </html>
  `);
  printable.document.close();
}

const pdfStyles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 8,
  },
  meta: {
    fontSize: 8,
    color: "#475569",
    marginBottom: 12,
    lineHeight: 1.35,
  },
  note: {
    marginTop: 12,
    padding: 8,
    border: "1px solid #bfdbfe",
    backgroundColor: "#eff6ff",
    color: "#1e3a8a",
    fontSize: 7,
  },
  table: {
    borderTop: "1px solid #cbd5e1",
    borderLeft: "1px solid #e2e8f0",
  },
  row: {
    flexDirection: "row",
    minHeight: 18,
  },
  headerCell: {
    flexGrow: 1,
    flexBasis: 0,
    padding: 4,
    backgroundColor: "#f8fafc",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #cbd5e1",
    fontSize: 6.5,
    fontWeight: 700,
  },
  cell: {
    flexGrow: 1,
    flexBasis: 0,
    padding: 4,
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 6.2,
  },
  zebraCell: {
    backgroundColor: "#f8fafc",
  },
  emptyCell: {
    padding: 8,
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    color: "#64748b",
  },
});

function ReportPdfDocument({
  title,
  entityName,
  periodLabel,
  search,
  headers,
  rows,
}: {
  title: string;
  entityName?: string;
  periodLabel: string;
  search?: string;
  headers: string[];
  rows: unknown[][];
}) {
  const generatedAt = new Date().toLocaleString("fr-FR");

  return (
    <Document title={title} author="HR Italy">
      <Page size="A4" orientation="landscape" style={pdfStyles.page}>
        <Text style={pdfStyles.title}>{title}</Text>
        <View style={pdfStyles.meta}>
          <Text>Entité : {entityName || "Non renseignée"}</Text>
          <Text>Période : {periodLabel}</Text>
          <Text>Généré le : {generatedAt}</Text>
          <Text>Filtre recherche : {search || "Aucun"}</Text>
        </View>
        <View style={pdfStyles.table}>
          <View style={pdfStyles.row} fixed>
            {headers.map((header) => (
              <Text key={header} style={pdfStyles.headerCell}>
                {header}
              </Text>
            ))}
          </View>
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={pdfStyles.row} wrap={false}>
                {headers.map((header, cellIndex) => (
                  <Text
                    key={`${header}-${cellIndex}`}
                    style={rowIndex % 2 === 1 ? [pdfStyles.cell, pdfStyles.zebraCell] : pdfStyles.cell}
                  >
                    {String(row[cellIndex] ?? "")}
                  </Text>
                ))}
              </View>
            ))
          ) : (
            <Text style={pdfStyles.emptyCell}>Aucune donnée.</Text>
          )}
        </View>
        <Text style={pdfStyles.note}>
          Rapport informatif — ne remplace pas une fiche de paie officielle.
        </Text>
      </Page>
    </Document>
  );
}

async function downloadReportPdf({
  filename,
  title,
  entityName,
  periodLabel,
  search,
  headers,
  rows,
}: {
  filename: string;
  title: string;
  entityName?: string;
  periodLabel: string;
  search?: string;
  headers: string[];
  rows: unknown[][];
}) {
  const blob = await pdf(
    <ReportPdfDocument
      title={title}
      entityName={entityName}
      periodLabel={periodLabel}
      search={search}
      headers={headers}
      rows={rows}
    />
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getEmployeeSearchText(employee?: Employee, fallbackId?: string) {
  return [
    employee?.displayName,
    employee?.employeeCode,
    employee?.taxCode,
    fallbackId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function ReportsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { hasPermission, loading: membershipLoading, entity, membership } = useActiveMembership(entityId);
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");

  const canReadReports = hasPermission("reports.read");
  const canExportReports = hasPermission("reports.export");
  const canReadPayroll = hasPermission("payroll.read");
  const canReadEmployees = hasPermission("employees.read");
  const canReadAttendances = hasPermission("attendances.read");
  const canReadContracts = hasPermission("contracts.read");
  const canReadCcnls = hasPermission("ccnls.read");
  const canReadEmploymentRequests = hasPermission("employmentRequests.read");
  const canReadMealTickets = hasPermission("mealTickets.read") || hasPermission("mealTickets.manage");
  const canReadReimbursements =
    hasPermission("reimbursements.read") ||
    hasPermission("reimbursements.manage") ||
    hasPermission("reimbursements.approve") ||
    hasPermission("reimbursements.export");

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, index) => current - 3 + index);
  }, []);

  const { startDate, endDate } = useMemo(
    () => getMonthRange(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );

  const { start: fullWeekStartDate, end: fullWeekEndDate } = useMemo(
    () => getAttendanceFullWeekRange(startDate, endDate),
    [endDate, startDate]
  );

  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadEmployees) return null;
    return query(collection(db, `entities/${entityId}/employees`)) as Query<Employee>;
  }, [db, entityId, permissionsReady, canReadReports, canReadEmployees]);

  const payrollQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadPayroll) return null;
    return query(
      collection(db, `entities/${entityId}/payrollCalculations`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth)
    ) as Query<PayrollCalculation>;
  }, [db, entityId, permissionsReady, canReadReports, canReadPayroll, selectedYear, selectedMonth]);

  const mealTicketQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadMealTickets) return null;
    return query(
      collection(db, `entities/${entityId}/mealTicketMonthlySummaries`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth),
      where("status", "==", "confirmed")
    ) as Query<MealTicketMonthlySummary>;
  }, [db, entityId, permissionsReady, canReadReports, canReadMealTickets, selectedYear, selectedMonth]);

  const kilometerQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadReimbursements) return null;
    return query(
      collection(db, `entities/${entityId}/kilometerReimbursementMonthlySummaries`),
      where("year", "==", selectedYear),
      where("month", "==", selectedMonth),
      where("status", "==", "confirmed")
    ) as Query<KilometerReimbursementMonthlySummary>;
  }, [db, entityId, permissionsReady, canReadReports, canReadReimbursements, selectedYear, selectedMonth]);

  const attendanceQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadAttendances) return null;
    return query(
      collection(db, `entities/${entityId}/attendances`),
      where("attendanceDate", ">=", fullWeekStartDate),
      where("attendanceDate", "<=", fullWeekEndDate)
    ) as Query<AttendanceRecord>;
  }, [db, entityId, permissionsReady, canReadReports, canReadAttendances, fullWeekStartDate, fullWeekEndDate]);

  const contractsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadContracts) return null;
    return query(
      collection(db, `entities/${entityId}/contracts`),
      where("startDate", ">=", startDate),
      where("startDate", "<=", endDate)
    ) as Query<Contract>;
  }, [db, entityId, permissionsReady, canReadReports, canReadContracts, startDate, endDate]);

  const attendanceContractsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadContracts) return null;
    return query(collection(db, `entities/${entityId}/contracts`)) as Query<Contract>;
  }, [db, entityId, permissionsReady, canReadReports, canReadContracts]);

  const ccnlsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadCcnls) return null;
    return query(collection(db, `entities/${entityId}/ccnls`)) as Query<CCNL>;
  }, [db, entityId, permissionsReady, canReadReports, canReadCcnls]);

  const employmentRequestsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadEmploymentRequests) return null;
    return query(collection(db, `entities/${entityId}/employmentRequests`)) as Query<EmploymentRequest>;
  }, [db, entityId, permissionsReady, canReadReports, canReadEmploymentRequests]);

  const mandatoryCommunicationsQuery = useMemo(() => {
    if (!db || !entityId || !permissionsReady || !canReadReports || !canReadEmploymentRequests) return null;
    return query(collection(db, `entities/${entityId}/mandatoryCommunications`)) as Query<MandatoryCommunication>;
  }, [db, entityId, permissionsReady, canReadReports, canReadEmploymentRequests]);

  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(
    employeesQuery,
    "reports.employees"
  );
  const { data: payrollCalculations, loading: loadingPayroll } = useCollection<PayrollCalculation>(
    payrollQuery,
    "reports.payroll-calculations"
  );
  const { data: mealTicketSummaries, loading: loadingMealTickets } = useCollection<MealTicketMonthlySummary>(
    mealTicketQuery,
    "reports.meal-ticket-summaries"
  );
  const { data: kilometerSummaries, loading: loadingKilometers } = useCollection<KilometerReimbursementMonthlySummary>(
    kilometerQuery,
    "reports.kilometer-reimbursement-summaries"
  );
  const { data: attendanceRecords, loading: loadingAttendance } = useCollection<AttendanceRecord>(
    attendanceQuery,
    "reports.attendances"
  );
  const { data: contracts, loading: loadingContracts } = useCollection<Contract>(
    contractsQuery,
    "reports.contracts"
  );
  const { data: attendanceContracts, loading: loadingAttendanceContracts } = useCollection<Contract>(
    attendanceContractsQuery,
    "reports.attendance-contracts"
  );
  const { data: ccnls, loading: loadingCcnls } = useCollection<CCNL>(
    ccnlsQuery,
    "reports.ccnls"
  );
  const { data: employmentRequests, loading: loadingEmploymentRequests } = useCollection<EmploymentRequest>(
    employmentRequestsQuery,
    "reports.employment-requests"
  );
  const { data: mandatoryCommunications, loading: loadingMandatoryCommunications } =
    useCollection<MandatoryCommunication>(
      mandatoryCommunicationsQuery,
      "reports.mandatory-communications"
    );

  const employeesMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees?.forEach((employee) => map.set(employee.employeeId, employee));
    return map;
  }, [employees]);

  const contractsByEmployee = useMemo(() => {
    const map = new Map<string, Contract[]>();
    (attendanceContracts || []).forEach((contract) => {
      const list = map.get(contract.employeeId) || [];
      list.push(contract);
      map.set(contract.employeeId, list);
    });
    return map;
  }, [attendanceContracts]);

  const ccnlsById = useMemo(() => {
    const map = new Map<string, CCNL>();
    (ccnls || []).forEach((ccnl) => map.set(ccnl.ccnlId, ccnl));
    return map;
  }, [ccnls]);

  const mealTicketMap = useMemo(() => {
    const map = new Map<string, MealTicketMonthlySummary>();
    mealTicketSummaries?.forEach((summary) => map.set(summary.employeeId, summary));
    return map;
  }, [mealTicketSummaries]);

  const kilometerMap = useMemo(() => {
    const map = new Map<string, KilometerReimbursementMonthlySummary>();
    kilometerSummaries?.forEach((summary) => map.set(summary.employeeId, summary));
    return map;
  }, [kilometerSummaries]);

  const filteredPayroll = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (payrollCalculations || [])
      .filter((calculation) => {
        if (!term) return true;
        return getEmployeeSearchText(employeesMap.get(calculation.employeeId), calculation.employeeId).includes(term);
      })
      .sort((a, b) => {
        const employeeA = employeesMap.get(a.employeeId)?.displayName || a.employeeId;
        const employeeB = employeesMap.get(b.employeeId)?.displayName || b.employeeId;
        return employeeA.localeCompare(employeeB);
      });
  }, [employeesMap, payrollCalculations, search]);

  const benefitRows = useMemo(() => {
    const employeeIds = new Set<string>();
    mealTicketSummaries?.forEach((summary) => employeeIds.add(summary.employeeId));
    kilometerSummaries?.forEach((summary) => employeeIds.add(summary.employeeId));

    const term = search.trim().toLowerCase();
    return Array.from(employeeIds)
      .map((employeeId) => {
        const employee = employeesMap.get(employeeId);
        const mealTicket = mealTicketMap.get(employeeId);
        const kilometer = kilometerMap.get(employeeId);
        const mealTicketTotal = mealTicket?.totalValue || 0;
        const kilometerTotal = kilometer?.totalAmount || 0;

        return {
          employeeId,
          employee,
          mealTicket,
          kilometer,
          total: mealTicketTotal + kilometerTotal,
        };
      })
      .filter((row) => {
        if (!term) return true;
        return getEmployeeSearchText(row.employee, row.employeeId).includes(term);
      })
      .sort((a, b) => {
        const employeeA = a.employee?.displayName || a.employeeId;
        const employeeB = b.employee?.displayName || b.employeeId;
        return employeeA.localeCompare(employeeB);
      });
  }, [employeesMap, kilometerMap, kilometerSummaries, mealTicketMap, mealTicketSummaries, search]);

  const attendanceRows = useMemo(() => {
    const grouped = new Map<string, AttendanceRecord[]>();
    (attendanceRecords || []).forEach((record) => {
      const rows = grouped.get(record.employeeId) || [];
      rows.push(record);
      grouped.set(record.employeeId, rows);
    });

    const term = search.trim().toLowerCase();
    return Array.from(grouped.entries())
      .map(([employeeId, records]) => {
        const employee = employeesMap.get(employeeId);
        const employeeContracts = contractsByEmployee.get(employeeId) || [];
        const recordsInPeriod = records.filter((record) => record.attendanceDate >= startDate && record.attendanceDate <= endDate);
        const recordsByWeek = new Map<string, AttendanceRecord[]>();
        records.forEach((record) => {
          const weekKey = getAttendanceFullWeekRange(record.attendanceDate, record.attendanceDate).start;
          const list = recordsByWeek.get(weekKey) || [];
          list.push(record);
          recordsByWeek.set(weekKey, list);
        });

        let canonicalOvertime = 0;
        recordsByWeek.forEach((weekRecords) => {
          const thresholds = new Set<number>();
          weekRecords.forEach((record) => {
            const resolved = resolveDateAwareWeeklyThreshold({
              employeeId,
              attendanceDate: record.attendanceDate,
              employeeWeeklyHours: employee?.weeklyHours,
              contracts: employeeContracts,
              ccnlsById,
            }).thresholdHours;
            if (resolved) thresholds.add(resolved);
          });

          if (thresholds.size !== 1) {
            canonicalOvertime += weekRecords
              .filter((record) => record.attendanceDate >= startDate && record.attendanceDate <= endDate)
              .reduce((sum, record) => sum + (record.overtimeHours || 0), 0);
            return;
          }

          const allocation = allocateWeeklyOrdinaryOvertime(
            weekRecords.map((record) => ({
              id: record.attendanceId || record.id,
              date: record.attendanceDate,
              workedHours: record.validatedHours || 0,
              sortKey: record.attendanceDate,
            })),
            Array.from(thresholds)[0]
          );

          canonicalOvertime += allocation.allocations
            .filter((allocation) => allocation.date >= startDate && allocation.date <= endDate)
            .reduce((sum, allocation) => sum + allocation.overtimeHours, 0);
        });
        const validatedRecords = recordsInPeriod.filter((record) => ["validated", "corrected", "locked"].includes(record.status));
        const sundayWorkedHours = recordsInPeriod.reduce((sum, record) => {
          const day = new Date(`${record.attendanceDate}T00:00:00`).getDay();
          return sum + (day === 0 ? record.validatedHours || 0 : 0);
        }, 0);

        return {
          employeeId,
          employee,
          totalDays: new Set(recordsInPeriod.map((record) => record.attendanceDate)).size,
          validatedDays: new Set(validatedRecords.map((record) => record.attendanceDate)).size,
          validatedHours: recordsInPeriod.reduce((sum, record) => sum + (record.validatedHours || 0), 0),
          dayHours: recordsInPeriod.reduce((sum, record) => sum + (record.dayHours || 0), 0),
          nightHours: recordsInPeriod.reduce((sum, record) => sum + (record.nightHours || 0), 0),
          overtimeHours: Number(canonicalOvertime.toFixed(2)),
          sundayWorkedHours,
          holidayWorkedHours: recordsInPeriod.reduce((sum, record) => sum + (record.holidayWorkedHours || 0), 0),
          absences: recordsInPeriod.filter((record) => !!record.absenceCode).length,
          anomalies: recordsInPeriod.filter((record) => record.anomalyFlag).length,
          draftOrUnvalidated: recordsInPeriod.filter((record) => ["draft", "draft_imported"].includes(record.status)).length,
        };
      })
      .filter((row) => {
        if (!term) return true;
        return getEmployeeSearchText(row.employee, row.employeeId).includes(term);
      })
      .sort((a, b) => {
        const employeeA = a.employee?.displayName || a.employeeId;
        const employeeB = b.employee?.displayName || b.employeeId;
        return employeeA.localeCompare(employeeB);
      });
  }, [attendanceRecords, ccnlsById, contractsByEmployee, employeesMap, endDate, search, startDate]);

  const employmentRequestByContractId = useMemo(() => {
    const map = new Map<string, EmploymentRequest>();
    (employmentRequests || []).forEach((request) => {
      if (request.source === "contract_renewal" && request.contractId) {
        map.set(request.contractId, request);
      }
    });
    return map;
  }, [employmentRequests]);

  const offerEmploymentRequestByOfferId = useMemo(() => {
    const map = new Map<string, EmploymentRequest>();
    (employmentRequests || []).forEach((request) => {
      if (request.source === "offer" && request.offerId) {
        map.set(request.offerId, request);
      }
    });
    return map;
  }, [employmentRequests]);

  const assunzioneCommunicationByOfferId = useMemo(() => {
    const map = new Map<string, MandatoryCommunication>();
    (mandatoryCommunications || []).forEach((communication) => {
      if (
        communication.employmentOfferId &&
        communication.type === "UNILAV_ASSUNZIONE"
      ) {
        map.set(communication.employmentOfferId, communication);
      }
    });
    return map;
  }, [mandatoryCommunications]);

  const contractRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (contracts || [])
      .map((contract) => {
        const employee = employeesMap.get(contract.employeeId);
        const request = employmentRequestByContractId.get(contract.contractId);
        const offerRequest = contract.sourceOfferId
          ? offerEmploymentRequestByOfferId.get(contract.sourceOfferId)
          : null;
        const assunzioneCommunication = contract.sourceOfferId
          ? assunzioneCommunicationByOfferId.get(contract.sourceOfferId)
          : null;
        const renewalMode = contract.renewalMode || (contract.isRenewal ? "renew_cdd" : null);
        const isCdi = /indeterminato|cdi/i.test(contract.contractType || "");
        const isHistoricalIntake = /historical_import|direct_hr_creation|old_employee_intake/i.test(
          contract.source || ""
        );
        const movement = renewalMode
          ? renewalMode === "convert_to_cdi"
            ? "CDD → CDI"
            : renewalMode === "change_livello"
              ? "Changement Livello"
              : "Renouvellement CDD"
          : "Nouveau contrat";
        const unilavLabel = request
          ? `${request.type === "unilav_trasformazione" ? "UNILAV_TRASFORMAZIONE" : "UNILAV_PROROGA"} · ${request.status}`
          : assunzioneCommunication
            ? `UNILAV_ASSUNZIONE · ${assunzioneCommunication.status}`
            : offerRequest
              ? `UNILAV_ASSUNZIONE · ${offerRequest.status}`
              : isHistoricalIntake
                ? "Reprise historique — UNILAV externe / à archiver"
                : contract.sourceOfferId
                  ? "UNILAV_ASSUNZIONE manquant"
                  : "UNILAV à vérifier";

        return {
          contract,
          employee,
          movement,
          endDateLabel: isCdi ? "Durée indéterminée" : dateLabel(contract.endDate),
          unilavLabel: request
            ? `${request.type === "unilav_trasformazione" ? "UNILAV_TRASFORMAZIONE" : "UNILAV_PROROGA"} · ${request.status}`
            : "Non renseigné",
          resolvedUnilavLabel: unilavLabel,
          isMidMonth: !!contract.startDate && !contract.startDate.endsWith("-01"),
        };
      })
      .filter((row) => {
        if (!term) return true;
        return getEmployeeSearchText(row.employee, row.contract.employeeId).includes(term);
      })
      .sort((a, b) => (b.contract.startDate || "").localeCompare(a.contract.startDate || ""));
  }, [
    assunzioneCommunicationByOfferId,
    contracts,
    employeesMap,
    employmentRequestByContractId,
    offerEmploymentRequestByOfferId,
    search,
  ]);

  const anomalyRows = useMemo(() => {
    const rows: { category: string; severity: "Info" | "Attention" | "Critique"; employeeLabel: string; employeeCode: string; taxCode: string; message: string }[] = [];

    (payrollCalculations || []).forEach((calculation) => {
      const employee = employeesMap.get(calculation.employeeId);
      const employeeLabel = employee?.displayName || calculation.employeeId;
      const employeeCode = employee?.employeeCode || "Non renseigné";
      const taxCode = employee?.taxCode || "Non renseigné";

      if (!calculation.rateSnapshot?.contractId) {
        rows.push({
          category: "Contrat",
          severity: "Critique",
          employeeLabel,
          employeeCode,
          taxCode,
          message: "Contrat manquant dans le snapshot de synthèse économique.",
        });
      }

      (calculation.reconciliationWarnings || []).forEach((warning) => {
        const severity = warning.severity === "blocking" ? "Critique" : "Attention";
        rows.push({
          category: warning.code === "missing_payroll_rate" ? "Taux paie" : warning.code === "missing_premium_rule" ? "Majorations" : "Payroll",
          severity,
          employeeLabel,
          employeeCode,
          taxCode,
          message: warning.message,
        });
      });
    });

    attendanceRows.forEach((row) => {
      if (row.anomalies > 0) {
        rows.push({
          category: "Présences",
          severity: "Attention",
          employeeLabel: row.employee?.displayName || row.employeeId,
          employeeCode: row.employee?.employeeCode || "Non renseigné",
          taxCode: row.employee?.taxCode || "Non renseigné",
          message: `${row.anomalies} présence(s) avec anomalie.`,
        });
      }
      if (row.draftOrUnvalidated > 0) {
        rows.push({
          category: "Présences",
          severity: "Attention",
          employeeLabel: row.employee?.displayName || row.employeeId,
          employeeCode: row.employee?.employeeCode || "Non renseigné",
          taxCode: row.employee?.taxCode || "Non renseigné",
          message: `${row.draftOrUnvalidated} présence(s) brouillon ou non validée(s).`,
        });
      }
    });

    if ((payrollCalculations || []).length > 0 && (mealTicketSummaries || []).length === 0) {
      rows.push({
        category: "Buoni pasto",
        severity: "Info",
        employeeLabel: "Tous",
        employeeCode: "Non renseigné",
        taxCode: "Non renseigné",
        message: "Aucun mois buoni pasto confirmé pour la période sélectionnée.",
      });
    }

    if ((payrollCalculations || []).length > 0 && (kilometerSummaries || []).length === 0) {
      rows.push({
        category: "Rimborsi chilometrici",
        severity: "Info",
        employeeLabel: "Tous",
        employeeCode: "Non renseigné",
        taxCode: "Non renseigné",
        message: "Aucun mois de remboursements kilométriques confirmé pour la période sélectionnée.",
      });
    }

    contractRows
      .filter((row) => row.isMidMonth)
      .forEach((row) => {
        rows.push({
          category: "Contrats",
          severity: "Attention",
          employeeLabel: row.employee?.displayName || row.contract.employeeId,
          employeeCode: row.employee?.employeeCode || row.contract.employeeCode || "Non renseigné",
          taxCode: row.employee?.taxCode || row.contract.taxCode || "Non renseigné",
          message: `Changement de contrat en cours de mois (${dateLabel(row.contract.startDate)}) : revue manuelle de la synthèse économique recommandée.`,
        });
      });

    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!term) return true;
      return `${row.employeeLabel} ${row.employeeCode} ${row.taxCode} ${row.category} ${row.message}`.toLowerCase().includes(term);
    });
  }, [attendanceRows, contractRows, employeesMap, kilometerSummaries, mealTicketSummaries, payrollCalculations, search]);

  const kpis = useMemo(() => {
    const totalGross = (payrollCalculations || []).reduce(
      (sum, calculation) => sum + (calculation.grossEconomicTotal || 0),
      0
    );
    const payrollWarnings = (payrollCalculations || []).reduce(
      (sum, calculation) => sum + (calculation.reconciliationWarnings?.length || 0),
      0
    );
    const mealTicketTotal = (mealTicketSummaries || []).reduce(
      (sum, summary) => sum + (summary.totalValue || 0),
      0
    );
    const kilometerTotal = (kilometerSummaries || []).reduce(
      (sum, summary) => sum + (summary.totalAmount || 0),
      0
    );

    return {
      employeeCount: payrollCalculations?.length || 0,
      totalGross,
      payrollWarnings,
      mealTicketTotal,
      kilometerTotal,
    };
  }, [kilometerSummaries, mealTicketSummaries, payrollCalculations]);

  const isLoading =
    membershipLoading ||
    loadingEmployees ||
    loadingPayroll ||
    loadingMealTickets ||
    loadingKilometers ||
    loadingAttendance ||
    loadingContracts ||
    loadingAttendanceContracts ||
    loadingCcnls ||
    loadingEmploymentRequests ||
    loadingMandatoryCommunications;

  const exportEconomicCsv = () => {
    const rows = filteredPayroll.map((calculation) => {
      const employee = employeesMap.get(calculation.employeeId);
      const mode = calculation.rateSnapshot.payCalculationMode || "monthly";
      const baseValue =
        mode === "actual_worked_hours" && calculation.baseWorkedValue != null
          ? calculation.baseWorkedValue
          : calculation.baseGrossValue;
      const variables =
        (calculation.nightValue || 0) +
        (calculation.overtimeValue || 0) +
        (calculation.holidayWorkedValue || 0) +
        (calculation.bonusValue || 0) -
        (calculation.deductionValue || 0);

      return [
        employee?.displayName || calculation.employeeId,
        employee?.employeeCode || "",
        employee?.taxCode || "",
        MODE_LABELS[mode],
        calculation.attendanceAggregation.totalValidatedHours || 0,
        baseValue,
        variables,
        calculation.grossEconomicTotal,
        calculation.reconciliationWarnings?.length || 0,
        STATUS_LABELS[calculation.status] || calculation.status,
      ];
    });

    downloadCsv(
      `rapport_synthese_economique_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.csv`,
      [
        "Collaborateur",
        "Matricule",
        "Codice fiscale",
        "Mode de calcul",
        "Heures validées",
        "Base",
        "Variables",
        "Total brut économique",
        "Alertes",
        "Statut",
      ],
      rows
    );
  };

  const exportBenefitsCsv = () => {
    const rows = benefitRows.map((row) => [
      row.employee?.displayName || row.employeeId,
      row.employee?.employeeCode || "",
      row.employee?.taxCode || "",
      row.mealTicket?.eligibleDays || 0,
      row.mealTicket?.valuePerTicket || 0,
      row.mealTicket?.totalValue || 0,
      row.kilometer?.totalKilometers || 0,
      row.kilometer?.totalAmount || 0,
      row.total,
      row.mealTicket?.status === "confirmed" || row.kilometer?.status === "confirmed" ? "Confirmé" : "Non confirmé",
    ]);

    downloadCsv(
      `rapport_avantages_remboursements_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.csv`,
      [
        "Collaborateur",
        "Matricule",
        "Codice fiscale",
        "Buoni pasto jours éligibles",
        "Valeur par ticket",
        "Buoni pasto total",
        "Km remboursés",
        "Remboursement km total",
        "Total avantages remboursements",
        "Statut confirmation",
      ],
      rows
    );
  };

  const periodLabel = `${months.find((month) => month.value === selectedMonth)?.label || selectedMonth} ${selectedYear}`;
  const entityName = entity?.name || entity?.legalName || entityId;

  const attendanceHeaders = [
    "Collaborateur",
    "Matricule",
    "Codice fiscale",
    "Jours présence",
    "Jours validés",
    "Heures validées",
    "Heures jour",
    "Heures nuit",
    "Heures sup.",
    "Dimanche travaillé",
    "Férié travaillé",
    "Absences",
    "Anomalies / brouillons",
  ];
  const attendanceCsvRows = attendanceRows.map((row) => [
    row.employee?.displayName || row.employeeId,
    row.employee?.employeeCode || "",
    row.employee?.taxCode || "",
    row.totalDays,
    row.validatedDays,
    row.validatedHours,
    row.dayHours,
    row.nightHours,
    row.overtimeHours,
    row.sundayWorkedHours,
    row.holidayWorkedHours,
    row.absences,
    row.anomalies + row.draftOrUnvalidated,
  ]);

  const contractHeaders = [
    "Collaborateur",
    "Matricule",
    "Codice fiscale",
    "Mouvement",
    "Type contrat",
    "Début",
    "Fin",
    "Ancien contrat",
    "Nouveau contrat",
    "Livello",
    "UNILAV",
  ];
  const contractCsvRows = contractRows.map((row) => [
    row.employee?.displayName || row.contract.employeeId,
    row.employee?.employeeCode || row.contract.employeeCode || "",
    row.employee?.taxCode || row.contract.taxCode || "",
    row.movement,
    row.contract.contractType,
    dateLabel(row.contract.startDate),
    row.endDateLabel,
    row.contract.previousContractId || "—",
    row.contract.contractId,
    [row.contract.levelCode, row.contract.levelLabel].filter(Boolean).join(" · ") || "Non renseigné",
    row.resolvedUnilavLabel,
  ]);

  const anomalyHeaders = ["Catégorie", "Sévérité", "Collaborateur", "Matricule", "Codice fiscale", "Message"];
  const anomalyCsvRows = anomalyRows.map((row) => [row.category, row.severity, row.employeeLabel, row.employeeCode, row.taxCode, row.message]);

  const economicHeaders = [
    "Collaborateur",
    "Matricule",
    "Codice fiscale",
    "Mode de calcul",
    "Heures validées",
    "Base",
    "Variables",
    "Total brut économique",
    "Alertes",
    "Statut",
  ];
  const economicCsvRows = filteredPayroll.map((calculation) => {
    const employee = employeesMap.get(calculation.employeeId);
    const mode = calculation.rateSnapshot.payCalculationMode || "monthly";
    const baseValue =
      mode === "actual_worked_hours" && calculation.baseWorkedValue != null
        ? calculation.baseWorkedValue
        : calculation.baseGrossValue;
    const variables =
      (calculation.nightValue || 0) +
      (calculation.overtimeValue || 0) +
      (calculation.holidayWorkedValue || 0) +
      (calculation.bonusValue || 0) -
      (calculation.deductionValue || 0);

    return [
      employee?.displayName || calculation.employeeId,
      employee?.employeeCode || "",
      employee?.taxCode || "",
      MODE_LABELS[mode],
      calculation.attendanceAggregation.totalValidatedHours || 0,
      baseValue,
      variables,
      calculation.grossEconomicTotal,
      calculation.reconciliationWarnings?.length || 0,
      STATUS_LABELS[calculation.status] || calculation.status,
    ];
  });

  const benefitHeaders = [
    "Collaborateur",
    "Matricule",
    "Codice fiscale",
    "Buoni pasto jours éligibles",
    "Valeur par ticket",
    "Buoni pasto total",
    "Km remboursés",
    "Remboursement km total",
    "Total avantages remboursements",
    "Statut confirmation",
  ];
  const benefitCsvRows = benefitRows.map((row) => [
    row.employee?.displayName || row.employeeId,
    row.employee?.employeeCode || "",
    row.employee?.taxCode || "",
    row.mealTicket?.eligibleDays || 0,
    row.mealTicket?.valuePerTicket || 0,
    row.mealTicket?.totalValue || 0,
    row.kilometer?.totalKilometers || 0,
    row.kilometer?.totalAmount || 0,
    row.total,
    row.mealTicket?.status === "confirmed" || row.kilometer?.status === "confirmed" ? "Confirmé" : "Non confirmé",
  ]);

  const exportAttendanceCsv = () =>
    downloadCsv(`rapport_presences_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.csv`, attendanceHeaders, attendanceCsvRows);

  const exportContractsCsv = () =>
    downloadCsv(`rapport_contrats_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.csv`, contractHeaders, contractCsvRows);

  const exportAnomaliesCsv = () =>
    downloadCsv(`rapport_anomalies_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.csv`, anomalyHeaders, anomalyCsvRows);

  const reportFilePeriod = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const exportPdf = (slug: string, title: string, headers: string[], rows: unknown[][]) =>
    downloadReportPdf({
      filename: `reports-${slug}-${reportFilePeriod}.pdf`,
      title,
      entityName,
      periodLabel,
      search,
      headers,
      rows,
    });

  if (membershipLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canReadReports) {
    return (
      <div className="p-8">
        <Alert variant="destructive" className="rounded-3xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>Vous n'avez pas la permission de consulter les rapports RH.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <main className="min-h-screen space-y-8 bg-slate-50/30 p-4 md:p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="rounded-full border-primary/20 bg-white px-3 py-1 text-primary">
            Données enregistrées uniquement
          </Badge>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">Rapports RH</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Rapports mensuels basés sur les données enregistrées : synthèse économique, avantages,
            remboursements et exports.
          </p>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800">
          Ces rapports restent des synthèses RH. Ils ne constituent pas une fiche de paie officielle.
        </div>
      </header>

      <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
        <CardContent className="grid gap-4 p-5 md:grid-cols-[180px_130px_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label>Mois</Label>
            <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(Number(value))}>
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={String(month.value)} className="capitalize">
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Année</Label>
            <Select value={String(selectedYear)} onValueChange={(value) => setSelectedYear(Number(value))}>
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Recherche collaborateur / matricule</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="rounded-xl pl-10"
                placeholder="Nom, matricule, codice fiscale..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <Button variant="outline" className="rounded-xl bg-white" onClick={() => setSearch("")} disabled={!search}>
            Effacer
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={BarChart3} label="Salariés avec synthèse" value={kpis.employeeCount} tone="blue" />
        <KpiCard icon={Euro} label="Total brut économique" value={euro(kpis.totalGross)} tone="primary" />
        <KpiCard icon={Gift} label="Buoni pasto confirmés" value={euro(kpis.mealTicketTotal)} tone="emerald" />
        <KpiCard icon={WalletCards} label="Remboursements km" value={euro(kpis.kilometerTotal)} tone="slate" />
        <KpiCard icon={AlertTriangle} label="Alertes Payroll" value={kpis.payrollWarnings} tone="amber" />
      </div>

      <Tabs defaultValue="economic" className="space-y-5">
        <TabsList className="grid h-auto w-full max-w-5xl grid-cols-2 rounded-2xl bg-white p-1 shadow-sm lg:grid-cols-5">
          <TabsTrigger value="economic" className="rounded-xl font-bold">
            Synthèse économique
          </TabsTrigger>
          <TabsTrigger value="benefits" className="rounded-xl font-bold">
            Avantages / Remboursements
          </TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-xl font-bold">
            Présences
          </TabsTrigger>
          <TabsTrigger value="contracts" className="rounded-xl font-bold">
            Contrats
          </TabsTrigger>
          <TabsTrigger value="anomalies" className="rounded-xl font-bold">
            Anomalies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="economic">
          <Card className="overflow-hidden rounded-3xl border-primary/10 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">Synthèse économique mensuelle</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lecture des PayrollCalculation enregistrés. Aucun recalcul de formule.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={exportEconomicCsv}
                  disabled={!canExportReports || filteredPayroll.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={() => void exportPdf("synthese-economique", "Rapport — Synthèse économique", economicHeaders, economicCsvRows)}
                  disabled={!canExportReports || filteredPayroll.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exporter PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead className="pl-6">Collaborateur</TableHead>
                    <TableHead>Mode de calcul</TableHead>
                    <TableHead className="text-right">Heures validées</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Variables</TableHead>
                    <TableHead className="text-right">Total brut économique</TableHead>
                    <TableHead className="text-center">Alertes</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/30" />
                      </TableCell>
                    </TableRow>
                  ) : filteredPayroll.length === 0 ? (
                    <EmptyRow colSpan={8} message="Aucune synthèse économique enregistrée pour ces filtres." />
                  ) : (
                    filteredPayroll.map((calculation) => {
                      const employee = employeesMap.get(calculation.employeeId);
                      const mode = calculation.rateSnapshot.payCalculationMode || "monthly";
                      const baseValue =
                        mode === "actual_worked_hours" && calculation.baseWorkedValue != null
                          ? calculation.baseWorkedValue
                          : calculation.baseGrossValue;
                      const variables =
                        (calculation.nightValue || 0) +
                        (calculation.overtimeValue || 0) +
                        (calculation.holidayWorkedValue || 0) +
                        (calculation.bonusValue || 0) -
                        (calculation.deductionValue || 0);

                      return (
                        <TableRow key={calculation.id} className="hover:bg-slate-50/70">
                          <TableCell className="pl-6">
                            <p className="font-bold text-slate-900">{employee?.displayName || calculation.employeeId}</p>
                            <p className="text-[10px] text-muted-foreground">
                              Matricule: <span className="font-mono uppercase">{employee?.employeeCode || "Non renseigné"}</span>
                              {" · "}
                              Codice fiscale: <span className="font-mono uppercase">{employee?.taxCode || "Non renseigné"}</span>
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("rounded-full", MODE_STYLES[mode])}>
                              {MODE_LABELS[mode]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold">{hours(calculation.attendanceAggregation.totalValidatedHours)}</TableCell>
                          <TableCell className="text-right font-bold">{euro(baseValue)}</TableCell>
                          <TableCell className="text-right">{euro(variables)}</TableCell>
                          <TableCell className="text-right font-black text-primary">{euro(calculation.grossEconomicTotal)}</TableCell>
                          <TableCell className="text-center">
                            {(calculation.reconciliationWarnings?.length || 0) > 0 ? (
                              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                                {calculation.reconciliationWarnings.length}
                              </Badge>
                            ) : (
                              <ShieldCheck className="mx-auto h-4 w-4 text-emerald-600" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn("rounded-full", STATUS_STYLES[calculation.status] || STATUS_STYLES.draft)}
                            >
                              {STATUS_LABELS[calculation.status] || calculation.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="benefits">
          <Card className="overflow-hidden rounded-3xl border-primary/10 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">Avantages / Remboursements</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Buoni pasto et rimborsi chilometrici confirmés, séparés du brut économique.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={exportBenefitsCsv}
                  disabled={!canExportReports || benefitRows.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={() => void exportPdf("avantages-remboursements", "Rapport — Avantages / Remboursements", benefitHeaders, benefitCsvRows)}
                  disabled={!canExportReports || benefitRows.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exporter PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead className="pl-6">Collaborateur</TableHead>
                    <TableHead className="text-right">Buoni pasto jours</TableHead>
                    <TableHead className="text-right">Buoni pasto total</TableHead>
                    <TableHead className="text-right">Km remboursés</TableHead>
                    <TableHead className="text-right">Remboursement km total</TableHead>
                    <TableHead className="text-right">Total avantages / remboursements</TableHead>
                    <TableHead>Statut confirmation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/30" />
                      </TableCell>
                    </TableRow>
                  ) : benefitRows.length === 0 ? (
                    <EmptyRow colSpan={7} message="Aucun avantage ou remboursement confirmé pour ces filtres." />
                  ) : (
                    benefitRows.map((row) => (
                      <TableRow key={row.employeeId} className="hover:bg-slate-50/70">
                        <TableCell className="pl-6">
                          <p className="font-bold text-slate-900">{row.employee?.displayName || row.employeeId}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Matricule: <span className="font-mono uppercase">{row.employee?.employeeCode || "Non renseigné"}</span>
                            {" · "}
                            Codice fiscale: <span className="font-mono uppercase">{row.employee?.taxCode || "Non renseigné"}</span>
                          </p>
                        </TableCell>
                        <TableCell className="text-right">{numberValue(row.mealTicket?.eligibleDays)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-700">{euro(row.mealTicket?.totalValue)}</TableCell>
                        <TableCell className="text-right">{numberValue(row.kilometer?.totalKilometers)} km</TableCell>
                        <TableCell className="text-right font-bold text-blue-700">{euro(row.kilometer?.totalAmount)}</TableCell>
                        <TableCell className="text-right font-black text-primary">{euro(row.total)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.mealTicket?.status === "confirmed" && (
                              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                                Buoni confirmés
                              </Badge>
                            )}
                            {row.kilometer?.status === "confirmed" && (
                              <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
                                Km confirmés
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance">
          <Card className="overflow-hidden rounded-3xl border-primary/10 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">Rapport Présences</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lecture des enregistrements de présence persistés pour la période sélectionnée.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl bg-white" onClick={exportAttendanceCsv} disabled={!canExportReports || attendanceRows.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={() => void exportPdf("presences", "Rapport — Présences", attendanceHeaders, attendanceCsvRows)}
                  disabled={!canExportReports || attendanceRows.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exporter PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead className="pl-6">Collaborateur</TableHead>
                    <TableHead className="text-right">Jours</TableHead>
                    <TableHead className="text-right">Validés</TableHead>
                    <TableHead className="text-right">H. validées</TableHead>
                    <TableHead className="text-right">Jour</TableHead>
                    <TableHead className="text-right">Nuit</TableHead>
                    <TableHead className="text-right">Sup.</TableHead>
                    <TableHead className="text-right">Dimanche</TableHead>
                    <TableHead className="text-right">Férié</TableHead>
                    <TableHead className="text-right">Abs.</TableHead>
                    <TableHead className="text-right">Anomalies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/30" />
                      </TableCell>
                    </TableRow>
                  ) : attendanceRows.length === 0 ? (
                    <EmptyRow colSpan={11} message="Aucune présence enregistrée pour ces filtres." />
                  ) : (
                    attendanceRows.map((row) => (
                      <TableRow key={row.employeeId} className="hover:bg-slate-50/70">
                        <TableCell className="pl-6">
                          <p className="font-bold text-slate-900">{row.employee?.displayName || row.employeeId}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Matricule: <span className="font-mono uppercase">{row.employee?.employeeCode || "Non renseigné"}</span>
                            {" · "}
                            Codice fiscale: <span className="font-mono uppercase">{row.employee?.taxCode || "Non renseigné"}</span>
                          </p>
                        </TableCell>
                        <TableCell className="text-right">{row.totalDays}</TableCell>
                        <TableCell className="text-right">{row.validatedDays}</TableCell>
                        <TableCell className="text-right font-bold">{hours(row.validatedHours)}</TableCell>
                        <TableCell className="text-right">{hours(row.dayHours)}</TableCell>
                        <TableCell className="text-right">{hours(row.nightHours)}</TableCell>
                        <TableCell className="text-right">{hours(row.overtimeHours)}</TableCell>
                        <TableCell className="text-right">{hours(row.sundayWorkedHours)}</TableCell>
                        <TableCell className="text-right">{hours(row.holidayWorkedHours)}</TableCell>
                        <TableCell className="text-right">{row.absences}</TableCell>
                        <TableCell className="text-right">
                          {row.anomalies + row.draftOrUnvalidated > 0 ? (
                            <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                              {row.anomalies + row.draftOrUnvalidated}
                            </Badge>
                          ) : (
                            <ShieldCheck className="ml-auto h-4 w-4 text-emerald-600" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts">
          <Card className="overflow-hidden rounded-3xl border-primary/10 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">Rapport Contrats</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mouvements contractuels dont renouvellements, transformations CDI et changements Livello.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl bg-white" onClick={exportContractsCsv} disabled={!canExportReports || contractRows.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={() => void exportPdf("contrats", "Rapport — Contrats", contractHeaders, contractCsvRows)}
                  disabled={!canExportReports || contractRows.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exporter PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead className="pl-6">Collaborateur</TableHead>
                    <TableHead>Mouvement</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Début</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Ancien contrat</TableHead>
                    <TableHead>Nouveau contrat</TableHead>
                    <TableHead>Livello</TableHead>
                    <TableHead>UNILAV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/30" />
                      </TableCell>
                    </TableRow>
                  ) : contractRows.length === 0 ? (
                    <EmptyRow colSpan={9} message="Aucun mouvement contractuel pour ces filtres." />
                  ) : (
                    contractRows.map((row) => (
                      <TableRow key={row.contract.contractId} className="hover:bg-slate-50/70">
                        <TableCell className="pl-6">
                          <p className="font-bold text-slate-900">{row.employee?.displayName || row.contract.employeeDisplayName || row.contract.employeeId}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Matricule: <span className="font-mono uppercase">{row.employee?.employeeCode || row.contract.employeeCode || "Non renseigné"}</span>
                            {" · "}
                            Codice fiscale: <span className="font-mono uppercase">{row.employee?.taxCode || row.contract.taxCode || "Non renseigné"}</span>
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="rounded-full bg-blue-50 text-blue-700 border-blue-200">{row.movement}</Badge>
                        </TableCell>
                        <TableCell>{row.contract.contractType}</TableCell>
                        <TableCell>{dateLabel(row.contract.startDate)}</TableCell>
                        <TableCell>{row.endDateLabel}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">{row.contract.previousContractId || "—"}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">{row.contract.contractId}</TableCell>
                        <TableCell>{[row.contract.levelCode, row.contract.levelLabel].filter(Boolean).join(" · ") || "Non renseigné"}</TableCell>
                        <TableCell className="text-xs">{row.resolvedUnilavLabel}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anomalies">
          <Card className="overflow-hidden rounded-3xl border-primary/10 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 border-b bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">Rapport Anomalies</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Alertes issues des données enregistrées : payroll, présences, confirmations et contrats.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl bg-white" onClick={exportAnomaliesCsv} disabled={!canExportReports || anomalyRows.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl bg-white"
                  onClick={() => void exportPdf("anomalies", "Rapport — Anomalies", anomalyHeaders, anomalyCsvRows)}
                  disabled={!canExportReports || anomalyRows.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exporter PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-white">
                  <TableRow>
                    <TableHead className="pl-6">Catégorie</TableHead>
                    <TableHead>Sévérité</TableHead>
                    <TableHead>Collaborateur</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/30" />
                      </TableCell>
                    </TableRow>
                  ) : anomalyRows.length === 0 ? (
                    <EmptyRow colSpan={4} message="Aucune anomalie détectée pour ces filtres." />
                  ) : (
                    anomalyRows.map((row, index) => (
                      <TableRow key={`${row.category}-${index}`} className="hover:bg-slate-50/70">
                        <TableCell className="pl-6 font-bold">{row.category}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              row.severity === "Critique"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : row.severity === "Attention"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                            )}
                          >
                            {row.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-slate-900">{row.employeeLabel}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Matricule: <span className="font-mono uppercase">{row.employeeCode}</span>
                            {" · "}
                            Codice fiscale: <span className="font-mono uppercase">{row.taxCode}</span>
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.message}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-16 text-center">
        <p className="text-sm font-semibold text-muted-foreground">{message}</p>
      </TableCell>
    </TableRow>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone: "primary" | "blue" | "emerald" | "slate" | "amber";
}) {
  const styles: Record<typeof tone, string> = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <Card className="rounded-3xl border-primary/10 bg-white shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("rounded-2xl p-3", styles[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-black text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
