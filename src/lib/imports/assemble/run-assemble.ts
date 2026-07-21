import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { ExtractionResult } from "@/lib/extraction/types";
import { runMatchingPass } from "@/lib/imports/match";
import type { ImportPayload } from "@/lib/imports/types";
import { fillAssumptions } from "./gap-fill";
import { mergeAcrossFiles } from "./merge-across-files";
import { derivePlanBasics } from "./plan-basics";
import { generateQuestions } from "./questions";
import type { AssemblePlanBasics, AssembleState } from "./types";

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
    spouseRetirementAge?: number | null;
    spouseLifeExpectancy?: number | null;
    spouseDob?: string;
  };
  /** Whether this household has a spouse — drives the plan-basics spouse fields. */
  hasSpouse: boolean;
  /**
   * Latest stored tax return, read by the caller (the route, after
   * authorization) and passed in so this stays a pure orchestration step.
   * Best-effort: a failed read degrades to `null`, never fails assemble.
   */
  taxReturn?: { taxYear: number; agi: number | null; totalTax: number | null } | null;
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
  const { importId, clientId, firmId, mode, scenarioId, fileResults, known, hasSpouse, taxReturn } = args;

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

  // retirementAge/lifeExpectancy are the two anchors derivePlanBasics always
  // needs (its ageProvenance fields are never blank). In production the
  // route always supplies both off the client row (NOT NULL columns); only
  // a caller that genuinely doesn't know them yet skips plan-basics rather
  // than fabricating an anchor value.
  let planBasics: AssemblePlanBasics | undefined;
  if (known?.retirementAge != null && known?.lifeExpectancy != null) {
    planBasics = derivePlanBasics({
      payload: annotated,
      known: {
        retirementAge: known.retirementAge,
        lifeExpectancy: known.lifeExpectancy,
        spouseRetirementAge: known.spouseRetirementAge,
        spouseLifeExpectancy: known.spouseLifeExpectancy,
        primaryDob: known.primaryDob,
        spouseDob: known.spouseDob,
        hasSpouse,
      },
      mode: mode === "new" ? "new" : "refresh",
      taxReturn: taxReturn ?? null,
    });
  }

  const assemble: AssembleState = { version: 1, mergedFileCount, assumptions, questions, planBasics };

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
