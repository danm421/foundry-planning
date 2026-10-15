// src/lib/fact-finder/placement/links.ts
/**
 * The review's "Links to" checks (D11), before anything is placed: a link
 * names a record of this client's base case of its own kind, or it has
 * vanished (deleted since, or a hand-made PATCH naming any id); a suggestion
 * still waits for its click; two live rows confirmed to one record would
 * write it twice. Live rows only — the Removed tray is never placed. Pure.
 */
import { FACT_FINDER_SECTIONS } from "../schema";
import { rowLabel } from "../state";
import type { FactFinderState, FFRow } from "../types";
import { LINK_TARGETS } from "./place";
import { findRecord, type RecordBook } from "./types";

/** A row the review names, as the fact finder calls it ("Joint Checking", "Social Security — Client"). */
export interface LinkedRow {
  rowId: string;
  label: string;
}

export interface LinkProblems {
  /** A confirmed or suggested link to a record that isn't one of the client's base-case records of its kind. */
  vanished: LinkedRow[];
  /** Suggested links that still need a click. */
  needsClick: number;
  /** Two or more live rows confirmed to one record. */
  doubles: { recordId: string; rows: LinkedRow[] }[];
}

export function checkLinks(state: FactFinderState, book: RecordBook): LinkProblems {
  const vanished: LinkedRow[] = [];
  let needsClick = 0;
  const confirmed = new Map<string, LinkedRow[]>();
  for (const section of FACT_FINDER_SECTIONS) {
    if (!section.links) continue;
    const pool = LINK_TARGETS[section.links];
    for (const row of state.sections[section.id] ?? []) {
      const link = row.link;
      if (link?.kind !== "existing") continue;
      const named = { rowId: row.id, label: rowLabel(section, row) };
      if (!pool.some((target) => findRecord(book, target, link.recordId))) vanished.push(named);
      else if (!link.confirmed) needsClick += 1;
      else confirmed.set(link.recordId, [...(confirmed.get(link.recordId) ?? []), named]);
    }
  }
  const doubles = [...confirmed].filter(([, rows]) => rows.length > 1).map(([recordId, rows]) => ({ recordId, rows }));
  return { vanished, needsClick, doubles };
}

/** These rows without their link and the candidates it came from, so the matcher scores them again. */
export function dropLinks(state: FactFinderState, rowIds: ReadonlySet<string>): FactFinderState {
  const sections = Object.fromEntries(
    Object.entries(state.sections).map(([sectionId, rows]) => [sectionId, rows.map((r) => (rowIds.has(r.id) ? unlinked(r) : r))]),
  );
  return { ...state, sections };
}

function unlinked(row: FFRow): FFRow {
  const next = { ...row };
  delete next.link;
  delete next.linkCandidates;
  return next;
}
