"use client";

// src/components/scenario/changes-panel-group-editor.tsx
//
// Inline editor that replaces the right-rail Changes panel body when the user
// opens a toggle group for editing. Lets the user pick a target group from a
// dropdown, edit its Members and Individuals, stage the result, and commit
// (or cancel) the batch when Done is clicked.
//
// Currently in: skeleton + dropdown, Members/Individuals sections, stage map +
// commit-on-Done flow, inline rename, and the zero-groups + New-group flows.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { ChangesPanelChange } from "./changes-panel";

const NEW_GROUP_SENTINEL = "__new__";

export interface GroupEditorProps {
  clientId: string;
  scenarioId: string;
  changes: ChangesPanelChange[];
  groups: ToggleGroup[];
  targetNames?: Record<string, string>;
  onClose: () => void;
}

export function GroupEditor({
  clientId,
  scenarioId,
  changes,
  groups,
  targetNames,
  onClose,
}: GroupEditorProps) {
  const router = useRouter();
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.orderIndex - b.orderIndex),
    [groups],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    sortedGroups[0]?.id ?? null,
  );
  // changeId → effective toggleGroupId | null; absence = unchanged from DB
  const [stage, setStage] = useState<Map<string, string | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creatingNew, setCreatingNew] = useState(sortedGroups.length === 0);
  const [newName, setNewName] = useState("");

  const selectedGroup =
    sortedGroups.find((g) => g.id === selectedGroupId) ?? null;

  function startRename() {
    if (!selectedGroup) return;
    setRenameValue(selectedGroup.name);
    setRenaming(true);
  }

  async function createNewGroup() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/scenarios/${scenarioId}/toggle-groups`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, defaultOn: true }),
        },
      );
      if (!res.ok) {
        console.error(
          `[GroupEditor] toggle-groups POST failed: ${res.status}`,
        );
        return;
      }
      const { group } = (await res.json()) as { group: { id: string } };
      setSelectedGroupId(group.id);
      setCreatingNew(false);
      setNewName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    const name = renameValue.trim();
    if (!name || !selectedGroupId) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/scenarios/${scenarioId}/toggle-groups/${selectedGroupId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
      setRenaming(false);
    }
  }

  function effectiveGroupId(c: ChangesPanelChange): string | null {
    if (stage.has(c.id)) return stage.get(c.id) ?? null;
    return c.toggleGroupId ?? null;
  }

  const members = changes.filter((c) => effectiveGroupId(c) === selectedGroupId);
  const individuals = changes.filter((c) => effectiveGroupId(c) !== selectedGroupId);

  function toggleMembership(changeId: string, currentlyMember: boolean) {
    const original = changes.find((c) => c.id === changeId)?.toggleGroupId ?? null;
    const target = currentlyMember ? null : selectedGroupId;
    setStage((prev) => {
      const next = new Map(prev);
      if (target === original) next.delete(changeId);
      else next.set(changeId, target);
      return next;
    });
  }

  async function commit() {
    if (stage.size === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setCommitError(null);
    try {
      // Fan out PATCHes in parallel, then inspect the results.
      const results = await Promise.all(
        Array.from(stage.entries()).map(async ([cid, gid]) => {
          const url = `/api/clients/${clientId}/scenarios/${scenarioId}/changes/${cid}`;
          const res = await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toggleGroupId: gid }),
          });
          return { cid, ok: res.ok, status: res.status };
        }),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        const succeeded = results.length - failed.length;
        const prefix = succeeded > 0 ? `${succeeded} of ${results.length} saved. ` : "";
        const codes = failed.map((r) => r.status).join(", ");
        setCommitError(`${prefix}${failed.length} save(s) failed (HTTP ${codes}). Please retry.`);
        // Refresh so changes that DID land reload as the new baseline, but keep
        // the panel open so the user sees the error and can retry the rest.
        router.refresh();
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (creatingNew) {
    const isFirst = sortedGroups.length === 0;
    return (
      <div data-testid="group-editor" className="flex flex-col flex-1">
        <div className="p-4 flex items-center gap-2">
          <input
            autoFocus
            aria-label={isFirst ? "Name your first group" : "New group name"}
            placeholder={isFirst ? "Name your first group" : "New group name"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createNewGroup();
            }}
            className="flex-1 bg-transparent border border-hair rounded px-2 h-7 text-[13px] text-ink"
          />
          <button
            type="button"
            onClick={createNewGroup}
            disabled={busy || !newName.trim()}
            className="h-7 px-3 rounded bg-accent text-accent-on text-[12px] disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <div className="flex-1" />
        <div className="sticky bottom-0 z-10 bg-card border-t border-hair p-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-7 px-3 rounded border border-hair text-[12px] text-ink-3 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="group-editor" className="flex flex-col flex-1">
      <div className="px-4 py-3 border-b border-hair flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            aria-label="Group name"
            disabled={busy}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
            className="flex-1 bg-transparent border border-hair rounded px-2 h-7 text-[13px] text-ink disabled:opacity-50"
          />
        ) : (
          <>
            <select
              aria-label="Select group to edit"
              value={selectedGroupId ?? ""}
              onChange={(e) => {
                if (e.target.value === NEW_GROUP_SENTINEL) {
                  setCreatingNew(true);
                  setNewName("");
                  return;
                }
                setSelectedGroupId(e.target.value);
              }}
              className="flex-1 bg-transparent border border-hair rounded px-2 h-7 text-[13px] text-ink"
            >
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value={NEW_GROUP_SENTINEL}>+ New group</option>
            </select>
            <button
              type="button"
              onClick={startRename}
              aria-label="Rename group"
              disabled={busy}
              className="h-7 px-2 rounded border border-hair text-[12px] text-ink-3 disabled:opacity-50"
              title="Rename"
            >
              ✎
            </button>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* Flat keyed array (not two <div> blocks) so a row migrating between
            Members and Individuals keeps its DOM identity — React scopes keys
            per-array, so split sections would unmount/remount on every toggle. */}
        {[
          <div
            key="__members-header"
            className="px-4 py-2 text-xs tracking-[0.18em] text-accent uppercase font-mono"
          >
            MEMBERS
          </div>,
          members.length === 0 ? (
            <div key="__members-empty" className="px-4 py-3 text-xs text-ink-3">
              No changes in this group yet.
            </div>
          ) : null,
          ...members.map((c) => (
            <EditorRow
              key={c.id}
              change={c}
              checked
              onToggle={() => toggleMembership(c.id, true)}
              targetNames={targetNames}
            />
          )),
          <div
            key="__individuals-header"
            className="px-4 py-2 text-xs tracking-[0.18em] text-accent uppercase font-mono border-t border-hair"
          >
            INDIVIDUALS — {individuals.length}
          </div>,
          ...individuals.map((c) => (
            <EditorRow
              key={c.id}
              change={c}
              checked={false}
              onToggle={() => toggleMembership(c.id, false)}
              targetNames={targetNames}
            />
          )),
        ]}
      </div>
      <div className="sticky bottom-0 z-10 bg-card border-t border-hair p-3 flex flex-col gap-2">
        {commitError && (
          <p className="text-xs text-red-400">{commitError}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-7 px-3 rounded border border-hair text-[12px] text-ink-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="h-7 px-3 rounded bg-accent text-accent-on text-[12px] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorRow({
  change,
  checked,
  onToggle,
  targetNames,
}: {
  change: ChangesPanelChange;
  checked: boolean;
  onToggle: () => void;
  targetNames?: Record<string, string>;
}) {
  const name =
    targetNames?.[`${change.targetKind}:${change.targetId}`] ??
    `${change.targetKind} — ${change.targetId.slice(0, 8)}`;
  return (
    <label
      data-testid={`editor-row-${change.id}`}
      className="flex items-center gap-3 px-4 py-2 text-[13px] text-ink hover:bg-card-hover cursor-pointer"
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span>{name}</span>
    </label>
  );
}
