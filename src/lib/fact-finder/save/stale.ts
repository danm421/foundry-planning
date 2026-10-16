// src/lib/fact-finder/save/stale.ts
/**
 * The stale check (D6): the lines the save writes, against the record book it
 * reloads inside its transaction. Anything a line relied on that changed since
 * the review — its record deleted or edited, a record of the same identity
 * added, a record it names gone — refuses the whole save, naming the line.
 * Placement runs again (no AI) to find each line's record as the review would
 * now. Only ticked fields count: the save writes nothing else. Pure.
 */
import { cellKey, type ChangeLine, type PlacedValue } from "../change-set";
import { applyLeftovers, type LeftoversOutput } from "../placement/leftovers";
import { checkLinks } from "../placement/links";
import { placeFactFinder, type Placed } from "../placement/place";
import { targetField } from "../placement/targets";
import { findRecord, type RecordBook, type TargetDraft } from "../placement/types";
import { sameValue } from "../placement/values";
import type { FactFinderState } from "../types";
import { refsIn } from "./plan";

export interface StaleProblem {
  lineId: string;
  message: string;
}

const CHANGED = (label: string) => `“${label}” changed since you reviewed — review again.`;
const GONE = (label: string) => `“${label}” is no longer on the plan — review again.`;
const ADDED = (label: string) => `“${label}” is on the plan now — review again.`;
const NAMES_GONE = (label: string) => `“${label}” names a record that's no longer on the plan — review again.`;

/** The first problem — check by check (vanished link, record moved, record gone, a named record gone, a field changed), each in line order; null when there's none. */
export function staleProblem(lines: readonly ChangeLine[], state: FactFinderState, book: RecordBook, now: Date): StaleProblem | null {
  return vanishedLink(lines, state, book) ?? movedRecord(lines, state, book, now) ?? goneRecord(lines, book) ?? goneRef(lines, book) ?? changedField(lines, book);
}

/** A "Links to" on a row the save writes from that names a record no longer on the plan: the message names the row. */
function vanishedLink(lines: readonly ChangeLine[], state: FactFinderState, book: RecordBook): StaleProblem | null {
  const vanished = new Map(checkLinks(state, book).vanished.map((row) => [row.rowId, row.label]));
  for (const line of lines) {
    const label = vanished.get(line.rowId);
    if (label !== undefined) return { lineId: line.id, message: GONE(label) };
  }
  return null;
}

/** The cell an AI plan note's item sat in (every field of its line comes from it). */
const itemOf = (line: ChangeLine | TargetDraft): string => {
  const cell = line.fields[0]?.from[0];
  return cell ? cellKey(cell.rowId, cell.columnId) : "";
};

/**
 * Every leftover as the plan note the AI step makes of it, by its item's cell — so an AI plan note finds its
 * note on record by its words, as the review did. No model call: the review already chose which items are notes.
 */
function aiNotes(placed: Placed, book: RecordBook) {
  const asNotes: LeftoversOutput = {
    items: placed.leftovers.map((item) => ({
      itemId: item.id, action: "note", lineId: null, key: null, value: null, quote: null, topic: null, reason: null,
    })),
  };
  const notes = applyLeftovers(placed.leftovers, placed.drafts, asNotes, book).drafts.filter((d) => d.aiPlaced);
  return new Map(notes.map((d) => [itemOf(d), d]));
}

/**
 * A line whose record placement finds differently now: a link or an identity match (a will by grantor, a provision
 * by grantor + asset, a related party by name, a plan note by its words…) lost its record, or found one a Create
 * didn't have — a Create whose line placement no longer makes (a will on record now) counts as found.
 */
function movedRecord(lines: readonly ChangeLine[], state: FactFinderState, book: RecordBook, now: Date): StaleProblem | null {
  const placed = placeFactFinder(state, book, now);
  const drafts = new Map(placed.drafts.map((d) => [d.lineId, d]));
  const notes = aiNotes(placed, book);
  for (const line of lines) {
    const draft = line.aiPlaced ? notes.get(itemOf(line)) : drafts.get(line.id);
    if (draft?.recordId === line.recordId) continue;
    if (line.recordId !== null && !findRecord(book, line.target, line.recordId)) return { lineId: line.id, message: GONE(line.label) };
    if (line.recordId === null) return { lineId: line.id, message: ADDED(line.label) };
    return { lineId: line.id, message: CHANGED(line.label) };
  }
  return null;
}

/** An Update line whose record isn't on the plan: placement keeps some ids whatever the book holds (the household's is the client's). */
function goneRecord(lines: readonly ChangeLine[], book: RecordBook): StaleProblem | null {
  const line = lines.find((l) => l.action === "update" && !findRecord(book, l.target, l.recordId));
  return line ? { lineId: line.id, message: GONE(line.label) } : null;
}

/** A record the line writes a reference to — the record it hangs off, a value it creates with, a ticked value and its companions — gone from the plan. */
function goneRef(lines: readonly ChangeLine[], book: RecordBook): StaleProblem | null {
  for (const line of lines) {
    const written: PlacedValue[] = [
      line.parent ?? null,
      line.fixed ?? null,
      ...line.fields.filter((f) => f.ticked).flatMap((f) => [f.next, f.with ?? null]),
    ];
    if (written.flatMap(refsIn).some((ref) => ref.ref === "record" && !findRecord(book, ref.target, ref.id))) return { lineId: line.id, message: NAMES_GONE(line.label) };
  }
  return null;
}

/** A ticked Update field whose value on record isn't the one the advisor saw — under the review's own tolerances. */
function changedField(lines: readonly ChangeLine[], book: RecordBook): StaleProblem | null {
  for (const line of lines) {
    if (line.action !== "update") continue;
    const record = findRecord(book, line.target, line.recordId);
    for (const field of line.fields) {
      if (!field.ticked) continue;
      const spec = targetField(line.target, field.key);
      if (!spec || !sameValue(spec.kind, field.onRecord, record?.values[field.key], book.people)) return { lineId: line.id, message: CHANGED(line.label) };
    }
  }
  return null;
}
