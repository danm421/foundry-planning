import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { downloadImportFile } from "@/lib/imports/blob";
import { stampAccountHoldingIds } from "@/lib/imports/assemble/merge-across-files";
import { extractDocument } from "@/lib/extraction/extract";
import type { Annotated, ChatState, PersistedImportPayload } from "@/lib/imports/types";
import type {
  AccountCategory,
  AccountSubType,
  ExtractedAccount,
  ExtractionResult,
} from "@/lib/extraction/types";

/**
 * The five statement-chat tools (Task 11). Each one is a function over
 * `(payload, args, ...)` returning a `ToolResult` — the next payload plus a
 * one-line summary for the transcript, and (for `drop_row`/`merge_rows`
 * only) the `excludedRows` delta Ruling 49 allows.
 *
 * Direction rule, same as `narrate.ts`/`rollups.ts`: this module reads from
 * `@/lib/imports/` and `@/lib/extraction/`, never the reverse.
 *
 * `payload` here is always the accounts-only `PersistedImportPayload` this
 * surface persists (C13) — every function below reads `payload.accounts`
 * defensively (`?? []`) rather than assuming it is populated.
 */

type AccountRow = Annotated<ExtractedAccount>;

/**
 * Ruling 50: `edit_row` uses an ALLOWLIST, never a denylist. These are
 * Task 10's seven columns (`ACCOUNT_COLUMNS` in
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

/** How many row ids an unknown-row error lists before it summarises the
 *  rest. Long enough to cover any realistic statement import, short enough
 *  that a pathological one can't flood the turn's context. */
const MAX_LISTED_ROW_IDS = 20;

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
function findRowIndex(accounts: AccountRow[], rowId: string): number {
  const idx = accounts.findIndex((r) => r.__rowId === rowId);
  if (idx !== -1) return idx;

  const known = accounts.map((r) => r.__rowId).filter((id): id is string => Boolean(id));
  if (known.length === 0) {
    throw new Error(`Unknown row id "${rowId}". This import has no rows to work on.`);
  }
  const listed = known.slice(0, MAX_LISTED_ROW_IDS).join(", ");
  const more =
    known.length > MAX_LISTED_ROW_IDS
      ? `, and ${known.length - MAX_LISTED_ROW_IDS} more`
      : "";
  throw new Error(`Unknown row id "${rowId}". The rows in this import are: ${listed}${more}.`);
}

/**
 * The set of `__rowId`s already committed into the client's plan
 * (`chat.committedRowIds`). Required — never optional — on all three
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
 */
function assertNotCommitted(row: AccountRow, committedRowIds: CommittedRowIds): void {
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
 * Writes ONE field on ONE row. Ruling 50: `field` must be on the
 * `EDITABLE_ACCOUNT_FIELDS` allowlist or this throws `/not editable/i` — a
 * denylist would silently permit `__provenance`/`match`/`reconciliation` and
 * anything added to `ExtractedAccount` later. `value` must additionally pass
 * that field's own domain check (Important 5) — the allowlist says WHICH
 * columns are writable, not that any scalar is a legal value for them.
 */
export function editRow(
  payload: PersistedImportPayload,
  args: EditRowArgs,
  committedRowIds: CommittedRowIds,
): ToolResult {
  const accounts = accountsOf(payload);
  const idx = findRowIndex(accounts, args.rowId);
  assertNotCommitted(accounts[idx], committedRowIds);
  if (!isEditableField(args.field)) {
    throw new Error(
      `Field "${args.field}" is not editable. Editable fields: ${EDITABLE_ACCOUNT_FIELDS.join(", ")}.`,
    );
  }
  if (!isValidFieldValue(args.field, args.value)) {
    throw new Error(`Value for "${args.field}" must be ${fieldDomainDescription(args.field)}.`);
  }
  const row = accounts[idx];
  const nextAccounts = accounts.map((r, i) =>
    i === idx ? { ...r, [args.field]: args.value } : r,
  );
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Set ${args.field} to ${describeValue(args.value)} on "${row.name}".`,
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
 * The four internal annotations `Annotated<T>` adds — the ONLY keys a merge
 * must not blend between two rows. `match` and `reconciliation` describe the
 * surviving row's OWN commit/reconciliation status and must never silently
 * inherit another row's; `__rowId` is the row's identity; `__provenance` gets
 * its own explicit rule in `unionAccountFields` below.
 *
 * Typed as `Record<keyof Annotated<object>, true>` rather than a hand-copied
 * array (the same construction `ACCOUNT_CATEGORY_SET` uses above): TypeScript
 * requires EVERY annotation key be present and rejects any key that isn't, so
 * adding a fifth annotation to `Annotated` is a compile error here rather
 * than a field that starts silently leaking across a merge.
 */
const ROW_ANNOTATION_KEYS: Record<keyof Annotated<object>, true> = {
  __provenance: true,
  match: true,
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
 */
function unionAccountFields(base: AccountRow, other: AccountRow): AccountRow {
  const merged: AccountRow = { ...base };
  for (const key of Object.keys(other) as Array<keyof AccountRow>) {
    // `Object.hasOwn`, not `key in` — `in` also matches Object.prototype's
    // own keys, so a row carrying a field called "toString" would be skipped.
    if (Object.hasOwn(ROW_ANNOTATION_KEYS, key)) continue;
    const baseValue = merged[key];
    const otherValue = other[key];
    if ((baseValue === undefined || baseValue === null) && otherValue !== undefined && otherValue !== null) {
      (merged as unknown as Record<string, unknown>)[key] = otherValue;
    }
  }
  if (!merged.__provenance && other.__provenance) {
    merged.__provenance = other.__provenance;
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
  const accounts = accountsOf(payload);
  const keepIdx = findRowIndex(accounts, args.keepRowId);
  const mergeIdx = findRowIndex(accounts, args.mergeRowId);
  const keep = accounts[keepIdx];
  const merge = accounts[mergeIdx];
  // BOTH sides, not just the retired one. Retiring a committed row leaves
  // its account in the plan while the survivor commits as a second copy of
  // the same account; folding into a committed SURVIVOR changes fields whose
  // committed figure this surface can no longer update.
  assertNotCommitted(keep, committedRowIds);
  assertNotCommitted(merge, committedRowIds);
  const merged = unionAccountFields(keep, merge);
  // `merged.holdings` is still the SAME array (and same holding objects) as
  // whichever of `keep`/`merge` donated it — `unionAccountFields` only
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
    .map((r, i) => (i === keepIdx ? merged : r))
    .filter((_, i) => i !== mergeIdx);
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Merged "${merge.name}" into "${keep.name}".`,
    // `irreversible: true` (Ruling 96): the retired row's own fields were
    // folded into `keep` above — restoring it would re-add the pre-merge
    // row alongside the merged one and double-count the account. The
    // discriminator is set HERE, at the producer, so the surface never has
    // to infer it from `reason`'s prose.
    excludedRows: [{ row: merge, reason: `merged into "${keep.name}"`, irreversible: true }],
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
  const accounts = accountsOf(payload);
  const idx = findRowIndex(accounts, args.rowId);
  const dropped = accounts[idx];
  assertNotCommitted(dropped, committedRowIds);
  const nextAccounts = accounts.filter((_, i) => i !== idx);
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Dropped "${dropped.name}" — ${args.reason}.`,
    excludedRows: [{ row: dropped, reason: args.reason }],
  };
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
 */
export function explain(
  payload: PersistedImportPayload,
  args: ExplainArgs,
  fileNames: Record<string, string>,
): ToolResult {
  const accounts = accountsOf(payload);
  const idx = findRowIndex(accounts, args.rowId);
  const row = accounts[idx];
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
