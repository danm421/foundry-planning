"use client";

import { useState } from "react";
import type { ClientData, Income } from "@/engine";
import {
  mutationKey,
  type IncomeTaxType,
  type SolverMutation,
  type SolverMutationKey,
} from "@/lib/solver/types";
import { activeIncomes } from "@/lib/solver/active-incomes";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverIncomeEditDialog } from "./solver-income-edit-dialog";

const TAX_TYPE_SHORT: Record<IncomeTaxType, string> = {
  earned_income: "earned",
  ordinary_income: "ordinary",
  dividends: "div",
  capital_gains: "LTCG",
  qbi: "QBI",
  tax_exempt: "tax-exempt",
  stcg: "STCG",
};

interface Props {
  baseClientData: ClientData;
  workingClientData: ClientData;
  currentYear: number;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}

/** Every per-income mutation key the inline input + edit dialog can write.
 *  A reset must clear the whole group so a partial edit doesn't half-revert. */
function incomeResetKeys(incomeId: string): SolverMutationKey[] {
  return [
    mutationKey({ kind: "income-annual-amount", incomeId, annualAmount: 0 }),
    mutationKey({ kind: "income-tax-type", incomeId, taxType: "ordinary_income" }),
    mutationKey({ kind: "income-growth-source", incomeId, source: "custom" }),
    mutationKey({ kind: "income-growth-rate", incomeId, rate: 0 }),
    mutationKey({ kind: "income-self-employment", incomeId, value: false }),
    mutationKey({ kind: "income-start-year", incomeId, year: 0 }),
    mutationKey({ kind: "income-end-year", incomeId, year: 0 }),
  ];
}

export function SolverRowIncomes({
  baseClientData,
  workingClientData,
  currentYear,
  onChange,
  onResetField,
}: Props) {
  const baseActive = activeIncomes(baseClientData.incomes, currentYear);
  if (baseActive.length === 0) return null;

  const resolvedInflationRate =
    workingClientData.planSettings?.inflationRate ??
    baseClientData.planSettings?.inflationRate ??
    0.03;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Other Income</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {baseActive.map((baseInc) => {
          const label = labelFor(baseInc, baseClientData.client);
          const workingInc =
            workingClientData.incomes.find((i) => i.id === baseInc.id) ?? baseInc;
          return (
            <Editable
              key={baseInc.id}
              label={label}
              baseIncome={baseInc}
              workingIncome={workingInc}
              resolvedInflationRate={resolvedInflationRate}
              onChange={onChange}
              onResetField={onResetField}
            />
          );
        })}
      </div>
    </div>
  );
}

function labelFor(income: Income, client: ClientData["client"]): string {
  const ownerSuffix =
    income.owner === "spouse"
      ? ` — ${client.spouseName?.split(" ")[0] ?? "Spouse"}`
      : income.owner === "client"
        ? ` — ${client.firstName.split(" ")[0]}`
        : "";
  if (income.name) return `${income.name}${ownerSuffix}`;
  return `${typeLabel(income.type)}${ownerSuffix}`;
}

function typeLabel(t: Income["type"]): string {
  switch (t) {
    case "salary":
      return "Salary";
    case "business":
      return "Business";
    case "deferred":
      return "Deferred comp";
    case "capital_gains":
      return "Capital gains";
    case "trust":
      return "Trust";
    default:
      return "Income";
  }
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPct(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function detailParts(income: Income): string[] {
  const tt =
    income.taxType != null && income.taxType in TAX_TYPE_SHORT
      ? TAX_TYPE_SHORT[income.taxType as IncomeTaxType]
      : null;
  return [
    tt,
    income.isSelfEmployment ? "SE" : null,
    income.growthSource === "inflation"
      ? "infl-linked growth"
      : income.growthRate != null && income.growthRate > 0
        ? `${formatPct(income.growthRate)} growth`
        : null,
    income.endYear != null ? `thru ${income.endYear}` : null,
  ].filter((s): s is string => s != null);
}

function DetailLine({ income }: { income: Income }) {
  const parts = detailParts(income);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1 text-[11px] text-ink-3 leading-snug">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? <span className="text-ink-4"> · </span> : null}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}

function Editable({
  label,
  baseIncome,
  workingIncome,
  resolvedInflationRate,
  onChange,
  onResetField,
}: {
  label: string;
  baseIncome: Income;
  workingIncome: Income;
  resolvedInflationRate: number;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Bumps on reset to remount CurrencyAmountInput so its local `display` state
  // re-seeds from the reverted base value (it seeds from defaultValue once).
  const [resetTick, setResetTick] = useState(0);
  const inputId = `inc-${workingIncome.id}`;
  return (
    <div>
      <label className="block text-[11px] text-ink-3 truncate" htmlFor={inputId}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <CurrencyAmountInput
          key={`${workingIncome.id}-${resetTick}`}
          id={inputId}
          label={label}
          defaultValue={workingIncome.annualAmount}
          onCommit={(n) =>
            onChange({
              kind: "income-annual-amount",
              incomeId: workingIncome.id,
              annualAmount: n,
            })
          }
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hair-2 bg-card-2 text-ink-3 hover:bg-card-hover hover:text-ink-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          aria-label={`Advanced edit ${label}`}
          title="Advanced edit"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474L4.42 15.14a.75.75 0 0 1-.36.198l-3.25.75a.75.75 0 0 1-.902-.901l.75-3.25a.75.75 0 0 1 .198-.36L11.013 1.427Z" />
          </svg>
        </button>
      </div>
      <DetailLine income={workingIncome} />
      <SolverBaseHint
        base={baseIncome.annualAmount}
        working={workingIncome.annualAmount}
        format={(v) => `${formatCurrency(v)}/yr`}
        onReset={
          onResetField
            ? () => {
                onResetField(incomeResetKeys(workingIncome.id));
                setResetTick((t) => t + 1);
              }
            : undefined
        }
      />
      {open ? (
        <SolverIncomeEditDialog
          open={open}
          onClose={() => setOpen(false)}
          onEmit={(mutations) => mutations.forEach(onChange)}
          workingRow={workingIncome}
          resolvedInflationRate={resolvedInflationRate}
        />
      ) : null}
    </div>
  );
}

/** Compact $-prefixed currency input with live thousands formatting. */
function CurrencyAmountInput({
  id,
  label,
  defaultValue,
  onCommit,
}: {
  id: string;
  label: string;
  defaultValue: number;
  onCommit: (n: number) => void;
}) {
  const [display, setDisplay] = useState<string>(
    Math.round(defaultValue).toLocaleString(),
  );
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return;
    setDisplay(n.toLocaleString());
    onCommit(n);
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className="h-9 w-32 rounded-md border border-hair-2 bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}
