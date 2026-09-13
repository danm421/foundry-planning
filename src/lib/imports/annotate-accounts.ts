import type { ExtractedAccount } from "@/lib/extraction/types";
import { matchAccount, type AccountCandidate } from "./match-keys/account";
import { resolveOwnersFromHint, type OwnerMatchFamilyMember } from "./owner-match";
import type { Annotated, MatchAnnotation } from "./types";

/**
 * The DB-free half of the account matching pass.
 *
 * Lifted out of `match.ts` (which imports `@/db` at module scope, and so can
 * never be reached from a "use client" component) so the statement-chat review
 * table can annotate its own rows in the browser from a candidate list the page
 * loaded server-side. `match.ts` imports these back, so the wizard and the chat
 * surface run ONE implementation rather than two that drift — the whole point of
 * moving them rather than copying them.
 *
 * Everything here is pure.
 */

/**
 * Annotate `rows` such that no existing record is claimed twice.
 *
 * Each row is matched against only the candidates not yet claimed by an
 * earlier row, so a second row that would have hit the same record degrades
 * rather than hitting it too. Without this the commit step issues two UPDATEs
 * against one record — last-wins — and the other imported row disappears with
 * no warning. Only `exact` claims: `fuzzy` is a ranked suggestion the advisor
 * still has to confirm, so it reserves nothing.
 *
 * A blocked row must not degrade all the way to `new`. `new` is an INSERT at
 * commit, so one account appearing in two overlapping statements would silently
 * become two accounts — double-counting net worth and every projection
 * downstream. So when the normal pass yields `new`, we ask what the row would
 * have matched in an unclaimed world; if that is an `exact` on an id someone
 * else already took, the row is a duplicate, not a new record, and becomes
 * `fuzzy`. Every commit module skips `fuzzy`, so the row writes nothing and
 * renders as "Ambiguous" — the pre-branch outcome, surfaced instead of silent.
 * A row that scores nothing against the FULL candidate set is genuinely new and
 * stays `new`.
 *
 * The probe passes an empty `claimed` rather than only an unfiltered candidate
 * list because `annotateExpenses` reads the set directly (its slot pool is not
 * in `candidates` at all in onboarding mode) — filtering alone would return the
 * post-claim answer and the expenses half would never degrade.
 *
 * `preClaimed` seeds the set with records already spoken for by rows this call
 * is NOT annotating — `reannotateAccountRows` below re-derives only the
 * undecided rows, and the decided ones' links have to stay reserved. Seeding
 * rather than pre-filtering `candidates` is deliberate: the duplicate probe
 * above reads the SET, so a pre-filtered list would hide the collision and the
 * duplicate row would degrade to `new` — an INSERT, the double-count this whole
 * function exists to prevent.
 */
export function claimOnce<T, C extends { id: string }>(
  rows: T[],
  candidates: C[],
  annotate: (row: T, available: C[], claimed: ReadonlySet<string>) => MatchAnnotation,
  preClaimed: Iterable<string> = [],
): Array<T & { match: MatchAnnotation }> {
  const claimed = new Set<string>(preClaimed);
  return rows.map((row) => {
    const available = candidates.filter((c) => !claimed.has(c.id));
    const match = annotate(row, available, claimed);
    if (match.kind === "exact") {
      claimed.add(match.existingId);
      return { ...row, match };
    }
    if (match.kind === "new" && claimed.size > 0) {
      const unclaimed = annotate(row, candidates, new Set<string>());
      if (unclaimed.kind === "exact" && claimed.has(unclaimed.existingId)) {
        // Empty `candidates` deliberately: the picker builds its option list
        // from the component's own `candidates` prop via `candidatesForRow`,
        // not from this annotation, so carrying the blocked id here would gain
        // the advisor nothing and would only invite them to re-select the
        // record another row already claimed — recreating the double-UPDATE
        // claimOnce exists to prevent.
        return { ...row, match: { kind: "fuzzy", candidates: [] } };
      }
    }
    return { ...row, match };
  });
}

/**
 * Resolve an extracted account's owners to family_member ids for *matching*,
 * reusing the same registration-hint parser the commit step uses so the two
 * agree on who owns what.
 *
 * ONLY a `"hint"` resolution is forwarded — one where the statement's verbatim
 * registration line actually named somebody on the roster. The other two
 * sources are guesses, and a guess is worse than silence here because
 * `ownerAgreement` has no "maybe": it scores 1.0 or 0.0, never the neutral 0.5
 * it reserves for genuinely unknown ownership.
 *
 * - `"default"` is the parser's trailing "somebody has to own it, so use the
 *   client" fallback. Correct when WRITING an account, a fabrication when
 *   matching one: it zeroes the owner term against every spouse-owned
 *   candidate, pushing a genuine renamed-account match under SCORE_FLOOR and
 *   out of the picker entirely.
 * - `"coarse"` is the model's inferred client/spouse/joint enum.
 *   `prompts/account-statement.ts` tells the extractor to fill it by inferring
 *   "from account title or registration", so it is present on essentially every
 *   row and asserted with the same confidence whether the registration was
 *   unambiguous or absent. Scoring it as evidence was the more damaging half:
 *   W_OWNER (0.25) + W_CATEGORY (0.20) is exactly SCORE_FLOOR (0.45) under a
 *   `>=` test, so a correctly-guessed owner plus an agreeing category cleared
 *   the floor with ZERO name overlap — making name, the point of that ladder,
 *   decorative on the dominant production path.
 *
 * The cost is real and accepted: an account registered to a trust, or to anyone
 * else off the roster, no longer earns owner credit from the coarse enum, so a
 * renamed one can fall under the floor and be offered as `new`. That forgoes a
 * gain rather than causing a regression — and the wrongly-surfaced direction is
 * the more expensive error, since a `fuzzy` row is skipped at commit while a bad
 * merge overwrites.
 */
export function resolveOwnerIdsForMatching(
  row: { ownerNameHint?: string; owner?: "client" | "spouse" | "joint" },
  family: OwnerMatchFamilyMember[],
): string[] {
  if (family.length === 0) return [];
  const { owners, source } = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
  if (source !== "hint") return [];
  // Narrowing only — this parser never emits entity or external-beneficiary
  // owners, but AccountOwner is a union and the ids have to be extracted.
  return owners.flatMap((o) => (o.kind === "family_member" ? [o.familyMemberId] : []));
}

/**
 * Stamp `match` on every account row, one existing record per row.
 *
 * The accounts line of `annotatePayload`, extracted verbatim so the browser can
 * run it too. `family` is the household roster; pass `[]` when it is unknown,
 * which costs the owner term its evidence and nothing else.
 */
export function annotateAccountRows<T extends ExtractedAccount>(
  rows: T[],
  candidates: AccountCandidate[],
  family: OwnerMatchFamilyMember[],
  preClaimed: Iterable<string> = [],
): Array<T & { match: MatchAnnotation }> {
  return claimOnce(
    rows,
    candidates,
    (row, available) => matchAccount(row, available, resolveOwnerIdsForMatching(row, family)),
    preClaimed,
  );
}

/**
 * True when `match` is a stamp this pass may overwrite.
 *
 * Re-annotating is safe for a row nobody has ruled on — a fresh row, or one the
 * matcher itself last labelled. It is NOT safe for a row carrying a decision:
 * an `exact` is either the advisor's explicit pick or the `linkCreated` stamp a
 * completed commit wrote, and re-deriving over either one silently relinks a row
 * to a different account than the one it actually wrote to. `matchLocked` is how
 * an advisor's deliberate "create as new" survives the same way — without it,
 * the next annotation pass would quietly re-suggest the match they just rejected.
 */
export function isReannotatable<T>(row: Annotated<T>): boolean {
  if (row.matchLocked) return false;
  return row.match == null || row.match.kind === "new" || row.match.kind === "fuzzy";
}

/**
 * Whether two annotations say the same thing.
 *
 * Not a general deep-equal — it exists so `reannotateAccountRows` can hand back
 * the SAME row object when a re-run changed nothing. Without that, a `fuzzy`
 * row (which stays re-annotatable forever, by design) would get a fresh object
 * on every pass, the effect that calls this would set state, the state change
 * would re-run the effect, and the review table would spin.
 */
function sameMatch(a: MatchAnnotation | undefined, b: MatchAnnotation | undefined): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "exact") return a.existingId === (b as { existingId: string }).existingId;
  if (a.kind === "fuzzy") {
    const other = (b as { candidates: Array<{ id: string; score: number }> }).candidates;
    return (
      a.candidates.length === other.length &&
      a.candidates.every((c, i) => c.id === other[i].id && c.score === other[i].score)
    );
  }
  return true;
}

/**
 * Re-derive `match` for the rows nobody has ruled on, leaving the rest alone.
 *
 * The chat review table has no server matching pass — `chat/extract/route.ts`
 * never annotates — so the browser runs one over the candidates the page
 * loaded. It runs repeatedly (every extraction, every turn, every edit), which
 * is what makes the two guards below load-bearing rather than decorative:
 *
 * - Rows failing `isReannotatable` are passed through UNTOUCHED, and any
 *   existing account they are matched to is handed to `annotateAccountRows` as
 *   already-claimed. Skipping them without reserving their links would let an
 *   undecided row claim an account a committed row is already writing to — two
 *   UPDATEs against one record, last-wins.
 * - A row whose re-derived match is identical to the one it already has keeps
 *   its original object, and an unchanged set returns the SAME array. The
 *   caller's `rows === prev.rows` check is then enough to bail out of the state
 *   update entirely.
 */
export function reannotateAccountRows<T extends ExtractedAccount>(
  rows: Array<Annotated<T>>,
  candidates: AccountCandidate[],
  family: OwnerMatchFamilyMember[],
): Array<Annotated<T>> {
  const open: Array<Annotated<T>> = [];
  const preClaimed: string[] = [];
  for (const row of rows) {
    if (isReannotatable(row)) open.push(row);
    else if (row.match?.kind === "exact") preClaimed.push(row.match.existingId);
  }
  if (open.length === 0) return rows;

  const annotated = annotateAccountRows(open, candidates, family, preClaimed);
  const freshFor = new Map(open.map((row, i) => [row, annotated[i]] as const));

  let changed = false;
  const result = rows.map((row) => {
    const fresh = freshFor.get(row);
    if (!fresh || sameMatch(row.match, fresh.match)) return row;
    changed = true;
    return fresh;
  });
  return changed ? result : rows;
}
