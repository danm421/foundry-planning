import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
    requireImportAccess,
    ForbiddenError,
    NotFoundError,
} from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
    mergeExtractionResults,
    type FileExtraction,
} from "@/lib/imports/merge";
import { runMatchingPass } from "@/lib/imports/match";
import type { ImportPayload } from "@/lib/imports/types";
import type { ExtractionResult } from "@/lib/extraction/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string; importId: string }> };

interface PayloadJsonShape {
    fileResults?: Record<string, ExtractionResult>;
    payload?: ImportPayload;
}

export async function POST(_request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        const { userId } = await auth();
        if (!userId) {
            throw new UnauthorizedError();
        }
        const { id: clientId, importId } = await params;

        const rl = await checkImportRateLimit(firmId, "match");
        if (!rl.allowed) {
            const status = rl.reason === "unconfigured" ? 503 : 429;
            const message =
                rl.reason === "unconfigured"
                    ? "Rate limiting is not configured — matching is disabled."
                    : "Too many match requests. Please wait and try again.";
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
            (imp.payloadJson as PayloadJsonShape)?.fileResults ?? {};
        const fileExtractions: FileExtraction[] = Object.entries(fileResults).map(
            ([fileId, result]) => ({ fileId, result })
        );
        if (fileExtractions.length === 0) {
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

        const merged = mergeExtractionResults(fileExtractions);
        const annotated = await runMatchingPass({
            payload: merged,
            clientId,
            scenarioId: imp.scenarioId ?? "",
            mode: imp.mode,
        });

        const counts = countAnnotations(annotated);

        await db
            .update(clientImports)
            .set({
                payloadJson: { fileResults, payload: annotated },
                updatedAt: new Date(),
            })
            .where(eq(clientImports.id, importId));

        await recordAudit({
            action: "import.match.run",
            resourceType: "client_import",
            resourceId: importId,
            clientId,
            firmId,
            metadata: {
                mode: imp.mode,
                ...counts,
            },
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

function countAnnotations(payload: ImportPayload) {
    let exact = 0;
    let fuzzy = 0;
    let newRows = 0;
    const arrays = [
        payload.accounts,
        payload.incomes,
        payload.expenses,
        payload.liabilities,
        payload.dependents,
        payload.lifePolicies,
        payload.wills,
        payload.entities,
    ] as const;
    for (const arr of arrays) {
        for (const row of arr) {
            const k = row.match?.kind;
            if (k === "exact") exact += 1;
            else if (k === "fuzzy") fuzzy += 1;
            else if (k === "new") newRows += 1;
        }
    }
    return { exact, fuzzy, new: newRows };
}
