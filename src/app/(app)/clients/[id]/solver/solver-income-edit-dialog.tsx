"use client";

import { useState } from "react";
import type { Income } from "@/engine/types";
import DialogShell from "@/components/dialog-shell";
import { CurrencyInput } from "@/components/currency-input";
import {
  inputClassName,
  inputBaseClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type { IncomeTaxType, SolverMutation } from "@/lib/solver/types";

const INCOME_TAX_TYPE_LABELS: Record<IncomeTaxType, string> = {
  earned_income: "Earned Income",
  ordinary_income: "Ordinary Income",
  dividends: "Dividends",
  capital_gains: "Capital Gains",
  qbi: "QBI",
  tax_exempt: "Tax-Exempt",
  stcg: "Short-Term Capital Gains",
};

function defaultTaxTypeFor(incType: Income["type"]): IncomeTaxType {
  switch (incType) {
    case "salary":
      return "earned_income";
    case "social_security":
      return "ordinary_income";
    case "business":
      return "ordinary_income";
    case "deferred":
      return "ordinary_income";
    case "capital_gains":
      return "capital_gains";
    case "trust":
      return "ordinary_income";
    default:
      return "ordinary_income";
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onEmit: (mutations: SolverMutation[]) => void;
  workingRow: Income;
  resolvedInflationRate: number;
}

export function SolverIncomeEditDialog({
  open,
  onClose,
  onEmit,
  workingRow,
  resolvedInflationRate,
}: Props) {
  const showSeToggle = workingRow.type === "business";

  const [annualAmount, setAnnualAmount] = useState<string>(
    String(workingRow.annualAmount ?? 0),
  );
  const [taxType, setTaxType] = useState<IncomeTaxType>(
    (workingRow.taxType as IncomeTaxType) ?? defaultTaxTypeFor(workingRow.type),
  );
  const initialGrowthSource: "custom" | "inflation" =
    workingRow.growthSource === "inflation" ? "inflation" : "custom";
  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    initialGrowthSource,
  );
  const [growthRatePct, setGrowthRatePct] = useState<string>(
    workingRow.growthRate != null
      ? String(Math.round(workingRow.growthRate * 10000) / 100)
      : "0",
  );
  const [isSe, setIsSe] = useState<boolean>(workingRow.isSelfEmployment ?? false);
  const [startYear, setStartYear] = useState<number>(workingRow.startYear);
  const [endYear, setEndYear] = useState<number>(workingRow.endYear);

  function handleApply() {
    const out: SolverMutation[] = [];
    const incomeId = workingRow.id;

    const amt = parseFloat(annualAmount);
    if (!Number.isNaN(amt) && amt !== workingRow.annualAmount) {
      out.push({
        kind: "income-annual-amount",
        incomeId,
        annualAmount: amt,
      });
    }

    if (taxType !== (workingRow.taxType ?? defaultTaxTypeFor(workingRow.type))) {
      out.push({ kind: "income-tax-type", incomeId, taxType });
    }

    if (growthSource !== initialGrowthSource) {
      out.push({ kind: "income-growth-source", incomeId, source: growthSource });
    }
    const targetRate =
      growthSource === "inflation"
        ? resolvedInflationRate
        : (parseFloat(growthRatePct) || 0) / 100;
    if (targetRate !== (workingRow.growthRate ?? null)) {
      out.push({ kind: "income-growth-rate", incomeId, rate: targetRate });
    }

    if (showSeToggle && isSe !== (workingRow.isSelfEmployment ?? false)) {
      out.push({ kind: "income-self-employment", incomeId, value: isSe });
    }

    if (startYear !== workingRow.startYear) {
      out.push({ kind: "income-start-year", incomeId, year: startYear });
    }
    if (endYear !== workingRow.endYear) {
      out.push({ kind: "income-end-year", incomeId, year: endYear });
    }

    if (out.length > 0) onEmit(out);
    onClose();
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={workingRow.name || incomeTypeLabel(workingRow.type)}
      size="md"
      primaryAction={{ label: "Apply", onClick: handleApply }}
    >
      <div className="mb-4">
        <label className={fieldLabelClassName}>Annual amount</label>
        <CurrencyInput
          value={annualAmount}
          onChange={(raw) => setAnnualAmount(raw)}
        />
      </div>

      <div className="mb-4">
        <label className={fieldLabelClassName}>Tax treatment</label>
        <select
          value={taxType}
          onChange={(e) => setTaxType(e.target.value as IncomeTaxType)}
          className={selectClassName}
        >
          {(Object.keys(INCOME_TAX_TYPE_LABELS) as IncomeTaxType[]).map((k) => (
            <option key={k} value={k}>
              {INCOME_TAX_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="mb-4">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">Growth</legend>
        <div className="flex gap-1 text-xs mb-3">
          <ModeButton
            active={growthSource === "custom"}
            onClick={() => setGrowthSource("custom")}
          >
            Custom %
          </ModeButton>
          <ModeButton
            active={growthSource === "inflation"}
            onClick={() => setGrowthSource("inflation")}
          >
            Inflation-linked
          </ModeButton>
        </div>
        {growthSource === "custom" ? (
          <div>
            <label className={fieldLabelClassName}>Annual growth rate (%)</label>
            <input
              type="number"
              step={0.25}
              value={growthRatePct}
              onChange={(e) => setGrowthRatePct(e.target.value)}
              className={inputBaseClassName + " w-32"}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            Follows the plan&rsquo;s inflation rate (
            {(resolvedInflationRate * 100).toFixed(2)}% currently).
          </p>
        )}
      </fieldset>

      {showSeToggle && (
        <fieldset className="mb-4">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Self-employment
          </legend>
          <label className="flex items-start gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={isSe}
              onChange={(e) => setIsSe(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Treat as net SE earnings for SECA tax
              <span className="block text-[12px] text-ink-3">
                When on, counts both halves of FICA (with above-line deduction
                for the employer half).
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <fieldset className="mb-2">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">Timeline</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName}>Start year</label>
            <input
              type="number"
              min={1950}
              max={2150}
              value={startYear}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) setStartYear(n);
              }}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName}>End year</label>
            <input
              type="number"
              min={1950}
              max={2150}
              value={endYear}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) setEndYear(n);
              }}
              className={inputClassName}
            />
          </div>
        </div>
      </fieldset>
    </DialogShell>
  );
}

function incomeTypeLabel(t: Income["type"]): string {
  switch (t) {
    case "salary":
      return "Salary";
    case "business":
      return "Business income";
    case "deferred":
      return "Deferred comp";
    case "capital_gains":
      return "Capital gains";
    case "trust":
      return "Trust distribution";
    case "social_security":
      return "Social Security";
    default:
      return "Income";
  }
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
        active
          ? "border-accent bg-accent/15 text-accent-ink"
          : "border-hair-2 bg-card-2 text-ink-2 hover:bg-card-hover"
      }`}
    >
      {children}
    </button>
  );
}
