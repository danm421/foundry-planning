"use client";

// src/components/scenario/changes-panel-toggle-group-card.tsx
//
// One row per toggle group inside <ChangesPanel>'s ToggleGroupsSection.
// Collapsed by default — clicking the row toggles `expanded` to reveal the
// requires-group dropdown and the leaf rows for changes tagged with this
// group's id.
//
// The on/off toggle switch and the requires dropdown both PATCH the toggle-group
// route (`PATCH /api/clients/[id]/scenarios/[sid]/toggle-groups/[gid]`) and call
// `router.refresh()` so the panel rehydrates from the server.
//
// A hover-revealed × in the header opens an inline confirm strip with two
// destructive choices: keep the changes ungrouped (`?moveChangesTo=ungrouped`,
// the safest default) or cascade-delete them (`?moveChangesTo=delete`).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "@/components/icons";
import { ChangesPanelLeafRow } from "./changes-panel-leaf-row";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { ChangesPanelChange } from "./changes-panel";

export interface ToggleGroupCardProps {
  clientId: string;
  group: ToggleGroup;
  changes: ChangesPanelChange[];
  /** All toggle groups for this scenario; used to populate the Required dropdown. */
  allGroups: ToggleGroup[];
  /** See ChangesPanelProps.targetNames. */
  targetNames?: Record<string, string>;
}

export function ToggleGroupCard({
  clientId,
  group,
  changes,
  allGroups,
  targetNames,
}: ToggleGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [defaultOn, setDefaultOn] = useState(group.defaultOn);
  const [requiresGroupId, setRequiresGroupId] = useState<string>(
    group.requiresGroupId ?? "",
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  // A group can only require a top-level group (one whose own requiresGroupId
  // is null). This keeps the dependency graph one level deep, matching the
  // engine's resolveToggleStates contract. Self is also excluded.
  const candidateParents = allGroups.filter(
    (g) => g.id !== group.id && g.requiresGroupId == null,
  );

  async function patchGroup(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(
      `/api/clients/${clientId}/scenarios/${group.scenarioId}/toggle-groups/${group.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      router.refresh();
    }
    return res.ok;
  }

  async function deleteGroup(moveChangesTo: "ungrouped" | "delete") {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/scenarios/${group.scenarioId}/toggle-groups/${group.id}?moveChangesTo=${moveChangesTo}`,
        { method: "DELETE" },
      );
      if (!res.ok) return;
      router.refresh();
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div
      data-testid={`toggle-group-card-${group.id}`}
      className="border-b border-hair"
    >
      <div className="w-full px-4 py-3 flex items-center gap-2 hover:bg-paper/50 group">
        <ToggleSwitch
          on={defaultOn}
          onChange={(v) => {
            setDefaultOn(v);
            void patchGroup({ defaultOn: v }).then((ok) => {
              if (!ok) setDefaultOn(!v);
            });
          }}
        />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 min-w-0 flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
          aria-expanded={expanded}
        >
          <span className="text-[14px] text-ink flex-1 truncate">
            {group.name}
          </span>
          <span className="text-xs text-ink-3 font-mono tabular-nums">
            {changes.length}
          </span>
          <span className="text-ink-3" aria-hidden="true">
            {expanded ? "▴" : "▾"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Delete technique ${group.name}`}
          title="Delete technique"
          className="opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-ink hover:text-ink flex items-center justify-center rounded p-1 shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <TrashIcon width={16} height={16} aria-hidden="true" />
        </button>
      </div>
      {confirmingDelete && (
        <div
          data-testid={`toggle-group-confirm-delete-${group.id}`}
          className="px-4 py-3 border-t border-hair bg-crit/10"
        >
          <div className="text-sm text-ink mb-2">
            Delete &ldquo;{group.name}&rdquo;?
            {changes.length > 0 ? (
              <span className="text-ink-2">
                {" "}
                {changes.length} change{changes.length === 1 ? "" : "s"} are tagged
                with this technique.
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void deleteGroup("ungrouped")}
              disabled={deleting}
              className="h-7 px-3 rounded bg-accent text-accent-on text-[12px] font-medium hover:bg-accent-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {changes.length > 0 ? "Keep changes (ungroup)" : "Delete technique"}
            </button>
            {changes.length > 0 && (
              <button
                type="button"
                onClick={() => void deleteGroup("delete")}
                disabled={deleting}
                className="h-7 px-3 rounded bg-crit/80 text-ink text-[12px] font-medium hover:bg-crit/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Delete changes too
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="h-7 px-3 rounded text-[12px] text-ink-3 hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div data-testid={`toggle-group-card-body-${group.id}`}>
          <div className="px-4 py-2 text-xs text-ink-3">
            <label className="flex items-center gap-2">
              <span>Required:</span>
              <select
                value={requiresGroupId}
                onChange={(e) => {
                  const prev = requiresGroupId;
                  const v = e.target.value || null;
                  setRequiresGroupId(e.target.value);
                  void patchGroup({ requiresGroupId: v }).then((ok) => {
                    if (!ok) setRequiresGroupId(prev);
                  });
                }}
                className="bg-transparent border border-hair text-ink-2 rounded px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                aria-label="Required parent group"
              >
                <option value="">(none)</option>
                {candidateParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {changes.length === 0 ? (
            <div className="px-4 py-2 text-xs text-ink-3 italic">
              No changes recorded yet.
            </div>
          ) : (
            changes.map((c) => (
              <ChangesPanelLeafRow
                key={c.id}
                clientId={clientId}
                scenarioId={group.scenarioId}
                change={c}
                enabled={c.enabled}
                targetName={targetNames?.[`${c.targetKind}:${c.targetId}`]}
                customLabel={c.label}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      aria-pressed={on}
      aria-label={on ? "Toggle group on" : "Toggle group off"}
      className={`w-8 h-4 rounded-full border transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        on ? "bg-accent border-accent" : "bg-transparent border-hair"
      }`}
    >
      <span
        className={`block w-3 h-3 rounded-full transition ${
          on ? "bg-paper ml-4" : "bg-ink-4 ml-0"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
