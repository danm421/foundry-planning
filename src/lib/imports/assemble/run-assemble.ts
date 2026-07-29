import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { ExtractionResult } from "@/lib/extraction/types";
import { runMatchingPass } from "@/lib/imports/match";
import { applyDecisions } from "@/lib/imports/planner/apply-decisions";
import { runPlanner } from "@/lib/imports/planner/run-planner";
import type { ImportPayload } from "@/lib/imports/types";
import { fillAssumptions } from "./gap-fill";
import { deriveGoals } from "./goals";
import { applyIncomeTimingDefaults } from "./income-timing";
import { mergeAcrossFiles } from "./merge-across-files";
import { derivePlanBasics } from "./plan-basics";
import { generateQuestions } from "./questions";
import type { AssemblePlanBasics, AssembleQuestion, AssembleState } from "./types";

/**
 * Task 17's real export — until then, a stub. `estimate_ss_pia` (the
 * planner's tool, see `planner/tools.ts`) always returns 0. Task 16 builds
 * the underlying Social Security PIA estimator and Task 17 wires it in
 * here. A zero-argument function is assignable to
 * `(input: EstimatePiaToolInput) => number` (TS allows fewer params on the
 * source side), so this typechecks as-is.
 */
const makePiaEstimator = () => () => 0;

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
  /**
   * The source document's full text and per-page text, used to run the
   * planning reasoner (Task 13/14) opportunistically. Optional: no caller
   * passes these explicitly in production - the route stays unmodified (R3)
   * - so when absent, `deriveDocumentTextFromFileResults` below sources them
   * from `fileResults` instead, now that `ExtractionResult` carries its own
   * already-redacted `text`/`pages` (extract.ts R2). When BOTH an explicit
   * value and `fileResults` would yield text, the explicit value wins (Task
   * 19's fixture harness and this file's own tests rely on that). Only when
   * no file yields any text does assemble stay on the deterministic path
   * this file always ran.
   */
  documentText?: string;
  pages?: string[];
  /** Injected in tests. Defaults to the real `runPlanner`. */
  runPlannerFn?: typeof runPlanner;
}

export interface RunAssembleResult {
  assemble: AssembleState;
  questionCount: number;
  rowCount: number;
}

/**
 * R3: `runAssemble` already takes `fileResults`, and (per extract.ts's R2
 * change) an `ExtractionResult` now carries its own already-SSN-redacted
 * `text` (single-pass) or `pages` (multi-pass) - never both, see the
 * comments at extract.ts's two return sites. This derives the planner's
 * `documentText`/`pages` inputs from what the caller already has, so the
 * route needs NO change; it's only consulted when the caller didn't inject
 * `documentText` explicitly (Task 19's fixture harness, and this file's own
 * tests, still take precedence via `args.documentText`).
 *
 * Iterates `Object.entries(fileResults)` in the SAME order `mergeAcrossFiles`
 * uses (merge-across-files.ts:260) - determinism is a plan Global Constraint.
 * Per file: text is `r.text ?? r.pages?.join("\n")`; pages are `r.pages ??
 * (r.text ? [r.text] : [])`, which recovers whichever form extract.ts didn't
 * persist for that file. An import can hold multiple files: pages flatten
 * into one array in file order, and text joins per-file with a
 * `=== <fileName> ===` separator so the planner can tell files apart. If no
 * file yields any text, both come back undefined so the caller's
 * `if (documentText)` guard stays false and the planner is skipped - the
 * degrade-to-deterministic path must survive.
 */
function deriveDocumentTextFromFileResults(
  fileResults: Record<string, ExtractionResult>,
): { documentText?: string; pages?: string[] } {
  const sections: string[] = [];
  const pages: string[] = [];

  for (const [, r] of Object.entries(fileResults)) {
    const text = r.text ?? r.pages?.join("\n");
    const filePages = r.pages ?? (r.text ? [r.text] : []);
    if (text) {
      sections.push(`=== ${r.fileName} ===\n${text}`);
    }
    pages.push(...filePages);
  }

  if (sections.length === 0) return {};
  return { documentText: sections.join("\n\n"), pages };
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
    payload.entities.length +
    payload.savings.length +
    // Goals are ROWS, not derived views of the accounts that seeded them:
    // `commitGoals` writes one `expenses` row per education goal
    // (commit/goals.ts:128,159) and one `assetTransactions` row per home
    // purchase (:226,254). So a 529 account and its education goal are two
    // distinct committed records, and counting both is not double-counting.
    //
    // Optional because `goals` only rides on the payload from assemble onward
    // (set at :190 below); `annotated` never carries it.
    //
    // Without these two terms the count was asymmetric in a way that made R4's
    // "counts planner-added rows" only half-true: a planner goal decision of
    // kind "one_time"/"recurring" becomes an `expenses` row and WAS counted
    // (apply-decisions.ts buildExpenseRow), while kind "education" becomes a
    // `goals.education` entry and was INVISIBLE here (deriveEducationGoal).
    (payload.goals?.education.length ?? 0) +
    (payload.goals?.homePurchases.length ?? 0)
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
  const { payload: timedPayload, normalized: timingNormalizations } =
    applyIncomeTimingDefaults(payload);
  for (const n of timingNormalizations) {
    timedPayload.warnings.push(`${n.incomeName}: ${n.reason}`);
  }
  const { assumptions } = fillAssumptions({ payload: timedPayload, mode, known });

  const annotated = await runMatchingPass({
    payload: timedPayload,
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

  // Goals derive from the annotated payload alone — a 529 plus the dependent
  // roster — so unlike planBasics they need no `known` anchors and always run.
  const goals = deriveGoals({ payload: annotated });

  // The planner refines what the deterministic steps derived. It is
  // opportunistic: no document text, a timeout, or an outage all leave the
  // assembled payload exactly as the deterministic path built it.
  //
  // `args.documentText` still wins when a caller supplies it directly (Task
  // 19's fixture harness, and this file's own tests). No caller does that in
  // production — the route stays unmodified (R3) — so the fallback below
  // derives it from `fileResults`, which now carries each file's own
  // already-redacted `text`/`pages` (extract.ts R2). Only when NEITHER an
  // explicit value nor any file yields text does this branch stay skipped.
  let plannerQuestions: AssembleQuestion[] = [];
  let plannerNotes: string[] = [];
  let plannerPayload: ImportPayload = { ...annotated, ...(planBasics ? { planBasics } : {}), goals };

  const derived = args.documentText ? null : deriveDocumentTextFromFileResults(fileResults);
  const documentText = args.documentText ?? derived?.documentText;
  const plannerPages = args.documentText ? args.pages : derived?.pages;

  if (documentText) {
    const plan = args.runPlannerFn ?? runPlanner;
    const decisions = await plan({
      documentText,
      pages: plannerPages ?? [documentText],
      payload: plannerPayload,
      estimatePia: makePiaEstimator(),
    }).catch(() => null);

    if (decisions) {
      const applied = applyDecisions({
        payload: plannerPayload,
        decisions,
        known: {
          primaryDob: known?.primaryDob,
          spouseDob: known?.spouseDob,
          hasSpouse,
        },
      });
      plannerPayload = applied.payload;
      plannerQuestions = applied.questions;
      plannerNotes = applied.notes;
    }
  }

  // Merge the planner's proposed questions into the deterministic list,
  // de-duplicating by id — the deterministic question wins any collision,
  // since it already reflects real evidence (a merge conflict, a known
  // gap) rather than the planner's read of the same field.
  const deterministicIds = new Set(questions.map((q) => q.id));
  const allQuestions: AssembleQuestion[] = [
    ...questions,
    ...plannerQuestions.filter((q) => !deterministicIds.has(q.id)),
  ];

  const assemble: AssembleState = {
    version: 1,
    mergedFileCount,
    assumptions,
    questions: allQuestions,
    notes: plannerNotes,
  };

  // planBasics is seeded onto the payload only, not onto `assemble` — the
  // review wizard reads `payload`, not `assemble` (and so does
  // commitPlanBasics, via buildLatestPayload's round-trip back through the
  // PATCH route). `assemble` has no reader for this field, so it isn't
  // duplicated there. `goals` follows the identical path. `plannerPayload`
  // already carries both (seeded above, and refined by `applyDecisions`
  // when the planner ran), so it stands in for the old inline object here.
  const assembledPayload: ImportPayload = plannerPayload;

  await db
    .update(clientImports)
    .set({
      payloadJson: { fileResults, payload: assembledPayload, assemble },
      updatedAt: new Date(),
    })
    .where(eq(clientImports.id, importId));

  await recordAudit({
    action: "import.assemble.run",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { mode, questionCount: allQuestions.length },
  });

  // R4: count rows on `assembledPayload` (== `plannerPayload`), not
  // `annotated` — `applyDecisions` can add rows (Rule 2 savings, Rule 4
  // "other" expenses from non-education goals) that `annotated` never sees.
  // Deferred from Task 15 only because the planner was dormant there.
  //
  // ⚠️ Do NOT justify this by a user-facing row-count summary: there isn't
  // one. `rowCount` is returned by the assemble route and read by NOTHING,
  // and it is not persisted (no column — the DB write above stores only
  // `payloadJson`). An earlier revision of this comment claimed a wizard
  // summary that does not exist. This is kept correct so the field is honest
  // whenever a consumer does appear, not because anything renders it today.
  return { assemble, questionCount: allQuestions.length, rowCount: countRows(assembledPayload) };
}
