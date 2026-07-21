import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
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
}

/** Advisor-facing note about what a collapse actually changed, when the
 * caller opts in (currently: account balance conflicts — FIX 5). Returning
 * `null` means "nothing worth calling out for this pair". */
type DescribeConflict<T> = (existing: T, incoming: T) => string | null;

/**
 * Append `rows` onto `target`, collapsing entries that share a dedupe key
 * (per `computeKey`) and are judged the same entity (per `isSameEntity`).
 * On a collapse, the richer row (more non-null fields) wins on conflicting
 * fields, but the surviving row is the UNION of both — a field only the
 * poorer row populated is backfilled, not dropped. The surviving row's
 * `__provenance` stays pinned to the FIRST file the entity appeared in, and
 * a `warnings` entry is appended.
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
      // The richer row (more non-null fields) is the base — it wins on any
      // conflicting field — but the poorer row's unique fields still
      // backfill any gaps the richer row left, so nothing is dropped.
      const [richerContent, poorerContent] =
        incomingFieldCount > existingEntry.fieldCount
          ? [content, existingEntry.content]
          : [existingEntry.content, content];
      existingEntry.content = unionFields(richerContent, poorerContent);
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
      const conflictNote = describeConflict?.(priorContent, content);
      warnings.push(
        conflictNote
          ? `Merged duplicate ${label} "${existingEntry.content.name}" seen in ${existingEntry.mergeCount} documents — ${conflictNote}`
          : `Merged duplicate ${label} "${existingEntry.content.name}" seen in ${existingEntry.mergeCount} documents.`,
      );
      continue;
    }

    const entry: DedupeBucketEntry<T> = {
      index: target.length,
      content,
      fieldCount: countNonNullFields(content as Record<string, unknown>),
      provenance,
      mergeCount: 1,
    };
    target.push({ ...content, __provenance: provenance, match: { kind: "new" } } as Annotated<T>);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
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

  return { payload, mergedFileCount: Object.keys(fileResults).length };
}
