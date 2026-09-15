import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireActiveSubscription,
  ForbiddenError as SubscriptionForbiddenError,
} from "@/lib/authz";
import { requireImportAccess, ForbiddenError, NotFoundError } from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { downloadImportFile } from "@/lib/imports/blob";
import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { runMapEntityPass } from "@/lib/statement-chat/map-entity-pass";
import { linkCreated } from "@/lib/imports/types";
import type { CandidateRow, RowsByEntity } from "@/lib/entity-extraction/types";

// The pass makes several Azure calls per document, so this matches the sibling
// chat/extract route's directives. Unlike that route this one is plain JSON,
// not SSE — there is no per-file progress to stream for a single file.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

type ImportRow = Awaited<ReturnType<typeof requireImportAccess>>;

type Gate =
  | { ok: false; response: Response }
  | { ok: true; firmId: string; clientId: string; importId: string; imp: ImportRow };

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

/**
 * The canonical gate chain for this feature, copied from
 * `chat/extract/route.ts:66-172` in the same order — `requireOrgId` →
 * `requireActiveSubscription` → `auth` → `verifyClientAccess` →
 * `checkImportRateLimit` → `requireImportAccess` → the `ai_import`
 * entitlement guard. That route's own comment records that the plan's
 * originally-drafted chain omitted the client-access and entitlement gates;
 * this is not a subset of it.
 *
 * Shared by both handlers here rather than transcribed twice, because two
 * copies of a security chain is how one of them drifts. `op` is the only
 * thing that varies: POST spends an Azure read ("map"), PATCH is a cheap
 * write ("match").
 *
 * POST draws on "map", NOT the sibling batch route's "extract". The two
 * routes have opposite request shapes — `chat/extract` streams every file
 * behind one request, this one is posted once per file — so sharing a bucket
 * mis-sizes this pass by the file count. It did: a 33-file import read five
 * files and was refused twenty-eight times inside eight seconds, taking both
 * life insurance policies with it.
 */
async function runGateChain(paramsPromise: Params["params"], op: "map" | "match"): Promise<Gate> {
  let firmId: string;
  let userId: string;
  let entitlements: string[] | undefined;
  try {
    firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId: uid, sessionClaims } = await auth();
    if (!uid) throw new UnauthorizedError();
    userId = uid;
    entitlements = (
      sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null
    )?.org_public_metadata?.entitlements;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, response: jsonResponse(401, { error: "Unauthorized" }) };
    }
    // A subscription failure is `@/lib/authz`'s own ForbiddenError — a
    // DIFFERENT class from `@/lib/imports/authz`'s (same name, two
    // declarations). Catching only the latter turns a 403 into a 500.
    if (err instanceof SubscriptionForbiddenError) {
      return { ok: false, response: jsonResponse(403, { error: err.message }) };
    }
    throw err;
  }

  const { id: clientId, importId } = await paramsPromise;

  const access = await verifyClientAccess(clientId);
  if (!access.ok) {
    return { ok: false, response: jsonResponse(404, { error: "Not found" }) };
  }
  if (access.access !== "own") {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: "Cross-organization imports are not supported.",
      }),
    };
  }
  if (access.permission !== "edit") {
    return { ok: false, response: jsonResponse(403, { error: "View-only access" }) };
  }

  const rl = await checkImportRateLimit(firmId, op);
  if (!rl.allowed) {
    let status: number;
    let message: string;
    switch (rl.reason) {
      case "unconfigured":
        status = 503;
        message = "Rate limiting is not configured — this action is disabled.";
        break;
      case "redis_error":
        status = 503;
        message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
        break;
      case "exceeded":
        status = 429;
        message = "Too many requests. Please wait and try again.";
        break;
    }
    const headers: Record<string, string> = {};
    if (rl.reset) {
      headers["Retry-After"] = String(
        Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
      );
    }
    return { ok: false, response: jsonResponse(status, { error: message }, headers) };
  }

  let imp: ImportRow;
  try {
    imp = await requireImportAccess({ importId, clientId, firmId, userId });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, response: jsonResponse(403, { error: "Forbidden" }) };
    }
    if (err instanceof NotFoundError) {
      return { ok: false, response: jsonResponse(404, { error: err.message }) };
    }
    throw err;
  }

  // Defense-in-depth, mirroring chat/extract/route.ts's own comment: the
  // middleware already blocks this for non-active subscriptions and every
  // active seat includes `ai_import`, so this guard exists to fail closed if
  // Clerk's entitlements metadata is missing or stale.
  if (!entitlements?.includes("ai_import")) {
    await recordAudit({
      action: "billing.access_denied",
      resourceType: "firm",
      resourceId: firmId,
      clientId,
      firmId,
      metadata: { reason: "ai_import_not_entitled", importId },
    });
    return { ok: false, response: jsonResponse(403, { error: "ai_import_not_entitled" }) };
  }

  return { ok: true, firmId, clientId, importId, imp };
}

/**
 * Read one uploaded file against the Details field map and persist the
 * extracted, match-annotated rows onto the import for advisor review.
 *
 * This is the server half of the feature's wiring: `runMapEntityPass` had no
 * caller at all until this route existed. The audit record lives HERE and not
 * in the lib, matching Phase 1 (`run-extraction.ts:185-192`,
 * `chat/extract/route.ts:165`).
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await runGateChain(params, "map");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId } = gate;

  const body = (await request.json().catch(() => ({}))) as { fileId?: unknown };
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  if (!fileId) {
    return jsonResponse(400, { error: "fileId is required" });
  }

  // Scoped to the import, never trusted from the body alone: a bare
  // `eq(id, fileId)` would read one firm's file through another firm's
  // import. `deletedAt` is the same rule the rest of the feature applies —
  // a soft-deleted file is indistinguishable from a never-existed id.
  const [file] = await db
    .select({
      blobUrl: clientImportFiles.blobUrl,
      originalFilename: clientImportFiles.originalFilename,
    })
    .from(clientImportFiles)
    .where(
      and(
        eq(clientImportFiles.id, fileId),
        eq(clientImportFiles.importId, importId),
        isNull(clientImportFiles.deletedAt),
      ),
    )
    .limit(1);
  if (!file) {
    return jsonResponse(404, { error: "File not found" });
  }

  const buffer = await downloadImportFile(file.blobUrl);
  if (!buffer) {
    // Deliberately unnamed. The browser knows which file it posted and
    // attributes every notice itself; naming the file HERE too printed
    // "x.pdf: x.pdf produced no readable text", and — worse — made two files
    // with one problem two different strings, which the warnings card can no
    // longer fold into a single line. See `summarizeMapWarnings`.
    return jsonResponse(502, { error: "Could not read this document from storage." });
  }

  let pages = await extractPdfPages(buffer);
  // Disclosures owed to the advisor about HOW the text was read, kept separate
  // from the pass's own warnings and prepended to them in the response.
  const readWarnings: string[] = [];

  // A genuine carrier policy is a SCAN. `unpdf` answers a scanned PDF with one
  // entry per page and every one of them EMPTY — a real 53-page life policy
  // came back as 53 blank strings. `pages.length === 0` does not catch that, so
  // the route used to read nothing, answer 200, and show the advisor an empty
  // table with no explanation after a minute of waiting. Phase 1's `extract.ts`
  // has recovered these documents by vision OCR all along; this is the same
  // fallback, on the same terms.
  // `pages.length > 0` matters: `extractPdfPages` answers [] when it could not
  // parse the PDF at all (empty buffer, parse error, timeout), and OCR is not
  // owed a billable call on a document that is not readable in the first place.
  // A SCAN is the different case — it parses fine and yields N blank pages.
  if (pages.length > 0 && pages.every((page) => page.trim().length === 0)) {
    const maxPages = Number(process.env.EXTRACTION_OCR_MAX_PAGES ?? "30") || 30;
    const ocr = await visionOcrPdf(buffer, { maxPages, model: "mini" });
    pages = ocr.segments;
    // `extract.ts` has disclosed both of these on the Phase 1 path since OCR
    // existed, and OCR is the only reason this route can read a carrier policy
    // at all. Dropping them means a 53-page scan capped at 30 reads to the
    // advisor as a COMPLETE extraction — the same "silent successful read"
    // shape the 422 below exists to prevent, one step further in.
    readWarnings.push(
      "This document had no text layer (scanned/image PDF); its text was recovered via image OCR — please verify the extracted figures.",
    );
    if (ocr.truncated) {
      readWarnings.push(
        `Only the first ${ocr.pagesProcessed} of ${ocr.pageCount} pages were read; data on later pages was skipped.`,
      );
    }
  }

  if (pages.length === 0) {
    // Either an empty document, or one whose text neither the text layer nor
    // OCR could recover. Say so rather than spending a multi-second billable
    // Azure call reading nothing and handing back a table with no reason.
    // Unnamed, for the reason the 502 above gives.
    return jsonResponse(422, { error: "This document produced no readable text." });
  }

  let result: Awaited<ReturnType<typeof runMapEntityPass>>;
  try {
    result = await runMapEntityPass({ importId, clientId, firmId, fileId, pages });
  } catch (err) {
    // The pass scopes its own read AND write on clientId + orgId +
    // not-discarded and throws this when either refuses. Letting it escape
    // would report a tenant refusal as a server fault.
    if (err instanceof NotFoundError) {
      return jsonResponse(404, { error: err.message });
    }
    throw err;
  }

  const entityIds = Object.keys(result.rows);
  const rowCount = entityIds.reduce((total, id) => total + result.rows[id].length, 0);
  await recordAudit({
    action: "import.map_pass.completed",
    resourceType: "client_import_file",
    resourceId: fileId,
    clientId,
    firmId,
    metadata: { importId, entityCount: entityIds.length, rowCount },
  });

  return jsonResponse(200, {
    rows: result.rows,
    warnings: [...readWarnings, ...result.warnings],
  });
}

/**
 * Stamp one extracted row as committed, so re-clicking Accept updates the
 * record it already created instead of inserting a second one.
 *
 * The browser commits a row by posting to the ENTITY's own create route
 * (`commitMapRow`) — a life insurance policy is two rows and only that route
 * knows it — and nothing in that flow marks the extracted row. `linkCreated`
 * is Phase 1's close for exactly this hole ("which is exactly what the
 * onboarding drawer's 'Apply again' button used to do"). The stamp has to be
 * written server-side because the row lives in `client_imports.payloadJson`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const gate = await runGateChain(params, "match");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId, imp } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    entityId?: unknown;
    rowId?: unknown;
    createdId?: unknown;
  };
  const entityId = typeof body.entityId === "string" ? body.entityId : "";
  const rowId = typeof body.rowId === "string" ? body.rowId : "";
  const createdId = typeof body.createdId === "string" ? body.createdId : "";
  if (!entityId || !rowId || !createdId) {
    return jsonResponse(400, { error: "entityId, rowId and createdId are required" });
  }

  const payload = (imp.payloadJson ?? {}) as Record<string, unknown>;
  const chat = (payload.chat ?? {}) as Record<string, unknown>;
  const entityRows = (chat.entityRows ?? {}) as RowsByEntity;
  const row = (entityRows[entityId] ?? []).find((candidate) => candidate.rowId === rowId);
  if (!row) {
    return jsonResponse(404, { error: "Row not found" });
  }

  // Mutates in place, which is what the rest of `payloadJson` is written
  // around — the whole (now-mutated) payload goes back below, so every
  // sibling row and every other slice survives untouched.
  linkCreated<CandidateRow>(row, createdId);

  // Same four legs `runMapEntityPass` writes under. `requireImportAccess`
  // already gated this; the narrower rule is that a handler HOLDING a firm id
  // must not issue a write that ignores it, and a write matching no row is a
  // refusal rather than a silent no-op.
  const written = await db
    .update(clientImports)
    .set({
      payloadJson: { ...payload, chat: { ...chat, entityRows } },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientImports.id, importId),
        eq(clientImports.clientId, clientId),
        eq(clientImports.orgId, firmId),
        isNull(clientImports.discardedAt),
      ),
    )
    .returning({ id: clientImports.id });
  if (written.length === 0) {
    return jsonResponse(404, { error: "Import not found" });
  }

  // After the write, never before — an audit row for a write that did not
  // land is worse than none. Every sibling write of this same column records
  // one (`chat/finalize/route.ts` → "import.chat.finalized",
  // `chat/turn/route.ts` → "import.chat.turn"), and this event in particular
  // is the one a dispute needs to reconstruct: it is the record that THIS row
  // created THAT entity, which is the whole incident `linkCreated` exists to
  // close ("Apply again" posting a second policy).
  await recordAudit({
    action: "import.map_pass.row_linked",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { entityId, rowId, createdId },
  });

  return jsonResponse(200, { ok: true });
}
