// src/lib/fact-finder/persist.ts
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import type { Tx } from "@/lib/db-tx";
import type { ExtractionResult } from "@/lib/extraction/types";
import { mergePayloadJson } from "@/lib/imports/payload-json-sql";
import { SAVE_CLOSED_MESSAGE } from "./api-types";
import { readFactFinderState } from "./state";
import type { FactFinderState, FFClosed } from "./types";

export interface FactFinderScope {
  importId: string;
  clientId: string;
  firmId: string;
}

export class FactFinderNotFoundError extends Error {
  constructor() {
    super("Import not found");
    this.name = "FactFinderNotFoundError";
  }
}

/** Every retry met a newer version — something is writing in a tight loop. */
export class FactFinderBusyError extends Error {
  constructor(message = "The fact finder is busy — try again in a moment.") {
    super(message);
    this.name = "FactFinderBusyError";
  }
}

/**
 * The import was saved to the plan (the save closed it) — nothing may write it
 * again, and retrying can't help. A kind of "busy" so the routes that already
 * answer a busy fact finder with a 409 answer this one the same way.
 */
export class FactFinderClosedError extends FactFinderBusyError {
  constructor() {
    super(SAVE_CLOSED_MESSAGE);
    this.name = "FactFinderClosedError";
  }
}

function scoped(scope: FactFinderScope): SQL | undefined {
  return and(
    eq(clientImports.id, scope.importId),
    eq(clientImports.clientId, scope.clientId),
    eq(clientImports.orgId, scope.firmId),
    isNull(clientImports.discardedAt),
  );
}

/** The save closes an import by writing `factFinder.closed`; nothing writes over one that has it. */
const notClosed = sql`(${clientImports.payloadJson} -> 'factFinder' -> 'closed') IS NULL`;

const storedVersion = sql`COALESCE((${clientImports.payloadJson} -> 'factFinder' ->> 'version')::int, 0)`;

/** One top-level key of the import's payload — not the whole (large) document. */
async function selectPayloadKey(
  scope: FactFinderScope,
  key: "factFinder" | "fileResults",
): Promise<{ found: false } | { found: true; slice: unknown }> {
  const [row] = await db
    .select({ slice: sql`${clientImports.payloadJson} -> ${key}::text` })
    .from(clientImports)
    .where(scoped(scope))
    .limit(1);
  return row ? { found: true, slice: row.slice } : { found: false };
}

export async function loadFactFinder(scope: FactFinderScope): Promise<FactFinderState | null> {
  const row = await selectPayloadKey(scope, "factFinder");
  return row.found ? readFactFinderState({ factFinder: row.slice ?? undefined }) : null;
}

/**
 * Whether the stored rows and unassigned holdings at `baseVersion` equal
 * `next`'s — the only parts of the fact finder the review reads. Compared as
 * jsonb, so key order and number formatting don't matter.
 */
async function rowsUnchanged(scope: FactFinderScope, baseVersion: number, next: FactFinderState): Promise<boolean> {
  const stored = sql`${clientImports.payloadJson} -> 'factFinder'`;
  const [row] = await db
    .select({
      same: sql<boolean>`(${stored} -> 'sections') = ${JSON.stringify(next.sections)}::jsonb
        AND COALESCE(${stored} -> 'unassignedHoldings', '[]'::jsonb) = ${JSON.stringify(next.unassignedHoldings)}::jsonb`,
    })
    .from(clientImports)
    .where(and(scoped(scope), sql`${storedVersion} = ${baseVersion}`))
    .limit(1);
  return row?.same === true;
}

/** The fact finder slice, locked (`FOR UPDATE`) on the save's transaction; null when the import is gone. A second save waits here for the first. */
export async function lockFactFinder(tx: Tx, scope: FactFinderScope): Promise<FactFinderState | null> {
  const [row] = await tx
    .select({ slice: sql`${clientImports.payloadJson} -> 'factFinder'` })
    .from(clientImports)
    .where(scoped(scope))
    .limit(1)
    .for("update");
  return row ? readFactFinderState({ factFinder: row.slice ?? undefined }) : null;
}

/**
 * Closes the import on the save's transaction: `closed` written, version + 1,
 * everything else in the slice (the change list included) as stored, and the
 * import marked committed. Compare-and-set on `baseVersion` and on "not closed
 * yet"; null when either fails (nothing written).
 */
export async function closeFactFinder(
  tx: Tx,
  scope: FactFinderScope,
  baseVersion: number,
  closed: FFClosed,
): Promise<FactFinderState | null> {
  const stored = sql`COALESCE(${clientImports.payloadJson} -> 'factFinder', '{}'::jsonb)`;
  const rows = await tx
    .update(clientImports)
    .set({
      payloadJson: sql`COALESCE(${clientImports.payloadJson}, '{}'::jsonb) || jsonb_build_object('factFinder', ${stored} || jsonb_build_object('closed', ${JSON.stringify(closed)}::jsonb, 'version', ${baseVersion + 1}::int))`,
      status: "committed",
      committedAt: new Date(closed.at),
      updatedAt: new Date(),
    })
    .where(and(scoped(scope), sql`${storedVersion} = ${baseVersion}`, notClosed))
    .returning({ slice: sql`${clientImports.payloadJson} -> 'factFinder'` });
  return rows.length === 1 ? readFactFinderState({ factFinder: rows[0].slice ?? undefined }) : null;
}

/**
 * Compare-and-set: writes only if the stored version still equals `baseVersion`
 * and the import isn't closed (a saved import is never written again).
 * Keeps a carried `changeSet` when `keepChangeSet` (the review) or when the
 * write leaves the rows and unassigned holdings as stored (a reading that
 * failed, a chat turn that edits nothing); any other write drops it. Here, so
 * every caller (PATCH, chat turn, undo, reading: `updateFactFinder`) gets it.
 */
export async function writeFactFinder(
  scope: FactFinderScope,
  baseVersion: number,
  next: FactFinderState,
  options: { keepChangeSet?: boolean } = {},
): Promise<FactFinderState | null> {
  const written: FactFinderState = { ...next, version: baseVersion + 1 };
  const keep = options.keepChangeSet || (next.changeSet !== undefined && (await rowsUnchanged(scope, baseVersion, next)));
  if (!keep) delete written.changeSet;
  const rows = await db
    .update(clientImports)
    .set({ payloadJson: mergePayloadJson({ factFinder: written }), updatedAt: new Date() })
    .where(and(scoped(scope), sql`${storedVersion} = ${baseVersion}`, notClosed))
    .returning({ id: clientImports.id });
  return rows.length === 1 ? written : null;
}

/**
 * Load, apply `mutate`, compare-and-set; on a stale version, start again from
 * the fresh state. `mutate` must be pure — it can run more than once. A closed
 * fact finder stops it at once (`FactFinderClosedError`): the read before any
 * attempt sees `closed`, so a write that lost to the save is not retried.
 */
export async function updateFactFinder(
  scope: FactFinderScope,
  mutate: (state: FactFinderState) => FactFinderState,
  attempts = 8,
): Promise<FactFinderState> {
  for (let i = 0; i < attempts; i++) {
    const current = await loadFactFinder(scope);
    if (!current) throw new FactFinderNotFoundError();
    if (current.closed) throw new FactFinderClosedError();
    const next = mutate(current);
    if (next === current) return current;
    const written = await writeFactFinder(scope, current.version, next);
    if (written) return written;
  }
  throw new FactFinderBusyError();
}

export interface ImportFileRow {
  id: string;
  blobUrl: string;
  originalFilename: string;
  detectedKind: string;
  documentType: string;
}

export async function listLiveFiles(importId: string): Promise<ImportFileRow[]> {
  return db
    .select({
      id: clientImportFiles.id,
      blobUrl: clientImportFiles.blobUrl,
      originalFilename: clientImportFiles.originalFilename,
      detectedKind: clientImportFiles.detectedKind,
      documentType: clientImportFiles.documentType,
    })
    .from(clientImportFiles)
    .where(and(eq(clientImportFiles.importId, importId), isNull(clientImportFiles.deletedAt)))
    .orderBy(asc(clientImportFiles.uploadedAt));
}

/** The statement reader's stored per-file results (written by runImportExtraction). */
export async function loadFileResults(scope: FactFinderScope): Promise<Record<string, ExtractionResult>> {
  const row = await selectPayloadKey(scope, "fileResults");
  return (row.found ? (row.slice as Record<string, ExtractionResult> | null) : null) ?? {};
}
