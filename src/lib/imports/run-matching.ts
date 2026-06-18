import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { ExtractionResult } from "@/lib/extraction/types";
import { mergeExtractionResults } from "@/lib/imports/merge";
import { runMatchingPass } from "@/lib/imports/match";
import type { ImportPayload, MatchKind } from "@/lib/imports/types";

export interface RunMatchingResult {
    exact: number;
    fuzzy: number;
    new: number;
}

function countAnnotations(payload: ImportPayload): Record<MatchKind, number> {
    const counts: Record<MatchKind, number> = { exact: 0, fuzzy: 0, new: 0 };
    const arrays = [
        payload.accounts,
        payload.incomes,
        payload.expenses,
        payload.liabilities,
        payload.dependents,
        payload.lifePolicies,
        payload.wills,
        payload.entities,
    ];
    for (const arr of arrays) {
        for (const row of arr) {
            const kind = row.match?.kind;
            if (kind) counts[kind] += 1;
        }
    }
    return counts;
}

export async function runImportMatching(args: {
    importId: string;
    clientId: string;
    firmId: string;
    mode: "onboarding" | "updating";
    scenarioId: string | null;
    fileResults: Record<string, ExtractionResult>;
}): Promise<RunMatchingResult> {
    const { importId, clientId, firmId, mode, scenarioId, fileResults } = args;

    const fileExtractions = Object.entries(fileResults).map(
        ([fileId, result]) => ({ fileId, result }),
    );

    const merged = mergeExtractionResults(fileExtractions);
    const annotated = await runMatchingPass({
        payload: merged,
        clientId,
        scenarioId: scenarioId ?? "",
        mode,
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
            mode,
            ...counts,
        },
    });

    return counts;
}
