import { keyedRowIdBucket } from "@/lib/imports/assemble/merge-across-files";
import { custodianMatches, normalizeCustodian } from "@/lib/imports/normalize-custodian";
import { livingHoldings, tombstonedHoldings } from "@/lib/imports/living-rows";
import { holdingMarketValue } from "@/lib/extraction/normalize-holdings";
import { holdingKey } from "@/lib/extraction/holdings-completion";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount, ExtractedHolding } from "@/lib/extraction/types";

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
  /**
   * The FRESH survivor's name — what `MergeDecision.account` carries, which
   * is NOT the standing row's name once the advisor has renamed the row
   * (`name` is on `EDITABLE_ACCOUNT_FIELDS`, and a rename survives the
   * rebase by construction). `narrate`'s `contradictsRebase` needs both
   * spellings to join a decision to the override that replaces it (Ruling
   * 128); `name` above stays the label anything advisor-facing prints.
   */
  freshName: string;
  /** The figure that stays on screen and will commit — the advisor's. */
  standingValue: number | undefined;
  /** The figure the new statement reported and the rebase discarded. */
  freshValue: number | undefined;
}

/**
 * One row whose fresh POSITIONS differ from the standing ones — the same
 * silence Ruling 117 closed for a whole-account figure, one level down. A
 * re-extraction can change what is UNDER an account (a fund swap, a new
 * purchase) even when the account's own balance does not move, and the
 * standing positions winning wholesale (same rule as `RebaseOverride`) used
 * to make that invisible.
 *
 * Counts and sums travel for both sides, same shape as `RebaseOverride`, so
 * the narrator can say what changed without the advisor opening the
 * statement to find out.
 */
export interface RebaseHoldingsOverride {
  __rowId: string;
  name: string;
  standingCount: number;
  freshCount: number;
  standingSum: number;
  freshSum: number;
}

/**
 * One standing row the rebase REFUSED to carry forward, because the fresh row
 * now holding its `__rowId` is not plausibly the same account (final review
 * #2, C-1). The advisor's work on that row is not applied — so they are told,
 * rather than the swap happening behind their back.
 */
export interface RebaseRefusal {
  __rowId: string;
  /** The STANDING row's name — the label the advisor has been looking at. */
  name: string;
  /** The FRESH row that now holds that id. A different account. */
  freshName: string;
}

/**
 * One standing row that has left the table: its `__rowId` has no counterpart
 * in the fresh set and no fresh row could be identified as the same account,
 * so the row is simply gone. That has always been the behaviour — a row the
 * new extraction does not produce is not in `freshMerged`, and the loop only
 * ever emits fresh rows — but it used to be SILENT.
 *
 * Fix wave 2, requirement 4. The row vanishing changes what will commit, and
 * an advisor who does not see it happen has no way to tell "this account left
 * the statements" from "the app lost my work". One sentence is cheap and can
 * never be wrong.
 */
export interface RebaseDrop {
  /**
   * Absent for a standing row that carried no `__rowId` at all (fix wave 3,
   * M-A). Such a row cannot be matched to anything in either direction, so
   * it was skipped before the orphan pass and left the table in silence —
   * the last remaining silent loss in a function whose job is to have none.
   */
  __rowId?: string;
  /** The STANDING row's name — the label the advisor has been looking at. */
  name: string;
  /**
   * True when the row carried a `linkCreated` stamp, i.e. it had already been
   * committed to the plan. That plan account is untouched by any of this, and
   * saying so is the difference between a note and an alarm.
   */
  committed: boolean;
  /**
   * Names of the fresh rows STILL ON THE TABLE that this row's own
   * fingerprint matched, and that the rebase nonetheless refused to identify
   * it with — the ambiguous case, where two standing rows competed for one
   * fresh row and neither could be carried (fix wave 3, I-B).
   *
   * Empty for the ordinary drop: the account simply is not in the new
   * statements, so nothing on screen is it.
   *
   * NON-empty is the dangerous one, and only for a COMMITTED row. That fresh
   * row kept its own identity and its own `{ kind: "new" }` match, so its
   * Commit button re-armed and committing it INSERTs a SECOND plan account
   * for an account the plan already has (measured, wave 4 Task 1). The
   * narrator turns this into a warning instead of a reassurance.
   *
   * A candidate listed here can never have been carried by some OTHER
   * orphan: carrying requires the fresh row to have exactly one claimant,
   * and this row is one of its claimants — so the sole claimant would have
   * to be this row, which would make it carried rather than dropped.
   */
  stillOnTable: string[];
}

/**
 * Could these two rows, which share a `__rowId`, be the same account?
 *
 * WHY A GUARD AT ALL. `__rowId` is minted by `mergeAcrossFiles` from the
 * dedupe key plus the entry's source coordinate. Uploading another statement
 * re-runs that merge over a changed file set, and an id minted in the
 * previous run is not, on its own, proof that the row answering to it now is
 * the row that answered to it then. When it isn't, the join overwrote a real
 * account with a different one's figures and emitted the displaced account as
 * a second, uncommitted copy: one account silently gone, another duplicated.
 *
 * WHY `__provenance.sourceFileId` AND NOTHING ELSE. This was measured, not
 * picked:
 *
 *  - `custodian`, `accountNumberLast4`, `name`, `value`, `basis`, `owner`,
 *    `category`, `subType` are the EIGHT entries of `EDITABLE_ACCOUNT_FIELDS`
 *    (`tools.ts`). An `edit_row` correction changes the STANDING row and
 *    never the freshly-extracted one, so any of them in a fingerprint refuses
 *    a legitimate join the moment the advisor corrects the field — silently
 *    discarding the very correction the rebase exists to preserve. That trades
 *    C-1 for a new defect in the same family.
 *  - `accountNumberLast4` is worse than merely risky: for a keyed account row
 *    the dedupe key IS the last-4, and the key is already a segment of the id
 *    both sides matched on. So comparing it adds ZERO discrimination on the
 *    fresh side while adding the full false-rejection risk on the standing
 *    side.
 *  - `__provenance` is not on `EDITABLE_ACCOUNT_FIELDS`, and `edit_row`'s
 *    allowlist rejects it by name. `merge_rows` keeps the SURVIVOR's own
 *    provenance (`unionAccountFields` skips every annotation key), so a merge
 *    cannot move it either. Its `section` is a constant here and `pageRange`
 *    is optional, so `sourceFileId` is the whole of the usable signal.
 *
 * WHAT IT COSTS. A merged entry's provenance tracks the entity's minimum
 * coordinate, exactly as its `__rowId` now does — so for rows this merge
 * produced the two agree by construction and this test cannot fire on a
 * correct join. It fires on an id minted under a DIFFERENT derivation (an
 * import still in review from before the coordinate ordinal landed) and on
 * any future drift that decouples the two. Defence in depth, deliberately.
 *
 * A MISSING side is not evidence of anything, so it adopts — the direction
 * that preserves the advisor's work, and the one every row in this module's
 * older tests relies on.
 */
function plausiblySameAccount(standing: AccountRow, fresh: AccountRow): boolean {
  const standingFile = standing.__provenance?.sourceFileId;
  const freshFile = fresh.__provenance?.sourceFileId;
  if (standingFile === undefined || freshFile === undefined) return true;
  return standingFile === freshFile;
}

/**
 * Same institution? `normalizeCustodian` + `custodianMatches` — the same pair
 * `mergeAcrossFiles`'s own `isSameEntity` uses to keep a Schwab statement out
 * of a Fidelity account that shares four masked digits, so the rebase cannot
 * disagree with the merge about what one institution is.
 *
 * A null on either side matches only another null, the direction both that
 * function and `rollups.ts` already take: a row with no readable custodian
 * gives this nothing to compare, and joining it to a named one blind is how
 * two real accounts become one.
 *
 * WHY CUSTODIAN IS RIGHT HERE AND WRONG IN `plausiblySameAccount`. It is on
 * `EDITABLE_ACCOUNT_FIELDS`, so an advisor who corrects a misread institution
 * makes the two sides disagree. In the guard above that costs a LEGITIMATE
 * join and silently discards the correction — a new defect. Here it costs a
 * re-attachment that would not have happened at all before this wave, so the
 * row is dropped exactly as it was, and now reported. A false negative is the
 * status quo; a false positive moves money onto the wrong account.
 */
function sameInstitution(standing: AccountRow, fresh: AccountRow): boolean {
  const a = normalizeCustodian(standing.custodian);
  const b = normalizeCustodian(fresh.custodian);
  if (a === null || b === null) return a === b;
  return custodianMatches(a, b);
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
 * Pair each ORPHANED persisted row — one whose `__rowId` has no counterpart
 * in the fresh set — with the fresh row that is genuinely the same account,
 * and return `freshRowId -> persistedRowId`: the identity to carry forward.
 *
 * "Persisted" covers BOTH sets of ids the chat slice keeps: the standing rows
 * (`payload.accounts`, which `committedRowIds` names) and the rows the
 * advisor retired (`chat.excludedRows`). They are the same problem — an id
 * minted by an earlier merge — so they get the same pass, and competing
 * across both is what stops a standing row from quietly taking the fresh row
 * that is really an exclusion (fix wave 3, I-A).
 *
 * WHY THIS EXISTS. `__rowId` is DERIVED, from the dedupe key plus the entry's
 * minimum member coordinate. Uploading a newer statement for an account
 * already on the import merges into that entry, and if the new file's id
 * sorts lower the minimum — and so the id — moves. Three waves have now tried
 * to make a derived id stable across a re-extraction; it cannot be, because a
 * derived id is a function of the input set and re-extraction changes the
 * input set by definition. Identity has to be ASSIGNED ONCE and carried
 * forward, and this is the boundary where the advisor's work lives.
 *
 * THE FINGERPRINT is the BUCKET half of the id (`keyedRowIdBucket`) plus the
 * institution. The bucket half is the merge's own dedupe key — the masked
 * last-4 for accounts — and it is the one part of the id a new file cannot
 * move. It is also not editable: it is read off the id both sides were minted
 * with, NOT off `accountNumberLast4`, so an advisor correcting a misread
 * masked number does not lose their row. The institution test is what stops
 * the bucket being used alone: post-Task-12 the key is the last-4 ALONE, so a
 * Fidelity IRA and a Schwab brokerage sharing four digits are one bucket —
 * the exact pair C-1 was built from.
 *
 * A NULL-KEY id (`${label}:null:${fileId}:${index}:${name}`) returns `null`
 * from `keyedRowIdBucket` and is never re-attached. It does not need to be:
 * that id is already scoped to its own file and index, so adding a file
 * cannot move it.
 *
 * ONLY UNAMBIGUOUS 1:1 PAIRS are accepted — the orphan must have exactly one
 * candidate AND that candidate exactly one claimant. Two standing rows
 * competing for one fresh row (the extractor's owner guess stopped flipping,
 * so two entries became one) has no right answer, and picking one is the
 * coin flip C-1 already cost. Requiring both directions also makes the result
 * independent of the order the orphans are considered in.
 *
 * A refused pair is not free, which is why `candidatesFor` comes back out:
 * the fresh row keeps its own `{ kind: "new" }` match, so if the orphan had
 * been committed its Commit button re-arms and committing it adds a SECOND
 * plan account. The caller names those rows in the drop caveat (I-B).
 *
 * UNIQUENESS — the trap. A carried-forward id cannot collide with an id
 * already in the fresh set:
 *  - an orphan's id is, by definition, absent from `freshByRowId`, so it
 *    cannot equal the id of any fresh row that keeps its own;
 *  - every fresh row is claimed at most once — `claimed` holds the ones an id
 *    match already took (a standing row's, or a retired row's), and the 1:1
 *    rule gives each remaining candidate a single claimant — so no fresh row
 *    is re-stamped twice;
 *  - two orphans cannot carry the same id: both orphan maps are keyed BY id,
 *    and the union of two such maps collapses a shared key too.
 * Pinned by "never mints a duplicate __rowId when it carries an id forward".
 */
function reattachOrphans(
  orphans: ReadonlyMap<string, AccountRow>,
  freshMerged: AccountRow[],
  claimed: ReadonlySet<string>,
): { carried: Map<string, string>; candidatesFor: Map<string, string[]> } {
  const candidatesFor = new Map<string, string[]>();
  const claimantCount = new Map<string, number>();

  for (const [persistedId, held] of orphans) {
    const bucket = keyedRowIdBucket(persistedId);
    if (bucket === null) continue;
    const candidates = freshMerged
      .filter((fresh) => {
        const freshId = fresh.__rowId;
        if (!freshId || claimed.has(freshId)) return false;
        return keyedRowIdBucket(freshId) === bucket && sameInstitution(held, fresh);
      })
      .map((fresh) => fresh.__rowId as string);
    if (candidates.length === 0) continue;
    candidatesFor.set(persistedId, candidates);
    for (const freshId of candidates) {
      claimantCount.set(freshId, (claimantCount.get(freshId) ?? 0) + 1);
    }
  }

  const carried = new Map<string, string>();
  for (const [persistedId, freshIds] of candidatesFor) {
    if (freshIds.length !== 1) continue;
    if (claimantCount.get(freshIds[0]) !== 1) continue;
    carried.set(freshIds[0], persistedId);
  }
  // `candidatesFor` travels back out so a REFUSED orphan can say which rows
  // on the table its own fingerprint matched — see `RebaseDrop.stillOnTable`.
  return { carried, candidatesFor };
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
 * Fix wave 2: a standing row whose id has NO counterpart in the fresh set is
 * no longer lost on sight. `reattachOrphans` looks for the fresh row that is
 * genuinely the same account and carries the STANDING row's id onto it, which
 * is what keeps `committedRowIds` pointing at it. One with no counterpart the
 * fingerprint will accept still disappears — it is absent from `freshMerged`
 * and the loop only ever emits fresh rows — but it comes out in `dropped` so
 * the advisor is told rather than left to notice.
 *
 * Fix wave 3: this is the ONE reconciliation every consumer of a persisted
 * id runs, rather than three that re-derive independently and disagree.
 * `__rowId` is DERIVED from the input set, and a re-extraction changes the
 * input set by definition — so any consumer that re-computes ids and then
 * compares them against a decision the advisor made EARLIER is comparing two
 * different namespaces. The table (`chat/extract`) was fixed in wave 2;
 * `chat/finalize`'s close gate (C-A) and the chat-exclusion subtraction
 * (I-A) were not, and both now come through here. `opts.retiredRows` is what
 * lets the second one: an exclusion's id is carried forward exactly like a
 * standing row's, so the caller's subtraction is unchanged.
 *
 * For a row present in BOTH sets the standing row wins wholesale, so a
 * re-merge that would have moved that row's balance (a newer statement
 * superseding an older one for the same account) does not move it on screen.
 * Nothing here can tell an advisor's correction apart from an untouched
 * extracted value, and silently overwriting a reviewed figure behind the
 * advisor's back is the worse of the two failures — the whole point of I1 is
 * that a correction must not evaporate.
 *
 * Final review #2, C-1: a standing row only wins its counterpart's slot when
 * the two are plausibly the same account (`plausiblySameAccount`). One that
 * is refused comes out in `refusals` instead of being applied, so a recycled
 * id can no longer overwrite a different account behind the advisor's back.
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
 *
 * The same silent hold-back happens one level down, in `holdingsOverrides`:
 * a newer statement's POSITIONS under an account already on the table are
 * held back too, even when the account's own balance did not change at all.
 */
export function rebaseOntoFreshMerge(
  freshMerged: AccountRow[],
  standing: AccountRow[],
  opts?: {
    /**
     * The rows the advisor has already retired in the chat — `drop_row`, or
     * the half an irreversible `merge_rows` folded away — exactly as
     * persisted in `chat.excludedRows`, each carrying the `__rowId` it had
     * AT THE MOMENT the advisor retired it.
     *
     * Fix wave 3, I-A: these are the OTHER ids the chat slice persists, and
     * they drift for exactly the same reason a standing row's does. They are
     * reconciled by the SAME pass here, so the caller's
     * `chatExcludedIds.has(row.__rowId)` subtraction and `finalize`'s
     * `missing` predicate keep working unchanged — the fresh row genuinely
     * IS the excluded id once this returns.
     *
     * Pass ONLY the advisor's own exclusions (`advisorRetiredRows`), never a
     * rollup exclusion: a rollup is re-derived by `detectRollups` on every
     * read and is not in `freshMerged` at all, so reconciling it could only
     * ever contest a real row's re-attachment.
     */
    retiredRows?: readonly AccountRow[];
  },
): {
  rows: AccountRow[];
  overrides: RebaseOverride[];
  holdingsOverrides: RebaseHoldingsOverride[];
  refusals: RebaseRefusal[];
  dropped: RebaseDrop[];
} {
  const freshByRowId = new Map(
    freshMerged.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );

  // Ruling 146: the guard runs HERE, at the rebase boundary, and NOT inside
  // `mergeAccountsByRowId`. That function is shared with the turn route,
  // where both arrays come from the SAME extraction — no id can have been
  // recycled there, `__rowId` is a valid identity, and that path has no
  // defect to fix. It must not absorb this one's risk.
  const refusals: RebaseRefusal[] = [];
  // Fresh rows already spoken for — by an id match, refused or not. A refused
  // row's fresh counterpart keeps its own slot, so it is claimed either way.
  const claimed = new Set<string>();
  // Keyed by id, so two standing rows sharing one (jsonb carries whatever was
  // written) collapse the same way `mergeAccountsByRowId`'s own Map collapses
  // them, and an id can never be carried forward twice.
  const orphans = new Map<string, AccountRow>();
  for (const held of standing) {
    const id = held.__rowId;
    if (!id) continue;
    const fresh = freshByRowId.get(id);
    if (!fresh) {
      orphans.set(id, held);
      continue;
    }
    claimed.add(id);
    if (plausiblySameAccount(held, fresh)) continue;
    refusals.push({ __rowId: id, name: held.name, freshName: fresh.name });
  }

  // ONE reconciliation, not three. `committedRowIds` rides on the standing
  // rows above; `chat.excludedRows` is the other place the chat slice
  // persists an id minted by an earlier merge, and it drifts identically
  // (fix wave 3, I-A). Both are reconciled by the same pass, on the same
  // fingerprint, under the same 1:1 rule — so a retired row and a standing
  // row can never both claim one fresh row without the ambiguity being seen.
  const retiredOrphans = new Map<string, AccountRow>();
  for (const retired of opts?.retiredRows ?? []) {
    const id = retired.__rowId;
    if (!id) continue;
    if (freshByRowId.has(id)) {
      // The exclusion still names a row in THIS merge: nothing to carry, and
      // the fresh row is spoken for. A standing orphan must never re-attach
      // onto it — the carried id would no longer be the excluded one, the
      // caller's subtraction would miss, and a row the advisor explicitly
      // dropped would come back on screen.
      claimed.add(id);
      continue;
    }
    // jsonb carries whatever was written, so an id could in principle appear
    // on both lists. The standing row is the one on screen; it wins.
    if (orphans.has(id)) continue;
    retiredOrphans.set(id, retired);
  }

  // Keyed by id in BOTH maps, so the union collapses a shared id the same
  // way each half does and no id can be carried forward twice.
  const { carried, candidatesFor } = reattachOrphans(
    new Map([...orphans, ...retiredOrphans]),
    freshMerged,
    claimed,
  );
  const carriedStandingIds = new Set(carried.values());
  // Walked in STANDING order (not orphan order) so a row carrying no id is
  // reported in its place on the table rather than in a trailing group of its
  // own. A RETIRED orphan that could not be carried is deliberately not
  // reported at all: the advisor removed it on purpose and it is not on the
  // table to vanish from.
  const dropped: RebaseDrop[] = [];
  const reported = new Set<string>();
  for (const row of standing) {
    // Same falsy test the orphan collection above uses, so an empty-string id
    // is "no id" in both places rather than a row that is silently neither.
    const id = row.__rowId || undefined;
    // For an id, the row this function treats as standing for it is the LAST
    // one written under it — matching `orphans` and `mergeAccountsByRowId`.
    // An id-less row is never in `orphans` at all, and is the M-A case.
    const held = id === undefined ? row : orphans.get(id);
    if (!held) continue; // matched a fresh row by id, so it did not leave
    if (id !== undefined) {
      if (carriedStandingIds.has(id) || reported.has(id)) continue;
      reported.add(id);
    }
    dropped.push({
      __rowId: id,
      name: held.name,
      committed: held.match?.kind === "exact",
      stillOnTable: (id === undefined ? [] : (candidatesFor.get(id) ?? []))
        .map((freshId) => freshByRowId.get(freshId)?.name)
        .filter((name): name is string => name !== undefined),
    });
  }

  // Re-attachment is EXPRESSED as re-stamping the fresh row's slot with the
  // identity being carried onto it. Everything downstream — the id join, the
  // override comparison, the caller's `committedRowIds` and `chatExcludedIds`
  // lookups — then works unchanged, because the row genuinely IS that id now.
  const base = freshMerged.map((r) => {
    const carriedId = r.__rowId === undefined ? undefined : carried.get(r.__rowId);
    return carriedId === undefined ? r : { ...r, __rowId: carriedId };
  });

  // A refused row is withheld from the CHANGED set, so the fresh row keeps
  // its own slot untouched. It is never appended alongside: putting it back
  // would be the duplicate half of the same failure.
  const refused = new Set(refusals.map((r) => r.__rowId));
  const adopted = standing.filter((r) => !(r.__rowId && refused.has(r.__rowId)));
  const rows = mergeAccountsByRowId(base, [], adopted);

  // Computed HERE, against the ADOPTED standing rows and `base`
  // directly, rather than
  // inside `mergeAccountsByRowId` — that function is the shared mechanism the
  // turn route also depends on, where "changed" means reference inequality
  // against a real start snapshot and carries no figure to report.
  const standingByRowId = new Map(
    adopted.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );

  const overrides: RebaseOverride[] = [];
  const holdingsOverrides: RebaseHoldingsOverride[] = [];
  for (const fresh of base) {
    const id = fresh.__rowId;
    if (!id) continue;
    const held = standingByRowId.get(id);
    if (!held) continue;

    // Ruling 117, one level down. The standing row winning wholesale is what
    // makes a holdings EDIT survive a re-extraction — and the same rule means
    // a NEWER statement's positions never reach an account already on the
    // table. Silently, until here. Who wins does not change; the advisor
    // being told does.
    //
    // R41 (fix round 1, I1): tombstones live ONLY on the standing side
    // (`base` comes from `mergeAcrossFiles`, which never sets `__dropped`),
    // so a position the advisor already dropped in the chat has to be
    // subtracted from the FRESH side before comparing — otherwise the
    // fresh side still carries it and the advisor's OWN edit reads as the
    // newer statement adding a position back. That is the tombstone's
    // documented purpose (`extraction/types.ts`: "stays in the array so the
    // next extraction cannot resurrect it") — resurrecting it into THIS
    // caveat is the same failure. The subtraction governs the COMPARISON
    // only; the reported counts and sums come off `freshLivingAll` (see the
    // override push below).
    const standingLiving = livingHoldings(held);
    const tombstoned = tombstonedHoldings(held);
    const freshLivingAll = livingHoldings(fresh);

    // R39 (fix round 1, I2): identity for "same position set" is chosen ONCE
    // PER COMPARISON, not per holding. `__holdingId` is the edit-stable
    // handle `stampHoldingIds` mints for every position `mergeAcrossFiles`
    // produces — the fresh side always has it — but a standing row that
    // predates this branch (or was persisted before the last merge ran) may
    // carry none. Falling back to `holdingKey` per HOLDING compares two
    // different identities across the two sides: the same real position
    // gets a bare "AAPL" on one side and "t:AAPL#0" on the other, which can
    // never match — a false override on a position set that did not change.
    // Keying BOTH sides on `holdingKey` unconditionally is also wrong:
    // ticker/name are on `EDITABLE_HOLDING_FIELDS`, so an advisor correcting
    // a misread ticker would make the sides disagree and blame the newer
    // statement (see `sameInstitution`'s docstring for the account-level
    // version of this same rule). So: `__holdingId` only when EVERY holding
    // on BOTH sides already carries one — the only shape the route
    // produces — else `holdingKey` on both. The mixed shape then cannot
    // arise.
    const bothFullyStamped =
      standingLiving.every((h) => h.__holdingId !== undefined) &&
      freshLivingAll.every((h) => h.__holdingId !== undefined);
    const identity = (h: ExtractedHolding): string =>
      bothFullyStamped ? (h.__holdingId as string) : holdingKey(h);

    const tombstonedKeys = new Set(tombstoned.map(identity));
    const freshLiving = freshLivingAll.filter((h) => !tombstonedKeys.has(identity(h)));

    const a = standingLiving.map(identity).sort();
    const b = freshLiving.map(identity).sort();
    const same = a.length === b.length && a.every((k, i) => k === b[i]);
    if (!same) {
      holdingsOverrides.push({
        __rowId: id,
        name: held.name,
        standingCount: standingLiving.length,
        // `freshLivingAll`, NOT the subtracted `freshLiving`. The subtraction
        // above exists to stop the advisor's own drop reading as the newer
        // statement ADDING a position back — that is a question about whether
        // the position SETS differ, so it belongs to the comparison and only
        // to the comparison. These two fields are rendered by `narrate` as a
        // claim about the document ("The newer statement lists N positions for
        // X ($Y)"), so reporting the subtracted set states something false:
        // a statement listing AAPL, VTI and BND, with VTI dropped by the
        // advisor, would be narrated as listing 2 positions worth $350 when it
        // lists 3 worth $750. Compare on the subtracted set, report on the set
        // the statement actually carries.
        freshCount: freshLivingAll.length,
        // `holdingMarketValue`, not a bare `marketValue ?? 0`: it is the
        // repo's one definition of a position's value and DERIVES
        // shares * price when the statement gave those instead — the
        // extraction prompt explicitly allows that shape, and these sums
        // are advisor-facing money.
        standingSum: standingLiving.reduce((s, h) => s + holdingMarketValue(h), 0),
        freshSum: freshLivingAll.reduce((s, h) => s + holdingMarketValue(h), 0),
      });
    }

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
      // ...and the fresh survivor's, which is what the merge's decision log
      // names. They differ exactly when the advisor has renamed the row
      // (Ruling 128).
      freshName: fresh.name,
      __rowId: id,
      standingValue: held.value,
      freshValue: fresh.value,
    });
  }

  return { rows, overrides, holdingsOverrides, refusals, dropped };
}
