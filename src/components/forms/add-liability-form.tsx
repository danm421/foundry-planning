"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import MilestoneYearPicker from "../milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { resolveMilestone } from "@/lib/milestones";
import { calcPayment, calcTerm, calcRate } from "@/lib/loan-math";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { inputClassName, inputBaseClassName, selectClassName, selectBaseClassName, fieldLabelClassName } from "./input-styles";
import { OwnershipEditor } from "./ownership-editor";
import type { AccountOwner } from "@/engine/ownership";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface LiabilityFormInitial {
  id: string;
  name: string;
  balance: string;
  interestRate: string; // decimal fraction, e.g. "0.065"
  monthlyPayment: string;
  startYear: number;
  startMonth: number; // 1-12
  termMonths: number;
  termUnit: "monthly" | "annual";
  balanceAsOfMonth?: number | null;
  balanceAsOfYear?: number | null;
  linkedPropertyId?: string | null;
  ownerEntityId?: string | null;
  owners?: AccountOwner[];
  startYearRef?: string | null;
  isInterestDeductible?: boolean;
}

export interface LiabilityFormValues {
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  startMonth: number;
  termMonths: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
}

interface AddLiabilityFormProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  entities?: { id: string; name: string }[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  mode?: "create" | "edit";
  initial?: LiabilityFormInitial;
  onSuccess?: () => void;
  onValuesChange?: (values: LiabilityFormValues) => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
}

export default function AddLiabilityForm({
  clientId,
  realEstateAccounts,
  entities,
  familyMembers = [],
  milestones,
  clientFirstName,
  spouseFirstName,
  mode = "create",
  initial,
  onSuccess,
  onValuesChange,
  onSubmitStateChange,
}: AddLiabilityFormProps) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    onSubmitStateChange?.({ canSubmit: !loading, loading });
  }, [loading, onSubmitStateChange]);
  const [error, setError] = useState<string | null>(null);
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const defaultOwners: AccountOwner[] = clientFm
    ? [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }]
    : [];
  const [owners, setOwners] = useState<AccountOwner[]>(
    initial?.owners && initial.owners.length > 0 ? initial.owners : defaultOwners,
  );
  const [isInterestDeductible, setIsInterestDeductible] = useState(initial?.isInterestDeductible ?? false);
  const isEdit = mode === "edit" && !!initial;

  // Auto-focus + select-all the Name input on create so the advisor can start
  // typing to replace the default name immediately.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isEdit) return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [isEdit]);

  const currentYear = new Date().getFullYear();
  const initialInterestPct = initial
    ? Math.round(Number(initial.interestRate) * 10000) / 100
    : 0;

  const [balance, setBalance] = useState<string>(initial?.balance ?? "0");
  const [interestRatePct, setInterestRatePct] = useState<string>(String(initialInterestPct));
  const [monthlyPayment, setMonthlyPayment] = useState<string>(initial?.monthlyPayment ?? "0");

  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (initial?.startYearRef as YearRef) ?? (!isEdit ? "plan_start" as YearRef : null)
  );
  const [startYear, setStartYear] = useState<number>(
    initial?.startYear ?? (startYearRef && milestones ? resolveMilestone(startYearRef, milestones, "start") ?? currentYear : currentYear)
  );
  const [startMonth, setStartMonth] = useState<number>(initial?.startMonth ?? 1);
  const [balanceAsOfMonth, setBalanceAsOfMonth] = useState<number>(initial?.balanceAsOfMonth ?? new Date().getMonth() + 1);
  const [balanceAsOfYear, setBalanceAsOfYear] = useState<number>(initial?.balanceAsOfYear ?? new Date().getFullYear());

  const [termValue, setTermValue] = useState(
    initial
      ? initial.termUnit === "annual"
        ? String(initial.termMonths / 12)
        : String(initial.termMonths)
      : "30"
  );
  const [termUnit, setTermUnit] = useState<"monthly" | "annual">(
    initial?.termUnit ?? "annual"
  );

  // Notify parent of live form values for amortization preview
  useEffect(() => {
    if (!onValuesChange) return;
    const termMonths = termUnit === "annual" ? parseInt(termValue) * 12 : parseInt(termValue);
    onValuesChange({
      balance: parseFloat(balance) || 0,
      interestRate: (parseFloat(interestRatePct) || 0) / 100,
      monthlyPayment: parseFloat(monthlyPayment) || 0,
      startYear,
      startMonth,
      termMonths: isNaN(termMonths) ? 0 : termMonths,
      balanceAsOfMonth,
      balanceAsOfYear,
    });
  }, [balance, interestRatePct, monthlyPayment, startYear, startMonth, termValue, termUnit, balanceAsOfMonth, balanceAsOfYear, onValuesChange]);

  // ============================================================================
  // Calculator handlers
  // ============================================================================

  function computeElapsedMonths() {
    // Use balance-as-of date if provided, otherwise use current date
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYr = now.getFullYear();
    const asOfMonth = balanceAsOfMonth || currentMonth;
    const asOfYear = balanceAsOfYear || currentYr;
    return Math.max(0, (asOfYear - startYear) * 12 + (asOfMonth - startMonth));
  }

  function handleCalcPayment() {
    const bal = parseFloat(balance);
    const rate = parseFloat(interestRatePct) / 100;
    const totalMonths = termUnit === "annual" ? parseInt(termValue) * 12 : parseInt(termValue);
    if (isNaN(bal) || isNaN(rate) || isNaN(totalMonths) || totalMonths <= 0) return;
    const elapsedMonths = computeElapsedMonths();
    const remainingMonths = Math.max(1, totalMonths - elapsedMonths);
    const pmt = calcPayment(bal, rate, remainingMonths);
    setMonthlyPayment(pmt.toFixed(2));
  }

  function handleCalcTerm() {
    const bal = parseFloat(balance);
    const rate = parseFloat(interestRatePct) / 100;
    const pmt = parseFloat(monthlyPayment);
    if (isNaN(bal) || isNaN(rate) || isNaN(pmt) || pmt <= 0) return;
    const solvedRemaining = calcTerm(bal, rate, pmt);
    if (solvedRemaining === Infinity) return;
    const elapsedMonths = computeElapsedMonths();
    const totalMonths = solvedRemaining + elapsedMonths;
    setTermValue(termUnit === "annual" ? String(Math.ceil(totalMonths / 12)) : String(totalMonths));
  }

  function handleCalcRate() {
    const bal = parseFloat(balance);
    const totalMonths = termUnit === "annual" ? parseInt(termValue) * 12 : parseInt(termValue);
    const pmt = parseFloat(monthlyPayment);
    if (isNaN(bal) || isNaN(totalMonths) || isNaN(pmt) || totalMonths <= 0 || pmt <= 0) return;
    const elapsedMonths = computeElapsedMonths();
    const remainingMonths = Math.max(1, totalMonths - elapsedMonths);
    const rate = calcRate(bal, remainingMonths, pmt);
    if (rate === null) return;
    setInterestRatePct((rate * 100).toFixed(3));
  }

  // ============================================================================
  // Form submission
  // ============================================================================

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const linkedPropertyId = data.get("linkedPropertyId") as string;

    // Mortgages (interest-deductible liabilities) must link to a real-estate
    // account so the engine can attribute the interest to the correct property.
    if (isInterestDeductible && !linkedPropertyId) {
      setError("Mortgage liabilities must link to a real estate property.");
      setLoading(false);
      return;
    }

    const termMonths = termUnit === "annual"
      ? parseInt(termValue) * 12
      : parseInt(termValue);

    const body = {
      name: data.get("name") as string,
      balance,
      interestRate: String(parseFloat(interestRatePct) / 100),
      monthlyPayment,
      startYear,
      startMonth,
      termMonths,
      termUnit,
      balanceAsOfMonth,
      balanceAsOfYear,
      linkedPropertyId: linkedPropertyId || null,
      owners,
      startYearRef,
      isInterestDeductible,
    };

    try {
      const newLiabilityId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "liability",
              targetId: initial!.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/liabilities/${initial!.id}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "liability",
              entity: { id: newLiabilityId, ...body },
            },
            {
              url: `/api/clients/${clientId}/liabilities`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save liability");
      }

      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // Calculator button component
  // ============================================================================

  function CalcButton({ onClick, title }: { onClick: () => void; title: string }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-gray-700 hover:text-accent"
        title={title}
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm1 3h6v2H7V5zm0 4h2v2H7V9zm0 4h2v2H7v-2zm4-4h2v2h-2V9zm0 4h2v2h-2v-2z" />
        </svg>
      </button>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form id="add-liability-form" onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Row 1: Name (full width) */}
      <div>
        <label className={fieldLabelClassName} htmlFor="name">
          Liability Name <span className="text-red-500">*</span>
        </label>
        <input
          ref={nameInputRef}
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="e.g., Primary Mortgage"
          className={inputClassName}
        />
      </div>

      {/* Row 2: Balance + Linked property */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="balance">
            Outstanding Balance ($)
          </label>
          <CurrencyInput
            id="balance"
            name="balance"
            value={balance}
            onChange={(raw) => setBalance(raw)}
            className={inputClassName}
          />
        </div>

        {realEstateAccounts && realEstateAccounts.length > 0 ? (
          <div>
            <label className={fieldLabelClassName} htmlFor="linkedPropertyId">
              Linked Property
            </label>
            <select
              id="linkedPropertyId"
              name="linkedPropertyId"
              defaultValue={initial?.linkedPropertyId ?? ""}
              className={selectClassName}
            >
              <option value="">None</option>
              {realEstateAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* Row 2b: Balance as of + Loan Start */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabelClassName}>Balance as of</label>
          <div className="mt-1 flex gap-2">
            <select
              value={balanceAsOfMonth}
              onChange={(e) => setBalanceAsOfMonth(Number(e.target.value))}
              className={selectBaseClassName + " w-20 shrink-0"}
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <input
              type="number"
              value={balanceAsOfYear}
              onChange={(e) => setBalanceAsOfYear(Number(e.target.value))}
              className={inputBaseClassName + " flex-1 min-w-0"}
              min={1900}
              max={2100}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName}>Loan Start</label>
          <div className="mt-1 flex gap-2">
            <select
              value={startMonth}
              onChange={(e) => setStartMonth(Number(e.target.value))}
              className={selectBaseClassName + " w-20 shrink-0"}
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            {milestones ? (
              <div className="flex-1 min-w-0">
                <MilestoneYearPicker
                  name="startYear"
                  id="startYear"
                  value={startYear}
                  yearRef={startYearRef}
                  milestones={milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setStartYear(yr); setStartYearRef(ref); }}
                  label=""
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                  position="start"
                />
              </div>
            ) : (
              <input
                id="startYear"
                name="startYear"
                type="number"
                required
                value={startYear}
                onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                className={inputBaseClassName + " flex-1 min-w-0"}
              />
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Term | Interest rate | Monthly payment (each with calc button) */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="flex items-center gap-1">
            <label className={fieldLabelClassName}>Term</label>
            <CalcButton onClick={handleCalcTerm} title="Calculate from balance, rate, and payment" />
          </div>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              value={termValue}
              onChange={(e) => setTermValue(e.target.value)}
              className={inputBaseClassName + " flex-1 min-w-0"}
              min="1"
              required
            />
            <select
              value={termUnit}
              onChange={(e) => setTermUnit(e.target.value as "monthly" | "annual")}
              className={selectBaseClassName + " w-24 shrink-0"}
            >
              <option value="annual">Years</option>
              <option value="monthly">Months</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label className={fieldLabelClassName} htmlFor="interestRate">
              Interest Rate (%)
            </label>
            <CalcButton onClick={handleCalcRate} title="Calculate from balance, term, and payment" />
          </div>
          <PercentInput
            id="interestRate"
            name="interestRate"
            value={interestRatePct}
            onChange={(raw) => setInterestRatePct(raw)}
            className={inputClassName}
          />
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label className={fieldLabelClassName} htmlFor="monthlyPayment">
              Monthly Payment ($)
            </label>
            <CalcButton onClick={handleCalcPayment} title="Calculate from balance, rate, and term" />
          </div>
          <CurrencyInput
            id="monthlyPayment"
            name="monthlyPayment"
            value={monthlyPayment}
            onChange={(raw) => setMonthlyPayment(raw)}
            className={inputClassName}
          />
        </div>
      </div>

      {/* Row 6: Ownership */}
      <div>
        <OwnershipEditor
          familyMembers={familyMembers}
          entities={(entities ?? []).map((e) => ({ id: e.id, name: e.name }))}
          value={owners}
          onChange={setOwners}
        />
      </div>

      {/* Row 7: Interest deductible checkbox */}
      <div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={isInterestDeductible}
            onChange={(e) => setIsInterestDeductible(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
          />
          Interest is tax-deductible
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-400">
          When checked, the annual interest portion flows into your itemized deductions (e.g., mortgage interest).
        </p>
      </div>

    </form>
  );
}
