import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
    clientImports,
    clientImportFiles,
    clientImportExtractions,
} from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import {
    requireImportAccess,
    ForbiddenError,
    NotFoundError,
} from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { extractDocument } from "@/lib/extraction/extract";
import type { DocumentType, ExtractionResult } from "@/lib/extraction/types";
import type { UploadKind } from "@/lib/extraction/validate-upload";
import { downloadImportFile } from "@/lib/imports/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

interface BodyArgs {
    model?: "mini" | "full";
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
                    Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
                );
            }
            return NextResponse.json({ error: message }, { status, headers });
        }

        await requireImportAccess({ importId, clientId, firmId, userId });

        const body = (await request.json().catch(() => ({}))) as BodyArgs;
        const model = body.model === "full" ? "full" : "mini";

        // Load all live files for this import; skip ones already successfully extracted.
        const files = await db
            .select()
            .from(clientImportFiles)
            .where(
                and(
                    eq(clientImportFiles.importId, importId),
                    isNull(clientImportFiles.deletedAt)
                )
            );

        if (files.length === 0) {
            return NextResponse.json(
                { error: "No files in this import to extract." },
                { status: 400 }
            );
        }

        // Load the import row so we can merge into payloadJson.
        const [importRow] = await db
            .select()
            .from(clientImports)
            .where(eq(clientImports.id, importId))
            .limit(1);
        if (!importRow) {
            return NextResponse.json(
                { error: "Import not found." },
                { status: 404 }
            );
        }

        const fileResults: Record<string, ExtractionResult> = {
            ...((importRow.payloadJson as { fileResults?: Record<string, ExtractionResult> })
                ?.fileResults ?? {}),
        };

        let succeeded = 0;
        let failed = 0;

        // Bounded by Azure OpenAI per-deployment TPM and downstream Neon/Blob
        // request concurrency. Tune in concert with rate limit budgets.
        const CONCURRENCY = 5;

        type FileOutcome =
            | { ok: true; fileId: string; result: ExtractionResult }
            | { ok: false; fileId: string };

        const extractOne = async (
            file: (typeof files)[number],
        ): Promise<FileOutcome> => {
            const startedAt = new Date();
            const [extraction] = await db
                .insert(clientImportExtractions)
                .values({
                    fileId: file.id,
                    model,
                    promptVersion: "pending",
                    status: "extracting",
                    startedAt,
                })
                .returning({ id: clientImportExtractions.id });
            const extractionId = extraction.id;

            await recordAudit({
                action: "import.extraction.started",
                resourceType: "client_import_file",
                resourceId: file.id,
                clientId,
                firmId,
                metadata: { importId, model },
            });

            try {
                const buffer = await downloadImportFile(file.blobUrl);
                if (!buffer) {
                    throw new Error("Blob fetch failed");
                }
                const result = await extractDocument(
                    buffer,
                    file.originalFilename,
                    file.documentType as DocumentType | "auto",
                    model,
                    file.detectedKind as UploadKind,
                );

                await db
                    .update(clientImportExtractions)
                    .set({
                        status: "success",
                        promptVersion: result.promptVersion,
                        rawResponseJson: result as unknown as Record<string, unknown>,
                        warnings: result.warnings,
                        finishedAt: new Date(),
                    })
                    .where(eq(clientImportExtractions.id, extractionId));

                await recordAudit({
                    action: "import.extraction.completed",
                    resourceType: "client_import_file",
                    resourceId: file.id,
                    clientId,
                    firmId,
                    metadata: {
                        importId,
                        model,
                        promptVersion: result.promptVersion,
                        warningCount: result.warnings.length,
                    },
                });

                return { ok: true, fileId: file.id, result };
            } catch (err) {
                const safeMessage =
                    err instanceof Error
                        ? err.message.slice(0, 500)
                        : "unknown extraction error";
                console.error(
                    `[import-extract] file ${file.id} (${file.originalFilename}) failed:`,
                    safeMessage,
                );
                await db
                    .update(clientImportExtractions)
                    .set({
                        status: "failed",
                        errorMessage: safeMessage,
                        finishedAt: new Date(),
                    })
                    .where(eq(clientImportExtractions.id, extractionId));

                await recordAudit({
                    action: "import.extraction.failed",
                    resourceType: "client_import_file",
                    resourceId: file.id,
                    clientId,
                    firmId,
                    metadata: { importId, model, error: safeMessage },
                });

                return { ok: false, fileId: file.id };
            }
        };

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            const chunk = files.slice(i, i + CONCURRENCY);
            const outcomes = await Promise.all(chunk.map(extractOne));
            for (const outcome of outcomes) {
                if (outcome.ok) {
                    fileResults[outcome.fileId] = outcome.result;
                    succeeded += 1;
                } else {
                    failed += 1;
                }
            }
        }

        // No "failed" import status — when every file fails, drop back to
        // draft so the advisor can edit/replace files and try again.
        const finalStatus: "review" | "draft" =
            succeeded > 0 ? "review" : "draft";
        await db
            .update(clientImports)
            .set({
                status: finalStatus,
                payloadJson: { fileResults },
                updatedAt: new Date(),
            })
            .where(eq(clientImports.id, importId));

        return NextResponse.json({
            ok: true,
            succeeded,
            failed,
            status: finalStatus,
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
            "POST /api/clients/[id]/imports/[importId]/extract failed:",
            safeMessage
        );
        return NextResponse.json(
            { error: "Extraction failed. Please try again." },
            { status: 500 }
        );
    }
}
