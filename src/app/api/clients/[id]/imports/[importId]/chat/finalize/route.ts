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
import { advisorRetiredRows, readChatState } from "@/lib/statement-chat/state";
import { rebaseOntoFreshMerge } from "@/lib/statement-chat/rebase";
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

  // This route only makes sense for a statement-chat import — a wizard
  // import (tax return, wills, policies, an "updating" accounts-only add,
  // …) has no chat step, and stamping its "accounts"/"plan-basics" tabs
  // here would be a lie about work this route never did (round 1 review,
  // Important 2: a wizard import with no account rows in `fileResults`
  // would otherwise sail through the `missing` check below with nothing to
  // verify, and get closed anyway).
  //
  // Direct optional-chain read — documented at `lib/imports/list.ts:26-35`
  // — NOT `readChatState`: that normalizer reports `surface: "chat"` for
  // ANY payload, including `{}`, which would make this guard a silent
  // no-op. That is the exact trap that nearly broke Task 8.
  if (payloadJson.chat?.surface !== "chat") {
    return jsonResponse(400, { error: "This import is not a statement-chat import." });
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

  // ...then RECONCILE that recompute with the identities the advisor's
  // session actually holds, before comparing anything against them (fix
  // wave 3, C-A). `__rowId` is DERIVED — the dedupe key plus the entry's
  // minimum source coordinate — so uploading one more statement whose file
  // id sorts lower MOVES it. Every id below (`committedRowIds`,
  // `excludedRows[].row.__rowId`) was minted by an EARLIER merge, and
  // comparing them against freshly-minted ids compares two different
  // namespaces: the row the advisor already committed counts as missing and
  // this route 409s FOREVER. There is no way out of that on the surface —
  // the row reads Committed so its button is disabled, `assertNotCommitted`
  // makes `drop_row` throw, and there is no force-close.
  //
  // This is the SAME call `chat/extract` makes, deliberately — one
  // reconciliation, not one per consumer, or they drift apart again. The
  // base is still `kept`, so the ground-truth property the comment above
  // defends is untouched: a row that never reached `payload.accounts` is
  // still in here, still under its own fresh id, and is still demanded.
  const persistedPayload = normalizeImportPayload(payloadJson.payload);
  const { rows: current } = rebaseOntoFreshMerge(kept, persistedPayload.accounts, {
    retiredRows: advisorRetiredRows(chat),
  });
  const committed = new Set(chat.committedRowIds);
  // A row the advisor retired IN THE CHAT — `drop_row`, or the half a
  // `merge_rows` folded away — is gone from the working table but comes
  // straight back out of the recompute above, because `fileResults` is raw
  // extraction that no tool ever edits. Without this it is never committed,
  // never in `committedRowIds`, and so lands in `missing` forever: a
  // permanent 409 that the branch's own headline tool creates. For a
  // `merge_rows` exclusion it is unrecoverable — that entry carries
  // `irreversible: true` and "Include anyway" is disabled for it
  // (`excluded-rows.tsx`), so the advisor has no way to put the row back and
  // commit it either.
  //
  // Treated exactly like a rollup exclusion: excluded means "not demanded at
  // close", not a second mechanism. The two lists differ only in where they
  // are computed — a rollup is re-derived by `detectRollups` on every read,
  // a chat exclusion is persisted (`chat.excludedRows`) because nothing can
  // re-derive an advisor's decision.
  const chatExcluded = new Set(
    chat.excludedRows
      .map((x) => x.row?.__rowId)
      .filter((rowId): rowId is string => typeof rowId === "string"),
  );
  const missing = current.filter((row) => {
    if (row.__rowId && chatExcluded.has(row.__rowId)) return false;
    return !row.__rowId || !committed.has(row.__rowId);
  });

  if (missing.length > 0) {
    return jsonResponse(409, {
      error:
        missing.length === 1
          ? "1 account row still needs to be committed before this import can be closed."
          : `${missing.length} account rows still need to be committed before this import can be closed.`,
    });
  }

  // What gets PERSISTED is `persistedPayload` — the payload as it stands on
  // disk, read above — never a fresh recompute and never the reconciled
  // `current`. The per-row commits already stamped `linkCreated` onto it
  // (each commit's `persistPartialCommit` call re-saves the mutated
  // payload), and a fresh `mergeAcrossFiles` result would reset every row
  // back to `{ kind: "new" }`, reopening the duplicate-insert hole Ruling 61
  // names. The rebase above is a READ used to compare identities; it never
  // becomes the record.

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
