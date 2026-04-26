"use client";

import { useScenarioState } from "@/hooks/use-scenario-state";

/**
 * Thin amber rule between the chip row and the tabs. Renders only when a
 * non-base scenario is active (i.e. `?scenario=<sid>` points at a scenario
 * with `isBaseCase: false`). Hidden on the base case so the chrome stays
 * quiet when nothing is being edited.
 *
 * `scenarios` is passed in (rather than fetched here) so the banner reacts
 * to chip clicks without a server round-trip — the parent layout already
 * loads this list for `<ScenarioChipRow>`.
 */
export function ScenarioModeBanner({
  clientId,
  scenarios,
}: {
  clientId: string;
  scenarios: { id: string; name: string; isBaseCase: boolean }[];
}) {
  const { scenarioId } = useScenarioState(clientId);
  if (!scenarioId) return null;
  const active = scenarios.find((s) => s.id === scenarioId);
  if (!active || active.isBaseCase) return null;

  return (
    <div className="px-6 py-2 border-b border-[#7a5b29] bg-[#0b0c0f] text-[11px] tracking-[0.18em] text-[#7a5b29] uppercase font-mono">
      EDITING SCENARIO · {active.name} · CHANGES TRACKED IN PANEL
    </div>
  );
}
