// src/lib/fact-finder/worksheet/turn-ops.ts
import { applyOps, type ClientOp, type OpContext } from "../ops";
import type { FactFinderState } from "../types";
import { applyWsOps, type WsOp } from "./ops";

export type TurnOp = { layer: "ws"; op: WsOp } | { layer: "staging"; op: ClientOp };

/** In order; staging ops through applyOps (its validation), worksheet ops through applyWsOps. All or nothing. */
export function applyTurnOps(state: FactFinderState, ops: readonly TurnOp[], ctx: OpContext): FactFinderState {
  let next = state;
  for (const t of ops) {
    next = t.layer === "staging" ? applyOps(next, [t.op], ctx) : { ...next, worksheet: applyWsOps(next.worksheet, [t.op]) };
  }
  return next;
}
