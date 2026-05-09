"use client";

// src/components/scenario/changes-panel.tsx
//
// Right-rail aside that lists every scenario_change for the active scenario,
// per parent-spec §5.7. The header carries scenario name, change/group counts,
// and a `Group` button that swaps the body for an inline <GroupEditor> — the
// single entry point for creating/editing toggle groups. When the editor is
// closed, the body shows the toggle-groups section followed by the ungrouped
// section. A collapsible <CascadeWarningsChip> footer surfaces any cascade
// warnings with per-warning [Restore] buttons.
//
// The panel is mounted by the client-data layout when a `?scenario=<id>` query
// param resolves to a non-base scenario in this firm. All data is fetched
// server-side; this component renders those props, owning only the local UI
// state (editor open flag, cascade-chip expanded flag).

import { useState } from "react";
import type {
  ScenarioChange,
  ToggleGroup,
  CascadeWarning,
} from "@/engine/scenario/types";
import { ChangesPanelLeafRow } from "./changes-panel-leaf-row";
import { ToggleGroupCard } from "./changes-panel-toggle-group-card";
import { CascadeWarningsChip } from "./changes-panel-cascade-warnings";
import { GroupEditor } from "./changes-panel-group-editor";

/**
 * Panel-only widening of the engine's `ScenarioChange`. The DB row carries an
 * `updatedAt` timestamp the engine type drops (the engine works on the
 * in-memory shape; the panel sorts by updatedAt desc), and an `enabled` flag
 * that is filtered out before the engine ever runs (`loadScenarioChanges`
 * drops `enabled = false` rows at the SQL layer). Disabled rows still surface
 * here because the panel queries the table directly so the toggle stays
 * visible in its off position.
 */
export type ChangesPanelChange = ScenarioChange & {
  updatedAt: Date | string;
  enabled: boolean;
};

export interface ChangesPanelProps {
  clientId: string;
  scenarioId: string;
  scenarioName: string;
  changes: ChangesPanelChange[];
  toggleGroups: ToggleGroup[];
  cascadeWarnings: CascadeWarning[];
  /**
   * Map of `${targetKind}:${targetId}` → display name, built in
   * `loadPanelData` from the effective tree. Leaf rows look up here so
   * users see "Income — Salary" instead of "Income — 5b0eb216".
   */
  targetNames?: Record<string, string>;
}

export function ChangesPanel({
  clientId,
  scenarioId,
  scenarioName,
  changes,
  toggleGroups,
  cascadeWarnings,
  targetNames,
}: ChangesPanelProps) {
  const [editing, setEditing] = useState(false);

  const ungrouped = [...changes]
    .filter((c) => c.toggleGroupId == null)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return (
    <aside className="w-[360px] shrink-0 border-l border-[#1f2024] bg-[#101114] flex flex-col">
      <PanelHeader
        scenarioName={scenarioName}
        changesCount={changes.length}
        groupsCount={toggleGroups.length}
        onOpenEditor={() => setEditing(true)}
      />
      {editing ? (
        <GroupEditor
          clientId={clientId}
          scenarioId={scenarioId}
          changes={changes}
          groups={toggleGroups}
          targetNames={targetNames}
          onClose={() => setEditing(false)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ToggleGroupsSection
            clientId={clientId}
            groups={toggleGroups}
            changes={changes}
            targetNames={targetNames}
          />
          <UngroupedSection
            clientId={clientId}
            scenarioId={scenarioId}
            changes={ungrouped}
            targetNames={targetNames}
          />
        </div>
      )}
      <CascadeWarningsChip
        clientId={clientId}
        scenarioId={scenarioId}
        warnings={cascadeWarnings}
        changes={changes}
      />
    </aside>
  );
}

function PanelHeader({
  scenarioName,
  changesCount,
  groupsCount,
  onOpenEditor,
}: {
  scenarioName: string;
  changesCount: number;
  groupsCount: number;
  onOpenEditor: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-[#1f2024]">
      <div className="text-xs tracking-[0.18em] text-[#7a5b29] uppercase font-mono mb-1">
        §.06 · CHANGES
      </div>
      <div className="text-[16px] text-[#e7e6e2] mb-1">{scenarioName}</div>
      <div className="text-xs text-[#a09c92]">
        {changesCount} change{changesCount === 1 ? "" : "s"} · {groupsCount} toggle
        group{groupsCount === 1 ? "" : "s"}
      </div>
      <button
        type="button"
        onClick={onOpenEditor}
        className="mt-3 px-3 h-7 rounded-full bg-[#d4a04a] text-[#0b0c0f] text-[12px] font-medium hover:bg-[#c69544] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Group
      </button>
    </div>
  );
}

function ToggleGroupsSection({
  clientId,
  groups,
  changes,
  targetNames,
}: {
  clientId: string;
  groups: ToggleGroup[];
  changes: ChangesPanelChange[];
  targetNames?: Record<string, string>;
}) {
  if (groups.length === 0) return null;
  // Sort by orderIndex asc for stable rendering (matches API GET order).
  const sortedGroups = [...groups].sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <div className="border-b border-[#1f2024]">
      <div className="px-4 py-2 text-xs tracking-[0.18em] text-[#7a5b29] uppercase font-mono">
        TOGGLE GROUPS — {sortedGroups.length}
      </div>
      {sortedGroups.map((g) => (
        <ToggleGroupCard
          key={g.id}
          clientId={clientId}
          group={g}
          changes={changes.filter((c) => c.toggleGroupId === g.id)}
          allGroups={sortedGroups}
          targetNames={targetNames}
        />
      ))}
    </div>
  );
}

function UngroupedSection({
  clientId,
  scenarioId,
  changes,
  targetNames,
}: {
  clientId: string;
  scenarioId: string;
  changes: ChangesPanelChange[];
  targetNames?: Record<string, string>;
}) {
  if (changes.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-[#a09c92] text-center">
        No changes yet. Edits in scenario mode will appear here.
      </div>
    );
  }
  return (
    <div className="border-b border-[#1f2024]">
      <div className="px-4 py-2 text-xs tracking-[0.18em] text-[#7a5b29] uppercase font-mono">
        UNGROUPED — {changes.length}
      </div>
      {changes.map((c) => (
        <ChangesPanelLeafRow
          key={c.id}
          clientId={clientId}
          scenarioId={scenarioId}
          change={c}
          enabled={c.enabled}
          targetName={targetNames?.[`${c.targetKind}:${c.targetId}`]}
        />
      ))}
    </div>
  );
}
