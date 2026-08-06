"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS,
  type EmployeeFinancialRequestDto,
  type EmployeeFinancialRequestType,
} from "@/types/employee-finance";

type Mode = "admin_create" | "admin_edit" | "employee_create" | "employee_edit";

export type EmployeeFinanceDialogEmployeeOption = {
  employeeId: string;
  displayName: string;
  matricule: string;
  activeContractWarning?: boolean;
};

export type EmployeeFinancialRequestDialogPayload = {
  employeeId?: string;
  requestType: EmployeeFinancialRequestType;
  requestedAmount: string;
  reason: string;
  requestedRepaymentMonths: string;
  requestedMonthlyAmount: string;
  requestedFirstInstallmentPeriod: string;
};

type Props = {
  open: boolean;
  mode: Mode;
  request?: EmployeeFinancialRequestDto | null;
  employeeOptions?: EmployeeFinanceDialogEmployeeOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: EmployeeFinancialRequestDialogPayload) => Promise<{ success: true } | { success: false; error: string }>;
};

const requestTypes: EmployeeFinancialRequestType[] = ["salary_advance", "internal_loan", "employee_debt"];

function centsToInput(value: number | null | undefined) {
  if (!value) return "";
  return (value / 100).toFixed(2).replace(".", ",");
}

export function EmployeeFinancialRequestDialog({
  open,
  mode,
  request,
  employeeOptions = [],
  onOpenChange,
  onSubmit,
}: Props) {
  const isAdmin = mode.startsWith("admin");
  const isEdit = mode.endsWith("edit");
  const [employeeId, setEmployeeId] = useState("");
  const [requestType, setRequestType] = useState<EmployeeFinancialRequestType>("salary_advance");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [requestedRepaymentMonths, setRequestedRepaymentMonths] = useState("");
  const [requestedMonthlyAmount, setRequestedMonthlyAmount] = useState("");
  const [requestedFirstInstallmentPeriod, setRequestedFirstInstallmentPeriod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(request?.employeeId || "");
    setRequestType(request?.requestType || "salary_advance");
    setRequestedAmount(centsToInput(request?.requestedAmountCents));
    setReason(request?.reason || "");
    setRequestedRepaymentMonths(request?.requestedRepaymentMonths ? String(request.requestedRepaymentMonths) : "");
    setRequestedMonthlyAmount(centsToInput(request?.requestedMonthlyAmountCents));
    setRequestedFirstInstallmentPeriod(request?.requestedFirstInstallmentPeriod || "");
    setError(null);
    setPending(false);
  }, [open, request]);

  const amountLabel = requestType === "employee_debt" ? "Montant de la dette" : "Montant demandé";
  const selectedEmployee = useMemo(
    () => employeeOptions.find((employee) => employee.employeeId === employeeId),
    [employeeOptions, employeeId]
  );

  async function handleSubmit() {
    setError(null);
    if (isAdmin && !employeeId) {
      setError("Sélectionnez un employé.");
      return;
    }
    if (!requestedAmount.trim()) {
      setError(`${amountLabel} requis.`);
      return;
    }
    if (reason.trim().length < 3) {
      setError("Le motif doit contenir au moins 3 caractères.");
      return;
    }

    setPending(true);
    const result = await onSubmit({
      ...(isAdmin ? { employeeId } : {}),
      requestType,
      requestedAmount,
      reason,
      requestedRepaymentMonths,
      requestedMonthlyAmount,
      requestedFirstInstallmentPeriod,
    });
    setPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le brouillon" : "Nouvelle demande financière"}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Créez une demande RH pour un employé. L’origine est enregistrée côté serveur."
              : "Créez votre propre demande. Votre profil employé est résolu automatiquement."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 py-2">
          {isAdmin && (
            <div className="grid gap-2">
              <Label>Employé</Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={pending}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionnez un employé" />
                </SelectTrigger>
                <SelectContent>
                  {employeeOptions.map((employee) => (
                    <SelectItem key={employee.employeeId} value={employee.employeeId}>
                      {employee.displayName} · {employee.matricule}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEmployee?.activeContractWarning && (
                <p className="text-xs font-medium text-amber-700">
                  Aucun contrat actif détecté pour cet employé. La demande reste possible mais sera signalée.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label>Type de demande</Label>
            <Select value={requestType} onValueChange={(value) => setRequestType(value as EmployeeFinancialRequestType)} disabled={pending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {requestTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {EMPLOYEE_FINANCIAL_REQUEST_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{amountLabel}</Label>
              <Input value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} placeholder="100,00" inputMode="decimal" disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label>Nombre de mois proposé</Label>
              <Input value={requestedRepaymentMonths} onChange={(event) => setRequestedRepaymentMonths(event.target.value)} placeholder="Ex. 6" inputMode="numeric" disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label>Montant mensuel proposé</Label>
              <Input value={requestedMonthlyAmount} onChange={(event) => setRequestedMonthlyAmount(event.target.value)} placeholder="Ex. 50,00" inputMode="decimal" disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label>Première période proposée</Label>
              <Input value={requestedFirstInstallmentPeriod} onChange={(event) => setRequestedFirstInstallmentPeriod(event.target.value)} placeholder="YYYY-MM" disabled={pending} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Motif</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Décrivez brièvement la demande."
              rows={5}
              maxLength={2000}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/2000 caractères</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Enregistrer" : "Créer le brouillon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
