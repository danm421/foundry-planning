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
import { addedQuickAddRows, draftFromIncome } from "@/lib/solver/quick-add-cashflow";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverAddedCashflowRow } from "./solver-added-cashflow-row";
import { SolverBaseHint } from "./solver-base-hint";
import { CurrencyAmountInput } from "./solver-currency-amount-input";
import type { CashflowFormContext } from "./solver-cashflow-edit-dialog";
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
  /** The tree the solver started from (base, or the loaded scenario). Rows in
   *  the working tree but not here were added by this session's quick-add. */
  sourceClientData: ClientData;
  workingClientData: ClientData;
  currentYear: number;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  /** Form context for the quick-add editor behind an added row's pencil. */
  cashflowCtx: CashflowFormContext;
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
  sourceClientData,
  workingClientData,
  currentYear,
  onChange,
  onResetField,
  cashflowCtx,
}: Props) {
  const baseActive = activeIncomes(baseClientData.incomes, currentYear);
  // Rows this session added. Deliberately NOT year-filtered: an advisor who
  // just typed a stream starting at retirement still has to see it.
  const added = addedQuickAddRows(sourceClientData.incomes, workingClientData.incomes);
  if (baseActive.length === 0 && added.length === 0) return null;

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
        {added.map((inc) => (
          <SolverAddedCashflowRow
            key={inc.id}
            draft={draftFromIncome(inc)}
            label={labelFor(inc, baseClientData.client)}
            hintRows={incomeDetailRows(inc)}
            ctx={cashflowCtx}
            onChange={onChange}
          />
        ))}
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

export function incomeDetailRows(income: Income): HintRow[] {
  const rows: HintRow[] = [];
  const tt =
    income.taxType != null && income.taxType in TAX_TYPE_SHORT
      ? TAX_TYPE_SHORT[income.taxType as IncomeTaxType]
      : null;
  if (tt) rows.push({ term: "Taxed as", value: tt });
  if (income.isSelfEmployment) rows.push({ value: "SE" });
  if (income.growthSource === "inflation") {
    rows.push({ term: "Growth", value: "infl-linked" });
  } else if (income.growthRate != null && income.growthRate > 0) {
    rows.push({ term: "Growth", value: formatPct(income.growthRate) });
  }
  if (income.endYear != null) rows.push({ term: "Through", value: String(income.endYear) });
  return rows;
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
  const rows = incomeDetailRows(workingIncome);
  const inputId = `inc-${workingIncome.id}`;
  return (
    <div>
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {rows.length ? <FieldHintPopover label={`${label} details`} rows={rows} /> : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <CurrencyAmountInput
          id={inputId}
          label={label}
          value={workingIncome.annualAmount}
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
      <SolverBaseHint
        base={baseIncome.annualAmount}
        working={workingIncome.annualAmount}
        format={(v) => `${formatCurrency(v)}/yr`}
        onReset={
          onResetField ? () => onResetField(incomeResetKeys(workingIncome.id)) : undefined
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
