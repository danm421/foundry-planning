// src/components/presentations/shared/drill-options-control.tsx
"use client";

import type { DrillPageOptions } from "@/lib/presentations/shared/drill-types";
import type { NamedRange } from "@/lib/presentations/shared/year-filter";
import { OptionsRow } from "./options-layout";
import { YearRangeControl } from "./year-range-control";

interface Props {
  value: DrillPageOptions;
  onChange: (next: DrillPageOptions) => void;
  presets?: NamedRange[];
}

export function DrillOptionsControl({ value, onChange, presets }: Props) {
  return (
    <OptionsRow>
      <YearRangeControl
        value={value.range}
        onChange={(range) => onChange({ ...value, range })}
        presets={presets}
      />
    </OptionsRow>
  );
}

const TAX_BRACKET_PRESETS: NamedRange[] = ["rothConversionYears"];

/** The Tax Bracket pages exist to size a Roth conversion, so they alone offer
 *  the range that keeps only the years one happens. */
export function TaxBracketOptionsControl(props: Omit<Props, "presets">) {
  return <DrillOptionsControl {...props} presets={TAX_BRACKET_PRESETS} />;
}
