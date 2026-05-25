"use client";

import MoneyText from "@/components/money-text";
import { fieldLabelClassName } from "@/components/forms/input-styles";

interface FlowRow {
  id: string;
  name: string;
  annualAmount: number | string;
  ownerAccountId?: string | null;
}

export interface BusinessFlowsTabProps {
  businessId: string;
  incomes: FlowRow[];
  expenses: FlowRow[];
  hidden: boolean;
  onOpenAddIncome: () => void;
  onOpenAddExpense: () => void;
  onEditIncome: (id: string) => void;
  onEditExpense: (id: string) => void;
}

const toNum = (v: number | string): number =>
  typeof v === "number" ? v : parseFloat(v || "0") || 0;

export default function BusinessFlowsTab({
  businessId,
  incomes,
  expenses,
  hidden,
  onOpenAddIncome,
  onOpenAddExpense,
  onEditIncome,
  onEditExpense,
}: BusinessFlowsTabProps) {
  const ownedIncomes = incomes.filter((i) => i.ownerAccountId === businessId);
  const ownedExpenses = expenses.filter((e) => e.ownerAccountId === businessId);

  const netAnnual =
    ownedIncomes.reduce((s, i) => s + toNum(i.annualAmount), 0) -
    ownedExpenses.reduce((s, e) => s + toNum(e.annualAmount), 0);

  return (
    <div className={hidden ? "hidden" : "space-y-4"}>
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
        <span className="text-[12px] font-medium text-ink-3 uppercase tracking-wider">
          Net annual flow
        </span>
        <MoneyText value={netAnnual} className="text-[15px] font-semibold text-ink" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={fieldLabelClassName}>Incomes</label>
          <button
            type="button"
            onClick={onOpenAddIncome}
            className="text-[12px] text-accent hover:text-accent-deep font-medium"
          >
            + Add income
          </button>
        </div>
        {ownedIncomes.length === 0 ? (
          <p className="text-[12px] text-ink-4 py-2">No incomes for this business.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedIncomes.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => onEditIncome(i.id)}
                  className="flex-1 min-w-0 text-left text-[13px] text-ink truncate hover:underline"
                >
                  {i.name}
                </button>
                <span className="text-[12px] tabular-nums text-ink-2">
                  <MoneyText value={toNum(i.annualAmount)} /> / yr
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={fieldLabelClassName}>Expenses</label>
          <button
            type="button"
            onClick={onOpenAddExpense}
            className="text-[12px] text-accent hover:text-accent-deep font-medium"
          >
            + Add expense
          </button>
        </div>
        {ownedExpenses.length === 0 ? (
          <p className="text-[12px] text-ink-4 py-2">No expenses for this business.</p>
        ) : (
          <ul className="space-y-1.5">
            {ownedExpenses.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => onEditExpense(e.id)}
                  className="flex-1 min-w-0 text-left text-[13px] text-ink truncate hover:underline"
                >
                  {e.name}
                </button>
                <span className="text-[12px] tabular-nums text-crit">
                  (<MoneyText value={toNum(e.annualAmount)} />) / yr
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
