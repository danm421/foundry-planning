"use client";

// Left-pane "Scenario changes" tab — the Changes drawer's content, moved
// in-pane. Renders the same <ChangesPanel> the right-edge drawer used
// (ScenarioDrawerShell/ScenarioDrawer), here in its `embedded` variant. The
// base case has no scenario_change rows to show, so it gets a quiet empty
// state instead.
//
// The toolbar above the list adds, edits and deletes any plan detail, not only
// the ones the scenario already changed: Add and Edit open the Details page's
// own editor in place, Delete asks first (SolverDeleteConfirm) and then opens
// the same host, which runs the view's delete and reports back. Every write the
// view makes is reported up through `onTargetsWritten` so the Solver can drop
// the draft levers that write replaced. The base case gets the toolbar greyed
// out and a way to create a scenario: nothing here ever writes the base plan.
//
// Clicking a change's title opens where it's edited (resolveChangeEditor):
// a Solver tab (Stress, Retirement) switches the left pane; a Details page
// opens that row's own editor in place (SolverChangeEditor), which also
// explains a change whose editor can't be used inside a scenario. Rows with
// nowhere to open, rows in a switched-off toggle group, and every row for a
// view-only advisor, stay plain text.

import { useEffect, useState } from "react";
import { useScenarioModeUI } from "@/components/scenario/scenario-mode-wrapper";
import { ChangesPanel, type ChangesPanelChange } from "@/components/scenario/changes-panel";
import { labelFor } from "@/components/scenario/changes-panel-leaf-row";
import type { ClientData, LtcEvent, ProjectionYear } from "@/engine/types";
import { useClientAccess } from "@/components/client-access-provider";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import { focusRowId, resolveChangeEditor, type CreateVariant } from "@/lib/scenario/change-editor-target";
import { detailEditorTarget, detailType, type DetailTypeKey } from "@/lib/scenario/plan-detail-catalog";
import type { InventoryItem, WillGrantor } from "@/lib/scenario/plan-inventory";
import type { ScenarioWriteEvent } from "@/hooks/scenario-write-listener";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import { SolverChangeEditor, type EditorHostTarget } from "./solver-change-editor";
import { LtcEventDialog } from "./ltc-event-dialog";
import { SolverDetailActions } from "./solver-detail-actions";
import { SolverDeleteConfirm } from "./solver-delete-confirm";
import type { InputTab } from "./report-tab-link";

interface Props {
  clientId: string;
  /** Server-loaded panel data for the active scenario, or null on the base
   *  case (or a scenario id that failed to resolve — see loadPanelData). */
  panel: PanelData | null;
  /** Every plan detail the toolbar can edit or delete, from the persisted plan. */
  inventory: InventoryItem[];
  /** The scenario's persisted plan: what a delete would cascade through. */
  planTree: ClientData;
  /** Grantors with no will in the persisted plan: who "Will" may be added for. */
  willGrantors: readonly WillGrantor[];
  /** Every scenario write the editor makes, with the name of what was edited. */
  onTargetsWritten: (events: ScenarioWriteEvent[], label: string) => void;
  /** Switches the Solver's left pane to the tab that edits a change. */
  onOpenSolverTab: (tab: InputTab) => void;
  /** The current projection, for the LTC dialog's home-sale preview. */
  projectionYears?: ProjectionYear[];
  /** A change to open on arrival (the Stress row's "edit on the Changes tab"). */
  initialOpenChangeId?: string | null;
  /** Called once the pending change has been handled, so the caller clears it. */
  onInitialOpenConsumed?: () => void;
}

export function SolverChangesTab({
  clientId,
  panel,
  inventory,
  planTree,
  willGrantors,
  onTargetsWritten,
  onOpenSolverTab,
  projectionYears,
  initialOpenChangeId,
  onInitialOpenConsumed,
}: Props) {
  const { permission } = useClientAccess();
  const { openCreate } = useScenarioModeUI();
  const canEdit = permission === "edit";
  // `seq` remounts the editor on every click, so re-opening the same change
  // (or replacing a message) always starts a fresh load. `label` names what the
  // editor is about, for its own messages and for the draft-reconciliation notice.
  const [editing, setEditing] = useState<{ target: EditorHostTarget; seq: number; label: string } | null>(null);
  // A delete waits here for the advisor's confirmation before it reaches the host.
  const [confirming, setConfirming] = useState<InventoryItem | null>(null);
  // The LTC event has no Details page; its dialog is mounted here, not in the host.
  const [ltcEditing, setLtcEditing] = useState<{ event: LtcEvent; seq: number } | null>(null);

  // One-shot open on arrival, then tell the workspace the pending id is spent.
  useEffect(() => {
    if (!panel || !initialOpenChangeId) return;
    const change = panel.changes.find((c) => c.id === initialOpenChangeId);
    if (change && canEdit && isApplied(change)) openChange(change);
    onInitialOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot open on arrival
  }, [initialOpenChangeId]);

  if (!panel) {
    return (
      <>
        {canEdit && (
          <div className="mb-3">
            <SolverDetailActions
              inventory={inventory}
              disabled
              willGrantors={willGrantors}
              onAdd={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
            />
            <div className="flex items-center gap-3 text-[12px] text-ink-3">
              <span>Add, edit and delete work inside a scenario.</span>
              <button
                type="button"
                onClick={openCreate}
                className="h-7 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[12px] text-ink-2 hover:border-hair focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                Create scenario
              </button>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-hair bg-card p-6 text-center text-[12px] text-ink-3">
          Pick a scenario to see its changes.
        </div>
      </>
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
    if (target.surface === "ltc-event") {
      setLtcEditing((prev) => ({ event: target.event, seq: (prev?.seq ?? 0) + 1 }));
      return;
    }
    openEditor(target, labelFor(change, panel?.targetNames[`${change.targetKind}:${change.targetId}`], change.label));
  }

  function openEditor(target: EditorHostTarget, label: string) {
    setEditing((prev) => ({ target, label, seq: (prev?.seq ?? 0) + 1 }));
  }

  return (
    <>
      {canEdit && (
        <SolverDetailActions
          inventory={inventory}
          disabled={false}
          willGrantors={willGrantors}
          onAdd={(key: DetailTypeKey, variant?: CreateVariant) =>
            openEditor(detailEditorTarget(key, { intent: "create", variant }), detailType(key).label)
          }
          onEdit={(item) => openEditor(detailEditorTarget(item.typeKey, { intent: "edit", id: item.id }), item.label)}
          onDelete={setConfirming}
        />
      )}
      {confirming && (
        <SolverDeleteConfirm
          tree={planTree}
          inventory={inventory}
          item={confirming}
          scenarioName={panel.scenarioName}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            openEditor(detailEditorTarget(confirming.typeKey, { intent: "delete", id: confirming.id }), confirming.label);
            setConfirming(null);
          }}
        />
      )}
      {ltcEditing && (
        <LtcEventDialog
          key={ltcEditing.seq}
          clientId={clientId}
          scenarioId={panel.scenarioId}
          event={ltcEditing.event}
          tree={planTree}
          projectionYears={projectionYears ?? []}
          onDone={() => setLtcEditing(null)}
        />
      )}
      {editing && (
        <SolverChangeEditor
          key={editing.seq}
          clientId={clientId}
          scenarioId={panel.scenarioId}
          target={editing.target}
          label={editing.label}
          onDone={() => setEditing(null)}
          onWrite={(event) => onTargetsWritten([hostEvent(event, editing.target)], editing.label)}
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
        // Ruling F-M4: a jump to a Solver tab opens a tab, not an editor.
        openVerbFor={(c) => (resolveChangeEditor(c)?.surface === "solver-tab" ? "Open" : "Edit")}
      />
    </>
  );
}

/**
 * A plan_settings write carries the client id, but the draft levers it replaces
 * are keyed on the Assumptions tab the editor was opened on, so the event is
 * re-addressed to that focus id. The Tax Rates tab also writes the client's
 * workplace-coverage fields as a `client` edit; that is part of the same
 * settings save, so it is re-addressed too rather than superseding the
 * retirement-age and life-expectancy levers a `client` write would.
 */
function hostEvent(event: ScenarioWriteEvent, target: EditorHostTarget): ScenarioWriteEvent {
  if (target.surface !== "details" || target.focus.kind !== "plan_settings") return event;
  if (event.targetKind !== "plan_settings" && event.targetKind !== "client") return event;
  return { ...event, targetKind: "plan_settings", targetId: focusRowId(target.focus) ?? event.targetId };
}
