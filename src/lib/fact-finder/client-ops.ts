// src/lib/fact-finder/client-ops.ts
// The screen's pending edits, re-applied on a newer fact finder (a 409, or a
// read or chat reply that landed while the advisor was typing). Client-safe.
import { FactFinderOpError, applyOps, locationOf, type ClientOp, type OpContext } from "./ops";
import { locateRow, sameJson } from "./state";
import type { FactFinderState, FFRow } from "./types";

/** What an edit depends on. If any of it changed underneath, the edit is dropped. */
export type OpTarget =
  | { kind: "cell"; rowId: string; columnId: string }
  | { kind: "link"; rowId: string }
  | { kind: "place"; rowId: string }
  | { kind: "holding"; rowId: string | null; holdingId: string }
  | { kind: "destination"; rowId: string };

export function opTargets(op: ClientOp): OpTarget[] {
  switch (op.op) {
    case "setCell":
    case "clearCell":
      return [{ kind: "cell", rowId: op.rowId, columnId: op.columnId }];
    case "addRow":
      return op.rowId ? [{ kind: "place", rowId: op.rowId }] : [];
    case "removeRow":
    case "restoreRow":
      return [{ kind: "place", rowId: op.rowId }];
    case "mergeRows":
      return [
        { kind: "place", rowId: op.keepRowId },
        { kind: "place", rowId: op.dropRowId },
      ];
    case "setLink":
      return [{ kind: "link", rowId: op.rowId }];
    case "setHolding":
    case "removeHolding":
      return [{ kind: "holding", rowId: op.rowId, holdingId: op.holdingId }];
    case "assignHolding":
      return [
        { kind: "holding", rowId: op.from === "unassigned" ? null : op.from.rowId, holdingId: op.holdingId },
        { kind: "destination", rowId: op.to.rowId },
      ];
  }
}

function liveRow(state: FactFinderState, rowId: string): FFRow | undefined {
  const at = locateRow(state, rowId);
  return at ? state.sections[at.sectionId][at.index] : undefined;
}

/**
 * The part of a state a target depends on. A row's place is where it sits
 * (a section, or the tray), not its content: a reading that fills a cell
 * doesn't cancel the advisor's remove. A row that's live in neither state
 * (one this batch adds or restores) compares equal; whether the edit still
 * applies is then up to `applyOps`.
 */
function targetValue(state: FactFinderState, target: OpTarget): unknown {
  switch (target.kind) {
    case "cell":
      return liveRow(state, target.rowId)?.cells[target.columnId];
    case "link":
      return liveRow(state, target.rowId)?.link;
    case "place": {
      const loc = locationOf(state, target.rowId);
      if (loc === null) return null;
      return { where: loc.where, sectionId: loc.where === "section" ? loc.sectionId : loc.entry.sectionId };
    }
    case "holding": {
      const holdings = target.rowId === null ? state.unassignedHoldings : liveRow(state, target.rowId)?.holdings;
      return holdings?.find((h) => h.id === target.holdingId);
    }
    case "destination":
      return liveRow(state, target.rowId) !== undefined;
  }
}

/**
 * Re-applies the advisor's edits on `fresh`. An edit is kept when nothing it
 * depends on changed between `lastServer` (what it was made against) and
 * `fresh`, and it still applies after the edits kept before it. Kept edits
 * keep their order.
 */
export function rebaseOps(
  ops: readonly ClientOp[],
  lastServer: FactFinderState,
  fresh: FactFinderState,
  ctx: OpContext,
): { kept: ClientOp[]; dropped: ClientOp[] } {
  const kept: ClientOp[] = [];
  const dropped: ClientOp[] = [];
  let state = fresh;
  for (const op of ops) {
    const unchanged = opTargets(op).every((t) => sameJson(targetValue(lastServer, t), targetValue(fresh, t)));
    if (!unchanged) {
      dropped.push(op);
      continue;
    }
    try {
      state = applyOps(state, [op], ctx);
      kept.push(op);
    } catch (err) {
      if (!(err instanceof FactFinderOpError)) throw err;
      dropped.push(op);
    }
  }
  return { kept, dropped };
}
