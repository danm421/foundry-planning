import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
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
import { runImportExtraction, type ExtractionFileProgress } from "@/lib/imports/run-extraction";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { narrate } from "@/lib/statement-chat/narrate";
import { writeChatState } from "@/lib/statement-chat/state";
import type { ImportPayloadJson } from "@/lib/imports/types";

// SSE route: extraction can run for minutes across several files, so this
// mirrors the wizard extract route's (and Forge stream's) directives.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

interface BodyArgs {
  model?: "mini" | "full";
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
 * Statement-chat's extraction route. Gate chain and SSE framing are copied
 * from the two real precedents on this branch — the gate order from the
 * wizard's `.../imports/[importId]/extract/route.ts:36-104` (C1/C2), and the
 * stream shape from `.../api/forge/stream/route.ts:152-164` (C6) — rather
 * than the plan's originally-drafted chain, which omitted the client-access
 * and ai_import-entitlement gates entirely.
 *
 * `runImportExtraction`'s own aggregate write only ever carries `fileResults`
 * (plus `chat` when present, per C11) — never the merged/annotated rows — so
 * this route re-reads the import row after extraction returns and merges +
 * detects rollups + narrates from the fresh `fileResults` before persisting
 * `decisions`/`excludedRows` back onto the chat slice.
 */
export async function POST(request: Request, { params }: Params) {
  // --- Gate chain (canonical order per C1 — ALL resolve before the stream opens) ---
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
    // A subscription failure is `@/lib/authz`'s own ForbiddenError — a
    // DIFFERENT class from `@/lib/imports/authz`'s (same name, two
    // declarations; see run-extraction's sibling route for the same trap).
    // Mapped explicitly here so "no active subscription" reads as 403, not
    // a 500 from the generic fallback.
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

  const rl = await checkImportRateLimit(firmId, "extract");
  if (!rl.allowed) {
    let status: number;
    let message: string;
    switch (rl.reason) {
      case "unconfigured":
        status = 503;
        message = "Rate limiting is not configured — extraction is disabled.";
        break;
      case "redis_error":
        status = 503;
        message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
        break;
      case "exceeded":
        status = 429;
        message = "Too many extraction requests. Please wait and try again.";
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

  let extractHoldingsDefault: boolean;
  try {
    const imp = await requireImportAccess({ importId, clientId, firmId, userId });
    extractHoldingsDefault = imp.extractHoldings === true;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return jsonResponse(403, { error: "Forbidden" });
    }
    if (err instanceof NotFoundError) {
      return jsonResponse(404, { error: err.message });
    }
    throw err;
  }

  // Defense-in-depth: mirrors the wizard extract route's own comment. The
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

  const body = (await request.json().catch(() => ({}))) as BodyArgs;
  const model = body.model === "full" ? "full" : "mini";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      // Cancel-on-disconnect, mirroring forge/stream (C6): stop writing once
      // the client aborts, AND stop extraction from starting any new
      // CONCURRENCY-wide chunk of work (request.signal is threaded into
      // runImportExtraction below). Nothing further gets written to a
      // closed controller either way.
      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort);

      try {
        await runImportExtraction({
          importId,
          clientId,
          firmId,
          model,
          extractHoldings: extractHoldingsDefault,
          // Re-adding files to an already-extracted chat import must not
          // re-read (and re-bill) the ones already settled (brief Step 3 /
          // C4).
          skipExtracted: true,
          onFile: (progress: ExtractionFileProgress) => {
            send({ type: "file", ...progress });
          },
          // C6, third clause: an abandoned tab must stop holding
          // CONCURRENCY (5) Azure slots against the shared per-deployment
          // TPM budget. Checked only at a chunk boundary and only to break
          // cleanly — see the `signal` doc on RunExtractionArgs for why an
          // abort here must never throw or cancel in-flight work.
          signal: request.signal,
        });

        // C11 (second half): `runImportExtraction` read the import row at
        // its START and wrote it at its END, potentially minutes apart. Any
        // payload this route hands to `writeChatState` MUST come from a
        // FRESH read taken after that write, or it spreads a stale
        // `fileResults` back over the one extraction just produced.
        const [freshRow] = await db
          .select()
          .from(clientImports)
          .where(eq(clientImports.id, importId))
          .limit(1);
        const payloadJson = (freshRow?.payloadJson ?? {}) as ImportPayloadJson;
        const fileResults = payloadJson.fileResults ?? {};

        // Merge every file's extraction into one set of rows (dated
        // supersession, __rowId, decision log — Tasks 1-6), then separate
        // printed totals from real accounts (Task 4), then narrate ONLY the
        // kept rows (C10) — never the full merged set, or the summary's
        // account count double-counts every rollup the very next caveat
        // says was excluded.
        const { payload, mergedFileCount, decisions: mergeDecisions } = mergeAcrossFiles(fileResults);
        const { kept, excluded } = detectRollups(payload.accounts);
        // `detectRollups` runs AFTER `mergeAcrossFiles` and produces its own
        // "rollup-excluded" MergeDecision per dropped row — narrate()'s
        // `case "rollup-excluded"` branch (and C10's own worked example,
        // which presupposes that caveat already renders) only fires when
        // that decision is folded in here; `mergeAcrossFiles` never sees a
        // rollup row and so never emits it on its own.
        const decisions = [...mergeDecisions, ...excluded.map((x) => x.decision)];
        const narration = narrate({ fileCount: mergedFileCount, decisions, rows: kept });

        await db
          .update(clientImports)
          .set({
            payloadJson: writeChatState(payloadJson, { decisions, excludedRows: excluded }),
            updatedAt: new Date(),
          })
          .where(eq(clientImports.id, importId));

        if (!closed) {
          send({
            type: "done",
            summary: narration.summary,
            caveats: narration.caveats,
            rows: kept,
            excluded,
          });
        }
      } catch (err) {
        const safeMessage =
          err instanceof Error ? err.message.slice(0, 200) : "Extraction failed.";
        console.error(
          `POST /api/clients/${clientId}/imports/${importId}/chat/extract failed:`,
          safeMessage,
        );
        send({ type: "error", message: safeMessage });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
