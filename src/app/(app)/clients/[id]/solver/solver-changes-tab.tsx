"use client";

// Left-pane "Scenario changes" tab — the Changes drawer's content, moved
// in-pane. Renders the same <ChangesPanel> the right-edge drawer used
// (ScenarioDrawerShell/ScenarioDrawer), here in its `embedded` variant. The
// base case has no scenario_change rows to show, so it gets a quiet empty
// state instead. Click-to-edit (onOpenChange/canOpenChange) is wired up by a
// later task.

import { ChangesPanel } from "@/components/scenario/changes-panel";
import type { PanelData } from "@/lib/scenario/load-panel-data";

interface Props {
  clientId: string;
  /** Server-loaded panel data for the active scenario, or null on the base
   *  case (or a scenario id that failed to resolve — see loadPanelData). */
  panel: PanelData | null;
}

export function SolverChangesTab({ clientId, panel }: Props) {
  if (!panel) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-[12px] text-ink-3">
        Pick a scenario to see its changes.
      </div>
    );
  }

  return (
    <ChangesPanel
      variant="embedded"
      clientId={clientId}
      scenarioId={panel.scenarioId}
      scenarioName={panel.scenarioName}
      changes={panel.changes}
      toggleGroups={panel.toggleGroups}
      cascadeWarnings={panel.cascadeWarnings}
      targetNames={panel.targetNames}
    />
  );
}
