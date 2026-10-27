// src/lib/fact-finder/read-summary.ts
import { countCellsToCheck, countLinksNeedingClick } from "./state";
import type { FactFinderState, FFMergeDecision } from "./types";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The chat panel's after-reading message (spec § 4): what was read, what to check, what was left out.
 * `filesRead` counts only the documents read — the `failed` ones (stopped ones included) are not.
 */
export function buildReadSummary(input: {
  state: FactFinderState;
  decisions: FFMergeDecision[];
  filesRead: number;
  failed: Array<{ fileName: string; reason: string }>;
  caveats: string[];
}): { summary: string; caveats: string[] } {
  const toCheck = countCellsToCheck(input.state);
  const toConfirm = countLinksNeedingClick(input.state);
  const parts: string[] = [];
  if (toCheck > 0) parts.push(`${count(toCheck, "value")} to check`);
  if (toConfirm > 0) parts.push(`${count(toConfirm, "link")} to confirm`);
  const failed = input.failed.length;
  const retry = `Retry ${failed === 1 ? "it" : "them"}`;
  const read =
    failed === 0
      ? `Read ${count(input.filesRead, "document")}.`
      : input.filesRead === 0
        ? `Couldn't read ${count(failed, "document")} — ${retry}.`
        : `Read ${count(input.filesRead, "document")}. ${failed} couldn't be read — ${retry}.`;
  const summary = parts.length > 0 ? `${read} ${parts.join("; ")}.` : read;

  const caveats: string[] = [];
  for (const d of input.decisions) if (d.kind === "excluded") caveats.push(`Left out "${d.label}": ${d.reason}`);
  const unassigned = input.state.unassignedHoldings.length;
  if (unassigned > 0) {
    caveats.push(`${count(unassigned, "holding")} couldn't be matched to an account — ask me which account they belong to.`);
  }
  for (const f of input.failed) caveats.push(`Couldn't read ${f.fileName}: ${f.reason}`);
  caveats.push(...input.caveats);
  return { summary, caveats: [...new Set(caveats)] };
}
