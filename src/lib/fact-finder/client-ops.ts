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

function tryApply(state: FactFinderState, op: ClientOp, ctx: OpContext): FactFinderState | null {
  try {
    return applyOps(state, [op], ctx);
  } catch (err) {
    if (!(err instanceof FactFinderOpError)) throw err;
    return null;
  }
}

function sameTargets(op: ClientOp, a: FactFinderState, b: FactFinderState): boolean {
  return opTargets(op).every((t) => sameJson(targetValue(a, t), targetValue(b, t)));
}

/** A destination target only says the row is there; the moved holding itself is in the row. */
function movedHolding(state: FactFinderState, op: ClientOp): unknown {
  return op.op === "assignHolding"
    ? liveRow(state, op.to.rowId)?.holdings?.find((h) => h.id === op.holdingId)
    : undefined;
}

/**
 * Re-applies the advisor's edits on `fresh`. An edit is kept when nothing it
 * depends on differs between the state it was made against (`lastServer`
 * plus the edits before it) and the state it would apply to now (`fresh`
 * plus the edits kept before it), and it still applies. Kept edits keep
 * their order. An edit that isn't kept is `dropped` (lost) unless what the
 * advisor last put there is there anyway — the server already took it and
 * its reply never arrived — then it's in neither list.
 */
export function rebaseOps(
  ops: readonly ClientOp[],
  lastServer: FactFinderState,
  fresh: FactFinderState,
  ctx: OpContext,
): { kept: ClientOp[]; dropped: ClientOp[] } {
  const kept: ClientOp[] = [];
  const notKept: ClientOp[] = [];
  let mine = lastServer;
  let state = fresh;
  for (const op of ops) {
    const next = sameTargets(op, mine, state) ? tryApply(state, op, ctx) : null;
    mine = tryApply(mine, op, ctx) ?? mine;
    if (next) {
      state = next;
      kept.push(op);
    } else {
      notKept.push(op);
    }
  }
  const dropped = notKept.filter(
    (op) => !sameTargets(op, mine, state) || !sameJson(movedHolding(mine, op), movedHolding(state, op)),
  );
  return { kept, dropped };
}
