// src/components/presentations/shared/drill-options-control.tsx
"use client";

import type { DrillPageOptions } from "@/lib/presentations/shared/drill-types";
import { OptionsRow } from "./options-layout";
import { YearRangeControl } from "./year-range-control";

interface Props {
  value: DrillPageOptions;
  onChange: (next: DrillPageOptions) => void;
}

export function DrillOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <YearRangeControl
        value={value.range}
        onChange={(range) => onChange({ ...value, range })}
      />
    </OptionsRow>
  );
}
