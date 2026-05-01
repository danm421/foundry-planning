import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import {
    claimAiImportCredit,
    syncAiImportEntitlement,
} from "@/lib/billing/ai-import-quota";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
    ForbiddenError,
    NotFoundError,
    requireImportAccess,
} from "@/lib/imports/authz";
import { commitTabs } from "@/lib/imports/commit/orchestrator";
import {
    COMMIT_TABS,
    type CommitTab,
} from "@/lib/imports/commit/types";
import { WillCommitValidationError } from "@/lib/imports/commit/will-types";
import type { ImportPayloadJson } from "@/lib/imports/types";
import { checkImportRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; importId: string }> };

const TAB_SET: ReadonlySet<string> = new Set(COMMIT_TABS);

function parseTabs(input: unknown): CommitTab[] | { error: string } {
    if (!Array.isArray(input) || input.length === 0) {
        return { error: "Body must include a non-empty `tabs` array." };
    }
    const out: CommitTab[] = [];
    const seen = new Set<string>();
    for (const t of input) {
        if (typeof t !== "string" || !TAB_SET.has(t)) {
            return { error: `Unknown tab: ${String(t)}` };
        }
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t as CommitTab);
        }
    }
    return out;
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        const { userId } = await auth();
        if (!userId) {
            throw new UnauthorizedError();
        }
        const { id: clientId, importId } = await params;

        const rl = await checkImportRateLimit(firmId, "commit");
        if (!rl.allowed) {
            let status: number;
            let message: string;
            switch (rl.reason) {
                case "unconfigured":
                    status = 503;
                    message = "Rate limiting is not configured — commits are disabled.";
                    break;
                case "redis_error":
                    status = 503;
                    message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
                    break;
                case "exceeded":
                    status = 429;
                    message = "Too many commit requests. Please wait and try again.";
                    break;
            }
            const headers: Record<string, string> = {};
            if (rl.reset) {
                headers["Retry-After"] = String(
                    Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
                );
            }
            return NextResponse.json({ error: message }, { status, headers });
        }

        const imp = await requireImportAccess({
            importId,
            clientId,
            firmId,
            userId,
        });

        if (imp.mode === "updating" && !imp.scenarioId) {
            return NextResponse.json(
                { error: "Updating-mode imports require a scenarioId." },
                { status: 400 },
            );
        }
        if (!imp.scenarioId) {
            return NextResponse.json(
                { error: "Import has no scenarioId; matching/commit not possible." },
                { status: 400 },
            );
        }

        const body = (await request.json().catch(() => null)) as
            | { tabs?: unknown }
            | null;
        const parsed = parseTabs(body?.tabs);
        if ("error" in parsed) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        const tabs = parsed;

        const payload = (imp.payloadJson as ImportPayloadJson)?.payload;
        if (!payload) {
            return NextResponse.json(
                { error: "Import has no annotated payload. Run matching first." },
                { status: 400 },
            );
        }

        const { results, allTabsCommitted, firstTimeAllCommitted } = await commitTabs({
            importId,
            payload,
            tabs,
            ctx: {
                clientId,
                scenarioId: imp.scenarioId,
                orgId: firmId,
                userId,
            },
        });

        if (firstTimeAllCommitted && imp.mode === "onboarding") {
            // Atomic credit claim happens INSIDE commitTabs's tx via the
            // helper imported below — but commitTabs already returned, so we
            // run the claim in a fresh tx. Idempotent: re-running won't
            // double-credit because of the WHERE ai_import_counted=false.
            try {
                await db.transaction(async (tx) => {
                    // Cast: claimAiImportCredit's AnyTx is typed against the
                    // node-postgres HKT for portability, but the project's
                    // db uses neon-serverless. The runtime API surface
                    // (tx.execute(sql)) is identical.
                    await claimAiImportCredit(
                        tx as unknown as Parameters<typeof claimAiImportCredit>[0],
                        importId,
                    );
                });
                await syncAiImportEntitlement(firmId);
            } catch (err) {
                // Quota update is best-effort post-commit — failure here does
                // not undo the import. Reconcile cron + the next
                // subscription.updated webhook will heal Clerk metadata drift.
                console.error(
                    "ai-import quota credit/sync failed:",
                    err instanceof Error ? err.message : err,
                );
            }
        }

        await Promise.all(
            tabs.map((tab) =>
                recordAudit({
                    action: "import.commit.tab",
                    resourceType: "client_import",
                    resourceId: importId,
                    clientId,
                    firmId,
                    metadata: { tab, ...results[tab] },
                }),
            ),
        );

        return NextResponse.json({
            ok: true,
            results,
            status: allTabsCommitted ? "committed" : "review",
        });
    } catch (err) {
        if (err instanceof UnauthorizedError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (err instanceof ForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (err instanceof NotFoundError) {
            return NextResponse.json({ error: err.message }, { status: 404 });
        }
        if (err instanceof WillCommitValidationError) {
            return NextResponse.json({ error: err.message }, { status: 400 });
        }
        const safeMessage =
            err instanceof Error ? err.message.slice(0, 200) : "unknown error";
        console.error(
            "POST /api/clients/[id]/imports/[importId]/commit failed:",
            safeMessage,
        );
        return NextResponse.json(
            { error: "Commit failed. Please try again." },
            { status: 500 },
        );
    }
}
