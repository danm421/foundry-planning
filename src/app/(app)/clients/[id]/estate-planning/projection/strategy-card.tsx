/**
 * StrategyCard — presentational card for the projection panel's strategy row
 * (Task 29). Three slots per card: a tag-line eyebrow, a large primary
 * amount, and a one-line narrative.
 *
 * Token translations from the plan pseudocode:
 *   bg-bg-1         → bg-card-2
 *   rounded-card    → rounded
 *   text-fg-1       → text-ink-2
 *   text-fg-3       → text-ink-3
 *   text-accent-hi  → text-accent-ink
 *   text-neg        → text-crit
 *
 * The MoneyText component renders Intl currency (e.g. "-$1,234,567"); the
 * negative sign falls out naturally for the procrastination card's signed
 * delta. `isNeg` toggles `text-crit` for visual emphasis.
 */

import MoneyText from "@/components/money-text";

export interface StrategyCardData {
  tagLine: string;
  primaryAmount: number;
  narrative: string;
}

export function StrategyCard({ data }: { data: StrategyCardData }) {
  const isNeg = data.primaryAmount < 0;
  return (
    <div className="rounded border border-hair bg-card-2 p-4">
      <div className="mb-2 text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
        {data.tagLine}
      </div>
      <MoneyText
        value={data.primaryAmount}
        format="currency"
        className={`block text-[30px] tabular-nums ${
          isNeg ? "text-crit" : "text-accent-ink"
        }`}
      />
      <p className="mt-3 text-[13px] text-ink-2">{data.narrative}</p>
    </div>
  );
}
