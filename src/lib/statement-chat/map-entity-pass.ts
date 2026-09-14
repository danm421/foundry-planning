// src/lib/statement-chat/map-entity-pass.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { findEntity } from "@/domain/forge/detail-fields";
import { extractMapEntities } from "@/lib/entity-extraction";
// Imported from the module rather than the barrel on purpose. `matchByIdentity`
// is pure and deterministic, and this file's tests assert the REAL exact/new
// verdicts while stubbing the barrel's AI-calling `extractMapEntities`. Taking
// both from the barrel would let one mock silently stub out the matching this
// function exists to do, and every row would come back undefined-matched.
import { matchByIdentity } from "@/lib/entity-extraction/matcher";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { NotFoundError } from "@/lib/imports/authz";
import { loadExistingRows } from "./existing-rows";

type RowsByEntity = Record<string, CandidateRow[]>;

/**
 * Annotate each candidate row with `exact` / `fuzzy` / `new` against the
 * client's existing data, so accepting a row means update or create with no new
 * concept in the review table.
 *
 * A failed load for one entity costs only that entity: its rows stay, marked
 * `new`. Losing a whole document's read because one table was unreachable would
 * be a worse outcome than offering a duplicate the advisor can see.
 *
 * But "marked new" is also precisely what a LEAK would have looked like if
 * `loadExistingRows` had failed open, so it must not be silent. A caught failure
 * means the client's existing rows were never read, and every row below it is
 * reported `new` for that reason and not because the client has none — an
 * advisor acting on it duplicates their own data. `onWarning` carries that
 * sentence out to `runMapEntityPass`'s `warnings`, where the caller can show it.
 * Optional so the signature the review table calls stays as the brief wrote it.
 */
export async function annotateMatches(args: {
  clientId: string;
  rows: RowsByEntity;
  onWarning?: (message: string) => void;
}): Promise<RowsByEntity> {
  const { clientId, rows, onWarning } = args;
  const out: RowsByEntity = {};

  for (const [entityId, entityRows] of Object.entries(rows)) {
    const entity = findEntity(entityId);
    if (!entity) continue;
    if (entityRows.length === 0) {
      out[entityId] = entityRows;
      continue;
    }

    let existing: Awaited<ReturnType<typeof loadExistingRows>> = [];
    try {
      existing = await loadExistingRows({ entity, clientId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      console.warn(`[map-entity-pass] could not load existing ${entityId}: ${reason}`);
      onWarning?.(
        `Could not read this client's existing ${entity.label} rows (${reason}), so every ` +
          "row below is offered as new. Check for duplicates before accepting them.",
      );
    }

    out[entityId] = entityRows.map((row) => ({
      ...row,
      match: matchByIdentity(entity, row, existing),
    }));
  }

  return out;
}

/**
 * Read one uploaded file for every map entity it contains, match the results
 * against the client, and persist them additively into the import's
 * `payloadJson` under `chat.entityRows`. No migration.
 *
 * Both the read and the write are constrained by `clientId` AND `orgId` — the
 * column that holds the firm id (`imports/authz.ts` writes `firmId` there). The
 * route's `requireImportAccess` still gates first; this is not a substitute for
 * it. It is the narrower rule that a function already HOLDING a firm id must
 * not issue a write that ignores it, and an import id alone is not a tenant
 * boundary. A write that matches no row is a refusal, never a silent no-op.
 *
 * KNOWN RACE (accepted for now, and the reason the merge is called out rather
 * than hidden): the `payloadJson` merge is read-modify-write in JS. It is
 * additive only against the snapshot it read. This pass runs per `fileId`, so
 * two files of the same import extracting concurrently can interleave and the
 * later write drops the earlier file's rows. Closing it properly needs a
 * transaction or a jsonb-level `||` merge (as `imports/commit/orchestrator.ts`
 * uses) rather than an in-memory spread. `rebase.ts`'s `mergeAccountsByRowId`
 * is the same hazard already met once on this feature and the shape a fix would
 * take: merge the changed rows onto a FRESH read by row id, never write back a
 * whole array computed from a stale one.
 *
 * ⚠️ The sequential loop in `use-map-rows.ts` does NOT close that race, and
 * must not be described as doing so (final review, explicit verdict). It is a
 * BROWSER guard on one surface; nothing server-side enforces one caller at a
 * time, and `PATCH /chat/map-pass` — which the same loop fires once per
 * committed row — rewrites this column too, alongside `chat/turn` and
 * `chat/finalize`. The follow-up has to cover the PATCH leg as well as this
 * one. Merging by `rowId` below is the cheap in-branch mitigation, not the fix:
 * it bounds the growth and makes the stamp unambiguous, but two concurrent
 * writers still lose one side.
 */
export async function runMapEntityPass(args: {
  importId: string;
  clientId: string;
  firmId: string;
  fileId: string;
  pages: string[];
}): Promise<{ rows: RowsByEntity; warnings: string[] }> {
  const { importId, clientId, firmId, fileId, pages } = args;
  const extracted = await extractMapEntities({ fileId, pages });

  // The same four legs `imports/authz.ts:64-69` scopes on. `discardedAt` is one
  // of them: a discarded import is indistinguishable from a never-existed id
  // everywhere else in this feature, and a pass that could still write one would
  // resurrect rows into something the advisor deleted.
  const inScope = and(
    eq(clientImports.id, importId),
    eq(clientImports.clientId, clientId),
    eq(clientImports.orgId, firmId),
    isNull(clientImports.discardedAt),
  );

  const warnings = [...extracted.warnings];
  const rows = await annotateMatches({
    clientId,
    rows: extracted.rows,
    onWarning: (message) => warnings.push(message),
  });

  const current = await db.query.clientImports.findFirst({ where: inScope });
  if (!current) throw new NotFoundError("Import not found");

  const payload = (current.payloadJson ?? {}) as Record<string, unknown>;
  const chat = (payload.chat ?? {}) as Record<string, unknown>;
  const stored = (chat.entityRows ?? {}) as RowsByEntity;

  // A NEW object, not `stored` with entries assigned into it. The merge must not
  // touch what was read: a refused write has to leave the snapshot exactly as it
  // found it, or "nothing was written" stops being provable in a caller or a test.
  //
  // MERGED BY `rowId`, not appended (final review I5, Ruling 37). A `rowId` is
  // `${fileId}:${entity}:${index}` and is stable across a re-read of the same
  // file, so a blind append grew this column by a full copy of the same rows on
  // every re-run — and PATCH's `.find(rowId)` then stamped whichever duplicate
  // sorted first rather than the row the advisor committed. Rows from a
  // DIFFERENT file carry a different id and are untouched, which is what keeps
  // a second file's pass additive.
  //
  // The incoming copy WINS: a re-read is the newer statement of what the
  // document says, and letting the stored copy survive would show the advisor a
  // value the file no longer carries. It also drops any `match.existingId` the
  // PATCH stamped, which is correct for the same reason `useMapRows` clears
  // `committedRowIds` on a re-run — the id is positional, so a different policy
  // can land at that index, and inheriting the stamp would render "Committed"
  // with nothing written behind it.
  const entityRows: RowsByEntity = { ...stored };
  for (const [entityId, entityRowList] of Object.entries(rows)) {
    const merged = new Map((stored[entityId] ?? []).map((r) => [r.rowId, r] as const));
    for (const incoming of entityRowList) merged.set(incoming.rowId, incoming);
    entityRows[entityId] = [...merged.values()];
  }

  const written = await db
    .update(clientImports)
    .set({ payloadJson: { ...payload, chat: { ...chat, entityRows } }, updatedAt: new Date() })
    .where(inScope)
    .returning({ id: clientImports.id });
  if (written.length === 0) throw new NotFoundError("Import not found");

  return { rows, warnings };
}
