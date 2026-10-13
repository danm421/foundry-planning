// src/lib/fact-finder/relink.ts
// Server-only (reads the plan's records). Keeps "Links to" fresh after edits:
// fact finder imports link against the base case only (R2).
import { applyLinkScores } from "./matching/score";
import type { FFOp } from "./ops";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "./records/load";
import { emptyExistingRecords, type ExistingRecords } from "./records/types";
import { findSection } from "./schema";
import type { FactFinderState } from "./types";

/** The records of the client's base case; none when the client has no base case yet. */
export async function loadBaseCaseRecords(clientId: string): Promise<ExistingRecords> {
  const scenarioId = await resolveBaseCaseScenarioId(clientId);
  return scenarioId ? loadExistingRecords(clientId, scenarioId) : emptyExistingRecords();
}

export async function relinkBaseCase(state: FactFinderState, clientId: string): Promise<FactFinderState> {
  return applyLinkScores(state, await loadBaseCaseRecords(clientId));
}

/** Whether a batch can change a link: holding edits can't, nor can rows of a section that doesn't link. */
export function opsNeedRelink(ops: readonly FFOp[]): boolean {
  return ops.some((op) => {
    switch (op.op) {
      case "setHolding":
      case "removeHolding":
      case "assignHolding":
        return false;
      case "restoreRow":
      case "restoreSnapshots":
        return true; // the op doesn't name the row's section
      default:
        return findSection(op.sectionId)?.links !== undefined;
    }
  });
}
