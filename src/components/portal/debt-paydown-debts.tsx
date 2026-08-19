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
  /** EFFECTIVE value — the client's override applied over the debt's own
   * figure, when one exists. This is what the maths and the "usable"
   * checkbox read; it is NOT what gates whether this row shows an editable
   * box (see `rateUnknown`/`paymentUnknown`). */
  annualRate: number | null;
  minimumPayment: number | null;
  manual: boolean;
  included: boolean;
  /** True when the debt's OWN reported rate (before any override) is
   * unknown, so this row always shows an editable rate box — seeded with
   * any saved override, and never frozen into read-only text once one is
   * set, because an override must stay revisable. Always true for a manual
   * row: it has no "own" rate to begin with. */
  rateUnknown: boolean;
  /** Same idea as `rateUnknown`, for the monthly payment. */
  paymentUnknown: boolean;
  /** Display-ready month this debt clears under the current plan (e.g.
   * "Jan 2028"), already formatted by the workspace's own `monthName` — not
   * the "YYYY-MM" wire format `PaydownDebtResult.payoffMonth` derives from. */
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

/** Every row's own typed strings — a manual debt's fields AND a real debt's
 * rate/payment override — kept separate from the parsed numbers that drive
 * the maths (see the workspace's `rowRaw` for why). Keyed by row id: a
 * manual debt's own generated id, or a real debt's id for an override. One
 * map safely covers both, since a manual id always starts with "m" and no
 * liability uuid can, so the two id spaces never collide. Fields are
 * optional because a real-debt override entry has no `balance` (a real
 * debt's balance is never editable) and a fresh row may have typed only one
 * of its fields so far. */
export type RowRawInputs = Record<
  string,
  { balance?: string; annualRate?: string; minimumPayment?: string }
>;

const RATE_CLS =
  "w-20 rounded-md border border-hair bg-card-2 px-2 py-1 text-right tabular text-[12px] text-ink";
const NAME_CLS =
  "min-w-0 flex-1 rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink";
const BALANCE_CLS =
  "tabular w-24 rounded-md border border-hair bg-card-2 px-2 py-1 text-right text-[13px] text-ink";

/** Fraction → display percent, rounded to keep float division noise (e.g.
 * 5.9999999999998) off the screen. Exported so the workspace can seed a
 * manual row's raw percent string with the same rounding when it mints one
 * (on load and on "Add a debt") — a single source of truth for the
 * conversion rather than two copies drifting apart. */
export function toPercent(rate: number): number {
  return Math.round(rate * 100 * 10_000) / 10_000;
}

export function DebtPaydownDebts({
  rows,
  manualCount,
  rowRaw,
  edits,
}: {
  rows: PaydownRow[];
  manualCount: number;
  /** Every row's own typed strings — see `RowRawInputs`. */
  rowRaw: RowRawInputs;
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
                  aria-label={`Name for ${r.name}`}
                  onChange={(e) => edits.onName(r.id, e.target.value)}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
              )}

              {r.manual ? (
                <CurrencyInput
                  // The RAW typed string, not `String(r.balance)` — a value
                  // re-derived from the parsed number every render fights a
                  // decimal point the client just typed (React restores the
                  // pre-"." digits on the next render, so "5." becomes "5"
                  // and the next keystroke appends onto the integer).
                  value={rowRaw[r.id]?.balance ?? String(r.balance)}
                  onValueChange={(v) => edits.onBalance(r.id, v)}
                  aria-label={`Balance for ${r.name}`}
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
                  value={rowRaw[r.id]?.annualRate ?? String(toPercent(r.annualRate ?? 0))}
                  onChange={(e) => edits.onRate(r.id, e.target.value)}
                />
              ) : r.rateUnknown ? (
                <input
                  className={RATE_CLS}
                  inputMode="decimal"
                  placeholder="rate %"
                  aria-label={`Interest rate for ${r.name}`}
                  // The RAW typed string, seeded from any override already
                  // saved for this debt (converted fraction -> percent by
                  // the workspace) — never re-derived from the parsed number,
                  // which is the same decimal-point bug the manual fields
                  // had. Gated on `rateUnknown`, not `r.annualRate === null`:
                  // once an override supplies a rate, `r.annualRate` stops
                  // being null, but the box must stay editable rather than
                  // freezing into read-only text — an override has to stay
                  // revisable.
                  value={rowRaw[r.id]?.annualRate ?? ""}
                  onChange={(e) => edits.onRate(r.id, e.target.value)}
                />
              ) : (
                <span className="tabular w-20 text-right text-[13px] text-ink-2">
                  {((r.annualRate ?? 0) * 100).toFixed(2)}%
                </span>
              )}

              {r.manual ? (
                <CurrencyInput
                  value={rowRaw[r.id]?.minimumPayment ?? String(r.minimumPayment ?? 0)}
                  onValueChange={(v) => edits.onPayment(r.id, v)}
                  aria-label={`Monthly payment for ${r.name}`}
                  className={RATE_CLS}
                />
              ) : r.paymentUnknown ? (
                <CurrencyInput
                  // Was a hardcoded `value=""` — parent-owned and never
                  // updated, so every keystroke arrived as a fresh single
                  // character and the override ended up as whatever was
                  // typed LAST, not the whole number. Same fix and the same
                  // reason as the rate box above: gated on `paymentUnknown`,
                  // seeded from any saved override.
                  value={rowRaw[r.id]?.minimumPayment ?? ""}
                  onValueChange={(v) => edits.onPayment(r.id, v)}
                  aria-label={`Monthly payment for ${r.name}`}
                  placeholder="payment"
                  className={RATE_CLS}
                />
              ) : (
                <span className="tabular w-24 text-right text-[13px] text-ink-2">
                  {fmtUsd(r.minimumPayment ?? 0)}
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
