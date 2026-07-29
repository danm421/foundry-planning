import type { AccountCategory, ExtractedAccount } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import { custodianMatches, normalizeCustodian } from "../normalize-custodian";
import type { MatchAnnotation } from "../types";

export interface AccountCandidate {
  id: string;
  name: string;
  /**
   * Mirrors the DB `account_category` enum, which matches extraction's
   * `AccountCategory` value for value. Category is only a scoring input in the
   * ladder below, so a 529 that extraction classified as `taxable` + subType
   * "529" instead of `education_savings` still surfaces as a candidate — it
   * merely forfeits the category weight.
   */
  category: AccountCategory;
  accountNumberLast4: string | null;
  custodian: string | null;
  value: number;
  /**
   * family_member ids from `account_owners`. Optional: absent means "ownership
   * unknown", which scores neutrally rather than as a mismatch. Entity- and
   * external-beneficiary-owned accounts contribute no ids.
   */
  ownerIds?: string[];
}

/** Relative weights; sum to 1. */
const W_NAME = 0.45;
const W_OWNER = 0.25;
const W_CATEGORY = 0.2;
const W_VALUE = 0.1;

/**
 * Below this a candidate is not worth showing in the picker.
 *
 * Calibrated at 0.45 deliberately. A candidate with a completely different
 * name but matching category and value scores 0.425 (0 + 0.125 neutral owner +
 * 0.2 + 0.1) and is correctly excluded — "Vanguard Fund" is not a plausible
 * pick for "Schwab Brokerage" on category and value alone. But the same
 * candidate with *corroborating ownership* scores 0.55 and does surface, which
 * is the genuinely useful renamed-account case. Lowering this to 0.4 readmits
 * the noise; raising it past 0.55 loses renamed accounts.
 */
const SCORE_FLOOR = 0.45;
const MAX_CANDIDATES = 5;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
}

/**
 * Credit for a token that matches only after absorbing a typo. Strictly less
 * than an exact match's 1.0 so an exactly-named candidate always outranks a
 * near-named one; high enough that OCR noise doesn't sink a real match.
 */
const TYPO_MATCH_CREDIT = 0.8;

/**
 * Token-overlap similarity, 0..1, tolerant of a single typo per token.
 *
 * Plain edit distance is the wrong metric once names are condensed: "Fidelity
 * Rollover IRA" and "Fidelity IRA" are 9 edits apart but are obviously the same
 * account. Token overlap scores that 2/3. The bounded-Levenshtein fallback per
 * token additionally absorbs OCR typos ("Brokrage" vs "Brokerage").
 *
 * Typo'd tokens earn only partial credit rather than full credit, so an
 * exact-name candidate always outranks a near-name one. Scoring both at 1.0
 * would tie "Schwab Brokerage" with "Schwab Brokrage" and let input order
 * decide which the advisor sees first.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const used = new Set<number>();
  let score = 0;
  for (const t of ta) {
    let idx = tb.findIndex((u, j) => !used.has(j) && u === t);
    let credit = 1;
    if (idx < 0 && t.length >= 4) {
      idx = tb.findIndex(
        (u, j) => !used.has(j) && boundedLevenshtein(t, u, 1) >= 0,
      );
      credit = TYPO_MATCH_CREDIT;
    }
    if (idx >= 0) {
      used.add(idx);
      score += credit;
    }
  }
  return score / Math.max(ta.length, tb.length);
}

/** 1 identical, 0 disjoint, 0.5 when either side's ownership is unknown. */
function ownerAgreement(incoming: string[], candidate: string[] | undefined): number {
  if (incoming.length === 0 || !candidate || candidate.length === 0) return 0.5;
  const set = new Set(candidate);
  let shared = 0;
  for (const id of incoming) if (set.has(id)) shared += 1;
  const union = new Set([...incoming, ...candidate]).size;
  return union === 0 ? 0.5 : shared / union;
}

/** 1 identical, decaying to 0 at a 100%+ gap. 0.5 when the value is unknown. */
function valueProximity(incoming: number | undefined, candidate: number): number {
  if (incoming === undefined || !Number.isFinite(incoming)) return 0.5;
  const base = Math.max(Math.abs(candidate), Math.abs(incoming), 1);
  return Math.max(0, 1 - Math.abs(candidate - incoming) / base);
}

/**
 * Match an extracted account against the household's existing accounts.
 *
 * Only account-number-backed evidence returns `exact` — `exact` auto-writes
 * value, basis, custodian and holdings at commit with no advisor confirmation,
 * so a wrong `exact` silently overwrites the wrong account. Name and owner
 * agreement, however strong, only ever produce a ranked `fuzzy`.
 *
 * `incomingOwnerIds` are family_member ids resolved from the statement's
 * registration hint (see `matchOwnersFromHint`); pass none when unknown.
 */
export function matchAccount(
  incoming: ExtractedAccount,
  existing: AccountCandidate[],
  incomingOwnerIds: string[] = [],
): MatchAnnotation {
  const last4 = incoming.accountNumberLast4?.trim();
  const incomingCustodian = normalizeCustodian(incoming.custodian);

  if (last4) {
    const sameLast4 = existing.filter((a) => a.accountNumberLast4 === last4);

    // Rung 1: custodian agrees and singles out exactly one candidate.
    if (incomingCustodian) {
      const agreeing = sameLast4.filter((a) => {
        const c = normalizeCustodian(a.custodian);
        return c !== null && custodianMatches(incomingCustodian, c);
      });
      if (agreeing.length === 1) {
        return { kind: "exact", existingId: agreeing[0].id };
      }
    }

    // Rung 2: the last4 is unique among candidates and no KNOWN custodian
    // contradicts it. A Fidelity statement must never auto-merge into a Schwab
    // account just because both end in 1234.
    if (sameLast4.length === 1) {
      const existingCustodian = normalizeCustodian(sameLast4[0].custodian);
      const contradicts =
        incomingCustodian !== null &&
        existingCustodian !== null &&
        !custodianMatches(incomingCustodian, existingCustodian);
      if (!contradicts) {
        return { kind: "exact", existingId: sameLast4[0].id };
      }
    }
  }

  // Fuzzy: score every candidate, rank, and let the advisor confirm. Category
  // and value are scoring inputs, NOT exclusions — a portfolio routinely moves
  // more than 30% in a year and the extractor misclassifies category often.
  const scored: Array<{ id: string; score: number }> = [];
  for (const a of existing) {
    const score =
      W_NAME * nameSimilarity(a.name, incoming.name) +
      W_OWNER * ownerAgreement(incomingOwnerIds, a.ownerIds) +
      W_CATEGORY * (incoming.category && a.category === incoming.category ? 1 : 0) +
      W_VALUE * valueProximity(incoming.value, a.value);
    if (score >= SCORE_FLOOR) scored.push({ id: a.id, score });
  }

  if (scored.length === 0) return { kind: "new" };
  scored.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: scored.slice(0, MAX_CANDIDATES) };
}
