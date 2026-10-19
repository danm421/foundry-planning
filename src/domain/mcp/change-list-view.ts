// src/domain/mcp/change-list-view.ts
//
// A fact finder review's change list as Claude reads it: what saving creates
// and changes in the plan, each field from its value on record to the new one,
// and what can't save and why. Values print as the screen's change list prints
// them — the review's own `shown` text (placement/values.ts formatValue) — and
// a line with no changes is left out, as the screen folds it away. Pure.
//
// Not under the terminology test's allowlisted `tools/` prefix: no text here
// names the second person.
import { countLines, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { TARGETS } from "@/lib/fact-finder/placement/targets";
import { EMPTY } from "@/lib/fact-finder/placement/values";

export interface ChangeListField {
  key: string;
  label: string;
  /** The value on record; null on a new record, or when the record has none. */
  from: string | null;
  to: string;
  /** Saved unless the advisor leaves it out (the ticks). */
  included: boolean;
}

export interface ChangeListLine {
  lineId: string;
  action: "create" | "update";
  /** The kind of record: "Account", "Income"… */
  what: string;
  label: string;
  fields: ChangeListField[];
  /** Why the line can't save; nothing on it is saved. */
  cannotSave?: string;
  /** Placed by the review's AI step from free text. */
  aiPlaced?: true;
}

export interface ChangeListView {
  /** The version the save takes. */
  changeSetVersion: number;
  lines: ChangeListLine[];
  /** The change list's notices, then each line's warnings, named by its line. */
  warnings: string[];
  counts: { create: number; update: number; cannotSave: number };
}

export function changeListView(changeSet: ChangeSet, ticks: ChangeTicks): ChangeListView {
  const lines = changeSet.lines
    .filter((line) => line.action !== "none" || line.blocked)
    .map(
      (line): ChangeListLine => ({
        lineId: line.id,
        action: line.action === "create" ? "create" : "update",
        what: TARGETS[line.target].label,
        label: line.label,
        fields: line.fields.map(({ key, label, shown }) => ({
          key,
          label,
          from: shown.onRecord === undefined || shown.onRecord === EMPTY ? null : shown.onRecord,
          to: shown.next,
          included: ticks[line.id]?.[key] === true,
        })),
        ...(line.blocked ? { cannotSave: line.blocked.reason } : {}),
        ...(line.aiPlaced ? { aiPlaced: true as const } : {}),
      }),
    );
  const { creates, updates, blocked } = countLines(changeSet.lines);
  return {
    changeSetVersion: changeSet.builtAtVersion,
    lines,
    warnings: [...changeSet.notices, ...changeSet.lines.flatMap((line) => line.warnings.map((w) => `${line.label}: ${w}`))],
    counts: { create: creates, update: updates, cannotSave: blocked },
  };
}
