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
import type { ImportPayloadJson } from "@/lib/imports/types";
import { bridgeTaxReturn } from "./tax-bridge";

/**
 * Per-file progress reported to `onFile` as each file settles. `accountCount`
 * and `statementDate` are read off the just-extracted `ExtractionResult` — the
 * only place they exist (C12). `statementDate` is the first account carrying
 * one; a file extracted before Task 1's per-account statementDate field has
 * none, and the event tolerates that (undefined, not a crash).
 */
export interface ExtractionFileProgress {
    fileName: string;
    accountCount: number;
    statementDate?: string;
    /** Present only when this file failed to extract. */
    error?: string;
}

export interface RunExtractionArgs {
    importId: string;
    clientId: string;
    firmId: string;
    model: "mini" | "full";
    extractHoldings: boolean;
    comprehensive?: boolean;
    /**
     * Skip files that already carry a stored extraction result.
     *
     * The onboarding drawer lets an advisor add documents to an import that has
     * already been extracted. Without this, every earlier document would be
     * re-read on each addition — paying the model cost again and risking the
     * route's 300s ceiling once a handful of files are in play.
     */
    skipExtracted?: boolean;
    /**
     * Invoked once per file as it settles (success or failure) — additive,
     * so the wizard (which passes nothing) is unaffected (Task 9 / C3).
     *
     * Fires in COMPLETION order, not upload order: files run CONCURRENCY-wide
     * in `Promise.all` chunks, so a later-uploaded file can settle first.
     *
     * Called OUTSIDE `extractOne`'s own try/catch (C12) — a throw from this
     * callback must never be recorded as an extraction failure for a file
     * that actually succeeded.
     */
    onFile?: (progress: ExtractionFileProgress) => void;
    /**
     * Aborted when the caller's connection drops (Task 9 / a route-level
     * disconnect, C6's "thread the abort signal into the work" clause).
     * Checked ONLY at the top of each `CONCURRENCY`-wide chunk, and only to
     * `break` the outer loop — never to `throw` and never to cancel an
     * in-flight `Promise.all`. Aborting the in-flight batch would lose every
     * file that already succeeded in it, since `fileResults` is written to
     * `payloadJson` only after the loop below finishes. Breaking cleanly
     * instead falls through to that same write, so a disconnected run still
     * persists whatever it completed and `skipExtracted` picks up the rest
     * on the next request — an abandoned tab stops holding CONCURRENCY Azure
     * slots against the shared per-deployment TPM budget, but never throws
     * away paid-for work.
     */
    signal?: AbortSignal;
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
    const {
        importId,
        clientId,
        firmId,
        model,
        extractHoldings,
        comprehensive = false,
        skipExtracted = false,
        onFile,
        signal,
    } = args;

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

    if (!importRow) throw new Error(`Import not found: ${importId}`);

    // Read the FULL prior payload, not just `fileResults` — `chat` (the
    // statement-chat surface's slice, Task 6+) must survive the wholesale
    // write below (C11), and this is the only read of the pre-extraction row.
    const priorPayload = (importRow.payloadJson ?? {}) as ImportPayloadJson;

    const fileResults: Record<string, ExtractionResult> = {
        ...(priorPayload.fileResults ?? {}),
    };

    const pending = skipExtracted
        ? files.filter((f) => !fileResults[f.id])
        : files;

    // Nothing new to read. Return the standing summary rather than rewriting
    // payloadJson — that write drops the annotated `payload`, and the caller
    // would be re-running matching for no reason.
    if (pending.length === 0) {
        const summary = summarizeExtraction(fileResults);
        return {
            succeeded: 0,
            failed: 0,
            status: summary.status,
            warnings: summary.warnings,
        };
    }

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

        let outcome: FileOutcome;
        // Set on the success path only; read by the `onFile` call below.
        let progress: { accountCount: number; statementDate?: string } = { accountCount: 0 };
        let failureMessage: string | undefined;

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

            // A tax return also goes to the tax_returns store — the generic
            // extractor has no tax block, so plan-basics derivation would
            // otherwise have nothing to read.
            if (result.documentType === "tax_return") {
                const bridged = await bridgeTaxReturn({
                    buffer,
                    filename: file.originalFilename,
                    clientId,
                    kind: file.detectedKind as UploadKind,
                    model,
                });
                if (!bridged.ok && bridged.warning) {
                    result.warnings.push(bridged.warning);
                }
            }

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

            outcome = { ok: true, fileId: file.id, result };
            progress = {
                accountCount: result.extracted.accounts.length,
                statementDate: result.extracted.accounts.find((a) => a.statementDate)
                    ?.statementDate,
            };
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

            outcome = { ok: false, fileId: file.id };
            failureMessage = safeMessage;
        }

        // Deliberately OUTSIDE the try/catch above (C12): a throw from
        // `onFile` must never be recorded as an extraction failure for a
        // file that actually succeeded (or double-recorded for one that
        // didn't). Also deliberately swallowed rather than left to propagate:
        // `extractOne` runs inside `Promise.all`, so an uncaught throw here
        // would reject the whole concurrency chunk and take every file in it
        // down with it over a bug in a caller-supplied progress callback.
        try {
            onFile?.({
                fileName: file.originalFilename,
                accountCount: progress.accountCount,
                statementDate: progress.statementDate,
                error: failureMessage,
            });
        } catch (callbackErr) {
            console.error(
                `[import-extract] onFile callback threw for file ${file.id}:`,
                callbackErr instanceof Error ? callbackErr.message : callbackErr,
            );
        }

        return outcome;
    };

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
        // Checked only at a chunk boundary, and only to stop starting NEW
        // work — never mid-chunk, and never by rejecting the in-flight
        // Promise.all below (see the `signal` doc comment on RunExtractionArgs).
        if (signal?.aborted) break;
        const chunk = pending.slice(i, i + CONCURRENCY);
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
            // `payload` and `assemble` are deliberately dropped here, as
            // before (see the "Nothing new to read" comment above) — but `chat`
            // (Task 6+'s statement-chat slice) did NOT exist when that
            // wholesale-replace write was first added, and dropping it is
            // NOT deliberate: it silently reverts a chat-surface import to
            // the ordinary wizard the moment extraction re-runs (C11). Carry
            // it forward when present; a wizard import has none, so its
            // persisted value stays byte-identical.
            payloadJson: { fileResults, ...(priorPayload.chat ? { chat: priorPayload.chat } : {}) },
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
