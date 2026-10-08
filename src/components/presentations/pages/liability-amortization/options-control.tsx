"use client";

import type { LiabilityAmortizationPageOptions } from "@/lib/presentations/pages/liability-amortization/types";
import { useLiabilityOptions } from "@/components/presentations/options-context";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { exactCurrency } from "@/lib/presentations/format";

interface Props {
  value: LiabilityAmortizationPageOptions;
  onChange: (next: LiabilityAmortizationPageOptions) => void;
}

export function LiabilityAmortizationOptionsControl({ value, onChange }: Props) {
  const loans = useLiabilityOptions();
  const picked = value.liabilityIds;

  if (loans.length === 0) {
    return (
      <OptionsRow>
        <span className="text-sm text-ink-3">No amortizing loans on file.</span>
      </OptionsRow>
    );
  }

  function toggle(id: string) {
    const current = picked ?? loans.map((l) => l.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    // Every loan ticked is "all" again, so a loan added to the plan later
    // prints too.
    onChange({ liabilityIds: loans.every((l) => next.includes(l.id)) ? null : next });
  }

  return (
    <OptionsRow>
      <OptionsGroup label="Loans">
        <div className="flex flex-col gap-1">
          {loans.map((l) => (
            <label key={l.id} className="flex items-center gap-2 hover:text-ink">
              <input
                type="checkbox"
                className="accent-accent"
                checked={picked == null || picked.includes(l.id)}
                onChange={() => toggle(l.id)}
              />
              <span>{l.name}</span>
              <span className="tabular text-ink-3">{exactCurrency(l.balance)}</span>
            </label>
          ))}
        </div>
        {picked?.length === 0 && (
          <div className="text-[11px] text-crit">Choose at least one loan.</div>
        )}
      </OptionsGroup>
    </OptionsRow>
  );
}
