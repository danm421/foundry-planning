"use client";

import { useRef, useState } from "react";
import type { ClientData, Expense } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverFieldSlider } from "./solver-field-slider";
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
  const baseLiving = baseExpenses.filter((e) => e.type === "living");
  const hasLivingRows = baseLiving.length > 0;

  const isSolvingHere = activeSolve?.target.kind === "living-expense-scale";
  const otherSolveActive = activeSolve !== null && !isSolvingHere;
  const target: SolveLeverKey = { kind: "living-expense-scale" };

  // The scale lever moves RETIREMENT living expenses only, so its Solve control
  // rides next to the retirement row's value rather than the section header.
  // With no retirement row to host it (current-only or empty plans) it falls
  // back to the header so the synthesize-a-row solve stays reachable.
  const retirementId = baseLiving.find((e) =>
    isRetirementLivingExpense(e, currentYear),
  )?.id;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-medium text-ink">Living Expenses</div>
        {retirementId == null && !isSolvingHere ? (
          <LivingExpenseSolveButton
            target={target}
            disabled={otherSolveActive}
            onSolveStart={onSolveStart}
          />
        ) : null}
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
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
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
                  solve={
                    baseExpense.id === retirementId
                      ? { target, disabled: otherSolveActive, onSolveStart }
                      : undefined
                  }
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

/** Compact dollar label for slider end-caps, e.g. $0 · $50k · $1.5M. */
function compactUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

/** Rounds up to a tidy 1/2/2.5/5 ×10ⁿ value so slider scales read cleanly. */
function niceCeil(n: number): number {
  if (n <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/** Stable slider ceiling from the saved base, generous enough for what-ifs. */
function spendSliderMax(base: number): number {
  return niceCeil(Math.max(base * 2, 50_000));
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

type LivingExpenseSolve = {
  target: SolveLeverKey;
  disabled: boolean;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
};

/** Solve icon + popover for the "Maximum Retirement Spend" lever, rendered
 *  inline next to the retirement living-expense value (matching how the
 *  Retirement Ages row hangs its Solve button off the field value). */
function LivingExpenseSolveButton({ target, disabled, onSolveStart }: LivingExpenseSolve) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} className="relative shrink-0">
      <SolverSolveIcon
        label="Solve Maximum Retirement Spend"
        tooltip={LIVING_EXPENSE_SOLVE_DESCRIPTION}
        disabled={disabled}
        onClick={() => setPopoverOpen(true)}
      />
      {popoverOpen ? (
        <SolverSolvePopover
          title="Solve Maximum Retirement Spend"
          rangeLabel="$0 – resource cap"
          defaultTargetPct={85}
          open={popoverOpen}
          anchorRef={anchorRef}
          onClose={() => setPopoverOpen(false)}
          onSubmit={(targetPoS) => {
            setPopoverOpen(false);
            onSolveStart(target, targetPoS);
          }}
        />
      ) : null}
    </div>
  );
}

function Editable({
  label,
  expense,
  baseExpense,
  onCommit,
  onResetField,
  solve,
}: {
  label: string;
  expense: Expense;
  baseExpense: Expense;
  onCommit: (n: number) => void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  solve?: LivingExpenseSolve;
}) {
  const inputId = `e-${expense.id}`;
  const rows = livingExpenseDetailRows(expense);
  return (
    <div>
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {rows.length ? <FieldHintPopover label={`${label} details`} rows={rows} /> : null}
      </div>
      <SolverFieldSlider
        id={inputId}
        label={label}
        value={expense.annualAmount}
        min={0}
        max={spendSliderMax(baseExpense.annualAmount)}
        step={5_000}
        prefix="$"
        formatBound={compactUsd}
        valueMax={10_000_000}
        onCommit={onCommit}
        trailing={solve ? <LivingExpenseSolveButton {...solve} /> : undefined}
      />
      <SolverBaseHint
        base={baseExpense.annualAmount}
        working={expense.annualAmount}
        format={(n) => `${formatCurrency(n)}/yr`}
        onReset={
          onResetField
            ? () =>
                onResetField([
                  mutationKey({
                    kind: "expense-annual-amount",
                    expenseId: baseExpense.id,
                    annualAmount: 0,
                  }),
                ])
            : undefined
        }
      />
    </div>
  );
}
