"use client";

import { useScenarioOptions } from "@/components/presentations/options-context";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import type { RothConversionPageOptions } from "@/lib/presentations/pages/roth-conversion/types";

interface Props {
  value: RothConversionPageOptions;
  onChange: (next: RothConversionPageOptions) => void;
}

const field =
  "rounded border border-hair bg-card-2 px-2 py-1 text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40";

export function RothConversionOptionsControl({ value, onChange }: Props) {
  // Orphan integration-test rows (`writer-test-<uuid>`) leak into this list on a
  // crashed run — same filter the Tax Comparison control applies.
  const liveScenarios = useScenarioOptions().filter(
    (s) => !s.isBaseCase && !s.name.startsWith("writer-test-"),
  );

  return (
    <OptionsRow>
      <OptionsGroup label="Plan with the conversions">
        <select
          aria-label="Plan with the conversions"
          className={field}
          value={value.scenarioId}
          onChange={(e) => onChange({ ...value, scenarioId: e.target.value })}
        >
          <option value="base">Base Case</option>
          {liveScenarios.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.name}</option>
          ))}
        </select>
      </OptionsGroup>
    </OptionsRow>
  );
}
