"use client";

// Left-pane "Scenario changes" tab — the Changes drawer's content, moved
// in-pane. Renders the same <ChangesPanel> the right-edge drawer used
// (ScenarioDrawerShell/ScenarioDrawer), here in its `embedded` variant. The
// base case has no scenario_change rows to show, so it gets a quiet empty
// state instead.
//
// Clicking a change's title opens where it's edited (resolveChangeEditor):
// a Solver tab (Stress, Retirement) switches the left pane; a Details page
// opens that row's own editor in place (SolverChangeEditor), which also
// explains a change whose editor can't be used inside a scenario. Rows with
// nowhere to open, rows in a switched-off toggle group, and every row for a
// view-only advisor, stay plain text.

import { useState } from "react";
import { ChangesPanel, type ChangesPanelChange } from "@/components/scenario/changes-panel";
import { useClientAccess } from "@/components/client-access-provider";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import { resolveChangeEditor } from "@/lib/scenario/change-editor-target";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import { SolverChangeEditor, type EditorHostTarget } from "./solver-change-editor";
import type { InputTab } from "./report-tab-link";

interface Props {
  clientId: string;
  /** Server-loaded panel data for the active scenario, or null on the base
   *  case (or a scenario id that failed to resolve — see loadPanelData). */
  panel: PanelData | null;
  /** Switches the Solver's left pane to the tab that edits a change. */
  onOpenSolverTab: (tab: InputTab) => void;
}

export function SolverChangesTab({ clientId, panel, onOpenSolverTab }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  // `seq` remounts the editor on every click, so re-opening the same change
  // (or replacing a message) always starts a fresh load.
  const [editing, setEditing] = useState<{ target: EditorHostTarget; seq: number } | null>(null);

  if (!panel) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-[12px] text-ink-3">
        Pick a scenario to see its changes.
      </div>
    );
  }

  // Ruling F-C1: only a change the scenario currently applies can be opened.
  // The editors load the tree with every group at its saved on/off state, so a
  // change in a switched-off group (or one whose required parent group is off)
  // would open on base values — and saving would delete the change or pull it
  // out of its group. Same test the engine applies (`applyScenarioChanges`).
  const groupOn = resolveEffectiveToggleState({}, panel.toggleGroups);
  const isApplied = (change: ChangesPanelChange) =>
    change.toggleGroupId == null || groupOn[change.toggleGroupId] === true;

  function openChange(change: ChangesPanelChange) {
    const target = resolveChangeEditor(change);
    if (!target) return;
    if (target.surface === "solver-tab") {
      onOpenSolverTab(target.tab);
      return;
    }
    setEditing((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
  }

  return (
    <>
      {editing && (
        <SolverChangeEditor
          key={editing.seq}
          clientId={clientId}
          scenarioId={panel.scenarioId}
          target={editing.target}
          onDone={() => setEditing(null)}
        />
      )}
      <ChangesPanel
        variant="embedded"
        clientId={clientId}
        scenarioId={panel.scenarioId}
        scenarioName={panel.scenarioName}
        changes={panel.changes}
        toggleGroups={panel.toggleGroups}
        cascadeWarnings={panel.cascadeWarnings}
        targetNames={panel.targetNames}
        onOpenChange={openChange}
        canOpenChange={(c) => canEdit && isApplied(c) && resolveChangeEditor(c) !== null}
      />
    </>
  );
}
