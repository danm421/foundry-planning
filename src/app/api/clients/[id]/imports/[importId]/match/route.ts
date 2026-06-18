import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
    requireImportAccess,
    ForbiddenError,
    NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { runImportMatching } from "@/lib/imports/run-matching";
import type { ImportPayloadJson } from "@/lib/imports/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; importId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        const { userId } = await auth();
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
                    message = "Rate limiting is not configured — matching is disabled.";
                    break;
                case "redis_error":
                    status = 503;
                    message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
                    break;
                case "exceeded":
                    status = 429;
                    message = "Too many match requests. Please wait and try again.";
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

        const fileResults =
            (imp.payloadJson as ImportPayloadJson)?.fileResults ?? {};
        if (Object.keys(fileResults).length === 0) {
            return NextResponse.json(
                { error: "No extracted files to match. Run extraction first." },
                { status: 400 }
            );
        }

        if (imp.mode === "updating" && !imp.scenarioId) {
            return NextResponse.json(
                { error: "Updating-mode imports require a scenarioId." },
                { status: 400 }
            );
        }

        const counts = await runImportMatching({
            importId,
            clientId,
            firmId,
            mode: imp.mode,
            scenarioId: imp.scenarioId,
            fileResults,
        });

        return NextResponse.json({ ok: true, ...counts });
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
            "POST /api/clients/[id]/imports/[importId]/match failed:",
            safeMessage
        );
        return NextResponse.json(
            { error: "Matching failed. Please try again." },
            { status: 500 }
        );
    }
}
