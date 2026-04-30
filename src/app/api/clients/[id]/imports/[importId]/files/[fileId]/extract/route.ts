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
import { DOCUMENT_TYPES } from "@/lib/extraction/types";
import { downloadImportFile } from "@/lib/imports/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = {
    params: Promise<{ id: string; importId: string; fileId: string }>;
};

interface BodyArgs {
    model?: "mini" | "full";
    documentType?: DocumentType | "auto";
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const firmId = await requireOrgId();
        const { userId } = await auth();
        if (!userId) {
            throw new UnauthorizedError();
        }
        const { id: clientId, importId, fileId } = await params;

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

        const validDocTypes = ["auto", ...DOCUMENT_TYPES] as readonly string[];
        const requestedDocType = body.documentType;
        if (
            requestedDocType !== undefined &&
            !validDocTypes.includes(requestedDocType)
        ) {
            return NextResponse.json(
                { error: `Invalid document type: ${requestedDocType}` },
                { status: 400 }
            );
        }

        const [file] = await db
            .select()
            .from(clientImportFiles)
            .where(
                and(
                    eq(clientImportFiles.id, fileId),
                    eq(clientImportFiles.importId, importId),
                    isNull(clientImportFiles.deletedAt)
                )
            )
            .limit(1);
        if (!file) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const documentType: DocumentType | "auto" =
            requestedDocType ?? (file.documentType as DocumentType | "auto");

        const [importRow] = await db
            .select()
            .from(clientImports)
            .where(eq(clientImports.id, importId))
            .limit(1);
        if (!importRow) {
            return NextResponse.json({ error: "Import not found" }, { status: 404 });
        }

        const startedAt = new Date();
        const [extraction] = await db
            .insert(clientImportExtractions)
            .values({
                fileId,
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
            resourceId: fileId,
            clientId,
            firmId,
            metadata: { importId, model, documentType, reextract: true },
        });

        try {
            const buffer = await downloadImportFile(file.blobUrl);
            if (!buffer) {
                throw new Error("Blob fetch failed");
            }

            const result = await extractDocument(
                buffer,
                file.originalFilename,
                documentType,
                model,
                file.detectedKind as UploadKind
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

            // Replace this file's contribution to payloadJson.fileResults.
            const existingFileResults =
                (importRow.payloadJson as {
                    fileResults?: Record<string, ExtractionResult>;
                })?.fileResults ?? {};
            const fileResults = { ...existingFileResults, [fileId]: result };

            await db
                .update(clientImports)
                .set({
                    payloadJson: { fileResults },
                    updatedAt: new Date(),
                })
                .where(eq(clientImports.id, importId));

            await recordAudit({
                action: "import.extraction.completed",
                resourceType: "client_import_file",
                resourceId: fileId,
                clientId,
                firmId,
                metadata: {
                    importId,
                    model,
                    promptVersion: result.promptVersion,
                    reextract: true,
                    warningCount: result.warnings.length,
                },
            });

            return NextResponse.json({ ok: true, result });
        } catch (err) {
            const safeMessage =
                err instanceof Error
                    ? err.message.slice(0, 500)
                    : "unknown extraction error";
            console.error(
                `[import-extract] file ${fileId} (${file.originalFilename}) failed:`,
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
                resourceId: fileId,
                clientId,
                firmId,
                metadata: {
                    importId,
                    model,
                    reextract: true,
                    error: safeMessage,
                },
            });

            return NextResponse.json(
                { error: "Extraction failed", details: safeMessage },
                { status: 500 }
            );
        }
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
            "POST /api/clients/[id]/imports/[importId]/files/[fileId]/extract failed:",
            safeMessage
        );
        return NextResponse.json(
            { error: "Extraction failed. Please try again." },
            { status: 500 }
        );
    }
}
