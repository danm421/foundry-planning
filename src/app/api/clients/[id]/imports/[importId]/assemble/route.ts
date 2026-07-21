import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import {
    requireImportAccess,
    ForbiddenError,
    NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { runAssemble } from "@/lib/imports/assemble/run-assemble";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import type { ImportPayloadJson } from "@/lib/imports/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

interface BodyArgs {
    known?: {
        retirementAge?: number;
        lifeExpectancy?: number;
        filingStatus?: string;
        primaryDob?: string;
    };
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        await requireActiveSubscription();
        const { userId, sessionClaims } = await auth();
        if (!userId) {
            throw new UnauthorizedError();
        }
        const { id: clientId, importId } = await params;

        const access = await verifyClientAccess(clientId);
        if (!access.ok) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (access.access !== "own") {
            return NextResponse.json({ error: "Cross-organization imports are not supported." }, { status: 403 });
        }
        if (access.permission !== "edit") {
            return NextResponse.json({ error: "View-only access" }, { status: 403 });
        }

        const rl = await checkImportRateLimit(firmId, "match");
        if (!rl.allowed) {
            let status: number;
            let message: string;
            switch (rl.reason) {
                case "unconfigured":
                    status = 503;
                    message = "Rate limiting is not configured — assembling is disabled.";
                    break;
                case "redis_error":
                    status = 503;
                    message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
                    break;
                case "exceeded":
                    status = 429;
                    message = "Too many assemble requests. Please wait and try again.";
                    break;
            }
            const headers: Record<string, string> = {};
            if (rl.reset) {
                headers["Retry-After"] = String(
                    Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
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

        // Defense-in-depth: the middleware already blocks this POST for
        // non-active subscriptions, and every active seat includes the
        // ai_import entitlement (it's bundled into the plan). This guard fails
        // closed if the Clerk entitlements metadata is missing or stale.
        const entitlements =
          (sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null)
            ?.org_public_metadata?.entitlements;
        if (!entitlements?.includes("ai_import")) {
            await recordAudit({
                action: "billing.access_denied",
                resourceType: "firm",
                resourceId: firmId,
                clientId,
                firmId,
                metadata: { reason: "ai_import_not_entitled", importId },
            });
            return NextResponse.json(
                { error: "ai_import_not_entitled" },
                { status: 403 },
            );
        }

        const body = (await request.json().catch(() => ({}))) as BodyArgs;

        const fileResults =
            (imp.payloadJson as ImportPayloadJson)?.fileResults ?? {};
        if (Object.keys(fileResults).length === 0) {
            return NextResponse.json(
                { error: "No extracted files to assemble. Run extraction first." },
                { status: 400 }
            );
        }

        if (imp.mode === "updating" && !imp.scenarioId) {
            return NextResponse.json(
                { error: "Updating-mode imports require a scenarioId." },
                { status: 400 }
            );
        }

        const mode = imp.mode === "updating" ? "existing" : "new";
        const scenarioId = imp.scenarioId ?? "";

        // The client row (retirementAge/lifeExpectancy/filingStatus are all
        // NOT NULL, so a real value always exists by the time assemble runs —
        // build_plan writes them before creating the draft import) plus the
        // primary contact's DOB via the same firm-scoped helper Forge's own
        // read tools use. Without this, gap-fill never sees what's already on
        // record and fabricates an assumption for every one of these fields on
        // every real call (see FIX 1 in brief-V1-fixes.md). An explicit
        // body.known value still wins — nothing sends one today, but the shape
        // is kept for forward-compat / manual testing.
        const clientRow = await getClientWithContacts(clientId, firmId);
        const known = {
            retirementAge: clientRow?.retirementAge,
            lifeExpectancy: clientRow?.lifeExpectancy,
            filingStatus: clientRow?.filingStatus,
            primaryDob: clientRow?.dateOfBirth ?? undefined,
            ...body.known,
        };

        const result = await runAssemble({
            importId,
            clientId,
            firmId,
            mode,
            scenarioId,
            fileResults,
            known,
        });

        return NextResponse.json({
            ok: true,
            questionCount: result.questionCount,
            rowCount: result.rowCount,
            assemble: result.assemble,
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
        const safeMessage =
            err instanceof Error ? err.message.slice(0, 200) : "unknown error";
        console.error(
            "POST /api/clients/[id]/imports/[importId]/assemble failed:",
            safeMessage
        );
        return NextResponse.json(
            { error: "Assemble failed. Please try again." },
            { status: 500 }
        );
    }
}
