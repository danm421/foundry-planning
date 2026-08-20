"use client";

import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { TidbitPicker } from "@/components/presentations/shared/tidbit-picker";
import type { EarlyYearsRothPageOptions } from "@/lib/presentations/pages/early-years-roth/types";

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
          onChange={(tidbits) => onChange({ ...value, tidbits })}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
