import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { downloadImportFile } from "@/lib/imports/blob";
import { stampAccountHoldingIds } from "@/lib/imports/assemble/merge-across-files";
import { extractDocument } from "@/lib/extraction/extract";
import {
  EDITABLE_HOLDING_FIELDS,
  isEditableHoldingField,
  isValidHoldingValue,
  holdingFieldDomainDescription,
} from "@/lib/statement-chat/holding-fields";
import { isDroppedHolding, livingHoldings } from "@/lib/imports/living-rows";
import type { Annotated, ChatState, PersistedImportPayload } from "@/lib/imports/types";
import type {
  AccountCategory,
  AccountSubType,
  ExtractedAccount,
  ExtractedHolding,
  ExtractedLiability,
  ExtractionResult,
} from "@/lib/extraction/types";

/**
 * The seven statement-chat tools (Task 11, plus `edit_holding`/`drop_holding`
 * from Task 7). Each one is a function over
 * `(payload, args, ...)` returning a `ToolResult` — the next payload plus a
 * one-line summary for the transcript, and (for `drop_row`/`merge_rows`
 * only) the `excludedRows` delta Ruling 49 allows.
 *
 * Direction rule, same as `narrate.ts`/`rollups.ts`: this module reads from
 * `@/lib/imports/` and `@/lib/extraction/`, never the reverse.
 *
 * `payload` here is the `PersistedImportPayload` this surface persists (C13)
 * — every function below reads `payload.accounts` / `payload.liabilities`
 * defensively (`?? []`) rather than assuming either is populated.
 *
 * Task 12: the row tools (`edit_row`/`merge_rows`/`drop_row`) and `explain`
 * reach BOTH tables, resolving which one by the row id's own section prefix
 * (`locateRow` below). The three HOLDINGS tools deliberately do not: a
 * position is an account concept and a debt has none, so they keep resolving
 * against `payload.accounts` alone.
 */

type AccountRow = Annotated<ExtractedAccount>;
type LiabilityRow = Annotated<ExtractedLiability>;

/**
 * The holdings allowlist and its validators live in `holding-fields.ts`,
 * not here: that module has no runtime imports, so `holdings-table.tsx`
 * (a `"use client"` component) can import it directly without pulling this
 * file's `{ db } from "@/db"` into the browser bundle. Re-exported here so
 * any server-side reference keeps resolving from `tools.ts` — one
 * definition, two safe import paths.
 */
export {
  EDITABLE_HOLDING_FIELDS,
  isEditableHoldingField,
  isValidHoldingValue,
  type EditableHoldingField,
} from "@/lib/statement-chat/holding-fields";

/**
 * Ruling 50: `edit_row` uses an ALLOWLIST, never a denylist. These are
 * Task 10's account columns (`ACCOUNT_COLUMNS` in
 * `src/components/statement-chat/accounts-columns.ts` — Account type expands
 * to its two real fields, `category`/`subType`) — named here as ONE constant
 * so a future column spec (Phase 2, per Dan's Task 10 amendment) can supply
 * it instead of a hand-maintained list. Anything not on this list — including
 * `__provenance`, `match`, `reconciliation`, and `__rowId` itself — is
 * rejected, so a field added to `ExtractedAccount` later is closed to editing
 * by default rather than silently writable.
 */
export const EDITABLE_ACCOUNT_FIELDS = [
  "name",
  "value",
  "basis",
  "accountNumberLast4",
  "owner",
  "custodian",
  "category",
  "subType",
] as const;

export type EditableAccountField = (typeof EDITABLE_ACCOUNT_FIELDS)[number];

function isEditableField(field: string): field is EditableAccountField {
  return (EDITABLE_ACCOUNT_FIELDS as readonly string[]).includes(field);
}

/**
 * Review round 1, Important 5: a denylist-free allowlist of COLUMNS isn't
 * enough on its own — `basis` accepting the string `"x"` or `category`
 * accepting free text outside the real enum are both writes a human editing
 * the table could never make (the UI's own inputs are typed/select-bound;
 * see `accounts-columns.ts`). Every field gets its own domain check, not a
 * shared "any scalar goes" rule.
 *
 * `Record<AccountCategory, true>` / `Record<AccountSubType, true>` rather
 * than a hand-copied array: TypeScript requires EVERY key of the real union
 * type be present (and rejects any key that isn't), so this can't silently
 * drift out of sync with `@/lib/extraction/types` the way a parallel array
 * could.
 */
const ACCOUNT_CATEGORY_SET: Record<AccountCategory, true> = {
  taxable: true,
  cash: true,
  retirement: true,
  annuity: true,
  real_estate: true,
  business: true,
  life_insurance: true,
  notes_receivable: true,
  stock_options: true,
  education_savings: true,
};

const ACCOUNT_SUB_TYPE_SET: Record<AccountSubType, true> = {
  brokerage: true,
  savings: true,
  checking: true,
  traditional_ira: true,
  roth_ira: true,
  "401k": true,
  "403b": true,
  "529": true,
  trust: true,
  other: true,
  primary_residence: true,
  rental_property: true,
  commercial_property: true,
  sole_proprietorship: true,
  partnership: true,
  s_corp: true,
  c_corp: true,
  llc: true,
  term: true,
  whole_life: true,
  universal_life: true,
  variable_life: true,
};

/** Human-readable domain description for an error message. */
function fieldDomainDescription(field: EditableAccountField): string {
  switch (field) {
    case "value":
    case "basis":
      return "a finite number";
    case "owner":
      return `one of "client", "spouse", "joint"`;
    case "category":
      return `one of ${Object.keys(ACCOUNT_CATEGORY_SET).join(", ")}`;
    case "subType":
      return `one of ${Object.keys(ACCOUNT_SUB_TYPE_SET).join(", ")}`;
    case "name":
    case "custodian":
    case "accountNumberLast4":
      return "a plain string";
  }
}

/**
 * Per-field domain validation — replaces a blanket "any scalar" check
 * (review round 1, Important 5). Exhaustive over `EditableAccountField` by
 * construction: a field missing a `case` is a compile error, not a runtime
 * gap.
 */
function isValidFieldValue(field: EditableAccountField, value: unknown): boolean {
  switch (field) {
    case "value":
    case "basis":
      return typeof value === "number" && Number.isFinite(value);
    case "owner":
      return value === "client" || value === "spouse" || value === "joint";
    case "category":
      return typeof value === "string" && value in ACCOUNT_CATEGORY_SET;
    case "subType":
      return typeof value === "string" && value in ACCOUNT_SUB_TYPE_SET;
    case "name":
    case "custodian":
    case "accountNumberLast4":
      return typeof value === "string";
  }
}

/**
 * Ruling 50 applies here unchanged: an ALLOWLIST, never a denylist. These are
 * the editable columns of `liabilities-columns.ts`, minus the derived escrow
 * cell (which is computed from `totalPayment` and `monthlyPayment`, both of
 * which ARE editable — editing the derived figure directly would have nowhere
 * to write) and minus `match` (an annotation, ruled on in the link picker,
 * never a value the model writes). `propertyAddress` is editable because it is
 * the key the commit links the mortgage to its property by.
 *
 * `lender` is deliberately NOT here (Ruling 56, Task 12b) — reversing both
 * the plan and this docblock's own earlier claim that "allowing it costs
 * nothing a column would have". It costs a FALSE CONFIRMATION. The field is
 * extracted (`extraction/types.ts`, and the account-statement prompt asks for
 * it), but it has no review column, and it appears in NEITHER
 * `commit/liabilities.ts` NOR `db/schema.ts` — so it never reaches the
 * database. An accepted edit to it would report success, in the transcript,
 * for a write the advisor cannot see and the plan never stores: the same
 * lying-transcript defect the rest of this fix round exists to close. Giving
 * it a real column is the other way to fix that, and is out of scope here.
 */
export const EDITABLE_LIABILITY_FIELDS = [
  "name",
  "balance",
  "interestRate",
  "monthlyPayment",
  "totalPayment",
  "balanceAsOfDate",
  "maturityDate",
  "propertyAddress",
] as const;

export type EditableLiabilityField = (typeof EDITABLE_LIABILITY_FIELDS)[number];

function isEditableLiabilityField(field: string): field is EditableLiabilityField {
  return (EDITABLE_LIABILITY_FIELDS as readonly string[]).includes(field);
}

/** Dates in an extraction payload are absolute ISO `YYYY-MM-DD` strings,
 *  never relative and never a locale rendering — the same rule the commit
 *  path's own date parsing assumes. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Human-readable domain description for an error message. Mirrors
 *  `fieldDomainDescription` above — the model self-corrects from it. */
function liabilityFieldDomainDescription(field: EditableLiabilityField): string {
  switch (field) {
    case "balance":
    case "monthlyPayment":
    case "totalPayment":
      return "a finite number";
    case "interestRate":
      return "a decimal fraction between 0 and 1 (0.0625 is 6.25%, never 6.25)";
    case "balanceAsOfDate":
    case "maturityDate":
      return "a date in YYYY-MM-DD form";
    case "name":
    case "propertyAddress":
      return "a non-empty string";
  }
}

/**
 * Per-field domain validation for a debt row. Exhaustive over
 * `EditableLiabilityField` by construction, the same as its account twin: a
 * field missing a `case` is a compile error, not a runtime gap.
 *
 * `interestRate`'s range check is the load-bearing one. A rate is a DECIMAL
 * FRACTION everywhere in this codebase, so a model writing the `6.25` it read
 * off the statement — the obvious mistake — would otherwise be stored and
 * amortized as 625%. Refusing sends the model back with the shape it needs
 * (see the description above); storing it is a 100x error nothing downstream
 * can detect.
 */
function isValidLiabilityValue(field: EditableLiabilityField, value: unknown): boolean {
  switch (field) {
    case "balance":
    case "monthlyPayment":
    case "totalPayment":
      return typeof value === "number" && Number.isFinite(value);
    case "interestRate":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
    case "balanceAsOfDate":
    case "maturityDate":
      return typeof value === "string" && ISO_DATE.test(value);
    case "name":
    case "propertyAddress":
      return typeof value === "string" && value.trim().length > 0;
  }
}

/**
 * ONE result type with optional members (Ruling 49 / C4) — not three ad-hoc
 * shapes. `payload` and `summary` are on every result (C13: the route can't
 * ship a turn with either missing); `excludedRows` is present only for the
 * tools that produce it. The route merges whatever is present through
 * `writeChatState`.
 *
 * Final review, I3: there is no `proposal` member. `reread_document` used to
 * return one, and NOTHING ever read it — not `use-chat-turn.ts`, not the
 * surface, nowhere — while the transcript said "awaiting your approval" with
 * nothing to approve. Ruling 93 had already settled that the advisor approves
 * IN WORDS and the model then calls `edit_row`, so the structured field was
 * dead by design, not by oversight. The correction now travels in `summary`,
 * which is the thing the advisor and the model both actually read.
 */
export interface ToolResult {
  payload: PersistedImportPayload;
  summary: string;
  /** `drop_row`/`merge_rows` only — the newly-excluded entries this call
   *  produced (NOT the full accumulated list; the caller appends them to the
   *  prior one). */
  excludedRows?: ChatState["excludedRows"];
}

function accountsOf(payload: PersistedImportPayload): AccountRow[] {
  return payload.accounts ?? [];
}

/** How many ids an unknown-row (`findRowIndex`) or unknown-holding
 *  (`findHoldingIndex`) error lists before it summarises the rest. Long
 *  enough to cover any realistic statement import, short enough that a
 *  pathological one can't flood the turn's context — holdings are the more
 *  numerous of the two lists (the production failure behind this whole plan
 *  was ~63 positions in one account), so both share this one cap rather than
 *  holdings getting an uncapped join. */
const MAX_LISTED_IDS = 20;

/**
 * Final review, I5: the error LISTS the valid row ids.
 *
 * In the live browser pass `edit_row` failed twice with
 * `Unknown row id "fidelity|5678|client#0"` — the model had dropped the
 * `account:` prefix that was shown to it correctly — and a bare "unknown row"
 * gives it nothing to self-correct from, so it retries the same wrong id and
 * burns another of the four tool calls this turn allows.
 * `resolveSourceFileId` below already lists what the import DOES have for
 * exactly this reason; this is the same pattern for rows.
 */
function unknownRowIdError(rowId: string, rows: Array<{ __rowId?: string }>): Error {
  const known = rows.map((r) => r.__rowId).filter((id): id is string => Boolean(id));
  if (known.length === 0) {
    return new Error(`Unknown row id "${rowId}". This import has no rows to work on.`);
  }
  const listed = known.slice(0, MAX_LISTED_IDS).join(", ");
  const more =
    known.length > MAX_LISTED_IDS ? `, and ${known.length - MAX_LISTED_IDS} more` : "";
  return new Error(`Unknown row id "${rowId}". The rows in this import are: ${listed}${more}.`);
}

/**
 * Accounts-only row lookup — the THREE holdings tools and nothing else.
 *
 * Ruling 49: a position belongs to an account and a debt has none, so these
 * correctly refuse a liability id, and their error correctly lists only
 * account ids. Everything that DOES span both tables goes through `locateRow`
 * below; both share `unknownRowIdError` so the two lists can't grow two
 * different grammars for the model to read.
 */
function findRowIndex(accounts: AccountRow[], rowId: string): number {
  const idx = accounts.findIndex((r) => r.__rowId === rowId);
  if (idx !== -1) return idx;
  throw unknownRowIdError(rowId, accounts);
}

/**
 * Which array a row id belongs to, and where in it.
 *
 * Resolving by id alone — rather than taking a `table` argument from the
 * model — is safe because ids are already section-prefixed: `keyedRowId`
 * (`merge-across-files.ts`) mints every id as
 * `${label}:${key}#${fileId}:${index}`, so an account id starts with
 * "account:" and a liability id with "liability:". The id already says which
 * table it is in; an argument would only add a second way to be wrong about
 * it.
 *
 * It matches on the ARRAY, not on the prefix string, so a row whose id
 * predates that scheme (or the synthesized-property id
 * `account:synthesized:<slug>`, which has no `#fileId:index` half) resolves by
 * where it actually lives rather than by how its id happens to be spelled.
 */
type Located =
  | { table: "accounts"; index: number; row: AccountRow }
  | { table: "liabilities"; index: number; row: LiabilityRow };

function locateRow(payload: PersistedImportPayload, rowId: string): Located {
  const accounts = payload.accounts ?? [];
  const ai = accounts.findIndex((r) => r.__rowId === rowId);
  if (ai !== -1) return { table: "accounts", index: ai, row: accounts[ai] };

  const liabilities = payload.liabilities ?? [];
  const li = liabilities.findIndex((r) => r.__rowId === rowId);
  if (li !== -1) return { table: "liabilities", index: li, row: liabilities[li] };

  // The unknown-id error must list ids from BOTH tables, or the model retries
  // against a list that cannot contain the row it wants — I5's retry loop,
  // one table over.
  throw unknownRowIdError(rowId, [...accounts, ...liabilities]);
}

/**
 * The set of `__rowId`s already committed into the client's plan
 * (`chat.committedRowIds`). Required — never optional — on all five
 * MUTATING tools, so tsc proves every call site supplies it rather than
 * leaving a guard someone can forget to pass (the same reasoning
 * `SourceRow.sourceName` is required for in `merge-across-files.ts`).
 */
export type CommittedRowIds = ReadonlySet<string>;

/**
 * Refuse a write to a row whose figure is already in the client's plan
 * (final review, C3).
 *
 * REFUSING is the correct answer here, not merely the conservative one.
 * Once a row is committed, `commitAccounts` has written a real account into
 * the household and this surface has no path that updates it: `edit_row`
 * would change only the on-screen table while the plan kept the old figure,
 * and `entity-table.tsx` leaves that row's Commit button permanently
 * disabled — so the correction could never reach the plan at all, and the
 * screen would assert a change the client's net worth does not have.
 * `merge_rows` is worse: committing B, merging B into A, then committing A
 * leaves the plan holding BOTH accounts for the same real account — the
 * fifth route to a double count found on this plan.
 *
 * Read-only tools (`explain`, `reread_document`) are deliberately
 * unaffected: neither writes a row, and an advisor asking where a committed
 * row's number came from is a perfectly reasonable question.
 *
 * Error style follows `resolveSourceFileId` below — it tells the model what
 * to do next instead of dead-ending, so the turn ends in an explanation the
 * advisor can act on rather than a retry loop that burns the tool budget.
 *
 * Takes the two fields it reads rather than a row type (Task 12): the rule and
 * its message are already table-neutral — `commitLiabilities` honours `rowIds`
 * exactly as `commitAccounts` does — so a debt row needs the same guard, not a
 * second copy of it.
 */
function assertNotCommitted(
  row: { name: string; __rowId?: string },
  committedRowIds: CommittedRowIds,
): void {
  if (!row.__rowId || !committedRowIds.has(row.__rowId)) return;
  throw new Error(
    `"${row.name}" (row ${row.__rowId}) has already been committed to the client's plan, so it ` +
      `cannot be changed, merged or dropped here. Tell the advisor this row is already committed ` +
      `and has to be corrected on the client's accounts instead.`,
  );
}

function describeValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (value === null) return "empty";
  return String(value);
}

// ---------------------------------------------------------------------------
// edit_row
// ---------------------------------------------------------------------------

export interface EditRowArgs {
  rowId: string;
  field: string;
  value: unknown;
}

/**
 * Writes ONE field on ONE row, in whichever table its id names. Ruling 50:
 * `field` must be on that table's own allowlist or this throws
 * `/not editable/i` — a denylist would silently permit
 * `__provenance`/`match`/`reconciliation` and anything added to
 * `ExtractedAccount`/`ExtractedLiability` later. `value` must additionally
 * pass that field's own domain check (Important 5) — the allowlist says WHICH
 * columns are writable, not that any scalar is a legal value for them.
 *
 * The two allowlists are deliberately separate rather than one union: they
 * barely overlap (`name` alone), the domain rules differ where they do share a
 * shape, and a merged list would let the model write `custodian` onto a debt
 * or `balance` onto an account — a field neither table's commit path reads,
 * silently kept in the payload.
 */
export function editRow(
  payload: PersistedImportPayload,
  args: EditRowArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  const located = locateRow(payload, args.rowId);
  assertNotCommitted(located.row, committedRowIds);

  if (located.table === "liabilities") {
    if (!isEditableLiabilityField(args.field)) {
      throw new Error(
        `Field "${args.field}" is not editable on a debt. Editable fields: ${EDITABLE_LIABILITY_FIELDS.join(", ")}.`,
      );
    }
    if (!isValidLiabilityValue(args.field, args.value)) {
      throw new Error(
        `Value for "${args.field}" must be ${liabilityFieldDomainDescription(args.field)}.`,
      );
    }
    const liabilities = payload.liabilities ?? [];
    const nextLiabilities = liabilities.map((r, i) =>
      i === located.index ? { ...r, [args.field]: args.value } : r,
    );
    return {
      payload: { ...payload, liabilities: nextLiabilities },
      summary: `Set ${args.field} to ${describeValue(args.value)} on "${located.row.name}".`,
    };
  }

  if (!isEditableField(args.field)) {
    throw new Error(
      `Field "${args.field}" is not editable. Editable fields: ${EDITABLE_ACCOUNT_FIELDS.join(", ")}.`,
    );
  }
  if (!isValidFieldValue(args.field, args.value)) {
    throw new Error(`Value for "${args.field}" must be ${fieldDomainDescription(args.field)}.`);
  }
  const accounts = accountsOf(payload);
  const nextAccounts = accounts.map((r, i) =>
    i === located.index ? { ...r, [args.field]: args.value } : r,
  );
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Set ${args.field} to ${describeValue(args.value)} on "${located.row.name}".`,
  };
}

// ---------------------------------------------------------------------------
// merge_rows
// ---------------------------------------------------------------------------

export interface MergeRowsArgs {
  keepRowId: string;
  mergeRowId: string;
}

/**
 * The internal annotations `Annotated<T>` adds — the ONLY keys a merge must not
 * blend between two rows. `match`/`matchLocked` and `reconciliation` describe
 * the surviving row's OWN commit/reconciliation status and must never silently
 * inherit another row's; `__rowId` is the row's identity; `__provenance` gets
 * its own explicit rule in `unionAccountFields` below.
 *
 * Typed as `Record<keyof Annotated<object>, true>` rather than a hand-copied
 * array (the same construction `ACCOUNT_CATEGORY_SET` uses above): TypeScript
 * requires EVERY annotation key be present and rejects any key that isn't, so
 * adding another annotation to `Annotated` is a compile error here rather
 * than a field that starts silently leaking across a merge. `matchLocked`
 * arrived exactly that way.
 */
const ROW_ANNOTATION_KEYS: Record<keyof Annotated<object>, true> = {
  __provenance: true,
  match: true,
  matchLocked: true,
  reconciliation: true,
  __rowId: true,
};

/**
 * Backfill undefined/null fields on `base` from `other`, without touching a
 * field `base` already has. C9: deliberately mirrors `unionFields` in
 * `merge-across-files.ts` — that helper is module-local and not exported, so
 * the semantics are re-implemented here rather than exporting merge internals
 * for a tool.
 *
 * Review round 1, Important 4 narrowed this to `EDITABLE_ACCOUNT_FIELDS`
 * because the ORIGINAL version iterated every key of `other`, annotations
 * included. That over-corrected (final review, I4): it also stopped
 * `holdings`, `owners`, `ownerNameHint`, `statementDate`, `growthRate`,
 * `modelPortfolioId` and every other extracted-but-not-advisor-editable field
 * from carrying over, so merging a holdings-bearing row into a holdings-less
 * one silently threw the positions away before the row was ever committed.
 *
 * The correct line is the ANNOTATIONS, not the editable columns. An allowlist
 * is essential for `edit_row`, where the field name comes from the model
 * (Ruling 50) — but nothing names a field here: `merge_rows` takes two row
 * ids and both rows are system-extracted data, so the failure mode is silent
 * data LOSS and a field added to `ExtractedAccount` later should carry over
 * by default. `ROW_ANNOTATION_KEYS` is what makes that safe, and tsc keeps it
 * complete.
 *
 * `__provenance` is skipped by the loop and handled explicitly: it isn't
 * advisor-editable data, but knowing where a merged row came from is still
 * useful to `explain`, so it backfills ONLY when `base` has none at all.
 *
 * Generic over the row type (Task 12) rather than copied per table: "everything
 * but the annotations carries over" is a statement about `Annotated`, not about
 * accounts, so a debt merge needs the same rule and not a second version of it.
 */
function unionRowFields<T extends Annotated<object>>(base: T, other: T): T {
  const merged: T = { ...base };
  // ONE string-keyed view of each row, rather than a cast per write: a
  // generic's `keyof T` can be a symbol, so it cannot index a
  // `Record<string, unknown>` at all, and reading and writing through the same
  // view keeps the two halves of every comparison on the same key type.
  const mergedFields = merged as unknown as Record<string, unknown>;
  const otherFields = other as unknown as Record<string, unknown>;
  for (const key of Object.keys(otherFields)) {
    // `Object.hasOwn`, not `key in` — `in` also matches Object.prototype's
    // own keys, so a row carrying a field called "toString" would be skipped.
    if (Object.hasOwn(ROW_ANNOTATION_KEYS, key)) continue;
    const baseValue = mergedFields[key];
    const otherValue = otherFields[key];
    if ((baseValue === undefined || baseValue === null) && otherValue !== undefined && otherValue !== null) {
      mergedFields[key] = otherValue;
    }
  }
  // Written here, not in the loop, because `__provenance` is an annotation and
  // the loop deliberately skips every one of those.
  if (!merged.__provenance && other.__provenance) {
    mergedFields.__provenance = other.__provenance;
  }
  return merged;
}

/**
 * Unions two rows into one. `keepRowId` is the base and wins conflicting
 * fields; `mergeRowId`'s unique fields backfill (C9), restricted to the
 * editable allowlist (Important 4). `mergeRowId` is retired — removed from
 * `payload.accounts` — but its ORIGINAL (pre-merge) data is recorded in
 * `excludedRows`, the same as `drop_row`: merging is the one irreversible
 * tool (a mis-merged row's conflicting fields would otherwise simply be
 * gone), so the retired row's own values stay visible and recoverable.
 */
export function mergeRows(
  payload: PersistedImportPayload,
  args: MergeRowsArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  if (args.keepRowId === args.mergeRowId) {
    throw new Error("Cannot merge a row into itself.");
  }
  const keep = locateRow(payload, args.keepRowId);
  const merge = locateRow(payload, args.mergeRowId);
  // BOTH sides, not just the retired one. Retiring a committed row leaves
  // its account in the plan while the survivor commits as a second copy of
  // the same account; folding into a committed SURVIVOR changes fields whose
  // committed figure this surface can no longer update.
  assertNotCommitted(keep.row, committedRowIds);
  assertNotCommitted(merge.row, committedRowIds);

  if (keep.table === "accounts" && merge.table === "accounts") {
    return mergeAccountRows(payload, keep, merge);
  }
  if (keep.table === "liabilities" && merge.table === "liabilities") {
    return mergeLiabilityRows(payload, keep, merge);
  }
  // Task 12. Falling through means the two ids named different tables — the
  // one combination that is never a duplicate to fold. Refused by NAME so the
  // advisor reading the transcript can see which two rows the model thought
  // were one thing; blending them would put a debt's balance on the asset
  // side, which is the defect `dropDebtsFiledAsAssets` exists to undo.
  throw new Error(
    `Cannot merge "${keep.row.name}" and "${merge.row.name}": one is an account and the ` +
      "other is a debt. They are different things and belong in different tables.",
  );
}

function mergeAccountRows(
  payload: PersistedImportPayload,
  keep: { index: number; row: AccountRow },
  merge: { index: number; row: AccountRow },
): ToolResult {
  const accounts = accountsOf(payload);
  const merged = unionRowFields(keep.row, merge.row);
  // `merged.holdings` is still the SAME array (and same holding objects) as
  // whichever of `keep`/`merge` donated it — `unionRowFields` only
  // spreads the row shallowly, never the arrays it carries. Clone before
  // stamping so the mutation lands on `merged`'s own copy, not on a holding
  // object also reachable from `payload.accounts` or (for the retired row)
  // from the `excludedRows` snapshot below — both still need their PRE-merge
  // data untouched.
  merged.holdings = merged.holdings?.map((h) => ({ ...h }));
  // Positions here may never have been stamped at all (a fixture, or a row
  // this surface built by hand) — and a future tool that appends a position
  // to an already-stamped account needs its new entry numbered too. This
  // re-normalises the whole array so both cases end up correct; it is
  // idempotent for positions that already had a correct id.
  stampAccountHoldingIds(merged);
  const nextAccounts = accounts
    .map((r, i) => (i === keep.index ? merged : r))
    .filter((_, i) => i !== merge.index);
  // `unionRowFields` backfills only where the base has nothing, so when
  // BOTH rows carry positions the merged row keeps `keep`'s and `merge`'s are
  // gone — and the retired row is `irreversible: true`, so there is no way
  // back to them. That was inert while chat imports never extracted holdings;
  // it is not any more. Silence here is the same failure the holdings caveat
  // exists to prevent, so the summary says it outright.
  // `keep.row.holdings != null` reads as a null check but is really asking "did
  // keep's array WIN the union?" — `unionRowFields` backfills only where
  // the base has nothing. If that backfill rule ever changes, this is the
  // predicate that silently stops matching.
  const discardedPositions = keep.row.holdings != null ? livingHoldings(merge.row).length : 0;
  const noun = discardedPositions === 1 ? "position" : "positions";
  const was = discardedPositions === 1 ? "was" : "were";
  const positionsNote =
    discardedPositions === 0
      ? ""
      : ` The ${discardedPositions} ${noun} on "${merge.row.name}" ${was} not carried over` +
        ` — "${keep.row.name}"'s ${livingHoldings(keep.row).length} were kept.`;
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Merged "${merge.row.name}" into "${keep.row.name}".${positionsNote}`,
    // `irreversible: true` (Ruling 96): the retired row's own fields were
    // folded into `keep` above — restoring it would re-add the pre-merge
    // row alongside the merged one and double-count the account. The
    // discriminator is set HERE, at the producer, so the surface never has
    // to infer it from `reason`'s prose.
    excludedRows: [
      { row: merge.row, reason: `merged into "${keep.row.name}"`, irreversible: true },
    ],
  };
}

/**
 * The debt half. Same rule, minus everything that is an account concept: a
 * liability carries no positions, so there is no holdings clone, no id
 * re-stamp and no discarded-positions note — the three things that make up
 * most of the accounts path above. Writing them out as a second function is
 * what keeps that difference visible instead of hiding it behind branches in
 * one body.
 */
function mergeLiabilityRows(
  payload: PersistedImportPayload,
  keep: { index: number; row: LiabilityRow },
  merge: { index: number; row: LiabilityRow },
): ToolResult {
  const liabilities = payload.liabilities ?? [];
  const merged = unionRowFields(keep.row, merge.row);
  const nextLiabilities = liabilities
    .map((r, i) => (i === keep.index ? merged : r))
    .filter((_, i) => i !== merge.index);
  return {
    payload: { ...payload, liabilities: nextLiabilities },
    summary: `Merged "${merge.row.name}" into "${keep.row.name}".`,
    excludedRows: [
      { row: merge.row, reason: `merged into "${keep.row.name}"`, irreversible: true },
    ],
  };
}

// ---------------------------------------------------------------------------
// drop_row
// ---------------------------------------------------------------------------

export interface DropRowArgs {
  rowId: string;
  reason: string;
}

/**
 * Moves a row to `excludedRows` with its reason — C3: the ONE excluded-row
 * shape used everywhere (`{ row; reason; decision? }`), never a flat
 * `{ __rowId, __excludedReason }`. Never deletes the row's data: it survives,
 * annotated, exactly like a rollup `detectRollups` excludes.
 *
 * Returns only the NEW excluded entry this call produced — the caller
 * (turn.ts / the route) appends it to the prior `excludedRows` list before
 * persisting, mirroring how `writeChatState` only ever receives what changed.
 */
export function dropRow(
  payload: PersistedImportPayload,
  args: DropRowArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  if (args.reason.trim().length === 0) {
    throw new Error("A reason is required to drop a row.");
  }
  const located = locateRow(payload, args.rowId);
  const dropped = located.row;
  assertNotCommitted(dropped, committedRowIds);
  const summary = `Dropped "${dropped.name}" — ${args.reason}.`;
  const excludedRows: ToolResult["excludedRows"] = [{ row: dropped, reason: args.reason }];
  if (located.table === "liabilities") {
    const liabilities = payload.liabilities ?? [];
    return {
      payload: { ...payload, liabilities: liabilities.filter((_, i) => i !== located.index) },
      summary,
      excludedRows,
    };
  }
  const accounts = accountsOf(payload);
  return {
    payload: { ...payload, accounts: accounts.filter((_, i) => i !== located.index) },
    summary,
    excludedRows,
  };
}

// ---------------------------------------------------------------------------
// edit_holding / drop_holding
// ---------------------------------------------------------------------------

export interface EditHoldingArgs {
  rowId: string;
  holdingId: string;
  field: string;
  value: unknown;
}

export interface DropHoldingArgs {
  rowId: string;
  holdingId: string;
}

/**
 * Locate one position, or throw naming the ids that DO exist — `findRowIndex`
 * does the same for rows (I5), because a model told only "not found" retries
 * with another guess and burns the turn's tool budget. Shares
 * `MAX_LISTED_IDS` with `findRowIndex` rather than a second, uncapped list:
 * holdings are the more numerous of the two (a real import had ~63 positions
 * on one account), so this is the list most likely to need the cap.
 */
function findHoldingIndex(row: AccountRow, holdingId: string): number {
  const holdings = row.holdings ?? [];
  const idx = holdings.findIndex((h) => h.__holdingId === holdingId);
  if (idx !== -1) {
    // A tombstoned position is still IN the array (that is what stops the
    // next extraction resurrecting it), so it is findable — but no surface
    // shows it and no commit writes it. Returning its index let both
    // mutators report a confident `Set shares to 150 on ABBV` for a write
    // with no effect, which is a post-write confirmation that is not
    // grounded. The model gets told what actually happened instead.
    if (isDroppedHolding(holdings[idx])) {
      throw new Error(
        `Holding "${holdingId}" on row ${row.__rowId} was dropped from this import, so it cannot be edited or dropped again.`,
      );
    }
    return idx;
  }

  const known = holdings.map((h) => h.__holdingId).filter((id): id is string => Boolean(id));
  if (known.length === 0) {
    throw new Error(`No holding "${holdingId}" on row ${row.__rowId}. That row has no holdings.`);
  }
  const listed = known.slice(0, MAX_LISTED_IDS).join(", ");
  const more = known.length > MAX_LISTED_IDS ? `, and ${known.length - MAX_LISTED_IDS} more` : "";
  throw new Error(
    `No holding "${holdingId}" on row ${row.__rowId}. Valid holding ids: ${listed}${more}.`,
  );
}

/**
 * Writes ONE field on ONE position inside ONE row. Mirrors `editRow`:
 * `field` must be on the `EDITABLE_HOLDING_FIELDS` allowlist (`holding-
 * fields.ts`) and `value` must additionally pass that field's own domain
 * check — a numeric field that accepted a string would be stored as one and
 * later concatenated (the defect this whole plan traces back to).
 */
export function editHolding(
  payload: PersistedImportPayload,
  args: EditHoldingArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  const accounts = accountsOf(payload);
  const rowIdx = findRowIndex(accounts, args.rowId);
  assertNotCommitted(accounts[rowIdx], committedRowIds);
  if (!isEditableHoldingField(args.field)) {
    throw new Error(
      `Field "${args.field}" is not editable on a holding. Editable fields: ${EDITABLE_HOLDING_FIELDS.join(", ")}.`,
    );
  }
  if (!isValidHoldingValue(args.field, args.value)) {
    throw new Error(
      `Value for "${args.field}" must be ${holdingFieldDomainDescription(args.field)}.`,
    );
  }
  const row = accounts[rowIdx];
  const hIdx = findHoldingIndex(row, args.holdingId);
  const holdings = [...(row.holdings ?? [])];
  holdings[hIdx] = { ...holdings[hIdx], [args.field]: args.value };
  const nextAccounts = [...accounts];
  nextAccounts[rowIdx] = { ...row, holdings };
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Set ${args.field} to ${describeValue(args.value)} on ${
      holdings[hIdx].ticker ?? holdings[hIdx].name ?? args.holdingId
    } in "${row.name}".`,
  };
}

/**
 * Tombstones ONE position — sets `__dropped: true` and leaves it in the
 * array (never removes it), so `livingHoldings` (the ONE reader of that
 * flag) excludes it from anything that counts while the row keeps its
 * original position count. Unlike `dropRow`, this returns no `excludedRows`:
 * that delta exists for the row-level excluded list the advisor sees
 * separately, and a dropped position isn't a row.
 */
export function dropHolding(
  payload: PersistedImportPayload,
  args: DropHoldingArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  const accounts = accountsOf(payload);
  const rowIdx = findRowIndex(accounts, args.rowId);
  assertNotCommitted(accounts[rowIdx], committedRowIds);
  const row = accounts[rowIdx];
  const hIdx = findHoldingIndex(row, args.holdingId);
  const holdings = [...(row.holdings ?? [])];
  const dropped = holdings[hIdx];
  holdings[hIdx] = { ...dropped, __dropped: true };
  const nextAccounts = [...accounts];
  nextAccounts[rowIdx] = { ...row, holdings };
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Dropped ${dropped.ticker ?? dropped.name ?? args.holdingId} from "${row.name}". It will not be saved with the account.`,
  };
}

// ---------------------------------------------------------------------------
// read_holdings
// ---------------------------------------------------------------------------

export interface ReadHoldingsArgs {
  rowId: string;
}

/**
 * Fix round 1, R32: how many positions `readHoldings` lists before
 * truncating with a truthful "…and N more" suffix.
 *
 * This is NOT the same budget as `HOLDINGS_PROMPT_BUDGET_CHARS`
 * (`turn.ts`), and capping one does not cap the other. That block is
 * rebuilt fresh every turn and thrown away with the rest of the system
 * prompt — it never accumulates. This tool's `summary`, by contrast, is
 * pushed onto `turnEntries`, PERSISTED to the chat transcript, and REPLAYED
 * by `transcriptToMessages` (`turn.ts`) on every LATER turn — and a turn can
 * call this tool up to `MAX_TOOL_CALLS_PER_TURN` times. An uncapped join
 * here doesn't cost one turn's budget, it costs every turn's budget from
 * here on, growing without bound. 100 is far past any realistic account's
 * holding count (the production failure behind this whole plan was ~63
 * positions in one account), so the cap should never bite in practice — it
 * exists for the account that would otherwise never stop growing the
 * transcript.
 */
const MAX_HOLDINGS_PER_READ = 100;

/**
 * Fix round 1, R31: the ONE way to render a position — used by both the
 * prompt's inline listing (`describeHoldings` in `turn.ts`) and this tool's
 * own result, so the two views of "positions in an account" can't drift the
 * way they did at birth: three differences (`price=`, the `JSON.stringify`,
 * the indent prefix) in the copy carrying the R29 guard below, the one thing
 * that must not drift. Lives here, not in `turn.ts`, because the import
 * direction only runs one way — `turn.ts` already imports seven symbols from
 * this file (`editRow`, `mergeRows`, …), and this file must never import
 * from `turn.ts`.
 *
 * `indent` is supplied by the caller, not baked in: the prompt's inline
 * block nests one line per position under its account heading (`"  - "`),
 * this tool's flat list does not.
 *
 * R29: `__holdingId` is optional on `ExtractedHolding` — a payload persisted
 * before this branch carries positions with none. Printing
 * `${h.__holdingId}:` unconditionally renders the literal string "undefined"
 * as an id, and a model reading that as a real handle would call
 * `edit_holding`/`drop_holding` with it — both throw (neither tool has a
 * holding whose id IS "undefined"), burning one of the four tool calls a
 * turn allows on a position that genuinely cannot be corrected through this
 * surface: both tools match on `__holdingId` alone.
 */
export function formatHoldingLine(h: ExtractedHolding, indent = ""): string {
  const label = JSON.stringify(h.ticker ?? h.name ?? "?");
  const figures =
    `shares=${h.shares ?? "?"} price=${h.price ?? "?"} ` +
    `value=${h.marketValue ?? "?"} basis=${h.costBasis ?? "?"}`;
  return h.__holdingId
    ? `${indent}${h.__holdingId}: ${label} ${figures}`
    : `${indent}${label} ${figures} (no id — not correctable here)`;
}

/**
 * Read-only: returns one account's positions as prose. Writes nothing, so —
 * like `explain` and `reread_document` — it is available on a committed row
 * (it takes no `committedRowIds` at all, unlike `editHolding`/`dropHolding`),
 * and (Important 1's reference-identity contract) always returns the SAME
 * `payload` it was handed rather than a copy, so `runTurn` never mistakes a
 * read for a mutation.
 */
export function readHoldings(payload: PersistedImportPayload, args: ReadHoldingsArgs): ToolResult {
  const accounts = accountsOf(payload);
  const row = accounts[findRowIndex(accounts, args.rowId)];
  const living = livingHoldings(row);
  if (living.length === 0) {
    return { payload, summary: `"${row.name}" has no positions.` };
  }
  const shown = living.slice(0, MAX_HOLDINGS_PER_READ);
  const lines = shown.map((h) => formatHoldingLine(h)).join("\n");
  const more =
    living.length > MAX_HOLDINGS_PER_READ
      ? `\n…and ${living.length - MAX_HOLDINGS_PER_READ} more.`
      : "";
  return { payload, summary: `Positions in "${row.name}":\n${lines}${more}` };
}

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

export interface ExplainArgs {
  rowId: string;
}

/**
 * C1 / Ruling 21: `__provenance.pageRange` is populated only by the
 * multi-pass extraction path, never by `merge-across-files.ts` (the path
 * every chat-surface row comes through) — so this cites the page range ONLY
 * when it is actually present, rather than always, which would ship a tool
 * that tells every real advisor "pages undefined".
 *
 * `sourceFileId` is an id, not a filename (C1) — `fileNames` is the caller's
 * map from `payloadJson.fileResults[id].fileName`, since this is a lib
 * function and cannot read `SourceFilesContext` (React context).
 *
 * Ruling 49: this reaches BOTH tables. It resolves by row id, writes nothing,
 * and a debt carries `__provenance` exactly like an account — so "where did
 * the mortgage balance come from?" answers with the document instead of
 * dead-ending on `Unknown row id` listing only account ids, which is verbatim
 * the retry loop `findRowIndex`'s own docblock was written to prevent.
 */
export function explain(
  payload: PersistedImportPayload,
  args: ExplainArgs,
  fileNames: Record<string, string>,
): ToolResult {
  const row = locateRow(payload, args.rowId).row;
  const prov = row.__provenance;
  if (!prov) {
    return { payload, summary: `"${row.name}" has no recorded source document.` };
  }
  const fileName = fileNames[prov.sourceFileId] ?? prov.sourceFileId;
  const pageClause = prov.pageRange ? `, pages ${prov.pageRange[0]}–${prov.pageRange[1]}` : "";
  return { payload, summary: `"${row.name}" came from ${fileName}${pageClause}.` };
}

// ---------------------------------------------------------------------------
// reread_document
// ---------------------------------------------------------------------------

export interface RereadDocumentArgs {
  /**
   * The document's NAME, not its id (Ruling 103). The model is never shown a
   * row's real `sourceFileId`: both `describeRows` (turn.ts) and `explain`
   * substitute the human-readable file name before the model sees a source,
   * so a name is the only identifier it can supply. `resolveSourceFileId`
   * below turns it back into the id everything downstream keys off.
   */
  fileName: string;
  question: string;
}

/**
 * Minimal duck-typed contract for the model `reread_document` calls — a
 * single text-completion round trip. `chatModel()` (`AzureChatOpenAI`)
 * satisfies this structurally via its own `.invoke()`; tests supply a stub
 * that does the same without a real Azure call (C2).
 */
export interface RereadModel {
  invoke(prompt: string): Promise<{ content: unknown }>;
}

/** Context `reread_document` needs beyond `(payload, args, model)`: the
 *  import id (Important 2's scoping fix) and this import's own stored
 *  extraction results (the Critical's fix — real document text). */
export interface RereadDocumentContext {
  importId: string;
  fileResults: Record<string, ExtractionResult>;
}

function pickEditable(row: AccountRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_ACCOUNT_FIELDS) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function extractJsonObject(content: unknown): Record<string, unknown> {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model's reply did not contain a JSON proposal.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("The model's reply was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The model's reply was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve the document the model NAMED to the `sourceFileId` every check
 * below keys off (Ruling 103).
 *
 * The mapping has to happen here, server-side, because the model never holds
 * a real file id: the row list it reads shows `source=<file name>` and
 * `explain` cites a file name, so the id side of `fileNames` exists only in
 * this process. `ctx.fileResults` — the same map the caller derives that
 * `fileNames` from — is this import's own file list, so resolving against it
 * cannot reach another import's document, and Ruling 86's `importId`-scoped
 * DB lookup downstream is untouched either way.
 *
 * Matching is trimmed and case-insensitive. A value that is ALREADY a source
 * file id (a key of `fileResults`, or one live on a row's provenance)
 * resolves to itself — the model occasionally echoes an id back, and there
 * is no reason to punish it.
 */
function resolveSourceFileId(
  named: string,
  accounts: AccountRow[],
  fileResults: Record<string, ExtractionResult>,
): string {
  // `named` arrives straight off the model's tool call (`args as never` at
  // the dispatch site), so it can be absent however the schema is written.
  const raw = (named ?? "").trim();
  // Final review, T3: strip a matched pair of surrounding double quotes. The
  // row list renders `source="fidelity-2026-06.pdf"` (Ruling 103's own
  // boundary fix) and this tool's description says to name the document
  // "exactly as shown for a row" — so a model that includes the quotes is
  // reading the instruction correctly, and failing it burns one of the four
  // tool calls a turn allows. This tool has already shipped broken twice on
  // this class of gap.
  const wanted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).trim()
      : raw;
  if (wanted.length === 0) {
    throw new Error("Name the source document to re-read, exactly as it is shown for a row.");
  }
  if (Object.hasOwn(fileResults, wanted)) return wanted;
  if (accounts.some((r) => r.__provenance?.sourceFileId === wanted)) return wanted;

  const folded = wanted.toLowerCase();
  const matches = Object.entries(fileResults).filter(
    ([, result]) => (result.fileName ?? "").trim().toLowerCase() === folded,
  );
  if (matches.length === 1) return matches[0][0];

  // Two files under one name: naming the collision beats silently picking
  // one, which would re-read the wrong statement and propose a correction
  // off the wrong document. The ids give a way out — they resolve to
  // themselves above.
  if (matches.length > 1) {
    throw new Error(
      `This import has ${matches.length} documents named "${wanted}", so I can't tell which one ` +
        `you mean. Ask again by source id: ${matches.map(([id]) => id).join(", ")}.`,
    );
  }

  // Listing what this import DOES have, so the next attempt can name a real
  // document instead of looping on the same miss.
  const known = Object.values(fileResults)
    .map((result) => (result.fileName ?? "").trim())
    .filter((name) => name.length > 0);
  throw new Error(
    known.length > 0
      ? `No document in this import is named "${wanted}". This import has: ${known.join(", ")}.`
      : `No document in this import is named "${wanted}".`,
  );
}

/** The real, already-SSN-redacted text of a stored extraction result —
 *  `text` on the single-pass path, `pages` (joined) on multi-pass; every
 *  extraction produced by the current pipeline sets exactly one of the two
 *  (`extract.ts`'s two `return` sites). `undefined` only for a row persisted
 *  before this field existed. */
function storedDocumentText(result: ExtractionResult): string | undefined {
  if (result.text) return result.text;
  if (result.pages && result.pages.length > 0) return result.pages.join("\n\n---\n\n");
  return undefined;
}

/**
 * CRITICAL FIX (review round 1): the original version downloaded the file's
 * bytes, used them for nothing but a null check, and then asked the model a
 * text-only question built from data the row ALREADY carried — so the
 * "correction" it returned was invented, not read off the statement, no
 * matter what the advisor asked.
 *
 * RULING 103 (fix wave): the tool then took a `fileId` the model could never
 * supply — every surface substitutes the file NAME before the model sees a
 * row's source — so it threw "No rows in this import came from file …" on
 * every call. It now takes the name and resolves it to the id server-side
 * (`resolveSourceFileId`); every check below is keyed on the RESOLVED id, so
 * the provenance pre-check and Ruling 86's `importId` scoping are unchanged.
 *
 * The fix reuses `fileResults[fileId].text`/`.pages` — the already-redacted
 * document text `extract.ts` captures at extraction time specifically "so
 * the planning reasoner can run without re-fetching or re-parsing the source
 * file" (see its own doc comment in `@/lib/extraction/types`). That text is
 * embedded directly in the prompt below, so the model's answer is grounded
 * in what the statement actually says. A file predating that field (no
 * `text`/`pages` stored at all) falls back to downloading the blob and
 * re-running the real extraction pipeline (`extractDocument`,
 * `@/lib/extraction/extract`) to obtain it fresh — never a bespoke second
 * vision call. (Two known repo traps on that fallback path: Azure's
 * jailbreak filter can block vision OCR, and extraction truncates long
 * holdings tables — neither applies to the common stored-text path above.)
 */
export async function rereadDocument(
  payload: PersistedImportPayload,
  args: RereadDocumentArgs,
  model: RereadModel,
  ctx: RereadDocumentContext,
): Promise<ToolResult> {
  const accounts = accountsOf(payload);
  const fileId = resolveSourceFileId(args.fileName, accounts, ctx.fileResults);
  const fileResult = ctx.fileResults[fileId];
  /** What to CALL the document in anything the advisor or model reads — an
   *  id is meaningless to both. */
  const documentLabel = fileResult?.fileName ?? args.fileName.trim();

  const candidates = accounts.filter((r) => r.__provenance?.sourceFileId === fileId);
  if (candidates.length === 0) {
    throw new Error(`No rows in this import came from file "${documentLabel}".`);
  }

  let documentText = fileResult ? storedDocumentText(fileResult) : undefined;

  if (!documentText) {
    // Important 2: scoped by importId too, not id alone — `payload.accounts`
    // is advisor-controlled (the accounts-PATCH route shallow-merges with no
    // row validation), so the `__provenance` pre-check above narrows `fileId`
    // to a value SOMEONE claimed on a row, not one this import provably owns.
    const [file] = await db
      .select({ blobUrl: clientImportFiles.blobUrl })
      .from(clientImportFiles)
      .where(and(eq(clientImportFiles.id, fileId), eq(clientImportFiles.importId, ctx.importId)))
      .limit(1);
    if (!file) {
      throw new Error(`Source file "${documentLabel}" could not be found in this import.`);
    }
    const buffer = await downloadImportFile(file.blobUrl);
    if (!buffer) {
      throw new Error(`The stored file for "${documentLabel}" is unavailable.`);
    }
    const documentType = fileResult?.documentType ?? "auto";
    const fresh = await extractDocument(buffer, documentLabel, documentType, "mini");
    documentText = storedDocumentText(fresh);
    if (!documentText) {
      throw new Error(`Could not read the text of "${documentLabel}" to re-check it.`);
    }
  }

  const rowsDescription = candidates
    .map((r) => `- rowId ${r.__rowId}: ${JSON.stringify(pickEditable(r))}`)
    .join("\n");
  const prompt = [
    "An advisor is reviewing account rows extracted from the statement text below and has a question",
    "about ONE of them. Answer ONLY from the statement text — never from the row values themselves —",
    "by proposing a single corrected field on ONE of the rows below. Do not guess a row or field that",
    "isn't listed, and do not propose a value the statement text doesn't actually support.",
    "",
    `Rows from this file:\n${rowsDescription}`,
    "",
    "--- STATEMENT TEXT ---",
    documentText,
    "--- END STATEMENT TEXT ---",
    "",
    `Question: ${args.question}`,
    "",
    `Reply with ONLY a JSON object: {"rowId": "...", "field": "...", "value": ...}.`,
    `"field" must be one of: ${EDITABLE_ACCOUNT_FIELDS.join(", ")}.`,
  ].join("\n");

  const response = await model.invoke(prompt);
  const obj = extractJsonObject(response.content);
  const rowId = obj.rowId;
  const field = obj.field;
  const value = obj.value;
  if (typeof rowId !== "string" || typeof field !== "string" || !("value" in obj)) {
    throw new Error("The model's reply was missing rowId, field, or value.");
  }
  if (!candidates.some((r) => r.__rowId === rowId)) {
    throw new Error(`The model proposed an unknown row id "${rowId}".`);
  }
  if (!isEditableField(field)) {
    throw new Error(`The model proposed a field "${field}" that is not editable.`);
  }
  if (!isValidFieldValue(field, value)) {
    throw new Error(`The model proposed a value for "${field}" outside its valid domain.`);
  }

  // I3: this sentence IS the proposal — it is the only thing that carries
  // the correction now, so it names the ROW as well as the field and value.
  // "set basis to 12,345" alone is ambiguous the moment a statement has two
  // accounts, and "yes, apply that" has to be unambiguous for the model's
  // follow-up `edit_row` to hit the right row.
  const proposedRow = candidates.find((r) => r.__rowId === rowId);
  return {
    payload,
    summary:
      `Found a possible correction on "${proposedRow?.name ?? rowId}" (row ${rowId}): ` +
      `set ${field} to ${describeValue(value)}. Nothing has changed yet — say to apply it ` +
      `and I'll make the edit.`,
  };
}
