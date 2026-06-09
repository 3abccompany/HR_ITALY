"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Users, Search, UserCheck, Loader2, 
  ChevronRight, ListFilter, Filter, X,
  Building2, MapPin, Calendar, Briefcase, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFirebase, useCollection } from "@/firebase";
import { collection, query, orderBy } from "firebase/firestore";
import { useActiveMembership } from "@/hooks/use-active-membership";
import { Employee } from "@/types/employee";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Filters {
  search: string;
  status: string;
  department: string;
  site: string;
}

const initialFilters: Filters = {
  search: "",
  status: "active",
  department: "all",
  site: "all",
};

export default function EmployeesManagementPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const { db } = useFirebase();
  const { loading: membershipLoading, hasPermission, membership } = useActiveMembership(entityId);

  // Permission Readiness Guard
  const permissionsReady = !membershipLoading && !!membership && membership.entityId === entityId;

  // UX State
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25 });

  const canRead = hasPermission("employees.read");

  // Query
  const employeesQuery = useMemo(() => {
    if (!db || !entityId || !canRead || !permissionsReady) return null;
    return query(collection(db, `entities/${entityId}/employees`), orderBy("hireDate", "desc"));
  }, [db, entityId, canRead, permissionsReady]);

  const { data: employees, loading: loadingEmployees } = useCollection<Employee>(employeesQuery, "employees.registry");

  // Filter Logic
  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    return employees.filter(e => {
      if (filters.search) {
        const term = filters.search.toLowerCase();
        if (!e.displayName?.toLowerCase().includes(term) && !e.employeeCode?.toLowerCase().includes(term)) return false;
      }
      if (filters.status !== "all" && e.status !== filters.status) return false;
      return true;
    });
  }, [employees, filters]);

  if (membershipLoading || !permissionsReady) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      <h1 className="text-3xl font-headline font-bold text-primary mb-8">Gestion des Employés</h1>
      <Card className="overflow-hidden border-primary/10 shadow-xl">
        <Table>
          <TableHeader className="bg-secondary/20">
            <TableRow><TableHead>Employé</TableHead><TableHead>Poste</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {loadingEmployees ? (
              <TableRow><TableCell colSpan={4} className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
            ) : filteredEmployees.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-12">Aucun employé.</TableCell></TableRow>
            ) : (
              filteredEmployees.map(e => (
                <TableRow key={e.employeeId} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}>
                  <TableCell><div className="font-bold">{e.displayName}</div><div className="text-[10px] uppercase font-mono">{e.employeeCode}</div></TableCell>
                  <TableCell>{e.jobTitle}</TableCell>
                  <TableCell>{getStatusBadge(e.status)}</TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => router.push(`/entity/${entityId}/employees/${e.employeeId}`)}>Détails</Button></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function getStatusBadge(status: string) {
  return <Badge variant={status === 'active' ? 'default' : 'secondary'} className={status === 'active' ? "bg-green-500" : ""}>{status.toUpperCase()}</Badge>;
}
