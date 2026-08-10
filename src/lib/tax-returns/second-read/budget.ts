/**
 * Split a total character budget across documents.
 *
 * A single `slice(0, TOTAL)` over the concatenation would spend the whole
 * budget on the 1040 and truncate every supporting document to nothing — and
 * supporting documents (a Form 8283, a K-1 footnote statement) are precisely
 * what the deterministic layer cannot see. So each document gets an equal
 * share, and whatever the short ones do not use is redistributed to the rest,
 * repeatedly, until no document is under its share.
 */
export function allocateCharBudget(lengths: number[], total: number): number[] {
  const allocation = lengths.map(() => 0);
  let remainingBudget = total;
  const pending = lengths.map((_, i) => i);

  while (pending.length > 0) {
    const share = Math.floor(remainingBudget / pending.length);
    const satisfied = pending.filter((i) => lengths[i] <= share);
    if (satisfied.length === 0) {
      for (const i of pending) allocation[i] = share;
      break;
    }
    for (const i of satisfied) {
      allocation[i] = lengths[i];
      remainingBudget -= lengths[i];
    }
    pending.splice(0, pending.length, ...pending.filter((i) => lengths[i] > share));
  }

  return allocation;
}
