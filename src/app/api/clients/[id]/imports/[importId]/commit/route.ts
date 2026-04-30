import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { recordAudit } from "@/lib/audit";
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
            const status = rl.reason === "unconfigured" ? 503 : 429;
            const message =
                rl.reason === "unconfigured"
                    ? "Rate limiting is not configured — commits are disabled."
                    : "Too many commit requests. Please wait and try again.";
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

        const { results, allTabsCommitted } = await commitTabs({
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
