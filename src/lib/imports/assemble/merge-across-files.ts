import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedSavings,
  ExtractedWill,
  ExtractionResult,
} from "@/lib/extraction/types";
import { accountLast4, documentVouchesForLast4 } from "@/lib/extraction/account-number";
import { stripLast4Suffix } from "@/lib/extraction/condense-account-name";
import { holdingKey } from "@/lib/extraction/normalize-holdings";
import {
  emptyImportPayload,
  type Annotated,
  type ImportPayload,
  type Provenance,
} from "../types";
import type { MergeDecision } from "./decisions";
import { propertyAddressMatches, splitMortgageEscrow } from "./mortgage-escrow";
import { custodianMatches, normalizeCustodian } from "../normalize-custodian";
import { nameSimilarity } from "../match-keys/account";

export interface MergeAcrossFilesResult {
  payload: ImportPayload;
  mergedFileCount: number;
  /**
   * Structured facts about what the merge collapsed, in bucket order. A
   * parallel channel to `payload.warnings` — the warnings are the shipped
   * wizard copy, these are machine-readable so a narrator can only say what
   * actually happened. Additive: existing callers destructure `{ payload,
   * mergedFileCount }` and are unaffected.
   */
  decisions: MergeDecision[];
}

/** Two amounts are "the same" if they're within this fraction of each other. */
const AMOUNT_TOLERANCE_PCT = 0.01;

/**
 * True when `a` and `b` are close enough to treat as the same figure across
 * two documents. Both-undefined counts as a match (nothing to contradict);
 * exactly one undefined does not (conservative — don't guess).
 */
function withinTolerance(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) / base <= AMOUNT_TOLERANCE_PCT;
}

function countNonNullFields(row: Record<string, unknown>): number {
  return Object.values(row).filter((v) => v !== undefined && v !== null).length;
}

/** Advisor-facing whole-dollar formatting for a value-conflict warning. Kept
 * local (this module stays dependency-free — see gap-fill.ts's header
 * comment for the same convention) rather than pulling in a shared currency
 * formatter from an unrelated feature. */
function formatMoney(n: number | undefined): string {
  if (n === undefined) return "unknown";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Normalize a printed registration name for EXACT comparison: lowercase,
 * every run of non-alphanumerics collapsed to one space, trimmed. Returns
 * null when nothing survives.
 *
 * Deliberately NOT `normalizeCustodian` (which also strips trailing legal
 * suffixes, wrong for a person's name) and NOT `owner-match.ts`'s
 * `tokenize` + `nameMatches` pair (which drops digits and absorbs a
 * Levenshtein typo — a fuzzy rule, and fuzziness here would merge two real
 * accounts belonging to two family members whose names are one edit apart).
 * Nothing in `src/lib/imports/` offered exact-equality-after-cleanup for a
 * person name, so this is a local helper.
 */
function normalizeOwnerNameHint(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s || null;
}

/**
 * Whether two registration names name two DIFFERENT people — the only question
 * `backfillMissingCustodians` can ask a hint that is worth acting on.
 *
 * Deliberately asked in the negative, and deliberately tolerant, because the
 * caller uses the answer to REMOVE a candidate. A false "different people"
 * drops the true candidate and can leave a rival institution standing as the
 * only one, which is how an inferred custodian would send a row into another
 * account's bucket. So anything short of a contradiction has to read as "no
 * objection": an absent hint on either side, and any pair of spellings that
 * could be one person written two ways.
 *
 * Both of those shapes are in the production corpus for ONE man: "MICHAEL
 * SHARESKY" on his Voya statements, "MICHAEL V SHARESKY" plus the custodian's
 * registration boilerplate on his Schwab ones. So the test is word
 * CONTAINMENT, not equality — every word of the shorter reading has to appear
 * in the longer one. A middle initial drops out with the other one-character
 * words, and "CHARLES SCHWAB & CO INC CUST" is extra words rather than
 * disagreeing ones.
 *
 * What it does catch is a different given name, which is the whole reason it
 * exists: "MICHAEL SHARESKY" against Jennifer's "GE2702Jennifer Sharesky" —
 * OCR dirt and all, since this never gets clean input — shares only the
 * surname a household shares by definition, so neither covers the other.
 *
 * NOT the same test as `sameAccountOwner`'s, forty lines below, and the
 * divergence is deliberate: that one compares the two hints for EQUALITY and
 * uses the answer to permit a merge, so its tolerant direction is the strict
 * one. Handed the pair above it says "not the same owner" where this says
 * "could be one man" — and both are right for what they gate. Unifying them
 * would let `sameAccountOwner` merge pairs it currently refuses, which is the
 * direction that makes an account disappear, so it wants its own corpus
 * measurement rather than a shared helper.
 */
function hintsNameDifferentPeople(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeOwnerNameHint(a);
  const y = normalizeOwnerNameHint(b);
  if (x === null || y === null) return false;
  return !nameCovers(x, y) && !nameCovers(y, x);
}

/** Every word of `part` worth comparing appears somewhere in `whole`. */
function nameCovers(whole: string, part: string): boolean {
  return part
    .split(" ")
    .filter((word) => word.length >= 2)
    .every((word) => whole.includes(word));
}

/**
 * Do two same-custodian, same-last-4 account rows belong to the same OWNER?
 *
 * `owner` is a `client | spouse | joint` enum the EXTRACTOR guesses. The
 * household role it names appears nowhere on a statement — the page shows a
 * NAME — so the guess is not reproducible: four imports of byte-identical
 * fixtures read in identical order returned `spouse`/`client`,
 * `spouse`/`spouse`, `spouse`/`spouse`, `client`/`spouse` for the same two
 * files (Task 12). `match.ts` already demotes this same field as matching
 * evidence for the same reason.
 *
 * So the enum is no longer a bucket KEY (a flipped guess used to put ONE
 * real account in two buckets, where neither the custodian merge nor the
 * value-conflict rebase could ever see the pair — a double count). It is
 * consulted here instead, with `ownerNameHint` — the verbatim registration
 * name, which the prompt tells the model to copy without normalizing, and
 * which was byte-identical on all four runs — as the discriminator when the
 * guesses disagree.
 *
 * When they disagree and there is no discriminator (either hint absent, or
 * the hints name two different people) the answer is NOT the same owner.
 * That is the same direction the custodian rule below takes for a null
 * custodian: a merge that should not have happened makes a whole account
 * disappear, which is the error that costs money.
 */
function sameAccountOwner(existing: ExtractedAccount, incoming: ExtractedAccount): boolean {
  if (existing.owner === incoming.owner) return true;
  const a = normalizeOwnerNameHint(existing.ownerNameHint);
  const b = normalizeOwnerNameHint(incoming.ownerNameHint);
  if (a === null || b === null) return false;
  return a === b;
}

/**
 * Whether two rows at one custodian, neither carrying a usable account number,
 * are two statements for ONE account.
 *
 * This is the only merge in the file that runs on no account number at all, so
 * it is deliberately the narrowest. Every clause is there to refuse a pair the
 * advisor would have wanted kept apart, because the failure mode here is an
 * account disappearing rather than appearing twice:
 *
 * - Same CATEGORY. A retirement plan and a taxable brokerage at one custodian
 *   share an owner and nothing else. SUB-TYPE is deliberately NOT tested with
 *   it: it is the finer of the two model CLASSIFICATIONS and it flips between
 *   readings of one account — measured on Jennifer's Gensler ESOP, read as
 *   `401k` off the March statement and `other` off the June one, which put one
 *   plan in two buckets and booked it twice. A key made of extraction output
 *   inherits the extractor's variance, and the finer the field the more of it
 *   there is. What separates two plan types here is their NAMES, below, which
 *   are read off the page rather than inferred.
 * - DIFFERENT statement dates, both of them real. This is what makes the
 *   pairing "two quarters of one account" rather than "two accounts". It is
 *   also the clause that refuses the shape that has actually lost money here:
 *   four UBS accounts read out of ONE statement, all masked identically, all
 *   dated the same day — they never reach this at all, because one document
 *   carries one date.
 * - Agreeing NAMES. "401(k) Savings Plan" and "401(k) Savings" are one plan
 *   described twice; "401(k) Savings" and "Profit Sharing" are not. A name the
 *   model CLIPPED counts as agreeing — see `isClippedReadingOf`.
 *
 * What it still cannot see: two genuinely different accounts of the same type
 * at one custodian, both unnumbered, both named the same thing, read from
 * statements of different dates. Nothing in the extraction distinguishes those
 * either — and the merge says so, in the balances-differ caveat the advisor
 * gets on the merged row.
 */
function sameUnnumberedAccount(a: ExtractedAccount, b: ExtractedAccount): boolean {
  if (a.category !== b.category) return false;
  const dateA = orderableDate(a.statementDate);
  const dateB = orderableDate(b.statementDate);
  if (dateA === undefined || dateB === undefined || dateA === dateB) return false;
  return (
    nameSimilarity(a.name, b.name) >= NAME_AGREEMENT_ACROSS_STATEMENTS ||
    isClippedReadingOf(a.name, b.name)
  );
}

/**
 * Whether one of two names is the other with the end cut off — the model
 * stopped reading mid-header, so "401(k" and "401(k) Savings" are one plan
 * described twice rather than two plans.
 *
 * MEASURED: `nameSimilarity` scores that pair 0.5 against a 0.6 bar, because
 * the clip costs it a whole token. Lowering the bar is not the answer — 0.6 is
 * exactly what refuses "Profit Sharing" against "401(k) Savings", two real
 * plans at one custodian. A truncation is a different thing from a
 * disagreement, and `betterName` one screen above already says so with the
 * same strict-prefix test; this is that rule reaching the merge decision as
 * well as the display string.
 *
 * The shared-token clause is what keeps a prefix from meaning anything on its
 * own: "40" is a prefix of "401(k) Savings" too, as is any stray character the
 * extractor emitted, and neither shares a whole word with it. Requiring both
 * makes the shorter string a clipped READING of the longer rather than a
 * coincidence.
 *
 * This only ever loosens the NAME clause. A pair still has to clear every
 * other one — same institution, same category, two real and different
 * statement dates — before it is asked about at all.
 */
function isClippedReadingOf(a: string, b: string): boolean {
  // Normalized BEFORE the lengths are compared: a name with trailing
  // whitespace is not the longer reading, and picking the sides off the raw
  // strings would ask `startsWith` the question backwards and silently miss.
  const [shorter, longer] = [a, b]
    .map((name) => name.trim().toLowerCase())
    .sort((x, y) => x.length - y.length);
  if (shorter === longer || !longer.startsWith(shorter)) return false;
  return nameSimilarity(a, b) > 0;
}

/**
 * The name bar for joining two SEPARATE documents, higher than
 * `NAME_AGREEMENT`'s. Within one file a collapse also has the page ranges and
 * a to-the-cent balance behind it; across files the name is most of the case,
 * so it has to carry more of it. 0.6 takes "401(k) Savings Plan" / "401(k)
 * Savings" (two thirds) and refuses "Profit Sharing Plan" / "401(k) Savings
 * Plan" (one third).
 */
const NAME_AGREEMENT_ACROSS_STATEMENTS = 0.6;

/**
 * Backfill any undefined/null field on `base` using the corresponding field
 * from `other`, without touching fields `base` already has populated. Used
 * so that merging two rows unions their non-null fields — the row picked as
 * `base` wins on conflicting fields, but a field only `other` populated is
 * not silently dropped.
 */
function unionFields<T extends object>(base: T, other: T): T {
  const merged: T = { ...base };
  for (const key of Object.keys(other) as Array<keyof T>) {
    const baseValue = merged[key];
    const otherValue = other[key];
    if ((baseValue === undefined || baseValue === null) && otherValue !== undefined && otherValue !== null) {
      merged[key] = otherValue;
    }
  }
  return merged;
}

/**
 * Collapse the same account read TWICE out of ONE document.
 *
 * `extractWithMultiPass` reads a document once per page range the section
 * classifier hands it, and a statement's SUMMARY page is routinely a real
 * `accounts` region alongside each account's own detail pages. Both reads find
 * the same money, so one file emits the account twice: off the cover as
 * "401(k) Savings" / "John Hancock Retirement Plan Services" with no account
 * number, and off pages 3-4 as "401(k) Savings Plan x0210" / "John Hancock" —
 * $361,262.23 on both, to the cent.
 *
 * The cross-file merge below cannot undo it: its bucket key needs a custodian
 * AND a real last-4, and the cover row has neither, so it takes the null-key
 * fallback id and never reaches the detail row's bucket. Both rows land in the
 * advisor's review table and committing books the 401(k) twice.
 *
 * Deliberately here rather than in `extractWithMultiPass`, where the
 * duplication is made. `fileResults` is PERSISTED (assemble/route.ts hands the
 * stored column straight in), so a collapse at extraction time would bake into
 * new extractions only and leave every existing draft duplicated forever —
 * the trap `condense-account-name.ts` documents for itself. Here it is
 * re-derived on every assemble, so old drafts heal, the single-pass path in
 * `extract.ts` is covered too, and `payload.warnings` is in reach to say what
 * happened.
 */

/**
 * The page range the row was read from, when it came from a multi-pass read.
 * `null` for a single-pass row, which read the whole document at once.
 */
function pageRangeOf(row: ExtractedAccount): string | null {
  const provenance = (row as { __provenance?: { pageRange?: [number, number] } }).__provenance;
  const range = provenance?.pageRange;
  return Array.isArray(range) ? `${range[0]}-${range[1]}` : null;
}

/**
 * Two rows that are the same account read twice, rather than two accounts.
 *
 * Requires all three:
 *
 * 1. DIFFERENT page ranges. This is the structural fact the bug is about — the
 *    duplicate exists BECAUSE two reads of one document overlapped in content.
 *    Two rows from the SAME range are two accounts the extractor deliberately
 *    listed side by side, and folding those would delete a real one: a fact
 *    finder listing two $25,000 CDs, or a checking and a savings both at
 *    $10,000, is exactly this function's input. A row with no page range
 *    (single-pass) never collapses, for the same reason.
 * 2. The same balance, to within the merge's own 1%, and NON-ZERO. A zero
 *    balance matches nothing, including another zero (`base` is 0 below): a
 *    document routinely lists several accounts at $0, they are the one set a
 *    value rule cannot tell apart, and folding them would delete real rows on
 *    no evidence.
 * 3. No contradicting account number — two REAL four-digit numbers that differ
 *    are the one piece of evidence that settles it the other way.
 */
function isSameAccountReadTwice(a: ExtractedAccount, b: ExtractedAccount): boolean {
  const rangeA = pageRangeOf(a);
  const rangeB = pageRangeOf(b);
  if (rangeA === null || rangeB === null || rangeA === rangeB) return false;

  if (a.value === undefined || b.value === undefined) return false;
  const base = Math.max(Math.abs(a.value), Math.abs(b.value));
  if (base === 0) return false;
  if (Math.abs(a.value - b.value) / base > AMOUNT_TOLERANCE_PCT) return false;

  const numberA = accountLast4(a.accountNumberLast4);
  const numberB = accountLast4(b.accountNumberLast4);
  return !(numberA !== null && numberB !== null && numberA !== numberB);
}

/**
 * How much of two account names has to overlap before they are the same
 * account. `nameSimilarity` is token overlap, so 0.5 is "half the words",
 * which "401(k) Plan x7264" / "401(k) Plan x7265" clears (the near-identical
 * suffixes earn partial credit) and "Profit Sharing" / "401(k) Savings" does
 * not.
 */
const NAME_AGREEMENT = 0.5;

/**
 * How much the row proves about itself, so the survivor is the one the advisor
 * can act on. A real last-4 outranks everything (every downstream match keys
 * on it), then per-position holdings, then sheer field count as the tiebreak.
 * `__`-prefixed annotations are skipped: they are bookkeeping, and a row does
 * not become the better reading by carrying more of them.
 */
/**
 * The more complete of two readings of one account's name.
 *
 * `readingStrength` ranks a reading by how much it PROVES — a real account
 * number, per-position holdings — and the detail pages win that on every
 * statement. They do not always win the NAME: the header the detail read
 * clipped is "401(k" where the cover read the whole "401(k) Savings", and
 * carrying the winner's name wholesale puts the clipped one on screen and into
 * every name comparison downstream.
 *
 * Only a strict PREFIX is treated as a truncation, so this can never talk the
 * collapse into preferring a different name over a shorter one it meant:
 * "ESOP" is not a prefix of "Employee Stock Ownership", and both readings keep
 * whichever the stronger one chose.
 */
function betterName(winner: string, loser: string): string {
  const a = winner.trim();
  const b = loser.trim();
  if (a.length < b.length && b.toLowerCase().startsWith(a.toLowerCase())) return b;
  if (isAcronymOf(a, b)) return b;
  return a;
}

/**
 * Whether `short` is `long` written as an acronym — "ESOP" for "Employee Stock
 * Ownership", which the collapse used to keep over the expansion and which
 * shares no word with it, so no name comparison downstream could join the two
 * quarters of Jennifer's ESOP.
 *
 * Deliberately narrow, because this is the one case where the collapse
 * overrules the stronger reading about what an account is CALLED:
 *
 * - `short` must be nothing but capitals. A mixed-case or spaced name is a
 *   name, not an abbreviation, and "Roth" must not lose to whatever longer
 *   string the other reading offered.
 * - `long`'s word initials and `short` must agree as far as the shorter of the
 *   two runs. "ESOP" against "Employee Stock Ownership" is the real shape —
 *   the expansion is missing the "Plan" the P stands for — so this cannot
 *   demand the initials match in full. What it does demand is that they do not
 *   CONTRADICT: "ESOP" is not an acronym of "Profit Sharing Plan and Trust",
 *   which is how an unrelated longer name is refused.
 */
function isAcronymOf(short: string, long: string): boolean {
  if (!/^[A-Z]{2,8}$/.test(short)) return false;
  const initials = long
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
  if (initials.length < 2) return false;
  return initials.startsWith(short) || short.startsWith(initials);
}

/**
 * The fuller of two readings of one institution's name.
 *
 * `readingStrength` ranks a reading by how much it PROVES about the money, and
 * a statement's detail pages win that on every document. They do not always
 * win the CUSTODIAN: the running header on Jennifer's Gensler detail pages says
 * "John Hancock" where the cover page says "John Hancock Retirement Plan
 * Services", and `unionFields` cannot help because the winner's custodian is
 * not null — it is just shorter.
 *
 * That mattered far more than a display string should, because the cross-file
 * bucket key for an unnumbered row USED to be the normalized custodian:
 * carrying the detail read's "John Hancock" put Q1 in one bucket and Q2's
 * fuller spelling in another, and the two quarters of all three plans never
 * met. The key no longer carries the custodian — see the accounts
 * `mergeSection` below — so that is no longer what this defends. What is left
 * is the display string and every name comparison downstream that reads it,
 * which is reason enough to keep it but is NOT a merge-correctness claim.
 *
 * Only a spelling `custodianMatches` already calls the same institution can
 * win here — the whole-word-prefix rule, the same one `isSameEntity` uses — so
 * this can never rename an account's custodian to a different firm. Two
 * readings of one document really can name two different institutions (a
 * collapse pairs on the balance and the page range and never looks at the
 * custodian), and in that case the stronger reading keeps its own.
 */
function betterCustodian(winner: string, loser: string): string {
  const a = normalizeCustodian(winner);
  const b = normalizeCustodian(loser);
  if (a === null || b === null || !custodianMatches(a, b)) return winner;
  return loser.trim().length > winner.trim().length ? loser : winner;
}

function readingStrength(row: ExtractedAccount): number {
  let score = 0;
  if (accountLast4(row.accountNumberLast4) !== null) score += 100;
  if (row.holdings && row.holdings.length > 0) score += 10;
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith("__") && value !== undefined && value !== null) score += 1;
  }
  return score;
}

/**
 * One reading of an account number, with everything needed to judge whether the
 * number is this account's identity at all.
 *
 * `scope` is the set of readings the judgement is made against. It is NOT the
 * source file: two of one household's plans routinely arrive as two PDFs, and a
 * pass that could only see one file at a time found no contradiction in either
 * and cleared nothing — measured, and it discarded $142,862. What one statement
 * DATE says is the real unit, because one account has one balance on one date;
 * a row with no orderable date falls back to its file, which is the tightest
 * scope still available.
 */
interface NumberReading {
  number: string;
  scope: string;
  fileId: string;
  value: number | undefined;
  hasHoldings: boolean;
  name: string;
}

/**
 * Every four-digit value this import put in `accountNumberLast4` that cannot be
 * an account's identity.
 *
 * A masked account number is four digits, so shape alone cannot catch this: a
 * 401(k)'s contract number and the page-imposition code printed in a statement's
 * FOOTER are both four digits and both get copied into the field. What gives
 * them away is that they contradict themselves across readings, in two shapes:
 *
 * 1. ONE number at SEVERAL balances as of one date, on rows named DIFFERENTLY.
 *    One account has one balance on one day, so a number carried by rows worth
 *    $361,262, $48,034 and $94,829 on 2026-06-30 and named "401(k) Savings",
 *    "Profit Sharing" and "Employee Stock Ownership" is the plan's, not any of
 *    the three accounts'. The NAME clause is load-bearing and was measured
 *    missing: two documents reporting ONE account at one date and disagreeing
 *    about the balance is an ordinary stale-statement conflict, which the merge
 *    exists to collapse and disclose — and without the name test this cleared
 *    that account's number and split it in two.
 * 2. TWO numbers on ONE account, within one document, on rows named the SAME.
 *    A cover page prints the plan's contract number and the detail pages print
 *    the participant's — or, on a Merrill statement, the footer's imposition
 *    code changes between them. Balances equal to the CENT and one side listing
 *    positions while the other does not is the summary-versus-detail signature;
 *    two sibling accounts are read the same way, so both carry positions or
 *    neither does.
 *
 * The two are mirror images, and the name clause runs the opposite way in each:
 * shape 1 needs the rows to be DIFFERENT accounts, shape 2 needs them to be the
 * SAME one.
 *
 * Shape 2 is scoped to the FILE rather than the date, because a cover page and
 * its detail pages are intrinsically one document. Shape 1 has to reach across
 * files, and does: two of one household's plans routinely arrive as two PDFs,
 * and a pass that could only see one file at a time found no contradiction in
 * either and cleared nothing — measured, and it discarded $142,862.
 *
 * Both clear the number rather than choosing between the two readings. A number
 * that has been shown to contradict itself is not evidence for either row, and
 * every identity seam downstream — this file's bucket, and `matchAccount`, which
 * auto-writes value, basis and holdings over a stored account on a last-4 hit —
 * would otherwise take it at face value.
 */
function untrustworthyNumbers(readings: NumberReading[]): Set<string> {
  const bad = new Set<string>();

  const group = <K>(key: (r: NumberReading) => K): Map<K, NumberReading[]> => {
    const groups = new Map<K, NumberReading[]>();
    for (const r of readings) {
      const list = groups.get(key(r));
      if (list) list.push(r);
      else groups.set(key(r), [r]);
    }
    return groups;
  };

  // Shape 1: one number, two accounts.
  for (const rows of group((r) => `${r.scope}|${r.number}`).values()) {
    if (rows.some((a, i) => rows.slice(i + 1).some((b) => disagreeOnBalance(a, b) && !sameNamedAccount(a, b)))) {
      bad.add(rows[0].number);
    }
  }

  // Shape 2: one account, two numbers.
  for (const rows of group((r) => r.fileId).values()) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.number === b.number) continue;
        if (a.value === undefined || a.value !== b.value) continue;
        if (a.hasHoldings === b.hasHoldings) continue;
        if (!sameNamedAccount(a, b)) continue;
        bad.add(a.number);
        bad.add(b.number);
      }
    }
  }

  return bad;
}

function disagreeOnBalance(a: NumberReading, b: NumberReading): boolean {
  if (a.value === undefined || b.value === undefined) return false;
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return false;
  return !withinTolerance(a.value, b.value);
}

/**
 * Whether two readings name the same account, with the masked suffixes OFF.
 *
 * With them on, "Savings x6049" and "Savings x8952" score exactly 0.5 and
 * "401(k) Plan x7264" and "401(k) Plan x7265" score 0.93 — a separation earned
 * entirely by the field this whole pass exists to distrust. Stripped, both
 * pairs score 1.0, which honestly reports that the name carries no signal
 * between two same-typed accounts and leaves the decision to the other clauses.
 */
function sameNamedAccount(a: NumberReading, b: NumberReading): boolean {
  return (
    nameSimilarity(stripLast4Suffix(a.name, a.number), stripLast4Suffix(b.name, b.number)) >=
    NAME_AGREEMENT
  );
}

/**
 * Read every file's account rows as `NumberReading`s, so the judgement above is
 * made once over the whole import rather than once per file.
 */
function numberReadings(fileResults: Record<string, ExtractionResult>): NumberReading[] {
  const readings: NumberReading[] = [];
  for (const [fileId, result] of Object.entries(fileResults)) {
    for (const row of result.extracted.accounts) {
      const number = accountLast4(row.accountNumberLast4);
      if (number === null) continue;
      readings.push({
        number,
        scope: orderableDate(row.statementDate) ?? fileId,
        fileId,
        value: row.value,
        hasHoldings: (row.holdings?.length ?? 0) > 0,
        name: row.name,
      });
    }
  }
  return readings;
}

/**
 * The four-digit numbers this WHOLE import has shown not to be identities.
 *
 * One exported entry point rather than two halves, so both merges make the
 * same judgement over the same input and cannot drift. The file-scoped half
 * is not here — `accountRowsFor` unions `unvouchedNumbers` in at the point of
 * use, and says why neither subsumes the other.
 */
export function untrustedNumbersForImport(
  fileResults: Record<string, ExtractionResult>,
): Set<string> {
  return untrustworthyNumbers(numberReadings(fileResults));
}

/**
 * Phrases that mean the stored copy of a document is NOT the whole document.
 * Matched on the advisor-facing warning text because that is what `extract.ts`
 * leaves behind and what a persisted `fileResults` entry from before any of
 * this carries — there is no structured flag to read, and inventing one would
 * only ever be set on NEW extractions, leaving every existing draft judged
 * against a partial copy.
 */
const INCOMPLETE_TEXT_WARNINGS = [
  // `capPersistedPages` dropped whole trailing pages past the at-rest budget.
  "dropped from the copy saved for AI review",
  // Vision OCR stopped at `EXTRACTION_OCR_MAX_PAGES`.
  "data on later pages was skipped",
];

/** The marker both truncation paths in `extract.ts` append to what they cut. */
const TRUNCATION_MARKER = "... [truncated]";

/**
 * The document's stored text, or null when there is no complete copy to reason
 * about.
 *
 * Only `documentVouchesForLast4` uses this, and it is the half of that rule
 * that keeps it honest. That rule reads "this number is nowhere in the text" as
 * evidence the model invented it — which is true of the whole document and
 * false of a fragment. Handed a truncated copy, or one whose trailing pages
 * were dropped, it would clear numbers that were printed perfectly clearly on
 * a page nobody stored, and each one it cleared would drop a real account into
 * the unnumbered bucket.
 *
 * So every incomplete case returns null and the numbers in that file are left
 * exactly as extracted:
 *
 * - No `text` and no `pages`. A `.docx` whose parser yielded nothing, and every
 *   `fileResults` entry persisted before those fields existed — the merge is
 *   re-derived on every assemble precisely so old drafts heal, so this is a
 *   live shape, not a legacy curiosity.
 * - The truncation marker, from either path that cuts mid-content: the
 *   single-pass `MAX_DOCUMENT_TEXT_CHARS` cap, and `capPersistedPages` when
 *   page one alone exceeded the budget.
 * - A warning naming pages that were dropped or skipped, where the text that
 *   survived carries no marker at all.
 *
 * `pdf-parser`'s own 300-page ceiling is deliberately NOT covered: it leaves
 * nothing on the result to read, and a 300-page account statement is not a
 * shape this has to defend against.
 */
function judgeableText(result: ExtractionResult): string | null {
  if (result.warnings.some((w) => INCOMPLETE_TEXT_WARNINGS.some((phrase) => w.includes(phrase)))) {
    return null;
  }
  const text = result.text ?? result.pages?.join("\n");
  if (!text?.trim() || text.includes(TRUNCATION_MARKER)) return null;
  return text;
}

/**
 * Every four-digit number in ONE file's rows that the file's own text never
 * printed as an account number.
 *
 * Per FILE, not per import, and that is load-bearing: the same four digits are
 * a labelled account number on one statement and an invention on another, and
 * judged over the import's pooled text the invention borrows the real one's
 * credibility. `untrustworthyNumbers` above reasons the opposite way — its
 * evidence IS the contradiction between files — so the two sets are computed at
 * different scopes and unioned at the call site.
 */
function unvouchedNumbers(result: ExtractionResult): Set<string> {
  const unvouched = new Set<string>();
  const text = judgeableText(result);
  if (text === null) return unvouched;
  for (const row of result.extracted.accounts) {
    const number = accountLast4(row.accountNumberLast4);
    if (number !== null && !documentVouchesForLast4(text, number)) unvouched.add(number);
  }
  return unvouched;
}

/**
 * Clear the account number on every row whose number is not an identity — one
 * `untrustworthyNumbers` named, or one that was never four digits in the first
 * place (a six-digit plan GROUP number, UBS's "FI" branch suffix).
 *
 * The name suffix goes with the field. `composeAccountName` built it from the
 * same value, and it is the half that reaches the screen: "401(k) Savings Plan
 * x3350", "Profit Sharing Plan x3350" and "ESOP x3350" are three plans wearing
 * one group number.
 */
function clearUntrustedNumbers(
  rows: ExtractedAccount[],
  untrusted: ReadonlySet<string>,
  sourceName: string,
  warnings: string[],
): ExtractedAccount[] {
  const cleaned = rows.map((row) => {
    const raw = row.accountNumberLast4;
    if (raw === undefined) return row;
    const number = accountLast4(raw);
    if (number !== null && !untrusted.has(number)) return row;
    return { ...row, accountNumberLast4: undefined, name: stripLast4Suffix(row.name, raw) };
  });

  // Unchanged rows come back by reference, so this is also the "did anything
  // change" test — no flag mutated inside the transform above.
  if (cleaned.every((row, i) => row === rows[i])) return rows;

  warnings.push(
    `${sourceName} labelled one or more accounts with a number that is not reliably that ` +
      "account's own — a plan or contract number, or a code printed in the page footer. Those " +
      "numbers were dropped so unrelated accounts are not merged together; check the account " +
      "numbers before committing.",
  );
  return cleaned;
}

/**
 * Names a lender prints on a debt. A row called one of these is not an asset,
 * whatever category the extractor filed it under.
 *
 * Whole words, so "Loan" does not fire on "Sloane" and "Mortgage Note
 * Receivable" — a real asset — is still caught only when the same document
 * reported a matching debt, which it will not have.
 */
const DEBT_NAME = /\b(mortgage|heloc|home equity|loan)\b/i;

/**
 * Drop an accounts row that is really one of this document's own liabilities.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`. The
 * secondary-residence mortgage statement reported its debt correctly as a
 * liability ("Mortgage - 5304 Hudson Avenue D", $99,802.55, 3.25%) AND emitted
 * an accounts row for the same money ("Mortgage x3596", $99,802.55, category
 * `real_estate`, sub-type `primary_residence` — on a statement for the
 * SECONDARY residence). That row renders on the balance sheet as PROPERTY, so
 * one debt became $99,802.55 of assets. The primary-residence file, same lender
 * and same import, emitted one liability and no accounts row — extraction
 * variance, not intent.
 *
 * BOTH CONDITIONS ARE REQUIRED, and the second is the safety argument:
 *
 * - the row is NAMED like a debt, which is what distinguishes a misfiled
 *   mortgage from a brokerage account that happens to be worth the same as one;
 * - the SAME FILE already reported a liability at that balance, so the debt is
 *   recorded as a debt no matter what this drops. Without a matching
 *   liability the row is the only record of the money and it stays — which is
 *   also what keeps a mortgage note RECEIVABLE, a genuine asset, on the table.
 *
 * Scoped to one file for the same reason `collapseDuplicateReadings` is: a
 * mortgage statement and its debt are one document. Two files in an import can
 * legitimately report a $99,802 asset and a $99,802 debt that have nothing to
 * do with each other.
 */
function dropDebtsFiledAsAssets(
  rows: ExtractedAccount[],
  liabilities: ExtractedLiability[],
  sourceName: string,
  warnings: string[],
): ExtractedAccount[] {
  // No early return on an empty `liabilities`: the warn-and-keep leg below has
  // to run for a file that reported a debt-named row and NO debts at all,
  // which is the very case worth naming. With nothing to match, `some(...)` is
  // false and the row is kept — identical behaviour, warning gained.
  return rows.filter((row) => {
    if (!DEBT_NAME.test(row.name)) return true;
    if (!liabilities.some((debt) => withinTolerance(debt.balance, row.value))) {
      // KEPT ON PURPOSE. Without a matching liability this row is the only
      // record of the money, and a note RECEIVABLE ("Loan to Smith Family
      // Trust") is a genuine asset that `DEBT_NAME` also matches. But a
      // mortgage the model filed as property and forgot to report as a debt
      // looks exactly the same from here, so it is named rather than passed
      // over in silence.
      warnings.push(
        `${sourceName} listed "${row.name}" as an account but reported no matching debt. ` +
          "If it is money the household OWES, drop the row and add it as a liability; if it is " +
          "money owed TO them, leave it.",
      );
      return true;
    }
    warnings.push(
      `${sourceName} listed "${row.name}" as an account as well as a debt of the same ` +
        `${formatMoney(row.value)}. It is recorded as a debt only, so the balance sheet does not ` +
        "count it as property. Check the liabilities before committing.",
    );
    return false;
  });
}

/**
 * Drop an account row that asserts nothing but a name, naming it in
 * `warnings`.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`: a
 * photographed beneficiary-designation form produced a row named "401(k)
 * Savings Plan" with no custodian, no value, no statement date and no number.
 * The form MENTIONS a plan; it does not report one. The row reached the review
 * table with an empty balance, and — having neither a custodian nor a number —
 * could never merge into the plan it was naming, so it stayed there as an
 * eighth account for seven real ones.
 *
 * "NOTHING AT ALL" IS THE WHOLE BAR, and each clause is a row that IS real:
 * a balance with no institution (a fact finder's "401(k): $94,795"), an
 * institution with no balance (a statement whose figures failed to parse), a
 * number, a date, a position. A zero balance counts as a reading — a closed
 * account is a real thing to show an advisor — so only undefined/null is
 * "no figure".
 */
function dropEmptyRows(
  rows: ExtractedAccount[],
  sourceName: string,
  warnings: string[],
): ExtractedAccount[] {
  const kept: ExtractedAccount[] = [];
  for (const row of rows) {
    if (assertsSomething(row)) {
      kept.push(row);
    } else {
      warnings.push(
        `${sourceName} mentioned "${row.name}" but reported no balance, institution, date or ` +
          "account number for it, so it is not listed as an account. If it is one, add it by hand.",
      );
    }
  }
  return kept;
}

/** Whether a row carries any reading at all. A zero balance is a reading. */
function assertsSomething(row: ExtractedAccount): boolean {
  if (row.value !== undefined && row.value !== null) return true;
  return (
    Boolean(row.custodian) ||
    row.statementDate !== undefined ||
    accountLast4(row.accountNumberLast4) !== null ||
    (row.holdings?.length ?? 0) > 0
  );
}

/**
 * Fill in the institution on any row the extractor read without one, from the
 * rest of the import — but only when the import names exactly one candidate.
 *
 * THE DEFECT. Mike's Q1 401(k) came back with no custodian at all, from a
 * document whose text contains "Voya" plainly (measured, production import
 * `31acfca2-5c91-4f63-8bc4-8c65bcf50659`). A row with no custodian has nothing
 * to bucket on, so it takes `mergeSection`'s null-key fallback, which by
 * design never merges with anything — and Q1's $772,449.78 went on the review
 * table as a second 401(k) beside Q2's $884,095.37.
 *
 * WHY HERE AND NOT IN THE PROMPT. Eventually both. But `fileResults` is
 * PERSISTED, so a better prompt only helps documents extracted after it ships
 * and leaves every draft already in review double-counted. This is re-derived
 * on every assemble, so existing drafts heal — the same argument that puts
 * `collapseDuplicateReadings` in this file.
 *
 * WHY IT IS NARROW. Adopting an institution is adopting an identity, and a
 * wrong one would send the row into another account's bucket, which is the
 * direction that makes an account disappear. So:
 *
 * - Only a row with NO custodian is touched. A misread custodian stays as
 *   read; an inference does not get to overrule the document.
 * - A candidate has to AGREE with the row on category and on name, at the same
 *   bar the cross-file merge itself uses for two statements
 *   (`NAME_AGREEMENT_ACROSS_STATEMENTS`). Anything looser and a household's
 *   Roth IRA starts donating its custodian to its 401(k).
 * - A candidate whose REGISTRATION NAME contradicts the row's is dropped
 *   before the institutions are counted. Name agreement alone cannot separate
 *   two spouses' 401(k)s — measured, `nameSimilarity("401K", "401(k")` is 0.8
 *   — and the statements carry the one field that can. This only ever removes
 *   a candidate, never adds one, so it can make the set unambiguous but never
 *   more permissive than the institution count below. See
 *   `hintsNameDifferentPeople` for why it is tolerant rather than exact.
 * - Every remaining candidate must name ONE institution, by `custodianMatches`
 *   — so two spellings of Voya count once, and a Voya 401(k) beside a Fidelity
 *   401(k) counts twice and the rule refuses. That refusal is the whole safety
 *   argument: the ambiguous case is precisely a household with two same-named
 *   plans at two custodians, and there is no evidence here to choose.
 *
 * The advisor is told, because this is the one field on the row that was
 * inferred rather than read.
 */
function backfillMissingCustodians(
  rows: SourceRow<ExtractedAccount>[],
  warnings: string[],
): SourceRow<ExtractedAccount>[] {
  const named = rows.filter((r) => normalizeCustodian(r.content.custodian) !== null);
  if (named.length === 0) return rows;

  return rows.map((source) => {
    const row = source.content;
    if (row.custodian) return source;

    const candidates = named.filter(
      (other) =>
        other.content.category === row.category &&
        nameSimilarity(row.name, other.content.name) >= NAME_AGREEMENT_ACROSS_STATEMENTS &&
        !hintsNameDifferentPeople(row.ownerNameHint, other.content.ownerNameHint),
    );
    if (candidates.length === 0) return source;

    // One institution, however many rows or spellings said so.
    const spellings = candidates.map((c) => c.content.custodian as string);
    const normalized = spellings.map((c) => normalizeCustodian(c) as string);
    if (!normalized.every((n) => custodianMatches(n, normalized[0]))) return source;

    // Which spelling to adopt is a question `betterCustodian` already answers,
    // and answering it a second time here is how the two would drift apart.
    const custodian = spellings.reduce((a, b) => betterCustodian(a, b));
    warnings.push(
      `"${row.name}" in ${source.sourceName} did not name an institution; it was read as ` +
        `${custodian} because that is the only one this import's other statements name for ` +
        "an account like it. Check it before committing.",
    );
    return { ...source, content: { ...row, custodian } };
  });
}

/**
 * Collapse duplicate readings within ONE file's rows, keeping source order and
 * naming each collapse in `warnings`. Never call this across files — two
 * statements for one account are `mergeSection`'s job, and it has a statement
 * date to reason with that this does not.
 */
export function collapseDuplicateReadings(
  rows: ExtractedAccount[],
  sourceName: string,
  warnings: string[],
): ExtractedAccount[] {
  const kept: ExtractedAccount[] = [];

  for (const row of rows) {
    const twinIndex = kept.findIndex((existing) => isSameAccountReadTwice(existing, row));
    if (twinIndex === -1) {
      kept.push(row);
      continue;
    }
    const existing = kept[twinIndex];
    const [winner, loser] =
      readingStrength(row) > readingStrength(existing) ? [row, existing] : [existing, row];
    // `unionFields`, so a collapse can only ever ADD information: the cover row
    // is often the only one that named an owner or spelled the custodian out.
    kept[twinIndex] = {
      ...unionFields(winner, loser),
      name: betterName(winner.name, loser.name),
      // Only when BOTH readings named one — `unionFields` has already
      // backfilled the case where the winner had none, and handing a null to
      // `betterCustodian` would make it choose between a name and nothing.
      ...(winner.custodian && loser.custodian
        ? { custodian: betterCustodian(winner.custodian, loser.custodian) }
        : {}),
    };
    warnings.push(
      `"${kept[twinIndex].name}" was read twice from ${sourceName} (pages ${pageRangeOf(loser)} and ` +
        `${pageRangeOf(winner)}) at the same balance; kept the more detailed reading.`,
    );
  }

  return kept;
}

interface SourceRow<T> {
  content: T;
  provenance: Provenance;
  /**
   * The document's display name. `provenance` carries a `sourceFileId` — an
   * id, not something an advisor can read — and the decision log has to name
   * files ("seen in march.pdf and june.pdf"). Required, not optional, so tsc
   * proves every push site supplied it.
   */
  sourceName: string;
}

interface DedupeBucketEntry<T> {
  index: number;
  content: T;
  fieldCount: number;
  provenance: Provenance;
  mergeCount: number;
  // Notes from `describeConflict` across every merge into this entry — see
  // FIX 5. Collected in the loop, joined into ONE post-loop warning (FIX 6)
  // rather than emitted per merge.
  conflictNotes: string[];
  /**
   * Every ORDERABLE date seen in this bucket, in read order — the raw
   * `statementDate` is never recorded here (see `orderableDate`). Recording
   * the raw string would let an unorderable value like "March 31, 2026" sort
   * ahead of every ISO date and make the log name a `kept` statement that
   * `chooseBase` did not actually keep.
   */
  dates: string[];
  /** Distinct source file names for this bucket, in read order. */
  fileNames: string[];
  /**
   * The raw figures behind `conflictNotes`, existing-then-incoming, deduped
   * in first-seen order. Populated only when the caller supplies
   * `opts.conflictValueOf` — `T` is generic here and has no `value` field.
   */
  conflictValues: number[];
  /**
   * The `__rowId` minted for this bucket's FIRST occurrence. Carried on the
   * entry — not recomputed — because the collapse rewrite below rebuilds the
   * target row from `entry.content`, which is raw extracted content with no
   * `__rowId` of its own; without this field a collapse would silently drop
   * the id the row's earlier occurrence already had (Task 6, C2).
   *
   * Rewritten once by the renumber pass after the placement loop (Ruling
   * 130) — see the ordinal derivation there.
   */
  rowId: string;
  /**
   * The MINIMUM `(sourceFileId, indexWithinFile)` coordinate over every row
   * that has landed in this entry — the stable handle the renumber pass
   * orders a bucket by (Ruling 130).
   *
   * The minimum, specifically, is what makes it permutation-invariant: the
   * minimum of a set does not depend on the order the set was built in, so
   * two runs that visit the same files in different `Object.entries` orders
   * derive the same coordinate for the same entry.
   */
  sortKey: SortKey;
}

/**
 * A row's stable coordinate: which file it came from, and its position within
 * that file. Named (fix round 1, Minor 6) so the two places that pass a PAIR
 * of these say which end is which, instead of handing around a bare
 * comparison number a swapped call would silently invert.
 */
interface SortKey {
  fileId: string;
  index: number;
}

/**
 * Order two bucket entries by their stable coordinate: file id first, then
 * position within that file.
 *
 * A TUPLE compare, never a concatenation. `fileId` is a UUID and compares
 * fine as a string, but `index` is a number: concatenating them would
 * compare it lexicographically, where "10" sorts before "2".
 */
function compareSortKeys(a: SortKey, b: SortKey): number {
  if (a.fileId !== b.fileId) return a.fileId < b.fileId ? -1 : 1;
  return a.index - b.index;
}

/**
 * The `__rowId` a KEYED dedupe entry gets: its section label and dedupe key,
 * then the entry's own minimum `(sourceFileId, indexWithinFile)` coordinate.
 * See the long derivation at the mint site in `mergeSection`.
 *
 * One function rather than two literals so the provisional write and the
 * renumber pass cannot drift from each other — or from `keyedRowIdBucket`
 * below, which has to split this string back apart.
 */
function keyedRowId(label: string, key: string, sortKey: SortKey): string {
  return `${label}:${key}#${sortKey.fileId}:${sortKey.index}`;
}

/**
 * The `${label}:${key}` half of a keyed `__rowId` — the DEDUPE BUCKET the row
 * belonged to — or `null` when the id was not minted by `keyedRowId`.
 *
 * This is the only stable, NON-EDITABLE statement of "which account is this"
 * that survives a re-extraction: the coordinate half of the id moves when a
 * newly-added file changes an entry's minimum, but the bucket half is the
 * dedupe key and does not. `lib/statement-chat/rebase.ts` uses it to re-attach
 * a standing row whose id moved.
 *
 * Splitting at the LAST `#` is the same argument the mint's injectivity rests
 * on: a `sourceFileId` is a database UUID and `indexWithinFile` is a counter,
 * so neither can contain a `#` and the last one in the string is always the
 * one `keyedRowId` appended.
 *
 * Two shapes are rejected, because the NULL-KEY branch's id
 * (`${label}:null:${fileId}:${index}:${name}`) ends in raw extraction text
 * that can contain anything:
 *  - a suffix that is not `<no-# no-: string>:<digits>` — the coordinate shape;
 *  - a `:null:` marker sitting where the key would be. A real key of `"null"`
 *    mints `${label}:null#...`, which has no trailing colon and so still
 *    parses.
 */
export function keyedRowIdBucket(rowId: string): string | null {
  const hash = rowId.lastIndexOf("#");
  if (hash < 0) return null;
  if (!/^[^#:]+:\d+$/.test(rowId.slice(hash + 1))) return null;
  const bucket = rowId.slice(0, hash);
  if (/^[^:]*:null:/.test(bucket)) return null;
  return bucket;
}

/** Advisor-facing note about what a collapse actually changed, when the
 * caller opts in (currently: account balance conflicts — FIX 5). Returning
 * `null` means "nothing worth calling out for this pair". */
type DescribeConflict<T> = (existing: T, incoming: T) => string | null;

/** Zero-padded ISO YYYY-MM-DD — the only shape that sorts correctly as a
 * plain string, and so the only shape `chooseBase` will order by. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A recency key we can actually order with `>`, or `undefined` if we can't.
 *
 * The date is unvalidated model output — `extraction-schema.ts` runs account
 * rows through `z.looseObject({})`, so ANY string reaches this code. Ordering
 * an arbitrary string lexicographically silently inverts: "March 31, 2026" >
 * "June 30, 2026" ("M" > "J"), and unpadded "2026-6-30" > "2026-12-31" ("6" >
 * "1") — both of which would hand the win back to the STALER statement, the
 * exact defect this fix exists to close. Anything that isn't zero-padded ISO
 * is therefore treated as UNDATED, falling safe into the field-count path.
 *
 * A regex test, deliberately — not `Date` parsing, which would break this
 * module's purity contract.
 */
function orderableDate(value: string | undefined): string | undefined {
  return value !== undefined && ISO_DATE_RE.test(value) ? value : undefined;
}

/**
 * Choose which of two same-entity rows becomes the base — the one that wins
 * on conflicting fields. A statement date beats field richness: a June
 * statement carrying only a balance is better evidence of TODAY'S balance
 * than a March statement carrying a balance and a cost basis. Field count is
 * the fallback when dates cannot separate the rows, which preserves the
 * pre-2026-09 behaviour for every section that has no date to offer — and
 * for any date we can't trust (see `orderableDate`).
 *
 * When NEITHER can separate them, the two rows' stable coordinates do — see
 * `sortKeys`. Order of arrival never decides.
 */
function chooseBase<T>(
  existingContent: T,
  existingFieldCount: number,
  incoming: T,
  incomingFieldCount: number,
  recencyOf: ((row: T) => string | undefined) | undefined,
  /**
   * The two rows' stable `(sourceFileId, indexWithinFile)` coordinates. The
   * smaller one wins, and ONLY when the dates and the field counts both tie —
   * where the winner used to be "whichever row the
   * `Object.entries(fileResults)` loop reached first".
   *
   * That was measured, not theorised (Task 12): two equally-dated,
   * equally-rich rows for one account kept $10,000 read forward and $12,000
   * read in reverse. `payloadJson` is `jsonb` and Postgres does not preserve
   * a jsonb object's key insertion order, so both orders are things
   * production actually hands this function for the same two files — and
   * Task 12 makes the stakes concrete, because two rows whose extracted
   * `owner` guesses DISAGREE now merge, and exactly one of the two guesses
   * survives.
   *
   * A NAMED PAIR, not the precomputed comparison number this used to take
   * (fix round 1, Minor 6): the direction is decided here, once, so a
   * swapped call site cannot silently invert the tiebreak — it would have to
   * misname `incoming` as `existing` in plain sight.
   *
   * The coordinate is the same permutation-invariant minimum the `#n`
   * ordinal is assigned from (Ruling 130), so the two agree by construction.
   * Since fix round 1's Important 2 the placement loop also VISITS rows in
   * this order, so `existing` always already holds the smaller coordinate —
   * but that does NOT make this arm inert: it still decides WHICH end wins,
   * and pointing it the other way makes the larger coordinate win in every
   * order. Measured, by mutation: flipping this `< 0` to `> 0` turns the
   * "survives with the same owner whichever order" test red on the absolute
   * survivor while leaving its symmetry intact.
   */
  sortKeys: { incoming: SortKey; existing: SortKey },
): [base: T, other: T] {
  if (recencyOf) {
    const existingDate = orderableDate(recencyOf(existingContent));
    const incomingDate = orderableDate(recencyOf(incoming));
    if (existingDate && incomingDate && existingDate !== incomingDate) {
      return incomingDate > existingDate
        ? [incoming, existingContent]
        : [existingContent, incoming];
    }
    if (incomingDate && !existingDate) return [incoming, existingContent];
    if (existingDate && !incomingDate) return [existingContent, incoming];
  }
  if (incomingFieldCount !== existingFieldCount) {
    return incomingFieldCount > existingFieldCount
      ? [incoming, existingContent]
      : [existingContent, incoming];
  }
  return compareSortKeys(sortKeys.incoming, sortKeys.existing) < 0
    ? [incoming, existingContent]
    : [existingContent, incoming];
}

/**
 * Append `rows` onto `target`, collapsing entries that share a dedupe key
 * (per `computeKey`) and are judged the same entity (per `isSameEntity`).
 * On a collapse, the richer row (more non-null fields) wins on conflicting
 * fields — unless the caller passes `opts.recencyOf`, in which case the more
 * recently dated row wins instead and field count is only the tie-breaker
 * (see `chooseBase`). Either way the surviving row is the UNION of both — a
 * field only the losing row populated is backfilled, not dropped. The
 * surviving row's `__provenance` stays pinned to the FIRST file the entity
 * appeared in.
 *
 * Exactly ONE `warnings` entry is appended per bucket entry that actually
 * collapsed (mergeCount > 1), emitted AFTER the merge loop finishes rather
 * than once per merge — three files carrying the same entity produce a
 * single accurate "seen in 3 documents" warning instead of two ("seen in 2
 * documents." then "seen in 3 documents."), which downstream `questions.ts`
 * would otherwise turn into two questions sharing the same slugified id
 * (duplicate React keys / colliding `answers[q.id]` in the questions card).
 *
 * `computeKey` returning `null` means "not enough information to dedupe" —
 * the row is always appended standalone.
 */
function mergeSection<T extends { name: string }>(
  target: Annotated<T>[],
  rows: SourceRow<T>[],
  label: string,
  computeKey: (row: T) => string | null,
  isSameEntity: (existing: T, incoming: T) => boolean,
  warnings: string[],
  describeConflict?: DescribeConflict<T>,
  opts?: {
    recencyOf?: (row: T) => string | undefined;
    /** Collector for the structured decision log. Sections with no as-of
     * date to reason about simply don't pass it. */
    decisions?: MergeDecision[];
    /** Reads the figure `describeConflict` compared, so a `value-conflict`
     * decision can carry raw numbers rather than the formatted note. */
    conflictValueOf?: (row: T) => number | undefined;
  },
): void {
  const buckets = new Map<string, DedupeBucketEntry<T>[]>();

  /** Record what this row contributes to its bucket's decision facts. */
  const recordSource = (entry: DedupeBucketEntry<T>, row: T, sourceName: string): void => {
    const date = orderableDate(opts?.recencyOf?.(row));
    if (date !== undefined) entry.dates.push(date);
    // One file listing the same account twice must never render
    // "appeared in a.pdf and a.pdf".
    if (!entry.fileNames.includes(sourceName)) entry.fileNames.push(sourceName);
  };

  /**
   * Each source file's running row count for THIS section, so the null-key
   * fallback id below can be scoped to the file the row came from rather
   * than to a position in the whole flattened list. Incremented for every
   * row, keyed or not: "the 3rd account row read out of file X" then stays
   * the same identity even if a re-extraction of file X leaves an earlier
   * row without a custodian and so moves it onto the null-key branch.
   */
  const rowsSeenPerFile = new Map<string, number>();

  /**
   * The rows in a CANONICAL order, stamped with the coordinate above.
   *
   * Fix round 1, Important 2. `isSameEntity` is a pairwise relation and NOT
   * an equivalence relation — it never was: `custodianMatches` matches a
   * whole-word PREFIX, so "Fidelity" matches both "Fidelity Investments" and
   * "Fidelity Brokerage" while those two do not match each other; the amount
   * sections accept anything within 1%, which chains the same way. Task 12
   * widened the accounts bucket to the last-4 alone, which made a
   * non-transitive TRIPLE easy to reach for the first time: A(client,
   * "Julia"), B(client, no hint), C(spouse, "Julia") — A~B and A~C hold, B~C
   * does not.
   *
   * A greedy first-match partition over a relation like that depends on the
   * order the rows are VISITED. Measured: read A,B,C the three collapse into
   * ONE row; read B,C,A they come out as TWO, and the extra row is a DOUBLE
   * COUNT. `Object.entries(fileResults)` is what varied, and `payloadJson` is
   * `jsonb` — Postgres stores an object's keys sorted by length then bytewise,
   * so both orders are things production hands this function for the same set
   * of files.
   *
   * Sorting here makes the partition a function of the row SET, which is
   * exactly the invariant this function's docstring already claimed. The
   * coordinate is computed BEFORE the sort, in read order, so it still means
   * "the Nth row of file X" — a file's own rows arrive contiguously and in
   * order however `Object.entries` sequences the files, so the coordinate
   * itself is already permutation-invariant.
   *
   * This does NOT replace Ruling 130's minimum reduction or its renumber
   * pass. Those state the `#n` ordinal's invariant independently of how the
   * input happened to be ordered — a prior wave measured that sorting the
   * input rows does not on its own fix the ordinal — and both stay below.
   *
   * RESIDUAL, the same one Ruling 130 discloses: adding a NEW file can still
   * repartition a bucket, because that genuinely changes the input SET. What
   * is fixed here is permutation-invariance over a FIXED set.
   */
  const orderedRows = rows
    .map((row) => {
      const index = rowsSeenPerFile.get(row.provenance.sourceFileId) ?? 0;
      rowsSeenPerFile.set(row.provenance.sourceFileId, index + 1);
      return { ...row, sortKey: { fileId: row.provenance.sourceFileId, index } };
    })
    .sort((a, b) => compareSortKeys(a.sortKey, b.sortKey));

  for (const { content, provenance, sourceName, sortKey } of orderedRows) {
    const key = computeKey(content);
    const indexWithinFile = sortKey.index;
    if (key === null) {
      target.push({
        ...content,
        __provenance: provenance,
        // No dedupe key to derive an id from — fall back to this section
        // plus the row's position WITHIN ITS OWN SOURCE FILE. This is the
        // only branch that ever emits a `:null:` segment right after the
        // label — that, not any claim about what characters a key can
        // contain (keys are extraction-derived text and can contain
        // anything, including a colon), is what keeps this id from
        // colliding with one minted by the other two branches below.
        //
        // Final review, C2: this used to be the row's position in the whole
        // flattened read order, which is NOT stable. `payloadJson` is
        // `jsonb`, and Postgres does not preserve a jsonb object's key
        // insertion order — it stores keys sorted by length then bytewise,
        // and every key here is a 36-char UUID, so the order that comes back
        // is bytewise on random ids. Uploading one more statement can
        // therefore sort its file id AHEAD of the existing ones and slide
        // every later row's index by one. That matters because
        // `run-extraction.ts` drops `payload` wholesale on a re-extraction,
        // taking every `linkCreated` stamp with it — which leaves
        // `committedRowIds` as the ONLY thing standing between an
        // already-committed account and a second commit of the same account.
        // A shifted id misses that guard and the account commits twice.
        //
        // Scoping to `sourceFileId` (already on the provenance, so free)
        // makes adding a file unable to renumber another file's rows no
        // matter how jsonb sorts the keys — which is the property the
        // re-commit guard actually needs.
        __rowId: `${label}:null:${provenance.sourceFileId}:${indexWithinFile}:${content.name}`,
        match: { kind: "new" },
      } as Annotated<T>);
      continue;
    }

    const bucket = buckets.get(key);
    const existingEntry = bucket?.find((entry) => isSameEntity(entry.content, content));

    if (existingEntry) {
      const priorContent = existingEntry.content;
      const incomingFieldCount = countNonNullFields(content as Record<string, unknown>);
      // The base row wins on any conflicting field — but the other row's
      // unique fields still backfill any gaps the base left, so nothing is
      // dropped. `chooseBase` prefers the more recent statement where the
      // caller supplied a date accessor, else the richer row as before, else
      // the smaller coordinate.
      const [baseContent, otherContent] = chooseBase(
        existingEntry.content,
        existingEntry.fieldCount,
        content,
        incomingFieldCount,
        opts?.recencyOf,
        { incoming: sortKey, existing: existingEntry.sortKey },
      );
      existingEntry.content = unionFields(baseContent, otherContent);
      existingEntry.fieldCount = countNonNullFields(existingEntry.content as Record<string, unknown>);
      existingEntry.mergeCount += 1;
      // Content may have been enriched, but provenance stays pinned to the
      // first file this entity was seen in.
      target[existingEntry.index] = {
        ...existingEntry.content,
        __provenance: existingEntry.provenance,
        // Reused, not recomputed — see the `rowId` field doc on
        // DedupeBucketEntry (C2).
        __rowId: existingEntry.rowId,
        match: { kind: "new" },
      } as Annotated<T>;
      // Belt-and-braces callers (accounts — see FIX 5) can name what a
      // collapse actually changed instead of the generic "Merged duplicate"
      // notice, e.g. when two same-owner rows at the same custodian+last4
      // carry materially different balances (a legitimate same-account
      // different-statement-period case, so we still collapse — but the
      // advisor needs to see both figures rather than silently losing one).
      // Collected here and joined into the single post-loop warning below —
      // NOT emitted per merge (see FIX 6 in the function doc comment).
      const conflictNote = describeConflict?.(priorContent, content);
      if (conflictNote) {
        existingEntry.conflictNotes.push(conflictNote);
        // Same order the shipped warning uses — "($X vs $Y)", existing then
        // incoming — so a caveat built from these reads consistently with it.
        for (const figure of [opts?.conflictValueOf?.(priorContent), opts?.conflictValueOf?.(content)]) {
          if (figure !== undefined && !existingEntry.conflictValues.includes(figure)) {
            existingEntry.conflictValues.push(figure);
          }
        }
      }
      // Lower the entry's coordinate if this row's is smaller, so the field
      // holds the MINIMUM over the entry's member rows however the loop
      // reached them (Ruling 130). Kept as the minimum, deliberately, even
      // though the canonical visit order now means rows arrive in ascending
      // coordinate order: this states the ordinal's invariant on its own
      // terms, and a prior wave measured that ordering the input rows does
      // not on its own make the ordinal stable.
      if (compareSortKeys(sortKey, existingEntry.sortKey) < 0) {
        existingEntry.sortKey = sortKey;
      }
      recordSource(existingEntry, content, sourceName);
      continue;
    }

    // `key` is non-null here (the null branch above always `continue`s). A
    // bucket is an ARRAY: `isSameEntity` can reject every existing entry
    // under this key (e.g. two liabilities both named "Mortgage" with
    // balances >1% apart), landing this row as a SECOND distinct entry
    // under the SAME key — so `key` alone cannot be the id (review round 1,
    // Critical 1).
    //
    // The ordinal is unconditional — every entry gets `#n`, starting at 0 —
    // rather than only appending it from the second entry on (review round
    // 2: that conditional form is still not injective, because `key` is raw
    // extraction text and can itself contain `#`. A liability named
    // "Card#1" mints the bare id `liability:card#1`; a second, unrelated
    // "Card" entry rejected by isSameEntity would ALSO mint
    // `liability:card#1` under the conditional scheme — same id, two rows).
    //
    // Appending `#n` unconditionally is provably injective for any key
    // whatsoever: `n` is a plain digit string containing no `#`, so in
    // `${key}#${n}` the LAST `#` in the string is always the one this line
    // appended. Splitting there recovers `key` and `n` exactly, so two equal
    // ids force equal keys and equal ordinals — no escaping needed, and no
    // assumption about what characters extraction text can contain.
    //
    // Re-review, Ruling 130: the ordinal is NOT this entry's arrival rank.
    // It is derived from the entry's minimum `(sourceFileId,
    // indexWithinFile)` coordinate, assigned by the renumber pass below. The
    // id minted here is provisional and always overwritten there — it is
    // written at all only so the field is never momentarily undefined.
    //
    // The arrival rank had to go because this function's docstring forbids
    // anything minted here from depending on where a file falls in the
    // `Object.entries(fileResults)` loop: `payloadJson` is `jsonb` and
    // Postgres does not preserve a jsonb object's key insertion order.
    // Accounts were accidentally immune while `isSameEntity` was the
    // constant `() => true` — a bucket never held two entries, so `n` was
    // always 0 — but Ruling 120 gave accounts a real `isSameEntity`, and a
    // bucket can now hold several. A re-extraction reading the same files
    // back in a different jsonb order renumbered them, and `committedRowIds`
    // and the chat's rebase then addressed the WRONG account: the same C2
    // failure the null-key branch above was rewritten for.
    //
    // Sorting the input rows would NOT have fixed it — a newly uploaded file
    // whose UUID sorts ahead still lands first in the bucket and takes `#0`.
    // The ordinal had to stop being an arrival rank at all.
    //
    // Final review #2, C-1: the ordinal is the entry's COORDINATE, not its
    // RANK within the sorted bucket. Ruling 130 made the rank deterministic
    // for a FIXED file set, which is all it claimed — but a rank is still a
    // function of bucket MEMBERSHIP, and adding a file changes membership. A
    // newly-uploaded file whose UUID sorts ahead of an existing entry pushed
    // every entry behind it up by one, so an id that named account P came
    // back naming account Q. `rebaseOntoFreshMerge` joins standing rows onto
    // fresh ones by this id, so it then overwrote Q's row with P's content
    // and emitted Q again as a second, uncommitted copy: one real account
    // silently gone, another duplicated, $403,800 on screen against a truth
    // of $289,900, and a caveat quoting a figure no statement reported.
    //
    // `${fileId}:${index}` is the entry's own minimum coordinate, so it is a
    // function of the entry ALONE. Nothing another entry does — joining the
    // bucket, leaving it, arriving first — can move it.
    //
    // The injectivity argument above survives intact, on a slightly narrower
    // premise. Two entries under one key always have DIFFERENT minima (their
    // member rows are disjoint and every row's coordinate is unique), so the
    // suffix separates them. And the suffix still contains no `#`, so the
    // LAST `#` in the id is still the one this line appended and splitting
    // there still recovers `key` exactly — the premise being that neither a
    // `sourceFileId` (a database UUID) nor `indexWithinFile` (a counter) can
    // contain one. That is a claim about SYSTEM-generated values, not about
    // extraction text, and it is the same one the null-key branch above
    // already makes when it interpolates `sourceFileId` into an id.
    //
    // RESIDUAL, and it is NOT closeable here: a MERGED entry's minimum moves
    // when a lower-coordinate row from a newly-added file joins it, so its id
    // changes and a standing row can find no counterpart at all. That is the
    // COMMON case — a newer statement for an account already on the import —
    // and it cannot be fixed by choosing a better derivation, because any
    // derived id is a function of the input set and re-extraction changes the
    // input set by definition.
    //
    // So it is closed where identity actually lives: `rebaseOntoFreshMerge`
    // (`lib/statement-chat/rebase.ts`) carries the standing row's id FORWARD
    // onto the fresh row it re-attaches to, matching on the BUCKET half of
    // this id (`keyedRowIdBucket` above), which does not move. Measured cost
    // of leaving it open: the replacement row committed as `kind: "new"` and
    // INSERTED a second plan account for one real account.
    const rowId = keyedRowId(label, key, sortKey);
    const entry: DedupeBucketEntry<T> = {
      index: target.length,
      content,
      fieldCount: countNonNullFields(content as Record<string, unknown>),
      provenance,
      mergeCount: 1,
      conflictNotes: [],
      dates: [],
      fileNames: [],
      conflictValues: [],
      rowId,
      sortKey,
    };
    recordSource(entry, content, sourceName);
    target.push({ ...content, __provenance: provenance, __rowId: rowId, match: { kind: "new" } } as Annotated<T>);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }

  // Ruling 130's renumber pass, kept (Ruling 140 forbids deleting it) and
  // re-pointed at the entry's coordinate — see the derivation comment above.
  //
  // Still a PASS rather than a mint-and-forget, because `entry.sortKey` is
  // the MINIMUM over the entry's members and the placement loop can lower it
  // (`:519-527`) after the provisional id is written. Re-deriving every id
  // here, once, after every merge has landed, is what makes the id a
  // function of the finished entry rather than of whichever row created it.
  //
  // No sort any more: the id no longer depends on the entry's position in
  // its bucket, so ordering the bucket to assign one would be theatre. The
  // bucket's own iteration order is untouched, which is what the warnings
  // loop below depends on.
  for (const [key, bucket] of buckets.entries()) {
    for (const entry of bucket) {
      entry.rowId = keyedRowId(label, key, entry.sortKey);
      target[entry.index].__rowId = entry.rowId;
    }
  }

  // One warning per bucket entry that actually collapsed — see the function
  // doc comment (FIX 6) for why this must happen after the loop rather than
  // inline per merge.
  for (const bucket of buckets.values()) {
    for (const entry of bucket) {
      if (entry.mergeCount <= 1) continue;
      const conflictSuffix =
        entry.conflictNotes.length > 0 ? ` — ${entry.conflictNotes.join("; ")}` : "";
      warnings.push(
        conflictSuffix
          ? `Merged duplicate ${label} "${entry.content.name}" seen in ${entry.mergeCount} documents${conflictSuffix}`
          : `Merged duplicate ${label} "${entry.content.name}" seen in ${entry.mergeCount} documents.`,
      );
      if (!opts?.decisions) continue;

      // Emit on the count of DISTINCT orderable dates, because that is what
      // `chooseBase` actually ordered by:
      //   >= 2  the newest genuinely superseded the rest — `basis: "date"`.
      //   == 0  nothing in the bucket was datable; say so.
      //   == 1  SILENCE. Either the dates were equal (in which case
      //         `chooseBase` fell through to field count, so `basis: "date"`
      //         would be a lie and a narration would print the same date
      //         twice) or one row was undated (so "no readable date on
      //         either" would be a lie too). A decision arm whose narration
      //         lies is worse than no decision: the advisor still gets the
      //         "Merged duplicate" warning, and a real divergence still
      //         surfaces as `value-conflict` below.
      const distinctDates = [...new Set(entry.dates)].sort().reverse();
      if (distinctDates.length >= 2) {
        opts.decisions.push({
          kind: "superseded",
          account: entry.content.name,
          kept: distinctDates[0],
          dropped: distinctDates.slice(1),
          basis: "date",
        });
      } else if (distinctDates.length === 0) {
        opts.decisions.push({
          kind: "undated",
          account: entry.content.name,
          fileNames: entry.fileNames,
        });
      }

      // Only disclose a figure conflict when there are actually TWO figures
      // to weigh AND the SURVIVING row carries a date we can print AND we
      // can read the survivor's own figure straight off it (`kept`) — a
      // reader downstream must never have to re-derive "the winner" by
      // matching `account` (a bare display name that two different accounts
      // can share) back to a row, which can silently resolve to the wrong
      // account's figure. `entry.content` IS the survivor at this point in
      // the loop, so `conflictValueOf` reads its figure with no ambiguity.
      //
      // Without a date there is no truthful "as of". And a single figure is
      // not a conflict: `withinTolerance` returns false when exactly one side
      // is undefined (deliberately conservative — see `:42-44`), so a
      // statement that lists an account with no balance fires the note while
      // contributing no number, leaving one figure behind. Narrating that
      // asks the advisor to choose between a value and nothing. Either way
      // the divergence is still disclosed by the `balances differ (...)`
      // warning above, which can say "unknown" where this channel cannot.
      const survivorDate = orderableDate(opts.recencyOf?.(entry.content));
      const kept = opts.conflictValueOf?.(entry.content);
      if (entry.conflictValues.length >= 2 && survivorDate !== undefined && kept !== undefined) {
        opts.decisions.push({
          kind: "value-conflict",
          account: entry.content.name,
          values: entry.conflictValues,
          asOf: survivorDate,
          kept,
        });
      }
    }
  }
}

/**
 * Concatenate rows onto `target` with provenance annotated, no dedupe.
 *
 * Also stamps `__rowId` (Task 6, C3) from `provenance.section` plus this
 * row's push index — the only identity that exists on this path, since
 * `concatSection` has no `computeKey` and nothing here ever merges or is
 * excluded. Each call operates on one section's rows only, and no two
 * sections share a `provenance.section` string, so the ids stay globally
 * unique even though `committedRowIds` is a flat list across every section.
 */
function concatSection<T>(target: Annotated<T>[], rows: SourceRow<T>[]): void {
  rows.forEach(({ content, provenance }, index) => {
    target.push({
      ...content,
      __provenance: provenance,
      __rowId: `${provenance.section}:${index}`,
      match: { kind: "new" },
    } as Annotated<T>);
  });
}

/**
 * Fold `incoming` onto `existing` for a singleton family slot (primary or
 * spouse). First non-empty value wins the slot; if a later file names a
 * clearly different person, keep the first and warn instead of silently
 * overwriting. Otherwise (same person, or the slot was still empty), fill
 * in any fields the earlier document left blank.
 */
function mergeFamilyMember<T extends { firstName: string; lastName?: string }>(
  existing: T | undefined,
  incoming: T | undefined,
  label: string,
  warnings: string[],
): T | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const existingDisplayName = `${existing.firstName} ${existing.lastName ?? ""}`.trim();
  const incomingDisplayName = `${incoming.firstName} ${incoming.lastName ?? ""}`.trim();
  if (existingDisplayName.toLowerCase() !== incomingDisplayName.toLowerCase()) {
    warnings.push(
      `${label} conflict between files: "${existingDisplayName}" vs "${incomingDisplayName}". Keeping the first.`,
    );
    return existing;
  }

  return unionFields(existing, incoming);
}

/** The single-account half of `stampHoldingIds`, exported for `merge_rows`
 *  — the one operation that moves a holdings array between accounts. */
export function stampAccountHoldingIds(account: Annotated<ExtractedAccount>): void {
  if (!account.holdings?.length) return;
  const seen = new Map<string, number>();
  for (const h of account.holdings) {
    const key = holdingKey(h);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    h.__holdingId = `${key}#${occurrence}`;
  }
}

/**
 * Mint `__holdingId` for every position on every account.
 *
 * Deliberately a single post-pass rather than threaded through the three
 * sites that stamp `__rowId`: a holding's id is scoped to its own account and
 * does not depend on that account's id, so it only has to run once, after the
 * account set is final. Idempotent — re-stamping a payload that already
 * carries ids produces the same ids.
 */
function stampHoldingIds(accounts: Annotated<ExtractedAccount>[]): void {
  for (const account of accounts) {
    stampAccountHoldingIds(account);
  }
}

/**
 * Merge per-file `ExtractionResult`s into a single `ImportPayload`,
 * collapsing only high-confidence exact duplicates (see dedupe rules in
 * the task brief). Fuzzy near-duplicates are intentionally left as
 * separate rows for the review wizard / match step to reconcile.
 *
 * Pure: no randomness, no clock reads, same input in — same output out.
 *
 * It does NOT get to assume an iteration order, though (final review, C2 —
 * the previous wording claimed `Object.entries(fileResults)` runs in
 * "insertion order", and that is false the moment the data round-trips
 * through the database). `fileResults` is read back out of a `jsonb` column,
 * and Postgres does not preserve a jsonb object's key insertion order: it
 * stores keys sorted by length, then bytewise. Every key here is a 36-char
 * UUID, so what comes back is bytewise order on random ids, and uploading
 * one more file can land its id anywhere in that sequence. Nothing minted
 * below may therefore depend on where a file falls in this loop — see the
 * `__rowId` fallback in `mergeSection`, which is scoped to its own source
 * file for exactly this reason.
 */
/**
 * ONE file's account rows, cleaned, in the order the four passes have to run.
 *
 * They are a pipeline rather than four nested calls because the ORDER is the
 * part worth stating, and nesting states it inside-out:
 *
 * 1. `dropEmptyRows` first. A row asserting nothing cannot be judged for a
 *    fabricated number (it has none) and cannot be a duplicate reading of
 *    anything (it has no balance to match on), so the passes below never see
 *    it and never have to special-case it.
 * 2. `dropDebtsFiledAsAssets` before the number work, for the same reason: a
 *    row the file already recorded as a debt should not be reasoned about as
 *    an account at all.
 * 3. `clearUntrustedNumbers` before the collapse, because the collapse buckets
 *    on the account number, and a plan number left in place buckets two
 *    unrelated accounts together.
 * 4. `collapseDuplicateReadings` last — it is the only pass that JOINS rows,
 *    and it should join the cleaned ones.
 *
 * Everything here is scoped to one document. The cross-file judgement arrives
 * as `untrusted`, and the two number judgements are unioned rather than
 * ranked: `untrusted` is the whole import's — a number is not an identity if
 * it contradicts itself ACROSS files — and `unvouchedNumbers` is this file's —
 * a number is not an identity if THIS document never printed it as one.
 * Neither subsumes the other.
 */
export function accountRowsFor(
  result: ExtractionResult,
  untrusted: ReadonlySet<string>,
  warnings: string[],
): ExtractedAccount[] {
  const sourceName = result.fileName;
  const untrustedHere = new Set([...untrusted, ...unvouchedNumbers(result)]);

  let rows = dropEmptyRows(result.extracted.accounts, sourceName, warnings);
  rows = dropDebtsFiledAsAssets(rows, result.extracted.liabilities, sourceName, warnings);
  rows = clearUntrustedNumbers(rows, untrustedHere, sourceName, warnings);
  return collapseDuplicateReadings(rows, sourceName, warnings);
}

export function mergeAcrossFiles(
  fileResults: Record<string, ExtractionResult>,
): MergeAcrossFilesResult {
  const payload = emptyImportPayload();
  const decisions: MergeDecision[] = [];

  // Computed over EVERY file before the per-file loop: whether a four-digit
  // value is an account's identity is a fact about the whole import, not about
  // the file the row happened to arrive in.
  const untrusted = untrustedNumbersForImport(fileResults);

  const accountRows: SourceRow<ExtractedAccount>[] = [];
  const incomeRows: SourceRow<ExtractedIncome>[] = [];
  const expenseRows: SourceRow<ExtractedExpense>[] = [];
  const liabilityRows: SourceRow<ExtractedLiability>[] = [];
  const dependentRows: SourceRow<ExtractedDependent>[] = [];
  const entityRows: SourceRow<ExtractedEntity>[] = [];
  const lifePolicyRows: SourceRow<ExtractedLifePolicy>[] = [];
  const willRows: SourceRow<ExtractedWill>[] = [];
  const savingsRows: SourceRow<ExtractedSavings>[] = [];

  for (const [fileId, result] of Object.entries(fileResults)) {
    const provenanceFor = (section: string): Provenance => ({ sourceFileId: fileId, section });
    // `provenance` can only identify the file by id; the decision log has to
    // name it. `fileName` is required on `ExtractionResult`.
    const sourceName = result.fileName;

    for (const row of accountRowsFor(result, untrusted, payload.warnings)) {
      accountRows.push({ content: row, provenance: provenanceFor("accounts"), sourceName });
    }
    for (const row of result.extracted.incomes) {
      incomeRows.push({ content: row, provenance: provenanceFor("incomes"), sourceName });
    }
    for (const row of result.extracted.expenses) {
      expenseRows.push({ content: row, provenance: provenanceFor("expenses"), sourceName });
    }
    for (const row of result.extracted.liabilities) {
      liabilityRows.push({ content: row, provenance: provenanceFor("liabilities"), sourceName });
    }
    for (const row of result.extracted.entities) {
      entityRows.push({ content: row, provenance: provenanceFor("entities"), sourceName });
    }
    // `?? []` for the same reason as `merge.ts`'s savings loop — see the long
    // comment there. `result` is a PERSISTED `payloadJson.fileResults` entry
    // (assemble/route.ts reads the column and hands it straight in), and
    // `extracted.savings` only exists on this branch (`0038b216f`), so a
    // pre-branch fileResults row has no key for it. This loop is older than
    // `merge.ts`'s, so this path was already crashing on those imports.
    for (const row of result.extracted.savings ?? []) {
      savingsRows.push({ content: row, provenance: provenanceFor("savings"), sourceName });
    }
    for (const row of result.extracted.lifePolicies) {
      lifePolicyRows.push({ content: row, provenance: provenanceFor("lifePolicies"), sourceName });
    }
    for (const row of result.extracted.wills) {
      willRows.push({ content: row, provenance: provenanceFor("wills"), sourceName });
    }

    const family = result.extracted.family;
    if (family) {
      payload.primary = mergeFamilyMember(payload.primary, family.primary, "Primary client", payload.warnings);
      payload.spouse = mergeFamilyMember(payload.spouse, family.spouse, "Co-client", payload.warnings);
      for (const dep of family.dependents ?? []) {
        dependentRows.push({ content: dep, provenance: provenanceFor("family"), sourceName });
      }
    }

    payload.warnings.push(...result.warnings);
  }

  mergeSection(
    payload.accounts,
    // Runs over the WHOLE import's rows, after every file has had its
    // fabricated numbers cleared and its duplicate readings collapsed — the
    // institution that fills a gap may be on any other statement, and the
    // rows it compares against should already be the best reading of each.
    backfillMissingCustodians(accountRows, payload.warnings),
    "account",
    // `owner` used to be in the key too (FIX 5), to stop a client IRA and a
    // spouse IRA sharing a masked last-4 at the same custodian from ever
    // reaching one bucket. It had to leave (Task 12): the enum is a model
    // GUESS at a household role no statement prints, it flipped between two
    // imports of the same files, and a flipped guess put ONE real account in
    // TWO buckets whose `__rowId`s could never collide — so neither the
    // custodian merge nor the value-conflict rebase ever ran on the pair and
    // the newer balance became a second committable row. A double count.
    //
    // It moved rather than died: FIX 5's case is real, and getting it wrong
    // LOSES an account. `isSameEntity` below now carries the owner test, with
    // the verbatim registration name as the discriminator — the same shape
    // Ruling 121 used for the custodian.
    //
    // The CUSTODIAN is deliberately NOT in the key (Ruling 120/121). It used
    // to be, as `custodian.toLowerCase()` — a raw exact string — and the
    // section's `isSameEntity` was the constant `() => true`, which is only
    // ever consulted WITHIN a bucket already found by key. So two spellings
    // of one custodian never met: two Fidelity statements for the same two
    // accounts produced FOUR committable rows, because the extractor read
    // "Fidelity Investments" off one file and "Fidelity" off the other, from
    // headers that are byte-identical. Committing all four double-counted
    // the household by their own balances.
    //
    // Normalizing the key would not have fixed it: `normalizeCustodian`
    // strips only TRAILING legal suffixes ("LLC", "Inc"), and "Investments"
    // is not one, so "fidelity investments" still !== "fidelity". The
    // comparison this needs is a whole-word PREFIX rule, which is not
    // expressible as a bucket key at all — a key is exact-match by
    // construction. It has to be `isSameEntity`, below.
    //
    // A row still needs BOTH a custodian and a last-4 to be dedupable at
    // all; without either it takes `mergeSection`'s null-key fallback id and
    // never merges. The custodian stays in this GUARD even though it left
    // the key's CONTENTS (Ruling 127): a row with no custodian gives
    // `isSameEntity` below nothing to compare — both sides normalize to
    // null, and null matches null — so bucketing it can only ever produce a
    // blind merge. Two unrelated accounts that happen to share four masked
    // digits would fold into one, which is the money-losing mirror of the
    // split this fix exists to stop.
    // `accountLast4`, not the raw field. A masked account number is four
    // digits; the extractor also puts things there that are NOT this account's
    // number — a 401(k) statement's six-digit GROUP number, a five-digit plan
    // contract number — and ~8% of extracted rows carry one. Keyed on the raw
    // string, a Gensler statement whose 401(k), profit-sharing plan and ESOP
    // all print "433350" put three different plans in ONE bucket: they merged
    // into a single account and two real balances were thrown away as
    // "another statement reported…". `dropPlanNumbers` has already cleared
    // those, and the shapes it cannot see from one file's rows alone are
    // refused here too, for the same reason the custodian guard below exists:
    // a merge that should not have happened makes a whole account disappear,
    // and that is the error that costs money.
    //
    // A row with NO usable number is not sent straight to the null-key
    // fallback any more (Sept 2026). It used to be, and the cost showed up the
    // moment the number-stripping above started clearing plan numbers: a
    // household that uploads Q1 and Q2 of the same 401(k) got SIX review rows
    // for THREE plans, each quarter listed again at its own balance, and
    // committing them booked the retirement plan twice. A statement whose
    // numbers are all plan numbers is exactly the statement that most needs the
    // quarters joined, and the null key can never join anything.
    //
    // The fallback bucket says only "this row has no number", with
    // `isSameEntity` below carrying the whole burden of deciding which
    // unnumbered rows are one account. A row with no custodian EITHER still
    // takes the null key — there is nothing left to compare.
    //
    // THE CUSTODIAN IS NOT IN THIS KEY, and that is the same correction the
    // numbered path above got, for the same reason. It used to be
    // (`no-number@${normalizeCustodian(row.custodian)}`), and that re-opened
    // the trap the numbered path had just been fixed for: a key is exact-match
    // by construction, and one institution is routinely spelled two ways
    // across two statements. Measured — Jennifer's Gensler Q1 keyed as
    // `no-number@john hancock` off its detail pages and Q2 as `no-number@john
    // hancock retirement plan services` off its cover, `custodianMatches`
    // returns TRUE for that pair, and the two quarters still never met,
    // because the comparison that would have joined them only runs inside a
    // bucket a key already found. Three plans were on the review table twice.
    //
    // The cost is that every unnumbered row in the import shares one bucket,
    // so `isSameEntity` is asked about pairs it never used to see. That is the
    // point — it is the only place the prefix rule CAN run — and it is also
    // why `sameUnnumberedAccount` is the narrowest merge in this file.
    (row) => {
      if (!row.custodian) return null;
      const number = accountLast4(row.accountNumberLast4);
      if (number !== null) return number;
      return normalizeCustodian(row.custodian) === null ? null : "no-number";
    },
    // Now that the bucket is only the last-4, this is what keeps a Fidelity
    // statement out of a Schwab account that happens to share four masked
    // digits — the same `normalizeCustodian` + `custodianMatches`
    // pair `match-keys/account.ts` already uses against the plan's own
    // accounts, so one import can't disagree with the other about whether
    // two custodian spellings are the same institution.
    //
    // A custodian that normalizes to null (absent, or nothing but a legal
    // suffix) matches only another null — the precedent `rollups.ts` sets
    // for the same comparison. Nulls share the one catch-all rather than
    // each becoming its own; a null never silently joins a named custodian,
    // which is the direction that would lose money.
    //
    // The OWNER test runs after the custodian one and never overrides it
    // (Task 12) — a matching registration name is not evidence about the
    // institution. See `sameAccountOwner`.
    (existing, incoming) => {
      const a = normalizeCustodian(existing.custodian);
      const b = normalizeCustodian(incoming.custodian);
      const sameCustodian = a === null || b === null ? a === b : custodianMatches(a, b);
      if (!sameCustodian || !sameAccountOwner(existing, incoming)) return false;
      // A numbered bucket has already agreed on four digits, which is the
      // evidence this whole ladder is built on — nothing further to ask. An
      // UNNUMBERED bucket has agreed on nothing but the institution, so the
      // rest of the case has to be made explicitly.
      if (accountLast4(existing.accountNumberLast4) !== null) return true;
      return sameUnnumberedAccount(existing, incoming);
    },
    payload.warnings,
    (existing, incoming) =>
      withinTolerance(existing.value, incoming.value)
        ? null
        : `balances differ (${formatMoney(existing.value)} vs ${formatMoney(incoming.value)}); please verify which is current.`,
    // Accounts are the one section with an as-of date, so the newer statement
    // wins the balance rather than whichever row happened to list more fields.
    // They're also the only section that collects decisions: every arm of
    // `MergeDecision` reasons about a statement date, and a section with none
    // to offer would emit nothing but a misleading "undated" on every collapse.
    {
      recencyOf: (row) => row.statementDate,
      decisions,
      conflictValueOf: (row) => row.value,
    },
  );

  mergeSection(
    payload.incomes,
    incomeRows,
    "income",
    (row) => `${row.type ?? ""}|${row.owner ?? ""}|${row.name.toLowerCase().trim()}`,
    (existing, incoming) => withinTolerance(existing.annualAmount, incoming.annualAmount),
    payload.warnings,
  );

  mergeSection(
    payload.expenses,
    expenseRows,
    "expense",
    (row) => `${row.type ?? ""}|${row.name.toLowerCase().trim()}`,
    (existing, incoming) => withinTolerance(existing.annualAmount, incoming.annualAmount),
    payload.warnings,
  );

  mergeSection(
    payload.liabilities,
    liabilityRows,
    "liability",
    (row) => row.name.toLowerCase().trim(),
    (existing, incoming) => withinTolerance(existing.balance, incoming.balance),
    payload.warnings,
  );

  concatSection(payload.dependents, dependentRows);
  concatSection(payload.entities, entityRows);
  concatSection(payload.lifePolicies, lifePolicyRows);
  concatSection(payload.wills, willRows);
  concatSection(payload.savings, savingsRows);

  // AFTER every section has merged — the split needs the whole import's
  // accounts and liabilities in one place to link a mortgage to its property.
  // Row ids were already stamped inside each `mergeSection` above, so a
  // property this split SYNTHESIZES has missed that pass and must be annotated
  // by hand below, or it reaches the review table uncommittable.
  const escrow = splitMortgageEscrow({
    accounts: payload.accounts,
    liabilities: payload.liabilities,
  });
  payload.warnings.push(...escrow.warnings);
  // PAIRED BY INDEX, which `splitMortgageEscrow` guarantees: it copies every
  // row it is given, in order, and may only ever APPEND (see its POSITIONAL
  // INVARIANT comment). If it ever reordered or filtered, this would stamp the
  // wrong `__rowId`s onto the wrong rows and silently commit them.
  payload.accounts = escrow.accounts.map((next, i) => {
    const prior = payload.accounts[i];
    return prior
      ? ({ ...prior, ...next } as (typeof payload.accounts)[number])
      : ({
          ...next,
          // The provenance of the mortgage that CAUSED this row, found by the
          // address the split copied onto it — not `liabilities[0]`, which
          // would tell an advisor the second property came from the first
          // mortgage's statement. Provenance is an assertion about which
          // document a row came from; asserting the wrong one is the same
          // defect as inventing a figure. Falls back to the first liability so
          // a row that somehow matches nothing is still annotated.
          __provenance:
            payload.liabilities.find((debt) =>
              propertyAddressMatches(debt.propertyAddress, next.propertyAddress),
            )?.__provenance ?? payload.liabilities[0]?.__provenance,
          __rowId: `account:synthesized:${next.name.toLowerCase().trim().replace(/\s+/g, "-")}`,
          match: { kind: "new" as const },
        } as (typeof payload.accounts)[number]);
  });

  stampHoldingIds(payload.accounts);
  return { payload, mergedFileCount: Object.keys(fileResults).length, decisions };
}
