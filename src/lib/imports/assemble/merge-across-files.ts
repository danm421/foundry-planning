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
import { holdingKey } from "@/lib/extraction/holdings-completion";
import {
  emptyImportPayload,
  type Annotated,
  type ImportPayload,
  type Provenance,
} from "../types";
import type { MergeDecision } from "./decisions";
import { custodianMatches, normalizeCustodian } from "../normalize-custodian";

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
export function mergeAcrossFiles(
  fileResults: Record<string, ExtractionResult>,
): MergeAcrossFilesResult {
  const payload = emptyImportPayload();
  const decisions: MergeDecision[] = [];

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

    for (const row of result.extracted.accounts) {
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
      payload.spouse = mergeFamilyMember(payload.spouse, family.spouse, "Spouse", payload.warnings);
      for (const dep of family.dependents ?? []) {
        dependentRows.push({ content: dep, provenance: provenanceFor("family"), sourceName });
      }
    }

    payload.warnings.push(...result.warnings);
  }

  mergeSection(
    payload.accounts,
    accountRows,
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
    (row) => (row.custodian && row.accountNumberLast4 ? row.accountNumberLast4 : null),
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
      return sameCustodian && sameAccountOwner(existing, incoming);
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

  stampHoldingIds(payload.accounts);
  return { payload, mergedFileCount: Object.keys(fileResults).length, decisions };
}
