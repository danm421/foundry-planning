// src/components/presentations/pages/life-insurance-summary/options-control.tsx
"use client";

import type { LifeInsuranceSummaryOptions } from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import {
  OptionsRow,
  OptionsGroup,
} from "@/components/presentations/shared/options-layout";

export function LifeInsuranceSummaryOptionsControl({
  value,
  onChange,
}: {
  value: LifeInsuranceSummaryOptions;
  onChange: (next: LifeInsuranceSummaryOptions) => void;
}) {
  return (
    <OptionsRow>
      <OptionsGroup label="Projection">
        <label className="flex items-center justify-between gap-3">
          <span className="text-ink2">Death year</span>
          <input
            type="number"
            min={1900}
            max={2200}
            step={1}
            defaultValue={value.deathYear}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n >= 1900 && n <= 2200) onChange({ ...value, deathYear: n });
            }}
            className="h-8 w-24 rounded-md border border-hair bg-card px-2 text-right text-ink"
            aria-label="Death year"
          />
        </label>
      </OptionsGroup>
      <OptionsGroup label="Monte Carlo">
        <label className="flex items-center justify-between gap-3">
          <span className="text-ink2">Monte Carlo target</span>
          <select
            value={String(value.mcTargetScore)}
            onChange={(e) => onChange({ ...value, mcTargetScore: parseFloat(e.target.value) })}
            className="h-8 rounded-md border border-hair bg-card px-2 text-ink"
            aria-label="Monte Carlo target success"
          >
            {[0.75, 0.8, 0.85, 0.9, 0.95].map((v) => (
              <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>
            ))}
          </select>
        </label>
      </OptionsGroup>
      <OptionsGroup>
        <p className="text-[11px] text-ink3">
          Proceeds portfolio and other assumptions use the client&apos;s saved life-insurance
          solver settings. The need solve runs when you click Generate.
        </p>
      </OptionsGroup>
    </OptionsRow>
  );
}
