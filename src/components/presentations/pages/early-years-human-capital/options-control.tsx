"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsHumanCapitalPageOptions } from "@/lib/presentations/pages/early-years-human-capital/types";

interface Props {
  value: EarlyYearsHumanCapitalPageOptions;
  onChange: (next: EarlyYearsHumanCapitalPageOptions) => void;
}

export function EarlyYearsHumanCapitalOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
