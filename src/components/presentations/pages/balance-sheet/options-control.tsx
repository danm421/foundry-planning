"use client";
import type { BalanceSheetOptions } from "@/lib/presentations/pages/balance-sheet/options-schema";
import { OptionsRow, OptionsGroup, optionsFieldClassName } from "@/components/presentations/shared/options-layout";
import { useAgePeople } from "@/components/presentations/options-context";
import YearOrAgeInput from "@/components/year-or-age-input";

type AsOf = Pick<BalanceSheetOptions, "asOf" | "year">;

/** Today or a chosen year-end — shared by the Net Worth and Balance Sheet pages. */
export function AsOfOptionsGroup<T extends AsOf>({ value, onChange }: { value: T; onChange: (next: T) => void }) {
  const people = useAgePeople();
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
        <div className="flex items-center gap-2 pl-6">
          <YearOrAgeInput
            aria-label="Year"
            year={value.year}
            onChange={(year) => year != null && onChange({ ...value, year })}
            people={people}
            inputClassName={optionsFieldClassName}
          />
        </div>
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
