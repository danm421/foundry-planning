// src/components/quick-start/expenses-step.tsx
"use client";
import { useRef, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { inputClassName } from "@/components/forms/input-styles";
import { liabilityPayload, livingExpensePayload, otherExpensePayload } from "@/lib/quick-start/derive";
import type { QsStepProps } from "./step-props";
import { Labeled, sendJson } from "./ui";

interface LiabilityRow {
  _id: number;
  name: string;
  balance?: number;
  interestRatePct?: number;
  termYears?: number;
}

interface OtherExpenseRow {
  _id: number;
  name: string;
  amount?: number;
}

export function ExpensesStep({ ctx, bootstrap, registerSave }: QsStepProps) {
  const idRef = useRef(1);
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const [retirement, setRetirement] = useState<number | undefined>(undefined);
  const [liabilities, setLiabilities] = useState<LiabilityRow[]>([]);
  const [otherExpenses, setOtherExpenses] = useState<OtherExpenseRow[]>([]);

  const updateLiability = (id: number, patch: Partial<LiabilityRow>) =>
    setLiabilities((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const removeLiability = (id: number) =>
    setLiabilities((rs) => rs.filter((r) => r._id !== id));
  const addLiability = () =>
    setLiabilities((rs) => [...rs, { _id: idRef.current++, name: "" }]);

  const updateOtherExpense = (id: number, patch: Partial<OtherExpenseRow>) =>
    setOtherExpenses((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const removeOtherExpense = (id: number) =>
    setOtherExpenses((rs) => rs.filter((r) => r._id !== id));
  const addOtherExpense = () =>
    setOtherExpenses((rs) => [...rs, { _id: idRef.current++, name: "" }]);

  const missingCurrent = !current;
  const missingRetirement = !retirement;

  registerSave(async () => {
    if (!current || !retirement) {
      throw new Error("Enter both current and retirement annual expenses.");
    }

    const clientId = bootstrap.clientId;
    const { currentId, retirementId } = bootstrap.expenseStubs;

    // Current living expenses
    if (currentId) {
      await sendJson(
        `/api/clients/${clientId}/expenses/${currentId}`,
        "PUT",
        { annualAmount: current },
      );
    } else {
      await sendJson(
        `/api/clients/${clientId}/expenses`,
        "POST",
        livingExpensePayload("current", current, ctx),
      );
    }

    // Retirement living expenses
    if (retirementId) {
      await sendJson(
        `/api/clients/${clientId}/expenses/${retirementId}`,
        "PUT",
        { annualAmount: retirement },
      );
    } else {
      await sendJson(
        `/api/clients/${clientId}/expenses`,
        "POST",
        livingExpensePayload("retirement", retirement, ctx),
      );
    }

    // Liabilities
    for (const r of liabilities) {
      await sendJson(
        `/api/clients/${clientId}/liabilities`,
        "POST",
        liabilityPayload(
          {
            name: r.name,
            balance: r.balance ?? 0,
            interestRate: (r.interestRatePct ?? 0) / 100,
            termYears: r.termYears,
          },
          ctx,
        ),
      );
    }

    // Other expenses
    for (const r of otherExpenses) {
      await sendJson(
        `/api/clients/${clientId}/expenses`,
        "POST",
        otherExpensePayload({ name: r.name, amount: r.amount ?? 0 }, ctx),
      );
    }
  });

  return (
    <div className="space-y-6">
      {/* Required: current and retirement annual expenses */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Labeled label="Current annual expenses">
            <CurrencyInput
              aria-label="Current annual expenses"
              value={current ?? ""}
              onChange={(raw) => setCurrent(raw ? Number(raw) : undefined)}
            />
          </Labeled>
          {missingCurrent && (
            <p className="mt-1 text-[12px] text-crit">Required</p>
          )}
        </div>
        <div>
          <Labeled label="Retirement annual expenses">
            <CurrencyInput
              aria-label="Retirement annual expenses"
              value={retirement ?? ""}
              onChange={(raw) => setRetirement(raw ? Number(raw) : undefined)}
            />
          </Labeled>
          {missingRetirement && (
            <p className="mt-1 text-[12px] text-crit">Required</p>
          )}
        </div>
      </div>

      {/* Liabilities */}
      <div className="space-y-3">
        <div className="text-[13px] font-medium text-ink-2">Liabilities</div>
        {liabilities.length === 0 && (
          <p className="text-[13px] text-ink-3">No liabilities added yet.</p>
        )}
        {liabilities.map((r) => (
          <div
            key={r._id}
            className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card-2/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <Labeled label="Name">
                <input
                  type="text"
                  aria-label="Liability name"
                  value={r.name}
                  onChange={(e) => updateLiability(r._id, { name: e.target.value })}
                  className={inputClassName}
                />
              </Labeled>
              <button
                type="button"
                onClick={() => removeLiability(r._id)}
                className="mt-6 text-[12px] text-ink-3 transition-colors hover:text-crit"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Labeled label="Balance">
                <CurrencyInput
                  aria-label="Balance"
                  value={r.balance ?? ""}
                  onChange={(raw) =>
                    updateLiability(r._id, { balance: raw ? Number(raw) : undefined })
                  }
                />
              </Labeled>
              <Labeled label="Interest rate (%)">
                <input
                  type="number"
                  aria-label="Interest rate"
                  min={0}
                  step={0.1}
                  value={r.interestRatePct ?? ""}
                  onChange={(e) =>
                    updateLiability(r._id, {
                      interestRatePct: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className={inputClassName}
                />
              </Labeled>
              <Labeled label="Term (years)">
                <input
                  type="number"
                  aria-label="Term (years)"
                  min={1}
                  value={r.termYears ?? ""}
                  onChange={(e) =>
                    updateLiability(r._id, {
                      termYears: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className={inputClassName}
                />
              </Labeled>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addLiability}
          className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          + Add liability
        </button>
      </div>

      {/* Other expenses */}
      <div className="space-y-3">
        <div className="text-[13px] font-medium text-ink-2">Other expenses</div>
        {otherExpenses.length === 0 && (
          <p className="text-[13px] text-ink-3">No additional expenses added yet.</p>
        )}
        {otherExpenses.map((r) => (
          <div
            key={r._id}
            className="space-y-3 rounded-[var(--radius-md)] border border-hair bg-card-2/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <Labeled label="Name">
                <input
                  type="text"
                  aria-label="Expense name"
                  value={r.name}
                  onChange={(e) => updateOtherExpense(r._id, { name: e.target.value })}
                  className={inputClassName}
                />
              </Labeled>
              <button
                type="button"
                onClick={() => removeOtherExpense(r._id)}
                className="mt-6 text-[12px] text-ink-3 transition-colors hover:text-crit"
              >
                Remove
              </button>
            </div>
            <Labeled label="Amount">
              <CurrencyInput
                aria-label="Expense amount"
                value={r.amount ?? ""}
                onChange={(raw) =>
                  updateOtherExpense(r._id, { amount: raw ? Number(raw) : undefined })
                }
              />
            </Labeled>
          </div>
        ))}
        <button
          type="button"
          onClick={addOtherExpense}
          className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          + Add expense
        </button>
      </div>
    </div>
  );
}
