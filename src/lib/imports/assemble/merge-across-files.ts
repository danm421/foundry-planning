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
   */
  rowId: string;
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
 */
function chooseBase<T>(
  existingContent: T,
  existingFieldCount: number,
  incoming: T,
  incomingFieldCount: number,
  recencyOf?: (row: T) => string | undefined,
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
  return incomingFieldCount > existingFieldCount
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

  for (const { content, provenance, sourceName } of rows) {
    const key = computeKey(content);
    const indexWithinFile = rowsSeenPerFile.get(provenance.sourceFileId) ?? 0;
    rowsSeenPerFile.set(provenance.sourceFileId, indexWithinFile + 1);
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
      // caller supplied a date accessor, else the richer row as before.
      const [baseContent, otherContent] = chooseBase(
        existingEntry.content,
        existingEntry.fieldCount,
        content,
        incomingFieldCount,
        opts?.recencyOf,
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
    // `bucket` was captured above, before `.find`, so `bucket?.length ?? 0`
    // here is exactly the count of entries already under this key.
    const rowId = `${label}:${key}#${bucket?.length ?? 0}`;
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
    };
    recordSource(entry, content, sourceName);
    target.push({ ...content, __provenance: provenance, __rowId: rowId, match: { kind: "new" } } as Annotated<T>);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
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
    // `owner` is part of the key (not just an isSameEntity check) so a
    // client IRA and a spouse IRA sharing a masked last-4 at the same
    // custodian never even reach the same bucket — see FIX 5.
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
    // digits and an owner would fold into one, which is the money-losing
    // mirror of the split this fix exists to stop.
    (row) =>
      row.custodian && row.accountNumberLast4 ? `${row.accountNumberLast4}|${row.owner ?? ""}` : null,
    // Now that the bucket is only last-4 + owner, this is what keeps a
    // Fidelity statement out of a Schwab account that happens to share four
    // masked digits — the same `normalizeCustodian` + `custodianMatches`
    // pair `match-keys/account.ts` already uses against the plan's own
    // accounts, so one import can't disagree with the other about whether
    // two custodian spellings are the same institution.
    //
    // A custodian that normalizes to null (absent, or nothing but a legal
    // suffix) matches only another null — the precedent `rollups.ts` sets
    // for the same comparison. Nulls share the one catch-all rather than
    // each becoming its own; a null never silently joins a named custodian,
    // which is the direction that would lose money.
    (existing, incoming) => {
      const a = normalizeCustodian(existing.custodian);
      const b = normalizeCustodian(incoming.custodian);
      if (a === null || b === null) return a === b;
      return custodianMatches(a, b);
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

  return { payload, mergedFileCount: Object.keys(fileResults).length, decisions };
}
