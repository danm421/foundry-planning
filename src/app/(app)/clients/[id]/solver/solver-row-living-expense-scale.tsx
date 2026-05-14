"use client";

import { useState } from "react";
import type { ClientData, Expense } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { useSolverSide } from "./solver-section";

interface Props {
  baseExpenses: ClientData["expenses"];
  workingExpenses: ClientData["expenses"];
  currentYear: number;
  onChange(m: SolverMutation): void;
}

export function SolverRowLivingExpenseScale({
  baseExpenses,
  workingExpenses,
  currentYear,
  onChange,
}: Props) {
  const side = useSolverSide();
  const baseLiving = baseExpenses.filter((e) => e.type === "living");
  if (baseLiving.length === 0) return null;

  return (
    <div className="space-y-2.5 col-span-2">
      <div className="text-[13px] font-medium text-ink">Living Expenses</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {baseLiving.map((baseExpense) => {
          const label = labelFor(baseExpense, currentYear);
          if (side === "base") {
            return (
              <ReadOnly key={baseExpense.id} label={label} expense={baseExpense} />
            );
          }
          const workingExpense =
            workingExpenses.find((e) => e.id === baseExpense.id) ?? baseExpense;
          return (
            <Editable
              key={baseExpense.id}
              label={label}
              expense={workingExpense}
              onCommit={(n) =>
                onChange({
                  kind: "expense-annual-amount",
                  expenseId: baseExpense.id,
                  annualAmount: n,
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/** Disambiguates multiple "Living Expenses"-named rows by phase. */
function labelFor(expense: Expense, currentYear: number): string {
  if (expense.name && expense.name !== "Living Expenses") return expense.name;
  if (expense.startYear > currentYear) return "Living Expenses (retirement)";
  return "Living Expenses (current)";
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPct(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function detailParts(expense: Expense): string[] {
  return [
    expense.growthRate != null && expense.growthRate > 0
      ? `${formatPct(expense.growthRate)} growth`
      : null,
    expense.startYear != null && expense.endYear != null
      ? `${expense.startYear}–${expense.endYear}`
      : null,
  ].filter((s): s is string => s != null);
}

function DetailLine({ expense }: { expense: Expense }) {
  const parts = detailParts(expense);
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

function ReadOnly({ label, expense }: { label: string; expense: Expense }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3 truncate">{label}</div>
      <div className="mt-0.5 text-[15px] text-ink-2 tabular">
        {formatCurrency(expense.annualAmount)}/yr
      </div>
      <DetailLine expense={expense} />
    </div>
  );
}

function Editable({
  label,
  expense,
  onCommit,
}: {
  label: string;
  expense: Expense;
  onCommit: (n: number) => void;
}) {
  const inputId = `e-${expense.id}`;
  return (
    <div>
      <label className="block text-[11px] text-ink-3 truncate" htmlFor={inputId}>
        {label}
      </label>
      <CurrencyAmountInput
        id={inputId}
        label={label}
        defaultValue={expense.annualAmount}
        onCommit={onCommit}
      />
      <DetailLine expense={expense} />
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
    <div className="relative mt-1">
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
