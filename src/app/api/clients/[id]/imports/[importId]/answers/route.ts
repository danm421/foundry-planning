import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import {
    requireImportAccess,
    ForbiddenError,
    NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import type { ImportPayloadJson } from "@/lib/imports/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

interface BodyArgs {
    answers?: Record<string, string>;
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        await requireActiveSubscription();
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

        const imp = await requireImportAccess({
            importId,
            clientId,
            firmId,
            userId,
        });

        const body = (await request.json().catch(() => ({}))) as BodyArgs;
        const answers =
            body.answers && typeof body.answers === "object" ? body.answers : {};

        const payloadJson = (imp.payloadJson as ImportPayloadJson) ?? {};
        const assemble = payloadJson.assemble;
        if (!assemble) {
            return NextResponse.json(
                { error: "No assemble state — run assemble first." },
                { status: 400 }
            );
        }

        const payload = payloadJson.payload;

        for (const q of assemble.questions) {
            if (typeof answers[q.id] === "string") {
                q.answer = answers[q.id];
            }
        }

        // Apply to the mintable client where the answer changes it. Phase-1
        // scope is limited to q:primary_dob — assumption answers for
        // retirement age / filing status are recorded on the question but
        // not pushed to the already-minted client (out of A6 scope).
        const primaryDobQuestion = assemble.questions.find(
            (q) => q.id === "q:primary_dob"
        );
        if (primaryDobQuestion?.answer !== undefined && payload) {
            payload.primary ??= { firstName: "" };
            payload.primary.dateOfBirth = primaryDobQuestion.answer;
        }

        await db
            .update(clientImports)
            .set({
                payloadJson: { ...payloadJson, payload, assemble },
                updatedAt: new Date(),
            })
            .where(eq(clientImports.id, importId));

        const remaining = assemble.questions.filter((q) => !q.answer).length;

        await recordAudit({
            action: "import.assemble.answered",
            resourceType: "client_import",
            resourceId: importId,
            clientId,
            firmId,
            metadata: { answered: Object.keys(answers).length, remaining },
        });

        return NextResponse.json({ ok: true, remaining });
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
            "POST /api/clients/[id]/imports/[importId]/answers failed:",
            safeMessage
        );
        return NextResponse.json(
            { error: "Recording answers failed. Please try again." },
            { status: 500 }
        );
    }
}
