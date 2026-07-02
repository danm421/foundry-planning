"use client";
import type { HoldingsPageOptions } from "@/lib/presentations/pages/holdings/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

export function HoldingsOptionsControl({
  value,
  onChange,
}: {
  value: HoldingsPageOptions;
  onChange: (next: HoldingsPageOptions) => void;
}) {
  return (
    <OptionsRow>
      <OptionsGroup label="Layout">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.groupByAccount}
            onChange={(e) => onChange({ ...value, groupByAccount: e.target.checked })}
          />
          <span>Group by account</span>
        </label>
      </OptionsGroup>
      <OptionsGroup label="Detail">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.includeCostBasis}
            onChange={(e) => onChange({ ...value, includeCostBasis: e.target.checked })}
          />
          <span>Cost basis &amp; gain/loss</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
