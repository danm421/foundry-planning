"use client";

// "Not saved yet": every unsaved Solver entry, controls and held editor changes
// alike, one row per switch. Rows borrow the saved-change row look
// (changes-panel-leaf-row): switch, text, and a discard ×.

import { useMemo } from "react";
import type { ClientData } from "@/engine/types";
import { ToggleSwitch } from "@/components/scenario/changes-panel-leaf-row";
import { resolveChangeEditor } from "@/lib/scenario/change-editor-target";
import { isHeldChange } from "@/lib/solver/held-changes";
import { isEstateMutation, offEntryKeys, switchGroupOf } from "@/lib/solver/switch-groups";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import { describeSolverMutation, heldChangeLine, heldLabel, mutationNames } from "./describe-solver-mutation";
import type { EditorHostTarget } from "./solver-change-editor";
import type { InputTab } from "./report-tab-link";

export interface UnsavedChangesListProps {
  /** Every entry, on or off. */
  all: SolverMutation[];
  offGroups: ReadonlySet<string>;
  /** Names for edits and removes. */
  sourceTree: ClientData;
  /** For mutationNames: the working copy's names win. */
  workingTree: ClientData;
  canEdit: boolean;
  onSetGroupOn: (groupId: string, on: boolean) => void;
  onDiscard: (key: SolverMutationKey) => void;
  onOpenHeld: (target: EditorHostTarget, label: string) => void;
  onOpenSolverTab: (tab: InputTab) => void;
}

const TECHNIQUE_KINDS: ReadonlySet<SolverMutation["kind"]> = new Set([
  "roth-conversion-upsert",
  "asset-transaction-upsert",
  "reinvestment-upsert",
  "relocation-upsert",
  "debt-paydown",
]);

/** The Solver tab where a control is set. Lives here because `src/lib/solver`
 *  must not import from the app folder. */
export function solverTabOf(m: SolverMutation, all: readonly SolverMutation[]): InputTab {
  if (m.kind.startsWith("stress-")) return "stress_test";
  if (TECHNIQUE_KINDS.has(m.kind) || isEstateMutation(m, all)) return "techniques";
  return "retirement";
}

interface Item {
  entry: SolverMutation;
  title: string;
  /** What the title does when pressed, or null for plain text. */
  open: (() => void) | null;
}

export function UnsavedChangesList({
  all,
  offGroups,
  sourceTree,
  workingTree,
  canEdit,
  onSetGroupOn,
  onDiscard,
  onOpenHeld,
  onOpenSolverTab,
}: UnsavedChangesListProps) {
  const names = useMemo(() => mutationNames(sourceTree, workingTree), [sourceTree, workingTree]);
  const off = useMemo(() => offEntryKeys(all, offGroups, sourceTree), [all, offGroups, sourceTree]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, SolverMutation[]>();
    for (const m of all) {
      const id = switchGroupOf(m, all, sourceTree);
      const members = byGroup.get(id);
      if (members) members.push(m);
      else byGroup.set(id, [m]);
    }
    return [...byGroup];
  }, [all, sourceTree]);

  function heldItem(m: Extract<SolverMutation, { kind: "held-change" }>): Item {
    const name = heldLabel(m, names.rows);
    const title = heldChangeLine(m, names.rows);
    let open: (() => void) | null = null;
    if (canEdit && m.op !== "remove") {
      const target = resolveChangeEditor({
        opType: m.op,
        targetKind: m.targetKind,
        targetId: m.targetId,
        payload: m.payload,
        enabled: true,
      });
      if (target?.surface === "details") open = () => onOpenHeld(target, name);
      else if (target?.surface === "solver-tab") open = () => onOpenSolverTab(target.tab);
    }
    return { entry: m, title, open };
  }

  function row(item: Item, switchTitle: string, on: boolean, dimmed: boolean, groupId: string, discardKeys: SolverMutationKey[], testId: string, sub = false) {
    return (
      <div
        key={testId}
        data-testid={testId}
        className={`flex items-start gap-2 py-2 pr-4 ${sub ? "pl-10" : "pl-4"} ${dimmed ? "opacity-60" : ""}`}
      >
        {!sub && (
          <ToggleSwitch on={on} onChange={(next) => onSetGroupOn(groupId, next)} label={`Include ${switchTitle}`} />
        )}
        <div className="min-w-0 flex-1">
          {item.open ? (
            <button
              type="button"
              onClick={item.open}
              className="w-full truncate rounded text-left text-sm text-ink hover:text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {item.title}
            </button>
          ) : (
            <div className="truncate text-sm text-ink">{item.title}</div>
          )}
        </div>
        <DiscardButton title={item.title} keys={discardKeys} onDiscard={onDiscard} />
      </div>
    );
  }

  return (
    <div className="mb-4 divide-y divide-hair rounded-lg border border-hair bg-card">
      {groups.map(([groupId, entries]) => {
        // The switch shows this row's own group; dimming shows the effective state,
        // which also covers entries that name something a switched-off item creates.
        const on = !offGroups.has(groupId);
        const dimmed = entries.every((m) => off.has(mutationKey(m)));
        const first = entries[0];

        if (isHeldChange(first)) {
          const items = entries.filter(isHeldChange).map(heldItem);
          if (items.length === 1) {
            return row(items[0], items[0].title, on, dimmed, groupId, [mutationKey(first)], `unsaved-row-${groupId}`);
          }
          return (
            <div key={groupId} data-testid={`unsaved-row-${groupId}`} className={dimmed ? "opacity-60" : ""}>
              <div className="flex items-start gap-2 px-4 py-2">
                <ToggleSwitch
                  on={on}
                  onChange={(next) => onSetGroupOn(groupId, next)}
                  label={`Include ${items.length} changes saved together`}
                />
                <div className="text-sm text-ink-2">{items.length} changes saved together</div>
              </div>
              {items.map((item) => {
                const key = mutationKey(item.entry);
                return row(item, item.title, on, dimmed, groupId, [key], `unsaved-item-${key}`, true);
              })}
            </div>
          );
        }

        const base = describeSolverMutation(first, names);
        const title = entries.length > 1 ? `${base} +${entries.length - 1} linked` : base;
        const item: Item = {
          entry: first,
          title,
          open: canEdit ? () => onOpenSolverTab(solverTabOf(first, all)) : null,
        };
        return row(item, title, on, dimmed, groupId, entries.map(mutationKey), `unsaved-row-${groupId}`);
      })}
    </div>
  );
}

function DiscardButton({
  title,
  keys,
  onDiscard,
}: {
  title: string;
  keys: SolverMutationKey[];
  onDiscard: (key: SolverMutationKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => keys.forEach((k) => onDiscard(k))}
      aria-label={`Discard ${title}`}
      title="Discard this change"
      className="shrink-0 rounded px-1 text-ink-3 hover:text-crit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
