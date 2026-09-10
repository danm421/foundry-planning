import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireActiveSubscription,
  ForbiddenError as SubscriptionForbiddenError,
} from "@/lib/authz";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { readChatState } from "@/lib/statement-chat/state";
import { markTabsCommitted } from "@/lib/imports/commit/orchestrator";
import { normalizeImportPayload, type ImportPayloadJson } from "@/lib/imports/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

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
 * Closes a statement-chat import.
 *
 * Statement chat is accounts-only — there is no plan-basics/incomes/etc.
 * wizard tab for it to walk through — and `persistPartialCommit`
 * (`commit/orchestrator.ts`) deliberately never flips `status` on a
 * row-filtered commit (Ruling 61): the other rows might still be pending,
 * and this dispatcher has no visibility into `committedRowIds` to know
 * otherwise. So an import committed entirely row-by-row stays `review`
 * forever unless something else closes it. This is that something (Ruling
 * 70) — a dedicated route that VERIFIES the claim server-side rather than
 * trusting the client, so a false "everything is committed" can never
 * become a false statement in the client's own record of what was
 * imported.
 *
 * Gate chain mirrors `chat/extract/route.ts` exactly, with op="commit"
 * (this is a commit-adjacent mutation, not an extraction).
 */
export async function POST(request: Request, { params }: Params) {
  // --- Gate chain (canonical order — see chat/extract/route.ts) ---
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
    // `@/lib/imports/authz`'s (same name, two declarations).
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

  const rl = await checkImportRateLimit(firmId, "commit");
  if (!rl.allowed) {
    let status: number;
    let message: string;
    switch (rl.reason) {
      case "unconfigured":
        status = 503;
        message = "Rate limiting is not configured — closing this import is disabled.";
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
    return jsonResponse(status, { error: message }, headers);
  }

  let payloadJson: ImportPayloadJson;
  try {
    const imp = await requireImportAccess({ importId, clientId, firmId, userId });
    payloadJson = (imp.payloadJson ?? {}) as ImportPayloadJson;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return jsonResponse(403, { error: "Forbidden" });
    }
    if (err instanceof NotFoundError) {
      return jsonResponse(404, { error: err.message });
    }
    throw err;
  }

  // Defense-in-depth, mirroring chat/extract/route.ts's own comment.
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

  // --- Verify, from the server's OWN data, rather than trust the caller ---
  // "Kept" is recomputed fresh from `fileResults` — the same ground truth
  // chat/extract itself derives it from — not read off `payload.accounts`,
  // which only reflects what the surface has already PATCHed there and
  // could in principle be short a row. Excluded rollup rows are dropped by
  // `detectRollups` before this check ever sees them, so they can never
  // block closing.
  const fileResults = payloadJson.fileResults ?? {};
  const { payload: freshMerged } = mergeAcrossFiles(fileResults);
  const { kept } = detectRollups(freshMerged.accounts);
  const chat = readChatState(payloadJson);
  const committed = new Set(chat.committedRowIds);
  const missing = kept.filter((row) => !row.__rowId || !committed.has(row.__rowId));

  if (missing.length > 0) {
    return jsonResponse(409, {
      error:
        missing.length === 1
          ? "1 account row still needs to be committed before this import can be closed."
          : `${missing.length} account rows still need to be committed before this import can be closed.`,
    });
  }

  // Persist the CURRENT persisted payload — never a fresh recompute. The
  // per-row commits already stamped `linkCreated` onto it (each commit's
  // `persistPartialCommit` call re-saves the mutated payload), and a fresh
  // `mergeAcrossFiles` result would reset every row back to
  // `{ kind: "new" }`, reopening the duplicate-insert hole Ruling 61 names.
  const persistedPayload = normalizeImportPayload(payloadJson.payload);

  // `ALWAYS_REQUIRED_TABS` (`required-tabs.ts`) makes "plan-basics"
  // mandatory on every import regardless of mode or content — statement
  // chat has no plan-basics step at all, so nothing else ever stamps it,
  // and `markTabsCommitted`'s completeness check would otherwise never be
  // satisfiable for a chat import. `commitPlanBasics` no-ops on an absent
  // `payload.planBasics` (which chat never sets), and `markTabsCommitted`
  // only stamps a timestamp — it never invokes `commitPlanBasics` — so
  // stamping "plan-basics" here alongside "accounts" is bookkeeping, not a
  // data write.
  const { allTabsCommitted } = await db.transaction((tx) =>
    markTabsCommitted(tx, importId, ["accounts", "plan-basics"], persistedPayload),
  );

  await recordAudit({
    action: "import.chat.finalized",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { committedRowCount: chat.committedRowIds.length },
  });

  return jsonResponse(200, { ok: true, status: allTabsCommitted ? "committed" : "review" });
}
