import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { downloadImportFile } from "@/lib/imports/blob";
import type { Annotated, ChatState, PersistedImportPayload } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * The five statement-chat tools (Task 11). Each one is a function over
 * `(payload, args, ...)` returning a `ToolResult` — the next payload plus a
 * one-line summary for the transcript, and (for `drop_row`/`reread_document`
 * only) the extra fields Ruling 49 allows.
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

/** Rejects an object/function/array `value` — a scalar-only guard so a
 *  prompted model can't smuggle a structured payload into a scalar column. */
function isScalarValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * ONE result type with optional members (Ruling 49 / C4) — not three ad-hoc
 * shapes. `payload` and `summary` are on every result (C13: the route can't
 * ship a turn with either missing); `excludedRows` and `proposal` are present
 * only for the tools that produce them. The route merges whatever is present
 * through `writeChatState`.
 */
export interface ToolResult {
  payload: PersistedImportPayload;
  summary: string;
  /** `drop_row` only — the newly-excluded entries this call produced (NOT
   *  the full accumulated list; the caller appends them to the prior one). */
  excludedRows?: ChatState["excludedRows"];
  /** `reread_document` only — a correction the advisor must accept before
   *  it ever reaches `payload`. */
  proposal?: { rowId: string; field: EditableAccountField; value: unknown };
}

function accountsOf(payload: PersistedImportPayload): AccountRow[] {
  return payload.accounts ?? [];
}

function findRowIndex(accounts: AccountRow[], rowId: string): number {
  const idx = accounts.findIndex((r) => r.__rowId === rowId);
  if (idx === -1) throw new Error(`Unknown row id "${rowId}".`);
  return idx;
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
 * anything added to `ExtractedAccount` later.
 */
export function editRow(payload: PersistedImportPayload, args: EditRowArgs): ToolResult {
  const accounts = accountsOf(payload);
  const idx = findRowIndex(accounts, args.rowId);
  if (!isEditableField(args.field)) {
    throw new Error(
      `Field "${args.field}" is not editable. Editable fields: ${EDITABLE_ACCOUNT_FIELDS.join(", ")}.`,
    );
  }
  if (!isScalarValue(args.value)) {
    throw new Error(`Value for "${args.field}" must be a plain string, number, boolean, or null.`);
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
 * Backfill undefined/null fields on `base` from `other`, without touching a
 * field `base` already has. C9: deliberately mirrors `unionFields` in
 * `merge-across-files.ts` — that helper is module-local and not exported, so
 * the semantics are re-implemented here rather than exporting merge
 * internals for a tool.
 */
function unionAccountFields(base: AccountRow, other: AccountRow): AccountRow {
  const merged: AccountRow = { ...base };
  for (const key of Object.keys(other) as Array<keyof AccountRow>) {
    const baseValue = merged[key];
    const otherValue = other[key];
    if ((baseValue === undefined || baseValue === null) && otherValue !== undefined && otherValue !== null) {
      (merged as unknown as Record<string, unknown>)[key as string] = otherValue;
    }
  }
  return merged;
}

/**
 * Unions two rows into one. `keepRowId` is the base and wins conflicting
 * fields; `mergeRowId`'s unique fields backfill (C9). `mergeRowId` is
 * retired — the row is REMOVED from `payload.accounts`, never soft-marked,
 * matching how a duplicate statement row is already handled by the merge.
 */
export function mergeRows(payload: PersistedImportPayload, args: MergeRowsArgs): ToolResult {
  if (args.keepRowId === args.mergeRowId) {
    throw new Error("Cannot merge a row into itself.");
  }
  const accounts = accountsOf(payload);
  const keepIdx = findRowIndex(accounts, args.keepRowId);
  const mergeIdx = findRowIndex(accounts, args.mergeRowId);
  const keep = accounts[keepIdx];
  const merge = accounts[mergeIdx];
  const merged = unionAccountFields(keep, merge);
  const nextAccounts = accounts
    .map((r, i) => (i === keepIdx ? merged : r))
    .filter((_, i) => i !== mergeIdx);
  return {
    payload: { ...payload, accounts: nextAccounts },
    summary: `Merged "${merge.name}" into "${keep.name}".`,
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
export function dropRow(payload: PersistedImportPayload, args: DropRowArgs): ToolResult {
  if (args.reason.trim().length === 0) {
    throw new Error("A reason is required to drop a row.");
  }
  const accounts = accountsOf(payload);
  const idx = findRowIndex(accounts, args.rowId);
  const dropped = accounts[idx];
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
  fileId: string;
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
 * C10: the safety property of the whole toolset. This is the only tool that
 * calls a model, and the only one with access to the raw source document —
 * it PROPOSES a correction and never writes `payload` itself. `payload` on
 * the returned `ToolResult` is the SAME object handed in, untouched; the
 * advisor accepts a proposal through `edit_row`, a separate, auditable step.
 *
 * `fileId` must already appear as some row's `__provenance.sourceFileId` in
 * THIS payload — a guardrail, not just a lookup convenience: `payload` here
 * is always built from this import's own `fileResults` (the route only ever
 * hands in this import's data), so restricting `fileId` to one already
 * referenced there means a prompted model cannot use this tool to read an
 * arbitrary file id belonging to a different client or firm.
 */
export async function rereadDocument(
  payload: PersistedImportPayload,
  args: RereadDocumentArgs,
  model: RereadModel,
): Promise<ToolResult> {
  const accounts = accountsOf(payload);
  const candidates = accounts.filter((r) => r.__provenance?.sourceFileId === args.fileId);
  if (candidates.length === 0) {
    throw new Error(`No rows in this import came from file "${args.fileId}".`);
  }

  const [file] = await db
    .select({ blobUrl: clientImportFiles.blobUrl })
    .from(clientImportFiles)
    .where(eq(clientImportFiles.id, args.fileId))
    .limit(1);
  if (!file) {
    throw new Error(`Source file "${args.fileId}" could not be found.`);
  }
  const buffer = await downloadImportFile(file.blobUrl);
  if (!buffer) {
    throw new Error(`The stored file for "${args.fileId}" is unavailable.`);
  }

  const rowsDescription = candidates
    .map((r) => `- rowId ${r.__rowId}: ${JSON.stringify(pickEditable(r))}`)
    .join("\n");
  const prompt = [
    "An advisor is reviewing account rows extracted from the attached statement and has a question",
    "about ONE of them. Answer by proposing a single corrected field on ONE of the rows below — do not",
    "guess a row or field that isn't listed.",
    "",
    `Rows from this file:\n${rowsDescription}`,
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
  if (!isScalarValue(value)) {
    throw new Error(`The model proposed a non-scalar value for "${field}".`);
  }

  return {
    payload,
    summary: `Found a possible correction: set ${field} to ${describeValue(value)} — awaiting your approval.`,
    proposal: { rowId, field, value },
  };
}
