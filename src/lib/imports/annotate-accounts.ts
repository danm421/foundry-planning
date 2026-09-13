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
 */
export function claimOnce<T, C extends { id: string }>(
  rows: T[],
  candidates: C[],
  annotate: (row: T, available: C[], claimed: ReadonlySet<string>) => MatchAnnotation,
): Array<T & { match: MatchAnnotation }> {
  const claimed = new Set<string>();
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
): Array<T & { match: MatchAnnotation }> {
  return claimOnce(rows, candidates, (row, available) =>
    matchAccount(row, available, resolveOwnerIdsForMatching(row, family)),
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
