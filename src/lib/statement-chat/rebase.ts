import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * Rebasing account rows onto a freshly-read set.
 *
 * Lifted out of `chat/turn/route.ts` (final review, I1) so the re-extraction
 * route can reuse the SAME mechanism rather than grow a second, similar
 * merge. Direction rule, same as the rest of `lib/statement-chat`: reads from
 * `@/lib/imports/` and `@/lib/extraction/`, never the reverse.
 */

type AccountRow = Annotated<ExtractedAccount>;

/**
 * One row whose freshly-merged figure the rebase held back in favour of the
 * figure the advisor already has. Ruling 117: the standing row still wins,
 * but the advisor is TOLD — so both figures travel out of here together and
 * the narrator can name them in one sentence.
 *
 * `standingValue` is what stays on screen and what will commit;
 * `freshValue` is what the newly-read statements merged to and the rebase
 * discarded. Either can be `undefined` — a row with no readable balance is
 * an ordinary extraction outcome, and one side having a figure while the
 * other does not is itself a difference worth reporting.
 */
export interface RebaseOverride {
  __rowId: string;
  name: string;
  /** The figure that stays on screen and will commit — the advisor's. */
  standingValue: number | undefined;
  /** The figure the new statement reported and the rebase discarded. */
  freshValue: number | undefined;
}

/**
 * Review round 1, Important 1 (and Ruling 83's own follow-up correction):
 * merge a set of mutated rows onto the FRESH read `by __rowId`, rather than
 * replacing the array wholesale with a snapshot computed from a STALE read.
 * Without this, a commit landing (via the separate accounts-PATCH route)
 * while a turn's model calls are in flight has its `linkCreated` stamp
 * silently erased the moment the turn's write lands.
 *
 * A row is "changed" when the final object for its `__rowId` is a DIFFERENT
 * reference than what that row started as — `editRow`/`mergeRows`/`dropRow`
 * in `tools.ts` always create a new object for a row they touch and preserve
 * the exact same reference for every row they don't, so reference inequality
 * is an exact signal, not a heuristic. A row present in `startAccounts` but
 * absent from `changedAccounts` was retired (dropped, or merged away) and is
 * removed from the fresh array too. Every other fresh row is left exactly as
 * read — a concurrent write's stamps on it survive untouched.
 */
export function mergeAccountsByRowId(
  freshAccounts: AccountRow[],
  startAccounts: AccountRow[],
  changedAccounts: AccountRow[],
): AccountRow[] {
  const startByRowId = new Map(
    startAccounts.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );
  const changedByRowId = new Map(
    changedAccounts.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );

  const changed = new Map<string, AccountRow>();
  for (const [id, row] of changedByRowId) {
    if (startByRowId.get(id) !== row) changed.set(id, row);
  }
  const retired = new Set([...startByRowId.keys()].filter((id) => !changedByRowId.has(id)));

  const merged: AccountRow[] = [];
  for (const row of freshAccounts) {
    const id = row.__rowId;
    if (id && retired.has(id)) continue;
    if (id && changed.has(id)) {
      merged.push(changed.get(id) as AccountRow);
      continue;
    }
    merged.push(row);
  }
  return merged;
}

/**
 * Rebase the rows the advisor has been working on (`standing` — the persisted
 * `payload.accounts`) onto a freshly re-merged set (`freshMerged` — this
 * extraction's `detectRollups().kept`).
 *
 * Final review, I1: re-extraction used to REPLACE `payload.accounts` with the
 * fresh merge outright, so uploading one more statement threw away every
 * `edit_row` correction and every `linkCreated` stamp — and the UI actively
 * advertises that path ("You can still upload another statement first").
 *
 * The mapping onto `mergeAccountsByRowId` is exact once you name the three
 * arguments honestly:
 *   - `freshMerged` is the base, so it is the "fresh" array — a row only this
 *     extraction produced (a genuinely new account off the new statement) is
 *     carried through untouched.
 *   - `standing` is the changed set: every row on it may carry an advisor
 *     correction or a commit stamp, so all of them win over their fresh
 *     counterpart.
 *   - the "start" array is EMPTY, which is what says "assume nothing on the
 *     standing set is untouched". There is no earlier snapshot to diff
 *     against here — the previous merge cannot be recomputed once
 *     `fileResults` has changed — and an empty start also means nothing is
 *     ever treated as retired, so a genuinely new row is never dropped.
 *
 * A row that no longer exists in the new extraction simply disappears: it is
 * absent from `freshMerged`, and the loop only ever emits fresh rows.
 *
 * For a row present in BOTH sets the standing row wins wholesale, so a
 * re-merge that would have moved that row's balance (a newer statement
 * superseding an older one for the same account) does not move it on screen.
 * Nothing here can tell an advisor's correction apart from an untouched
 * extracted value, and silently overwriting a reviewed figure behind the
 * advisor's back is the worse of the two failures — the whole point of I1 is
 * that a correction must not evaporate.
 *
 * Ruling 117: that is still the behaviour, but it is NO LONGER SILENT. Every
 * row whose figure was held back comes out in `overrides`, so the narrator
 * can name both figures and the advisor can decide. This used to be written
 * up as an accepted trade-off; it was measured instead as a real loss —
 * a June statement showing $100,000 and a September statement showing
 * $130,000 for an untouched account left $100,000 on screen and $100,000 is
 * what committed, with nothing on the page saying a newer figure existed.
 * Worse, the caveat printed directly above that row named $130,000, because
 * the route narrated the FRESH decisions against the REBASED rows.
 */
export function rebaseOntoFreshMerge(
  freshMerged: AccountRow[],
  standing: AccountRow[],
): { rows: AccountRow[]; overrides: RebaseOverride[] } {
  const rows = mergeAccountsByRowId(freshMerged, [], standing);

  // Computed HERE, against `standing` and `freshMerged` directly, rather than
  // inside `mergeAccountsByRowId` — that function is the shared mechanism the
  // turn route also depends on, where "changed" means reference inequality
  // against a real start snapshot and carries no figure to report.
  const standingByRowId = new Map(
    standing.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );

  const overrides: RebaseOverride[] = [];
  for (const fresh of freshMerged) {
    const id = fresh.__rowId;
    if (!id) continue;
    const held = standingByRowId.get(id);
    if (!held) continue;
    // BY VALUE, not by reference. `standing` is parsed back out of jsonb on
    // every request, so it never shares an object with `freshMerged` — a
    // reference test would report every single row as an override.
    //
    // Plain `!==`, not the merge module's `withinTolerance`: that helper is
    // module-private in `merge-across-files.ts`, and its 1% band is the wrong
    // question anyway. It exists to decide whether two documents CONTRADICT
    // each other; here the two figures are three months apart and a 0.5%
    // move between them is a real change the advisor should still be told
    // about, not noise to swallow.
    if (held.value === fresh.value) continue;
    overrides.push({
      // The standing row's own name — that is the label on screen.
      name: held.name,
      __rowId: id,
      standingValue: held.value,
      freshValue: fresh.value,
    });
  }

  return { rows, overrides };
}
