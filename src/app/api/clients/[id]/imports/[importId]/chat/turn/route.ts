import { and, eq, gt } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImports, clientImportExtractions, clientImportFiles } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError as SubscriptionForbiddenError } from "@/lib/authz";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { readChatState, writeChatState } from "@/lib/statement-chat/state";
import { runTurn } from "@/lib/statement-chat/turn";
import type { Annotated, ImportPayloadJson } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

export const dynamic = "force-dynamic";
// A turn can make up to 4 tool calls plus the closing reply — generous but
// bounded, same order of magnitude as Forge's own stream route.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; importId: string }> };

interface BodyArgs {
  message?: unknown;
}

const MAX_MESSAGE_LENGTH = 4_000;

// Review round 1, Important 6: `run-extraction.ts` only clears a file's
// "extracting" row inside its own try/catch — a serverless timeout or
// process kill leaves it set forever, and the C12 #2 guard below would
// otherwise 409 every future turn on this import permanently, telling the
// advisor to wait for something that will never finish. 10 minutes is
// comfortably longer than chat/extract's own 300s (5 min) route cap, so a
// genuinely still-running extraction is never mistaken for stale.
const EXTRACTION_STALE_AFTER_MS = 10 * 60 * 1000;

type AccountRow = Annotated<ExtractedAccount>;

/**
 * Review round 1, Important 1 (and Ruling 83's own follow-up correction):
 * merge the turn's mutated rows onto the FRESH read `by __rowId`, rather
 * than replacing `payload.accounts` wholesale with a snapshot computed from
 * the STALE row read at the top of this request. Without this, a commit
 * landing (via the separate accounts-PATCH route) while this turn's model
 * calls are in flight has its `linkCreated` stamp silently erased the moment
 * this route's write lands — the same "must never regress a linked row"
 * defect Task 10b already guards elsewhere, arriving through a fourth door.
 *
 * A row is "changed by this turn" when the turn's final object for its
 * `__rowId` is a DIFFERENT reference than what that row started as —
 * `editRow`/`mergeRows`/`dropRow` in `tools.ts` always create a new object
 * for a row they touch and preserve the exact same reference for every row
 * they don't, so reference inequality is an exact signal, not a heuristic.
 * A row present at the start but absent from the turn's final accounts was
 * retired this turn (dropped, or merged away) and is removed here too, even
 * from the fresh array. Every other fresh row is left exactly as read — a
 * concurrent write's stamps on it survive untouched.
 */
function mergeAccountsByRowId(
  freshAccounts: AccountRow[],
  startAccounts: AccountRow[],
  turnAccounts: AccountRow[],
): AccountRow[] {
  const startByRowId = new Map(
    startAccounts.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );
  const turnByRowId = new Map(
    turnAccounts.filter((r) => r.__rowId).map((r) => [r.__rowId as string, r]),
  );

  const changed = new Map<string, AccountRow>();
  for (const [id, row] of turnByRowId) {
    if (startByRowId.get(id) !== row) changed.set(id, row);
  }
  const retired = new Set(
    [...startByRowId.keys()].filter((id) => !turnByRowId.has(id)),
  );

  const merged: AccountRow[] = [];
  for (const row of freshAccounts) {
    const id = row.__rowId;
    if (id && retired.has(id)) continue;
    if (id && changed.has(id)) {
      merged.push(changed.get(id) as AccountRow);
      continue;
    }
    merged.push(row);
  }
  return merged;
}

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
 * One conversational turn over a statement-chat import's extracted table
 * (Task 11). Gate chain and error mapping are copied verbatim from
 * `chat/extract/route.ts` (C7 — the plan's originally-drafted chain omitted
 * the client-access and ai_import-entitlement gates entirely).
 *
 * C12's two race requirements, both owned here:
 *  1. The import row is read via `requireImportAccess` for gating, used ONLY
 *     to seed what `runTurn` shows the model, and then re-read FRESH,
 *     immediately before `writeChatState`, so a `fileResults` write from an
 *     extraction that finished mid-turn is never spread from a stale copy.
 *  2. A turn is refused (409) while any file in this import has an
 *     in-progress `client_import_extractions` row — the closest durable
 *     signal available without a schema change or touching
 *     `chat/extract/route.ts` (outside this task's file list; see the task
 *     report for the residual TOCTOU window this does not close).
 *
 * `payload.accounts` IS written back here, in the SAME write as the chat
 * slice (task-review correction — see the task report's "Concern 2"
 * addendum) — but ONLY when a mutating tool actually ran this turn
 * (`turnResult.payloadMutated`), and merged onto the FRESH read `by __rowId`
 * (review round 1, Important 1) rather than replacing the array wholesale.
 * A tool-mutated row that only lived in the HTTP response, never persisted,
 * would leave the transcript claiming an edit that a resumed draft's table
 * does not show — a narrated action the data never reflects, the exact
 * class of defect Ruling 27 already refused to ship once. But a WHOLESALE
 * replace built from the STALE snapshot read at the top of this request
 * would erase a `linkCreated` stamp from a commit that landed (via the
 * separate accounts-PATCH route) while this turn's model calls were still
 * running — `mergeAccountsByRowId` (above) is what keeps both true at once.
 */
export async function POST(request: Request, { params }: Params) {
  // --- Gate chain (canonical order per C7 — mirrors chat/extract/route.ts) ---
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
      return jsonResponse(401, { error: "Unauthorized" });
    }
    // `@/lib/authz`'s own ForbiddenError — a DIFFERENT class from
    // `@/lib/imports/authz`'s (same name, two declarations; see
    // chat/extract/route.ts's own comment on this trap).
    if (err instanceof SubscriptionForbiddenError) {
      return jsonResponse(403, { error: err.message });
    }
    throw err;
  }

  const { id: clientId, importId } = await params;

  const access = await verifyClientAccess(clientId);
  if (!access.ok) {
    return jsonResponse(404, { error: "Not found" });
  }
  if (access.access !== "own") {
    return jsonResponse(403, {
      error: "Cross-organization imports are not supported.",
    });
  }
  if (access.permission !== "edit") {
    return jsonResponse(403, { error: "View-only access" });
  }

  const rl = await checkImportRateLimit(firmId, "turn");
  if (!rl.allowed) {
    let status: number;
    let message: string;
    switch (rl.reason) {
      case "unconfigured":
        status = 503;
        message = "Rate limiting is not configured — chat is disabled.";
        break;
      case "redis_error":
        status = 503;
        message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
        break;
      case "exceeded":
        status = 429;
        message = "Too many messages. Please wait and try again.";
        break;
    }
    const headers: Record<string, string> = {};
    if (rl.reset) {
      headers["Retry-After"] = String(
        Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
      );
    }
    return jsonResponse(status, { error: message }, headers);
  }

  let importRow: Awaited<ReturnType<typeof requireImportAccess>>;
  try {
    importRow = await requireImportAccess({ importId, clientId, firmId, userId });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return jsonResponse(403, { error: "Forbidden" });
    }
    if (err instanceof NotFoundError) {
      return jsonResponse(404, { error: err.message });
    }
    throw err;
  }

  // Defense-in-depth: mirrors chat/extract/route.ts's own comment. The
  // middleware already blocks this POST for non-active subscriptions, and
  // every active seat includes the ai_import entitlement — this guard fails
  // closed if Clerk's entitlements metadata is missing or stale.
  if (!entitlements?.includes("ai_import")) {
    await recordAudit({
      action: "billing.access_denied",
      resourceType: "firm",
      resourceId: firmId,
      clientId,
      firmId,
      metadata: { reason: "ai_import_not_entitled", importId },
    });
    return jsonResponse(403, { error: "ai_import_not_entitled" });
  }

  const payloadJson = (importRow.payloadJson ?? {}) as ImportPayloadJson;

  // This route only makes sense for a statement-chat import (same guard,
  // same reasoning, as chat/finalize/route.ts). Direct optional-chain read —
  // NOT `readChatState`, which normalizes ANY payload (including `{}`) to
  // `surface: "chat"` and would make this a silent no-op.
  if (payloadJson.chat?.surface !== "chat") {
    return jsonResponse(400, { error: "This import is not a statement-chat import." });
  }

  const body = (await request.json().catch(() => ({}))) as BodyArgs;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return jsonResponse(400, { error: "A message is required." });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(400, { error: "Message is too long." });
  }

  // C12 #2: refuse a turn while any file in this import is actively being
  // extracted. `client_import_extractions.status` is set to "extracting"
  // before a file's model call and flipped to "success"/"failed" after
  // (`run-extraction.ts`) — the closest durable, no-migration-needed signal
  // that an extraction is in flight for THIS import. Age-bound (Important 6):
  // that clearing only happens inside a try/catch, so a killed process or
  // serverless timeout leaves the row stuck at "extracting" forever — without
  // the `startedAt` bound, that would 409 every future turn on this import
  // permanently.
  const [inFlight] = await db
    .select({ id: clientImportExtractions.id })
    .from(clientImportExtractions)
    .innerJoin(clientImportFiles, eq(clientImportExtractions.fileId, clientImportFiles.id))
    .where(
      and(
        eq(clientImportFiles.importId, importId),
        eq(clientImportExtractions.status, "extracting"),
        gt(clientImportExtractions.startedAt, new Date(Date.now() - EXTRACTION_STALE_AFTER_MS)),
      ),
    )
    .limit(1);
  if (inFlight) {
    return jsonResponse(409, {
      error: "Still reading your documents — please wait for that to finish before continuing the conversation.",
    });
  }

  const chat = readChatState(payloadJson);
  const payload = payloadJson.payload ?? {};
  const fileResults = payloadJson.fileResults ?? {};

  let turnResult: Awaited<ReturnType<typeof runTurn>>;
  try {
    turnResult = await runTurn({ chat, payload, fileResults, message, importId });
  } catch (err) {
    const safeMessage = err instanceof Error ? err.message : "unknown error";
    if (safeMessage === "ai_not_configured") {
      return jsonResponse(503, { error: "The assistant is not configured for this firm yet." });
    }
    console.error(
      `POST /api/clients/${clientId}/imports/${importId}/chat/turn failed:`,
      safeMessage.slice(0, 200),
    );
    return jsonResponse(500, { error: "Could not process that message. Please try again." });
  }

  // C12 #1: re-read the import row FRESH, immediately before writing —
  // never the `importRow` read above for gating, which can be stale by the
  // time the (potentially slow) model calls above have finished.
  const [freshRow] = await db
    .select()
    .from(clientImports)
    .where(eq(clientImports.id, importId))
    .limit(1);
  const freshPayloadJson = (freshRow?.payloadJson ?? {}) as ImportPayloadJson;
  const freshChat = readChatState(freshPayloadJson);
  const nextTranscript = [...freshChat.transcript, ...turnResult.turnEntries];
  const nextExcludedRows = [...freshChat.excludedRows, ...turnResult.newExcludedRows];

  // Task-review correction (Concern 2) + review round 1, Important 1: a
  // tool-mutated row is persisted in the SAME write as the chat slice — a
  // turn that edits a row but is never committed would otherwise leave a
  // transcript claiming an edit the payload never reflects. But the `payload`
  // key is set ONLY when a mutating tool actually ran (`payloadMutated`), and
  // even then it's `mergeAccountsByRowId`'s output — the turn's changes
  // rebased onto the FRESH read — never `turnResult.payload` wholesale, which
  // was computed from the STALE snapshot read at the top of this request and
  // would silently erase a `linkCreated` stamp from a commit that landed
  // while this turn's model calls were in flight. `writeChatState` only ever
  // touches `chat`, so `payload` is set alongside it explicitly. Shape stays
  // `{ accounts }` only (this surface never persists any other section).
  const freshAccounts = (freshPayloadJson.payload?.accounts ?? []) as AccountRow[];
  const responseAccounts = turnResult.payloadMutated
    ? mergeAccountsByRowId(
        freshAccounts,
        (payload.accounts ?? []) as AccountRow[],
        (turnResult.payload.accounts ?? []) as AccountRow[],
      )
    : freshAccounts;

  const nextPayloadJson: ImportPayloadJson = writeChatState(freshPayloadJson, {
    transcript: nextTranscript,
    excludedRows: nextExcludedRows,
  });
  if (turnResult.payloadMutated) {
    nextPayloadJson.payload = { accounts: responseAccounts };
  }

  await db
    .update(clientImports)
    .set({
      payloadJson: nextPayloadJson,
      updatedAt: new Date(),
    })
    .where(eq(clientImports.id, importId));

  await recordAudit({
    action: "import.chat.turn",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: {
      toolCallCount: turnResult.turnEntries.filter((t) => t.role === "tool").length,
    },
  });

  // Ruling 49 / C13: ONE result shape, with optional members. `payload` and
  // `summary` are always present; `proposal` only when reread_document ran.
  return jsonResponse(200, {
    payload: { accounts: responseAccounts },
    summary: turnResult.summary,
    excludedRows: nextExcludedRows,
    ...(turnResult.proposal ? { proposal: turnResult.proposal } : {}),
  });
}
