"use client";

// The Changes tab's scenario picker. Switching here is the same switch the
// header's scenario pill makes — a new `?scenario=` that keeps every other
// param, so the advisor lands back on this tab in the scenario they picked.
// The pick shows at once; the workspace remounts when the new scenario loads.

import { useState } from "react";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { ScenarioPickerDropdown, type ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

export function SolverScenarioSelect({ clientId, scenarios }: { clientId: string; scenarios: ScenarioOption[] }) {
  const { scenarioId, setScenario } = useScenarioState(clientId);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <label className="mb-3 flex items-center gap-2 text-[12px] text-ink-3">
      Scenario
      <ScenarioPickerDropdown
        value={picked ?? scenarioId ?? "base"}
        onChange={(next) => {
          setPicked(next);
          setScenario(next === "base" ? null : next);
        }}
        scenarios={scenarios}
        snapshots={[]}
        className="h-7 min-w-0 max-w-[18rem] flex-1 rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
    </label>
  );
}
