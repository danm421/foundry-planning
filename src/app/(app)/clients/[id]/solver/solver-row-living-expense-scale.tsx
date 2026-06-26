"use client";

import { useState } from "react";
import type { ClientData, Expense } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverSolveIcon } from "./solver-solve-icon";
import { SolverSolvePopover } from "./solver-solve-popover";
import { SolverSolveProgressStrip } from "./solver-solve-progress-strip";

type ActiveSolve = {
  target: SolveLeverKey;
  targetPoS?: number;
  iteration: number;
  candidateValue: number | null;
  achievedPoS: number | null;
};

const LIVING_EXPENSE_SOLVE_DESCRIPTION =
  "Scales retirement living expenses up or down to find the spending level that reaches your target probability of success.";

interface Props {
  baseExpenses: ClientData["expenses"];
  workingExpenses: ClientData["expenses"];
  currentYear: number;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
}

export function SolverRowLivingExpenseScale({
  baseExpenses,
  workingExpenses,
  currentYear,
  onChange,
  onResetField,
  activeSolve,
  onSolveStart,
  onSolveCancel,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const baseLiving = baseExpenses.filter((e) => e.type === "living");
  const hasLivingRows = baseLiving.length > 0;

  const isSolvingHere = activeSolve?.target.kind === "living-expense-scale";
  const otherSolveActive = activeSolve !== null && !isSolvingHere;
  const target: SolveLeverKey = { kind: "living-expense-scale" };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-medium text-ink">Living Expenses</div>
        <div className="relative">
          <SolverSolveIcon
            label="Solve Maximum Retirement Spend"
            tooltip={LIVING_EXPENSE_SOLVE_DESCRIPTION}
            disabled={otherSolveActive}
            onClick={() => setPopoverOpen(true)}
          />
          {popoverOpen ? (
            <SolverSolvePopover
              title="Solve Maximum Retirement Spend"
              rangeLabel="$0 – resource cap"
              defaultTargetPct={85}
              open={popoverOpen}
              onClose={() => setPopoverOpen(false)}
              onSubmit={(targetPoS) => {
                setPopoverOpen(false);
                onSolveStart(target, targetPoS);
              }}
            />
          ) : null}
        </div>
      </div>
      {isSolvingHere ? (
        <SolverSolveProgressStrip
          title={`Solving Maximum Retirement Spend for ${Math.round(activeSolve.targetPoS! * 100)}% PoS`}
          iteration={activeSolve.iteration}
          maxIterations={14}
          candidateValue={activeSolve.candidateValue}
          achievedPoS={activeSolve.achievedPoS}
          valueFormatter={formatCurrency}
          onCancel={onSolveCancel}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {hasLivingRows ? (
            baseLiving.map((baseExpense) => {
              const label = labelFor(baseExpense, currentYear);
              const workingExpense =
                workingExpenses.find((e) => e.id === baseExpense.id) ?? baseExpense;
              return (
                <Editable
                  key={baseExpense.id}
                  label={label}
                  expense={workingExpense}
                  baseExpense={baseExpense}
                  onCommit={(n) =>
                    onChange({
                      kind: "expense-annual-amount",
                      expenseId: baseExpense.id,
                      annualAmount: n,
                    })
                  }
                  onResetField={onResetField}
                />
              );
            })
          ) : (
            <div className="col-span-2 text-[12px] text-ink-3">
              No retirement expenses entered — solve to find the sustainable spend.
            </div>
          )}
        </div>
      )}
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

export function livingExpenseDetailRows(expense: Expense): HintRow[] {
  const rows: HintRow[] = [];
  if (expense.growthRate != null && expense.growthRate > 0) {
    rows.push({ term: "Growth", value: formatPct(expense.growthRate) });
  }
  if (expense.startYear != null && expense.endYear != null) {
    rows.push({ term: "Applies", value: `${expense.startYear}–${expense.endYear}` });
  }
  return rows;
}

function Editable({
  label,
  expense,
  baseExpense,
  onCommit,
  onResetField,
}: {
  label: string;
  expense: Expense;
  baseExpense: Expense;
  onCommit: (n: number) => void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const inputId = `e-${expense.id}`;
  // Bumps on reset to remount the currency input so its local `display` state
  // re-seeds from the reverted base amount (it's seeded once from defaultValue).
  const [resetTick, setResetTick] = useState(0);
  const rows = livingExpenseDetailRows(expense);
  return (
    <div>
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {rows.length ? <FieldHintPopover label={`${label} details`} rows={rows} /> : null}
      </div>
      <CurrencyAmountInput
        key={`${inputId}-${resetTick}`}
        id={inputId}
        label={label}
        defaultValue={expense.annualAmount}
        onCommit={onCommit}
      />
      <SolverBaseHint
        base={baseExpense.annualAmount}
        working={expense.annualAmount}
        format={(n) => `${formatCurrency(n)}/yr`}
        onReset={
          onResetField
            ? () => {
                onResetField([
                  mutationKey({
                    kind: "expense-annual-amount",
                    expenseId: baseExpense.id,
                    annualAmount: 0,
                  }),
                ]);
                setResetTick((t) => t + 1);
              }
            : undefined
        }
      />
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
