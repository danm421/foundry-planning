"use client";
import type { BalanceSheetOptions } from "@/lib/presentations/pages/balance-sheet/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

type AsOf = Pick<BalanceSheetOptions, "asOf" | "year">;

/** Today or a chosen year-end — shared by the Net Worth and Balance Sheet pages. */
export function AsOfOptionsGroup<T extends AsOf>({ value, onChange }: { value: T; onChange: (next: T) => void }) {
  return (
    <OptionsGroup label="As of">
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
      {value.asOf === "eoy" && (
        <label className="flex flex-col gap-1 pt-1">
          <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Year</span>
          <input
            type="number"
            className="w-24 rounded border border-hair bg-card-2 px-2 py-1 text-ink"
            value={value.year}
            onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
          />
        </label>
      )}
    </OptionsGroup>
  );
}

export function BalanceSheetOptionsControl({
  value,
  onChange,
}: {
  value: BalanceSheetOptions;
  onChange: (next: BalanceSheetOptions) => void;
}) {
  return (
    <OptionsRow>
      <AsOfOptionsGroup value={value} onChange={onChange} />
      <OptionsGroup label="Tables">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.includeOutOfEstate}
            onChange={(e) => onChange({ ...value, includeOutOfEstate: e.target.checked })}
          />
          <span>Include Out of Estate table</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
