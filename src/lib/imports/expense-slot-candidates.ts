import type { MatchAnnotation } from "./types";

export interface SlotCandidate {
  id: string;
  name: string;
}

/**
 * Per-row picker candidates enforcing one-row-→-one-slot: a slot already
 * exact-matched by ANOTHER row is removed from row `rowIndex`'s option list.
 * The row's own current pick is always retained.
 */
export function candidatesForRow(
  rowIndex: number,
  matches: Array<MatchAnnotation | undefined>,
  candidates: SlotCandidate[],
): SlotCandidate[] {
  const claimed = new Set<string>();
  matches.forEach((m, i) => {
    if (i !== rowIndex && m?.kind === "exact") claimed.add(m.existingId);
  });
  return candidates.filter((c) => !claimed.has(c.id));
}
