"use client";

import type { ClientData, Expense } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
} from "@/lib/solver/types";
import { activeOtherExpenses } from "@/lib/solver/active-other-expenses";
import { addedQuickAddRows, draftFromExpense } from "@/lib/solver/quick-add-cashflow";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverAddedCashflowRow } from "./solver-added-cashflow-row";
import { SolverBaseHint } from "./solver-base-hint";
import { CurrencyAmountInput } from "./solver-currency-amount-input";
import type { CashflowFormContext } from "./solver-cashflow-edit-dialog";

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

/**
 * The plan's miscellaneous ("other") expenses, and any this session added.
 *
 * Living expenses have their own row with the spending solve lever, insurance
 * premiums are synthesized from policies, and education goals live in the
 * Education tab — so this is the category the "+ Add income or expense" popup
 * writes an expense into, and the one it has to be editable in afterwards.
 */
export function SolverRowOtherExpenses({
  baseClientData,
  sourceClientData,
  workingClientData,
  currentYear,
  onChange,
  onResetField,
  cashflowCtx,
}: Props) {
  const baseActive = activeOtherExpenses(baseClientData.expenses, currentYear);
  // Rows this session added. Deliberately NOT year-filtered: an advisor who
  // just typed an expense starting at retirement still has to see it.
  const added = addedQuickAddRows(sourceClientData.expenses, workingClientData.expenses);
  if (baseActive.length === 0 && added.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Other Expenses</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {baseActive.map((baseExp) => {
          const workingExp =
            workingClientData.expenses.find((e) => e.id === baseExp.id) ?? baseExp;
          return (
            <Editable
              key={baseExp.id}
              baseExpense={baseExp}
              workingExpense={workingExp}
              onChange={onChange}
              onResetField={onResetField}
            />
          );
        })}
        {added.map((exp) => (
          <SolverAddedCashflowRow
            key={exp.id}
            draft={draftFromExpense(exp)}
            label={exp.name || "Expense"}
            hintRows={otherExpenseDetailRows(exp)}
            ctx={cashflowCtx}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPct(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function otherExpenseDetailRows(expense: Expense): HintRow[] {
  const rows: HintRow[] = [];
  if (expense.growthSource === "inflation") {
    rows.push({ term: "Growth", value: "infl-linked" });
  } else if (expense.growthRate != null && expense.growthRate > 0) {
    rows.push({ term: "Growth", value: formatPct(expense.growthRate) });
  }
  if (expense.endYear != null) rows.push({ term: "Through", value: String(expense.endYear) });
  return rows;
}

function Editable({
  baseExpense,
  workingExpense,
  onChange,
  onResetField,
}: {
  baseExpense: Expense;
  workingExpense: Expense;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const label = workingExpense.name || "Expense";
  const rows = otherExpenseDetailRows(workingExpense);
  const inputId = `oexp-${workingExpense.id}`;
  return (
    <div>
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {rows.length ? <FieldHintPopover label={`${label} details`} rows={rows} /> : null}
      </div>
      <div className="mt-1">
        <CurrencyAmountInput
          id={inputId}
          label={label}
          value={workingExpense.annualAmount}
          onCommit={(n) =>
            onChange({
              kind: "expense-annual-amount",
              expenseId: workingExpense.id,
              annualAmount: n,
            })
          }
        />
      </div>
      <SolverBaseHint
        base={baseExpense.annualAmount}
        working={workingExpense.annualAmount}
        format={(v) => `${formatCurrency(v)}/yr`}
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
