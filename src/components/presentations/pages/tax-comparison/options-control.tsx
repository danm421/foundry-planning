"use client";

import { useScenarioOptions } from "@/components/presentations/options-context";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import type { TaxComparisonOptions } from "@/lib/presentations/pages/tax-comparison/options-schema";

interface Props {
  value: TaxComparisonOptions;
  onChange: (next: TaxComparisonOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function TaxComparisonOptionsControl({ value, onChange }: Props) {
  // Orphan integration-test rows (`writer-test-<uuid>`) leak into this list on a
  // crashed run — same filter the Retirement Comparison control applies.
  const liveScenarios = useScenarioOptions().filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-"),
  );

  return (
    <OptionsRow>
      <OptionsGroup label="Baseline plan">
        <select
          aria-label="Baseline plan"
          className={field}
          value={value.baselineScenarioId}
          onChange={(e) => onChange({ ...value, baselineScenarioId: e.target.value })}
        >
          <option value="base">Base Case</option>
          {liveScenarios
            .filter((sc) => sc.id !== value.scenarioId)
            .map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.name}</option>
            ))}
        </select>
      </OptionsGroup>
      <OptionsGroup label="Bracket thresholds">
        <label className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Low &lt;</span>
          <input
            type="number"
            aria-label="Low bracket threshold"
            className={`w-20 ${field}`}
            min={0}
            max={100}
            value={Math.round(value.lowThreshold * 100)}
            onChange={(e) => onChange({ ...value, lowThreshold: Number(e.target.value) / 100 })}
          />
          <span className="text-xs text-ink-3">%</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-ink-3">High &gt;</span>
          <input
            type="number"
            aria-label="High bracket threshold"
            className={`w-20 ${field}`}
            min={0}
            max={100}
            value={Math.round(value.highThreshold * 100)}
            onChange={(e) => onChange({ ...value, highThreshold: Number(e.target.value) / 100 })}
          />
          <span className="text-xs text-ink-3">%</span>
        </label>
      </OptionsGroup>
    </OptionsRow>
  );
}
