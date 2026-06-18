import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
    clientImports,
    clientImportFiles,
    clientImportExtractions,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { extractDocument } from "@/lib/extraction/extract";
import type { DocumentType, ExtractionResult } from "@/lib/extraction/types";
import type { UploadKind } from "@/lib/extraction/validate-upload";
import { downloadImportFile } from "@/lib/imports/blob";
import { summarizeExtraction } from "@/lib/imports/extract-summary";

export interface RunExtractionArgs {
    importId: string;
    clientId: string;
    firmId: string;
    model: "mini" | "full";
    extractHoldings: boolean;
    comprehensive?: boolean;
}

export interface RunExtractionResult {
    succeeded: number;
    failed: number;
    status: "review" | "draft";
    warnings: string[];
}

export async function runImportExtraction(
    args: RunExtractionArgs,
): Promise<RunExtractionResult> {
    const { importId, clientId, firmId, model, extractHoldings, comprehensive = false } = args;

    // Load all live files for this import.
    const files = await db
        .select()
        .from(clientImportFiles)
        .where(
            and(
                eq(clientImportFiles.importId, importId),
                isNull(clientImportFiles.deletedAt),
            ),
        );

    // Load the import row so we can merge into payloadJson.
    const [importRow] = await db
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, importId))
        .limit(1);

    const fileResults: Record<string, ExtractionResult> = {
        ...((importRow?.payloadJson as { fileResults?: Record<string, ExtractionResult> })
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
                extractHoldings,
                comprehensive,
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

    // Status is driven by whether any usable rows came out — a file that
    // "succeeds" but yields nothing (e.g. an un-OCR-able scan) drops the
    // import to draft so the UI surfaces the warning instead of an empty
    // Review screen.
    const summary = summarizeExtraction(fileResults);
    await db
        .update(clientImports)
        .set({
            status: summary.status,
            payloadJson: { fileResults },
            updatedAt: new Date(),
        })
        .where(eq(clientImports.id, importId));

    return {
        succeeded,
        failed,
        status: summary.status,
        warnings: summary.warnings,
    };
}
