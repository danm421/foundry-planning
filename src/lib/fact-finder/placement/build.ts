// src/lib/fact-finder/placement/build.ts
/**
 * Pass 2 (D12): the fact finder → its change list. Every row placed (D4, D5),
 * what's left over sent to the AI step once (D10), drafts diffed against the
 * record book (D8) and checked against the Details write path (D9) — an AI
 * value those checks refuse becomes a plan note instead of blocking its line;
 * then what can't save together is blocked: two lines changing one field of
 * one record, and every line that needs a line which can't save. Server-side
 * only (it imports validate.ts); the AI call is passed in.
 */
import type { CellRef, ChangeLine, ChangeSet, TargetKind } from "../change-set";
import { findSection } from "../schema";
import { locateRow, rowLabel } from "../state";
import type { FactFinderState } from "../types";
import { diffDrafts } from "./diff";
import { applyLeftovers, type LeftoversOutput } from "./leftovers";
import { columnFeeding } from "./map/index";
import { placeFactFinder } from "./place";
import { TARGETS } from "./targets";
import type { LeftoverItem, RecordBook, TargetDraft } from "./types";
import { validateLines } from "./validate";

export async function buildChangeSet(input: {
  state: FactFinderState;
  book: RecordBook;
  now: Date;
  runLeftovers: (items: readonly LeftoverItem[], drafts: readonly TargetDraft[]) => Promise<LeftoversOutput | null>;
}): Promise<Omit<ChangeSet, "builtAtVersion">> {
  const { state, book, now, runLeftovers } = input;
  const placed = placeFactFinder(state, book, now);
  const output = placed.leftovers.length > 0 ? await runLeftovers(placed.leftovers, placed.drafts) : null;
  const check = (answers: LeftoversOutput | null) => {
    const ai = applyLeftovers(placed.leftovers, placed.drafts, answers, book);
    return { notices: ai.notices, lines: validateLines(diffDrafts(ai.drafts, book), feeding) };
  };
  let checked = check(output);
  // An AI value the Details checks refuse never blocks its line: built again without that answer, the item becomes a
  // plan note in its own words, as any refused proposal does.
  const refused = blockedOnlyByAi(checked.lines, placed.leftovers);
  if (output && refused.size > 0) checked = check({ items: output.items.filter((a) => !refused.has(a.itemId)) });
  return {
    builtAt: now.toISOString(),
    lines: blockDependents(blockSameField(checked.lines), state),
    notices: [...placed.notices, ...checked.notices],
  };
}

const feeding = (line: ChangeLine, key: string) => columnFeeding(line.sectionId, line.target, key);
const sameCell = (a: CellRef, b: CellRef | undefined) =>
  b !== undefined && a.sectionId === b.sectionId && a.rowId === b.rowId && a.columnId === b.columnId;

/** The items whose AI values are all that blocks their line: without the line's AI fields, it passes the Details checks. */
function blockedOnlyByAi(lines: readonly ChangeLine[], items: readonly LeftoverItem[]): Set<string> {
  const refused = new Set<string>();
  for (const line of lines) {
    const aiFields = line.fields.filter((f) => f.ai);
    if (!line.blocked || aiFields.length === 0) continue;
    const without: ChangeLine = { ...line, blocked: undefined, fields: line.fields.filter((f) => !f.ai) };
    if (validateLines([without], feeding)[0].blocked) continue;
    for (const field of aiFields) {
      const item = items.find((i) => sameCell(i.cell, field.from[0]));
      if (item) refused.add(item.id);
    }
  }
  return refused;
}

/**
 * Two update lines on one record that both change a field (an Other Expenses
 * row linked to the business expense the Business row also sets): neither
 * saves until one lets it go. Lines on one record with different fields (the
 * household's lines) save side by side.
 */
function blockSameField(lines: readonly ChangeLine[]): ChangeLine[] {
  return lines.map((line) => {
    if (line.blocked || line.action !== "update") return line;
    for (const field of line.fields) {
      const other = lines.find(
        (o) => o !== line && o.action === "update" && o.target === line.target && o.recordId === line.recordId && o.fields.some((f) => f.key === field.key),
      );
      if (!other) continue;
      const reason = `"${line.label}" and "${other.label}" both change ${field.label} on the same record — clear it in one of them.`;
      return { ...line, blocked: { reason, ...(field.from[0] ? { cell: field.from[0] } : {}) } };
    }
    return line;
  });
}

/** The lines a line can't save without: its dependsOn and a parent that is a line. */
const needs = (line: ChangeLine): string[] => [...(line.dependsOn ?? []), ...(line.parent?.ref === "line" ? [line.parent.lineId] : [])];

/** A line id's fact finder row as the advisor knows it, else its record's kind ("Account"). */
function nameOfLine(lineId: string, state: FactFinderState): string {
  const [, rowId = "", target = ""] = /^(.*)\/([a-z_]+)(?:\/\d+)?$/.exec(lineId) ?? [];
  const at = locateRow(state, rowId);
  const section = at && findSection(at.sectionId);
  if (at && section) return rowLabel(section, state.sections[at.sectionId][at.index]);
  return Object.hasOwn(TARGETS, target) ? TARGETS[target as TargetKind].label : "another row";
}

/**
 * A line that needs a line the change set doesn't have can't resolve its reference, so it fails closed; and a line
 * that needs a blocked line is blocked too — pass after pass, until nothing changes.
 */
export function blockDependents(lines: readonly ChangeLine[], state: FactFinderState): ChangeLine[] {
  const ids = new Set(lines.map((l) => l.id));
  let current = lines.map((line) => {
    const gone = line.blocked ? undefined : needs(line).find((id) => !ids.has(id));
    if (gone === undefined) return line;
    return { ...line, blocked: { reason: `This depends on "${nameOfLine(gone, state)}", which won't be saved.` } };
  });
  for (;;) {
    const blocked = new Map(current.filter((l) => l.blocked).map((l) => [l.id, l.label]));
    let changed = false;
    current = current.map((line) => {
      const on = line.blocked ? undefined : needs(line).find((id) => blocked.has(id));
      if (on === undefined) return line;
      changed = true;
      return { ...line, blocked: { reason: `Saves only with "${blocked.get(on)}", which can't be saved yet.` } };
    });
    if (!changed) return current;
  }
}
