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
import { readChatState, writeChatState } from "@/lib/statement-chat/state";
// Shared with chat/turn/route.ts (final review, I1) — one rebase
// mechanism, not two similar ones.
import { rebaseOntoFreshMerge } from "@/lib/statement-chat/rebase";
import type { Annotated, ImportPayloadJson } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

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
 *
 * The advisor's standing rows are REBASED onto that fresh merge rather than
 * replaced by it (final review, I1) — see the rebase block below.
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
  // Final review, I1: the rows the advisor has been working on, captured
  // BEFORE extraction runs — this is the last moment they exist.
  // `runImportExtraction` ends with a wholesale
  // `payloadJson: { fileResults, ...chat }` write (`run-extraction.ts:350`)
  // that deliberately drops `payload`, so the fresh post-extraction read
  // below can never see them. The `chat` slice DOES survive that write, so
  // exclusions are still read fresh afterwards; only `payload.accounts` has
  // to be carried across by hand.
  let priorAccounts: Annotated<ExtractedAccount>[] = [];
  try {
    const imp = await requireImportAccess({ importId, clientId, firmId, userId });
    extractHoldingsDefault = imp.extractHoldings === true;
    priorAccounts = ((imp.payloadJson ?? {}) as ImportPayloadJson).payload?.accounts ?? [];
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
        const extractionResult = await runImportExtraction({
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

        // Ruling 97 (Task 11b fix round 1, Important 3) gates the WRITE;
        // Ruling 101 (fix round 2) separates it from the READ — the two are
        // NOT the same condition. `filesProcessed` is `0` ONLY on
        // `runImportExtraction`'s own "nothing new to read" early return —
        // which, per that function's own comment, never writes `payloadJson`
        // at all. Re-deriving from the UNCHANGED `fileResults` below and
        // persisting it here would do exactly what that comment exists to
        // prevent: a "Re-run extraction" click with no new files must be a
        // pure re-read of the STANDING state, never a rewrite —
        // `mergeAcrossFiles`/`detectRollups` know nothing about any
        // `edit_row`/`merge_rows`/`drop_row` a chat turn made (or a commit's
        // `linkCreated` stamp) since the last REAL extraction.
        //
        // BUT the standing payload only exists once Step 0 (or a prior
        // real extraction) has seeded it. `standingAccounts` checked below
        // (not just `filesProcessed`) is what distinguishes "nothing new,
        // and nothing to lose by reflecting it" from "nothing new, and
        // NOTHING HAS EVER BEEN SEEDED" — every import extracted before
        // Step 0 landed is in the second bucket. Falling through in that
        // case re-derives from `fileResults` exactly like a real
        // extraction would, and the WRITE gate below (not just
        // `filesProcessed > 0`) treats the absence of a standing payload as
        // a legitimate SEED, not an overwrite — Ruling 89's original
        // purpose, now also rescuing a legacy import's one recovery path.
        const standingAccounts = payloadJson.payload?.accounts;
        if (extractionResult.filesProcessed === 0 && standingAccounts) {
          const standingChat = readChatState(payloadJson);
          if (!closed) {
            send({
              type: "done",
              summary: "No new statements to read.",
              caveats: [],
              rows: standingAccounts,
              excluded: standingChat.excludedRows,
            });
          }
          return;
        }

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

        // --- Final review, I1: REBASE onto the fresh merge, never replace ---
        //
        // This route used to persist `payload: { accounts: kept }` outright,
        // so uploading one more statement threw away every `edit_row`
        // correction, put every `drop_row`/`merge_rows` row back in the
        // table, and dropped every `linkCreated` stamp — while the UI
        // actively invites that path ("You can still upload another
        // statement first"). `rebaseOntoFreshMerge` is the SAME mechanism the
        // turn route already uses to land a turn's rows on a fresh read (one
        // rebase, shared, not two similar ones): the fresh merge is the base,
        // so a genuinely new account off the new statement comes through
        // untouched, and every row the advisor has already worked on wins
        // over its freshly-merged counterpart. A row that no longer exists in
        // the new extraction simply disappears.
        //
        // C2's file-scoped `__rowId` is what makes this work at all: without
        // it, adding a file renumbers the other files' fallback ids and the
        // rebase matches nothing.
        const standingChat = readChatState(payloadJson);
        // A row the advisor retired in the chat comes straight back out of
        // the merge (it is still in `fileResults`), so it has to be
        // subtracted here or "drop it" would undo itself on the next upload.
        // Same subtraction the finalize route makes for the same reason.
        const chatExcludedIds = new Set(
          standingChat.excludedRows
            .map((x) => x.row?.__rowId)
            .filter((rowId): rowId is string => typeof rowId === "string"),
        );
        const {
          rows: rebasedAll,
          overrides: allOverrides,
          refusals: allRefusals,
          dropped: allDropped,
        } = rebaseOntoFreshMerge(kept, priorAccounts, {
          // Fix wave 2. The rebase now re-attaches a standing row whose id
          // moved onto the fresh row that is the same account, carrying the
          // standing id forward. A fresh row the advisor already retired must
          // never be that target: the carried id would not be the excluded
          // one, the subtraction two lines below would miss it, and the
          // dropped row would come back on screen.
          retiredRowIds: chatExcludedIds,
        });
        const rebasedAccounts = rebasedAll.filter(
          (row) => !(row.__rowId && chatExcludedIds.has(row.__rowId)),
        );
        // Ruling 117: an override is only worth telling the advisor about for
        // a row they can actually see. A row they dropped in the chat is
        // subtracted from the table one line above, so its override is
        // subtracted here for the same reason — a caveat about a row that is
        // not on screen is the same failure as a caveat naming a figure that
        // is not on screen.
        const rebaseOverrides = allOverrides.filter((o) => !chatExcludedIds.has(o.__rowId));
        // Final review #2, C-1. Same subtraction, same reason: a refusal
        // about a row the advisor already dropped in the chat is a caveat
        // about a row that is not on screen.
        const rebaseRefusals = allRefusals.filter((r) => !chatExcludedIds.has(r.__rowId));
        // Fix wave 2, requirement 4. Same subtraction, same reason.
        const rebaseDropped = allDropped.filter((d) => !chatExcludedIds.has(d.__rowId));
        // The advisor's own exclusions are kept first and win on id — a
        // `merge_rows` entry carries `irreversible: true`, which this run's
        // freshly-detected rollup entry for the same row would not. Fresh
        // rollup exclusions the chat has no record of are appended.
        const nextExcludedRows = [
          ...standingChat.excludedRows,
          ...excluded.filter((x) => !x.row.__rowId || !chatExcludedIds.has(x.row.__rowId)),
        ];

        // Narrate the rows that will actually be shown, not the raw merge —
        // and hand over the rebase's overrides, which is what lets `narrate`
        // drop any `value-conflict` caveat describing a figure the rebase
        // held back (Ruling 117) instead of printing it above a row showing
        // a different number.
        const narration = narrate({
          fileCount: mergedFileCount,
          decisions,
          rows: rebasedAccounts,
          overrides: rebaseOverrides,
          refusals: rebaseRefusals,
          dropped: rebaseDropped,
        });

        // Ruling 89 (Step 0) / Ruling 101 (fix round 2): persist
        // `payload.accounts = kept` in the SAME write as the chat slice —
        // `writeChatState` only ever touches `chat`, so `payload` is set
        // alongside it explicitly, narrow to `{ accounts }` (matching what
        // `use-chat-commit.ts` writes) — but ONLY when this run actually
        // re-derived rows (`filesProcessed > 0`) OR there was no standing
        // payload to clobber (`!standingAccounts`, the legacy-import rescue
        // above). Skipping the write on the "no new files, has a standing
        // payload" path is Ruling 97; this OR-clause is what Ruling 101
        // adds without reopening it.
        if (extractionResult.filesProcessed > 0 || !standingAccounts) {
          await db
            .update(clientImports)
            .set({
              payloadJson: {
                ...writeChatState(payloadJson, { decisions, excludedRows: nextExcludedRows }),
                payload: { accounts: rebasedAccounts },
              },
              updatedAt: new Date(),
            })
            .where(eq(clientImports.id, importId));
        }

        if (!closed) {
          send({
            type: "done",
            summary: narration.summary,
            caveats: narration.caveats,
            // Exactly what was just persisted — the surface adopts this
            // wholesale, so streaming the raw merge instead would leave the
            // screen disagreeing with the database from the first frame.
            rows: rebasedAccounts,
            excluded: nextExcludedRows,
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
