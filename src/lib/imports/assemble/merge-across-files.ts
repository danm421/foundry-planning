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

export interface MergeAcrossFilesResult {
  payload: ImportPayload;
  mergedFileCount: number;
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
  opts?: { recencyOf?: (row: T) => string | undefined },
): void {
  const buckets = new Map<string, DedupeBucketEntry<T>[]>();

  for (const { content, provenance } of rows) {
    const key = computeKey(content);
    if (key === null) {
      target.push({ ...content, __provenance: provenance, match: { kind: "new" } } as Annotated<T>);
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
      if (conflictNote) existingEntry.conflictNotes.push(conflictNote);
      continue;
    }

    const entry: DedupeBucketEntry<T> = {
      index: target.length,
      content,
      fieldCount: countNonNullFields(content as Record<string, unknown>),
      provenance,
      mergeCount: 1,
      conflictNotes: [],
    };
    target.push({ ...content, __provenance: provenance, match: { kind: "new" } } as Annotated<T>);
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
    }
  }
}

/** Concatenate rows onto `target` with provenance annotated, no dedupe. */
function concatSection<T>(target: Annotated<T>[], rows: SourceRow<T>[]): void {
  for (const { content, provenance } of rows) {
    target.push({ ...content, __provenance: provenance, match: { kind: "new" } } as Annotated<T>);
  }
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
 * Pure and deterministic: iterates `Object.entries(fileResults)` in
 * insertion order, no randomness, no clock reads.
 */
export function mergeAcrossFiles(
  fileResults: Record<string, ExtractionResult>,
): MergeAcrossFilesResult {
  const payload = emptyImportPayload();

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

    for (const row of result.extracted.accounts) {
      accountRows.push({ content: row, provenance: provenanceFor("accounts") });
    }
    for (const row of result.extracted.incomes) {
      incomeRows.push({ content: row, provenance: provenanceFor("incomes") });
    }
    for (const row of result.extracted.expenses) {
      expenseRows.push({ content: row, provenance: provenanceFor("expenses") });
    }
    for (const row of result.extracted.liabilities) {
      liabilityRows.push({ content: row, provenance: provenanceFor("liabilities") });
    }
    for (const row of result.extracted.entities) {
      entityRows.push({ content: row, provenance: provenanceFor("entities") });
    }
    // `?? []` for the same reason as `merge.ts`'s savings loop — see the long
    // comment there. `result` is a PERSISTED `payloadJson.fileResults` entry
    // (assemble/route.ts reads the column and hands it straight in), and
    // `extracted.savings` only exists on this branch (`0038b216f`), so a
    // pre-branch fileResults row has no key for it. This loop is older than
    // `merge.ts`'s, so this path was already crashing on those imports.
    for (const row of result.extracted.savings ?? []) {
      savingsRows.push({ content: row, provenance: provenanceFor("savings") });
    }
    for (const row of result.extracted.lifePolicies) {
      lifePolicyRows.push({ content: row, provenance: provenanceFor("lifePolicies") });
    }
    for (const row of result.extracted.wills) {
      willRows.push({ content: row, provenance: provenanceFor("wills") });
    }

    const family = result.extracted.family;
    if (family) {
      payload.primary = mergeFamilyMember(payload.primary, family.primary, "Primary client", payload.warnings);
      payload.spouse = mergeFamilyMember(payload.spouse, family.spouse, "Spouse", payload.warnings);
      for (const dep of family.dependents ?? []) {
        dependentRows.push({ content: dep, provenance: provenanceFor("family") });
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
    (row) =>
      row.custodian && row.accountNumberLast4
        ? `${row.custodian.toLowerCase()}|${row.accountNumberLast4}|${row.owner ?? ""}`
        : null,
    () => true,
    payload.warnings,
    (existing, incoming) =>
      withinTolerance(existing.value, incoming.value)
        ? null
        : `balances differ (${formatMoney(existing.value)} vs ${formatMoney(incoming.value)}); please verify which is current.`,
    // Accounts are the one section with an as-of date, so the newer statement
    // wins the balance rather than whichever row happened to list more fields.
    { recencyOf: (row) => row.statementDate },
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

  return { payload, mergedFileCount: Object.keys(fileResults).length };
}
