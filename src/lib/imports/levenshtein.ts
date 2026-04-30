/**
 * Bounded Levenshtein distance with early termination.
 *
 * Returns the edit distance between `a` and `b`, or `-1` if it exceeds
 * `bound`. The bound lets callers iterate over many candidates and skip
 * the expensive DP fill once a row's minimum distance already exceeds
 * the threshold the matching pass cares about.
 *
 * Comparison is case-sensitive — callers should lowercase first if they
 * want case-insensitive matching.
 */
export function boundedLevenshtein(a: string, b: string, bound: number): number {
  if (a === b) return 0;

  const lenA = a.length;
  const lenB = b.length;

  if (Math.abs(lenA - lenB) > bound) return -1;

  // Ensure a is the shorter string so the DP row is the smaller of the two.
  if (lenA > lenB) {
    return boundedLevenshtein(b, a, bound);
  }

  // Two rolling rows of size lenA + 1.
  let prev = new Array<number>(lenA + 1);
  let curr = new Array<number>(lenA + 1);
  for (let i = 0; i <= lenA; i++) prev[i] = i;

  for (let j = 1; j <= lenB; j++) {
    curr[0] = j;
    let rowMin = curr[0];
    for (let i = 1; i <= lenA; i++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,
        curr[i - 1] + 1,
        prev[i - 1] + cost,
      );
      if (curr[i] < rowMin) rowMin = curr[i];
    }
    if (rowMin > bound) return -1;
    [prev, curr] = [curr, prev];
  }

  const distance = prev[lenA];
  return distance > bound ? -1 : distance;
}
