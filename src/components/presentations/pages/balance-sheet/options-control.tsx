"use client";
import type { BalanceSheetOptions } from "@/lib/presentations/pages/balance-sheet/options-schema";

export function BalanceSheetOptionsControl({
  value,
  onChange,
}: {
  value: BalanceSheetOptions;
  onChange: (next: BalanceSheetOptions) => void;
}) {
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <fieldset className="space-y-1">
        <legend className="text-[11px] uppercase tracking-[0.1em] text-ink-3">As of</legend>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.asOf === "today"}
            onChange={() => onChange({ ...value, asOf: "today" })}
          />
          <span>Today (current balances)</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="radio"
            className="accent-accent"
            checked={value.asOf === "eoy"}
            onChange={() => onChange({ ...value, asOf: "eoy" })}
          />
          <span>End of year</span>
        </label>
      </fieldset>
      {value.asOf === "eoy" && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Year</span>
          <input
            type="number"
            className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            value={value.year}
            onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}
