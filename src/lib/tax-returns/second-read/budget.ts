/**
 * Split a total character budget across documents.
 *
 * A single `slice(0, TOTAL)` over the concatenation would spend the whole
 * budget on the 1040 and truncate every supporting document to nothing — and
 * supporting documents (a Form 8283, a K-1 footnote statement) are precisely
 * what the deterministic layer cannot see. So each document gets an equal
 * share, and whatever the short ones do not use is redistributed to the rest.
 *
 * Processing shortest-first makes that redistribution a single pass: once a
 * document is short enough for its share, it takes exactly its length and
 * the remaining budget/count shrink for the rest; the first document that
 * ISN'T short enough proves every longer document after it isn't either
 * (same share, only-larger lengths), so the rest all take that frozen share.
 */
export function allocateCharBudget(lengths: number[], total: number): number[] {
  const order = lengths.map((_, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  const allocation = lengths.map(() => 0);
  let remainingBudget = total;

  for (let k = 0; k < order.length; k++) {
    const remainingCount = order.length - k;
    const share = Math.floor(remainingBudget / remainingCount);
    const i = order[k];
    if (lengths[i] <= share) {
      allocation[i] = lengths[i];
      remainingBudget -= lengths[i];
    } else {
      for (let j = k; j < order.length; j++) allocation[order[j]] = share;
      break;
    }
  }

  return allocation;
}
