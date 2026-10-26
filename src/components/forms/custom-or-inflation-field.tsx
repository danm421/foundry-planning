"use client";

import { PercentInput } from "@/components/percent-input";
import { fieldLabelClassName } from "./input-styles";
import { GrowthSourceSelect } from "./growth-source-select";

/**
 * A growth rate that is either the plan's inflation rate or a custom %: the
 * two-choice form of `GrowthSourceSelect`, showing the rate the pick resolves
 * to. Real estate and property tax on the account form grow this way.
 */
export function CustomOrInflationField({
  id, label, inputId, inputLabel, source, onSourceChange, pct, onPctChange, inflationRate,
}: {
  id: string;
  label: string;
  inputId: string;
  inputLabel: string;
  source: "custom" | "inflation";
  onSourceChange: (next: "custom" | "inflation") => void;
  pct: string;
  onPctChange: (raw: string) => void;
  inflationRate: number;
}) {
  return (
    <div>
      <label className={fieldLabelClassName} htmlFor={id}>{label}</label>
      <GrowthSourceSelect
        id={id}
        value={source}
        options={[
          { value: "custom", name: "Custom %", pct: null },
          { value: "inflation", name: "Inflation rate", pct: inflationRate * 100 },
        ]}
        onChange={(raw) => onSourceChange(raw as "custom" | "inflation")}
        customInput={<PercentInput id={inputId} aria-label={inputLabel} value={pct} onChange={onPctChange} />}
      />
    </div>
  );
}
