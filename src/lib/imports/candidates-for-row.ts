import type { MatchAnnotation } from "./types";

/**
 * Per-row picker candidates enforcing one-row-→-one-existing-record: a record
 * already exact-matched by ANOTHER row is removed from row `rowIndex`'s option
 * list. The row's own current pick is always retained, so re-opening the picker
 * on a matched row still shows what it is matched to.
 *
 * Generic over the candidate shape so every review step can use it — all five
 * call sites (accounts, insurance, wills, family, expenses) pass
 * `MatchCandidate[]` (with subtitle and score).
 */
export function candidatesForRow<C extends { id: string }>(
  rowIndex: number,
  matches: Array<MatchAnnotation | undefined>,
  candidates: C[],
): C[] {
  const claimed = new Set<string>();
  matches.forEach((m, i) => {
    if (i !== rowIndex && m?.kind === "exact") claimed.add(m.existingId);
  });
  return candidates.filter((c) => !claimed.has(c.id));
}
