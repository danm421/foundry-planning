// src/components/presentations/pages/cash-flow/options-control.tsx
"use client";

import type { CashFlowPageOptions } from "@/lib/presentations/types";
import { OptionsRow } from "@/components/presentations/shared/options-layout";
import { YearRangeControl } from "@/components/presentations/shared/year-range-control";

interface Props {
  value: CashFlowPageOptions;
  onChange: (next: CashFlowPageOptions) => void;
}

export function CashFlowOptionsControl({ value, onChange }: Props) {
  return (
    <OptionsRow>
      <YearRangeControl
        value={value.range}
        onChange={(range) => onChange({ ...value, range })}
      />
    </OptionsRow>
  );
}
