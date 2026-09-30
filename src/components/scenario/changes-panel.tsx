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
  /** User rename; null = use computed smart label. */
  label: string | null;
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
  /** Extra classes merged onto the root aside (e.g. `h-full` in the drawer). */
  className?: string;
  /**
   * `rail` (default) is the 360px right-edge drawer used today; its markup is
   * unchanged. `embedded` is for mounting the panel inside a host layout (the
   * Solver's left-pane Changes tab) — it drops the fixed width
   * and left border for `w-full`.
   */
  variant?: "rail" | "embedded";
  /**
   * Opens a change's full editor (the Solver's Changes tab). When provided,
   * leaf-row titles become clickable, gated per-row by `canOpenChange`.
   */
  onOpenChange?: (change: ChangesPanelChange) => void;
  /** Per-row gate for `onOpenChange`. Absent → every row is openable. */
  canOpenChange?: (change: ChangesPanelChange) => boolean;
  /** Per-row verb for the open button's accessible name. Absent → "Edit". */
  openVerbFor?: (change: ChangesPanelChange) => "Edit" | "Open";
}

/**
 * Ready-to-call open callback for a leaf row: undefined when no `onOpenChange`
 * was given, or when a supplied `canOpenChange` returns false for this
 * change. Absent `canOpenChange`, every change is openable. Shared by
 * `UngroupedSection` and `ToggleGroupCard` so both gate the same way.
 */
export function resolveOnOpen(
  change: ChangesPanelChange,
  onOpenChange?: (change: ChangesPanelChange) => void,
  canOpenChange?: (change: ChangesPanelChange) => boolean,
): (() => void) | undefined {
  if (!onOpenChange) return undefined;
  if (canOpenChange && !canOpenChange(change)) return undefined;
  return () => onOpenChange(change);
}

export function ChangesPanel({
  clientId,
  scenarioId,
  scenarioName,
  changes,
  toggleGroups,
  cascadeWarnings,
  targetNames,
  className = "",
  variant = "rail",
  onOpenChange,
  canOpenChange,
  openVerbFor,
}: ChangesPanelProps) {
  const [editing, setEditing] = useState(false);

  const ungrouped = [...changes]
    .filter((c) => c.toggleGroupId == null)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  const asideClassName =
    variant === "embedded"
      ? `w-full border-hair bg-card flex flex-col ${className}`
      : `w-[360px] shrink-0 border-l border-hair bg-card flex flex-col ${className}`;

  return (
    <aside className={asideClassName}>
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
            onOpenChange={onOpenChange}
            canOpenChange={canOpenChange}
            openVerbFor={openVerbFor}
          />
          <UngroupedSection
            clientId={clientId}
            scenarioId={scenarioId}
            changes={ungrouped}
            targetNames={targetNames}
            onOpenChange={onOpenChange}
            canOpenChange={canOpenChange}
            openVerbFor={openVerbFor}
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
    <div className="px-4 py-3 border-b border-hair">
      <div className="text-xs tracking-[0.18em] text-accent uppercase font-mono mb-1">
        §.06 · CHANGES
      </div>
      <div className="text-[16px] text-ink mb-1">{scenarioName}</div>
      <div className="text-xs text-ink-3">
        {changesCount} change{changesCount === 1 ? "" : "s"} · {groupsCount} toggle
        group{groupsCount === 1 ? "" : "s"}
      </div>
      <button
        type="button"
        onClick={onOpenEditor}
        className="mt-3 px-3 h-7 rounded-full bg-accent text-accent-on text-[12px] font-medium hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
  onOpenChange,
  canOpenChange,
  openVerbFor,
}: {
  clientId: string;
  groups: ToggleGroup[];
  changes: ChangesPanelChange[];
  targetNames?: Record<string, string>;
  onOpenChange?: (change: ChangesPanelChange) => void;
  canOpenChange?: (change: ChangesPanelChange) => boolean;
  openVerbFor?: (change: ChangesPanelChange) => "Edit" | "Open";
}) {
  if (groups.length === 0) return null;
  // Sort by orderIndex asc for stable rendering (matches API GET order).
  const sortedGroups = [...groups].sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <div className="border-b border-hair">
      <div className="px-4 py-2 text-xs tracking-[0.18em] text-accent uppercase font-mono">
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
          onOpenChange={onOpenChange}
          canOpenChange={canOpenChange}
          openVerbFor={openVerbFor}
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
  onOpenChange,
  canOpenChange,
  openVerbFor,
}: {
  clientId: string;
  scenarioId: string;
  changes: ChangesPanelChange[];
  targetNames?: Record<string, string>;
  onOpenChange?: (change: ChangesPanelChange) => void;
  canOpenChange?: (change: ChangesPanelChange) => boolean;
  openVerbFor?: (change: ChangesPanelChange) => "Edit" | "Open";
}) {
  if (changes.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-ink-3 text-center">
        No changes yet. Edits in scenario mode will appear here.
      </div>
    );
  }
  return (
    <div className="border-b border-hair">
      <div className="px-4 py-2 text-xs tracking-[0.18em] text-accent uppercase font-mono">
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
          customLabel={c.label}
          onOpen={resolveOnOpen(c, onOpenChange, canOpenChange)}
          openVerb={openVerbFor?.(c)}
        />
      ))}
    </div>
  );
}
