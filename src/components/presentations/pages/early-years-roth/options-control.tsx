"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import {
  EARLY_YEARS_ROTH_OPTIONS_DEFAULT,
  type EarlyYearsRothPageOptions,
} from "@/lib/presentations/pages/early-years-roth/types";

interface Props {
  value: EarlyYearsRothPageOptions;
  onChange: (next: EarlyYearsRothPageOptions) => void;
}

export function EarlyYearsRothOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <OptionsGroup label="Tidbits">
        <TidbitPicker
          value={value.tidbits}
          defaults={EARLY_YEARS_ROTH_OPTIONS_DEFAULT.tidbits}
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
