"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsStandingPageOptions } from "@/lib/presentations/pages/early-years-standing/types";

interface Props {
  value: EarlyYearsStandingPageOptions;
  onChange: (next: EarlyYearsStandingPageOptions) => void;
}

export function EarlyYearsStandingOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Content">
        <label className="flex items-center gap-2 hover:text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.showMatchLine}
            onChange={(e) => onChange({ ...value, showMatchLine: e.target.checked })}
          />
          <span>Show the employer-match line</span>
        </label>
      </OptionsGroup>
      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
