"use client";
import type { ReactElement } from "react";
import { CurrencyInput } from "@/components/portal/currency-input";
import { fmtUsd } from "@/lib/portal/format";
import { MAX_MANUAL_DEBTS, MAX_NAME_LENGTH } from "@/lib/calculators/debt-paydown-state";

/** One row as the list renders it — a real debt or one the client added. */
export interface PaydownRow {
  id: string;
  name: string;
  balance: number;
  annualRate: number | null;
  minimumPayment: number | null;
  manual: boolean;
  included: boolean;
  /** "YYYY-MM" this debt clears under the current plan, when it does. */
  payoffLabel: string | null;
}

export interface DebtEdits {
  onToggle: (id: string, included: boolean) => void;
  onRate: (id: string, rate: string) => void;
  onPayment: (id: string, payment: string) => void;
  /** Manual rows only — a real debt's name and balance are read-only. */
  onName: (id: string, name: string) => void;
  onBalance: (id: string, balance: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

const RATE_CLS =
  "w-20 rounded-md border border-hair bg-card-2 px-2 py-1 text-right tabular text-[12px] text-ink";
const NAME_CLS =
  "min-w-0 flex-1 rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink";
const BALANCE_CLS =
  "tabular w-24 rounded-md border border-hair bg-card-2 px-2 py-1 text-right text-[13px] text-ink";

/** Fraction → display percent, rounded to keep float division noise (e.g.
 * 5.9999999999998) off the screen. */
function toPercent(rate: number): number {
  return Math.round(rate * 100 * 10_000) / 10_000;
}

export function DebtPaydownDebts({
  rows,
  manualCount,
  edits,
}: {
  rows: PaydownRow[];
  manualCount: number;
  edits: DebtEdits;
}): ReactElement {
  return (
    <section className="card p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink">Your debts</h2>
        <button
          type="button"
          onClick={edits.onAdd}
          disabled={manualCount >= MAX_MANUAL_DEBTS}
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          Add a debt
        </button>
      </header>

      <ul className="divide-y divide-hair">
        {rows.map((r) => {
          const usable = r.annualRate !== null && r.minimumPayment !== null;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <input
                type="checkbox"
                checked={r.included && usable}
                disabled={!usable}
                aria-label={`Include ${r.name}`}
                onChange={(e) => edits.onToggle(r.id, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--color-accent)] disabled:opacity-40"
              />

              {r.manual ? (
                <input
                  className={NAME_CLS}
                  value={r.name}
                  maxLength={MAX_NAME_LENGTH}
                  aria-label="Debt name"
                  onChange={(e) => edits.onName(r.id, e.target.value)}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
              )}

              {r.manual ? (
                <CurrencyInput
                  value={String(r.balance)}
                  onValueChange={(v) => edits.onBalance(r.id, v)}
                  aria-label="Debt balance"
                  className={BALANCE_CLS}
                />
              ) : (
                <span className="tabular text-[13px] text-ink-2">{fmtUsd(r.balance)}</span>
              )}

              {r.manual ? (
                <input
                  className={RATE_CLS}
                  inputMode="decimal"
                  aria-label={`Interest rate for ${r.name}`}
                  value={String(toPercent(r.annualRate ?? 0))}
                  onChange={(e) => edits.onRate(r.id, e.target.value)}
                />
              ) : r.annualRate === null ? (
                <input
                  className={RATE_CLS}
                  inputMode="decimal"
                  placeholder="rate %"
                  aria-label={`Interest rate for ${r.name}`}
                  onChange={(e) => edits.onRate(r.id, e.target.value)}
                />
              ) : (
                <span className="tabular w-20 text-right text-[13px] text-ink-2">
                  {(r.annualRate * 100).toFixed(2)}%
                </span>
              )}

              {r.manual ? (
                <CurrencyInput
                  value={String(r.minimumPayment ?? 0)}
                  onValueChange={(v) => edits.onPayment(r.id, v)}
                  aria-label={`Monthly payment for ${r.name}`}
                  className={RATE_CLS}
                />
              ) : r.minimumPayment === null ? (
                <CurrencyInput
                  value=""
                  onValueChange={(v) => edits.onPayment(r.id, v)}
                  aria-label={`Monthly payment for ${r.name}`}
                  placeholder="payment"
                  className={RATE_CLS}
                />
              ) : (
                <span className="tabular w-24 text-right text-[13px] text-ink-2">
                  {fmtUsd(r.minimumPayment)}
                </span>
              )}

              <span className="tabular w-24 text-right text-[12px] text-ink-3">
                {r.payoffLabel ?? "—"}
              </span>

              {r.manual && (
                <button
                  type="button"
                  onClick={() => edits.onRemove(r.id)}
                  aria-label={`Remove ${r.name}`}
                  className="text-[12px] text-ink-3 hover:text-crit"
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
