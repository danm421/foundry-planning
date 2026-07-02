"use client";
import type { AssumptionsPageOptions } from "@/lib/presentations/pages/assumptions/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";

export function AssumptionsOptionsControl({
  value,
  onChange,
}: {
  value: AssumptionsPageOptions;
  onChange: (next: AssumptionsPageOptions) => void;
}) {
  return (
    <OptionsRow>
      <OptionsGroup label="Sections">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.includeAccountTable}
            onChange={(e) => onChange({ ...value, includeAccountTable: e.target.checked })}
          />
          <span>Per-account growth table</span>
        </label>
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.includeCmaAppendix}
            onChange={(e) => onChange({ ...value, includeCmaAppendix: e.target.checked })}
          />
          <span>CMA &amp; model-portfolio appendix</span>
        </label>
      </OptionsGroup>
      <OptionsGroup label="Detail">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showAccountValues}
            onChange={(e) => onChange({ ...value, showAccountValues: e.target.checked })}
          />
          <span>Show account values</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
