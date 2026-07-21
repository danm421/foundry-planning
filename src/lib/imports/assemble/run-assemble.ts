import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { ExtractionResult } from "@/lib/extraction/types";
import { runMatchingPass } from "@/lib/imports/match";
import type { ImportPayload } from "@/lib/imports/types";
import { fillAssumptions } from "./gap-fill";
import { mergeAcrossFiles } from "./merge-across-files";
import { generateQuestions } from "./questions";
import type { AssembleState } from "./types";

export interface RunAssembleArgs {
  importId: string;
  clientId: string;
  firmId: string;
  mode: "new" | "existing";
  scenarioId: string;
  fileResults: Record<string, ExtractionResult>;
  known?: {
    retirementAge?: number;
    lifeExpectancy?: number;
    filingStatus?: string;
    primaryDob?: string;
  };
}

export interface RunAssembleResult {
  assemble: AssembleState;
  questionCount: number;
  rowCount: number;
}

function countRows(payload: ImportPayload): number {
  return (
    payload.accounts.length +
    payload.incomes.length +
    payload.expenses.length +
    payload.liabilities.length +
    payload.dependents.length +
    payload.lifePolicies.length +
    payload.wills.length +
    payload.entities.length
  );
}

/**
 * The Forge Plan Builder's assemble orchestrator: merges every uploaded
 * file's extraction into one payload, gap-fills the defaults a new
 * prospect needs, runs the existing match pass so rows carry
 * exact/fuzzy/new annotations, derives the advisor-facing question list,
 * and persists both the annotated payload and the assemble state onto the
 * import row. Mirrors `runImportMatching` (`run-matching.ts`) but adds the
 * gap-fill + question steps and writes `payloadJson.assemble` instead of
 * returning match counts.
 */
export async function runAssemble(args: RunAssembleArgs): Promise<RunAssembleResult> {
  const { importId, clientId, firmId, mode, scenarioId, fileResults, known } = args;

  const { payload, mergedFileCount } = mergeAcrossFiles(fileResults);
  const { assumptions } = fillAssumptions({ payload, mode, known });

  const annotated = await runMatchingPass({
    payload,
    clientId,
    scenarioId,
    mode: mode === "existing" ? "updating" : "onboarding",
  });

  const questions = generateQuestions({
    payload: annotated,
    assumptions,
    mode,
    primaryDobKnown: Boolean(known?.primaryDob || annotated.primary?.dateOfBirth),
  });

  const assemble: AssembleState = { version: 1, mergedFileCount, assumptions, questions };

  await db
    .update(clientImports)
    .set({
      payloadJson: { fileResults, payload: annotated, assemble },
      updatedAt: new Date(),
    })
    .where(eq(clientImports.id, importId));

  await recordAudit({
    action: "import.assemble.run",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { mode, questionCount: questions.length },
  });

  return { assemble, questionCount: questions.length, rowCount: countRows(annotated) };
}
