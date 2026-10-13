// src/lib/fact-finder/screen-summary.ts
// What the screen shows about the fact finder as a whole: the page rail's dots
// and counts, and which cells the last chat reply changed. Client-safe.
import { PAGE_ORDER, sectionsOnPage, type FFPage } from "./schema";
import { cellNeedsCheck, isBlank, linkNeedsClick, rowHasValues, sameJson } from "./state";
import type { FactFinderState, FFRow, FFRowLocation } from "./types";

export interface PageCounts {
  /** Any row on the page has a value (Accounts also counts holdings waiting for an account). */
  hasData: boolean;
  /** Values to check ("check this"). */
  toCheck: number;
  /** Links that need a click to confirm. */
  toLink: number;
}

/** Per page, over its live rows. The Removed tray counts nowhere. */
export function pageCounts(state: FactFinderState): Record<FFPage, PageCounts> {
  const out = {} as Record<FFPage, PageCounts>;
  for (const { id: page } of PAGE_ORDER) {
    const rows = sectionsOnPage(page).flatMap((s) => state.sections[s.id] ?? []);
    out[page] = {
      hasData: rows.some(rowHasValues) || (page === "accounts" && state.unassignedHoldings.length > 0),
      toCheck: rows.reduce((n, row) => n + Object.values(row.cells).filter(cellNeedsCheck).length, 0),
      toLink: rows.filter(linkNeedsClick).length,
    };
  }
  return out;
}

/** The latest chat reply that changed something (it has an undo entry; read summaries don't). */
export function lastChangeTurnId(state: FactFinderState): string | null {
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    const turn = state.transcript[i];
    if (turn.role === "assistant" && Object.hasOwn(state.undo, turn.id)) return turn.id;
  }
  return null;
}

const liveRowAt = (loc: FFRowLocation): FFRow | null => (loc?.where === "section" ? loc.row : null);

/**
 * Cells the last chat reply changed, as "rowId:columnId", plus "rowId:link"
 * when it changed the row's link. A row the reply added or brought back from
 * the tray counts every value it has.
 */
export function changedCellsOf(state: FactFinderState): ReadonlySet<string> {
  const changed = new Set<string>();
  const turnId = lastChangeTurnId(state);
  if (turnId === null) return changed;
  for (const snap of state.undo[turnId]) {
    if (snap.kind !== "row") continue;
    const after = liveRowAt(snap.after);
    if (!after) continue;
    const before = liveRowAt(snap.before);
    for (const [columnId, cell] of Object.entries(after.cells)) {
      const differs = before ? !sameJson(before.cells[columnId], cell) : !isBlank(cell.value);
      if (differs) changed.add(`${snap.rowId}:${columnId}`);
    }
    if (!sameJson(before?.link, after.link)) changed.add(`${snap.rowId}:link`);
  }
  return changed;
}
