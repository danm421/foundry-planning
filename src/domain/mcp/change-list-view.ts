// src/domain/mcp/change-list-view.ts
//
// A fact finder review's change list as Claude reads it: what saving creates
// and changes in the plan, each field from its value on record to the new one,
// what can't save and why, and what the save would leave out with these ticks
// and why — the save's own plan, as the screen runs it before saving. Values
// print as the screen's change list prints them — the review's own `shown`
// text (placement/values.ts formatValue) — and a line with no changes is left
// out, as the screen folds it away. Pure.
//
// Not under the terminology test's allowlisted `tools/` prefix: no text here
// names the second person (a reason is the save's own, passed through, R29).
import { countLines, type ChangeAction, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { TARGETS } from "@/lib/fact-finder/placement/targets";
import { EMPTY } from "@/lib/fact-finder/placement/values";
import { planSave } from "@/lib/fact-finder/save/plan";

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
  /** "none" only on a line that can't save. */
  action: ChangeAction;
  /** The kind of record: "Account", "Income"… */
  what: string;
  label: string;
  fields: ChangeListField[];
  /** Why the line can't save; nothing on it is saved. */
  cannotSave?: string;
  /** Why the save leaves the line out with these ticks, in the save's own words. */
  leftOut?: string;
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
  // The save's plan on these ticks, as the screen's ChangeList runs it: what it leaves out, with each reason.
  const plan = planSave(changeSet, ticks, { hasCoClient: changeSet.hasCoClient ?? false });
  const leftOut = new Map(plan.ok ? plan.leftOut.map((l) => [l.lineId, l.reason] as const) : []);
  const lines = changeSet.lines
    .filter((line) => line.action !== "none" || line.blocked)
    .map(
      (line): ChangeListLine => ({
        lineId: line.id,
        action: line.action,
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
        ...(leftOut.has(line.id) ? { leftOut: leftOut.get(line.id) } : {}),
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
