// The prose conventions a chapter narrator shares with its neighbours, as
// opposed to the figures it prints (`../facts.ts`) or the rules it is judged
// under (`../validate`).
//
// One tenant so far. It is here rather than private to a chapter because it had
// already been written twice — chapters 1 and 12 both count something for the
// reader — and the two copies had already drifted by one word.

/** Advisor prose spells small numbers. Past ten, a digit is what anyone writes.
 *
 *  Safe either way under Gate 1: a bare integer under four digits is not a
 *  figure to `validate/facts.ts`, because ages and counts are not plan outputs
 *  and the prose needs them to read naturally. */
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "three changes" · "one thing" · "14 changes". */
export function spelledCount(n: number, singular: string, plural: string): string {
  return `${COUNT_WORDS[n] ?? String(n)} ${n === 1 ? singular : plural}`;
}
