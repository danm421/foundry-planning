// src/lib/fact-finder/persist.ts
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import type { ExtractionResult } from "@/lib/extraction/types";
import { mergePayloadJson } from "@/lib/imports/payload-json-sql";
import { readFactFinderState } from "./state";
import type { FactFinderState } from "./types";

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
  constructor() {
    super("The fact finder is busy — try again in a moment.");
    this.name = "FactFinderBusyError";
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

/** Compare-and-set: writes only if the stored version still equals `baseVersion`. */
export async function writeFactFinder(
  scope: FactFinderScope,
  baseVersion: number,
  next: FactFinderState,
): Promise<FactFinderState | null> {
  const written: FactFinderState = { ...next, version: baseVersion + 1 };
  const rows = await db
    .update(clientImports)
    .set({ payloadJson: mergePayloadJson({ factFinder: written }), updatedAt: new Date() })
    .where(and(scoped(scope), sql`${storedVersion} = ${baseVersion}`))
    .returning({ id: clientImports.id });
  return rows.length === 1 ? written : null;
}

/**
 * Load, apply `mutate`, compare-and-set; on a stale version, start again from
 * the fresh state. `mutate` must be pure — it can run more than once.
 */
export async function updateFactFinder(
  scope: FactFinderScope,
  mutate: (state: FactFinderState) => FactFinderState,
  attempts = 8,
): Promise<FactFinderState> {
  for (let i = 0; i < attempts; i++) {
    const current = await loadFactFinder(scope);
    if (!current) throw new FactFinderNotFoundError();
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
