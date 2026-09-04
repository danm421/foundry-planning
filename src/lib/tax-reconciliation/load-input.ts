import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientDeductions, scenarios } from "@/db/schema";
import { runProjectionWithEvents } from "@/engine";
import { ClientNotFoundError, ProjectionInputError } from "@/lib/projection/load-client-data";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { parseRowFacts } from "@/lib/tax-returns/db";
import { loadDocumentContext } from "@/lib/tax-returns/assemble-analysis";
import { loadAnalysisContext } from "@/lib/tax-returns/load-analysis-context";
import { runCalc } from "@/lib/tax-analysis/adapter";
import { listDismissedIds } from "./dismissals-store";
import { snapshotFromTree } from "./snapshot";
import type { EngineYear, PlanDeduction, Reconciliation, ReconciliationInput } from "./types";

export const PROJECTION_FAILED_NOTE = "The plan's projection couldn't run, so only direct row comparisons are shown.";

export interface LoadedInput {
  ok: true; taxReturnId: string; status: Reconciliation["status"]; input: ReconciliationInput;
  dismissedIds: Set<string>; dismissalsUnavailable: boolean; notes: string[];
}
export interface LoadFailure { ok: false; code: "not_found" | "facts_unreadable" | "no_plan"; message: string }

async function loadBaseDeductions(clientId: string): Promise<PlanDeduction[]> {
  const [base] = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!base) return [];
  const rows = await db.select().from(clientDeductions).where(and(eq(clientDeductions.clientId, clientId), eq(clientDeductions.scenarioId, base.id)));
  return rows.map((d) => ({ id: d.id, type: d.type, name: d.name, annualAmount: parseFloat(d.annualAmount), growthRate: parseFloat(d.growthRate), startYear: d.startYear, endYear: d.endYear }));
}

export async function loadReconciliationInput(clientId: string, firmId: string, taxYear: number): Promise<LoadedInput | LoadFailure> {
  const row = await getTaxReturn(clientId, taxYear);
  if (!row) return { ok: false, code: "not_found", message: `No ${taxYear} return on file.` };
  const { facts } = parseRowFacts(row);
  if (!facts) {
    // Two very different situations reach here and only the message can tell them apart.
    // `facts` stays null until extraction finishes, and `status` defaults to "extracting",
    // so the COMMON case is a healthy return uploaded moments ago. Telling that advisor to
    // go recover it would send them hunting a fault that does not exist.
    return {
      ok: false, code: "facts_unreadable",
      message: row.status === "extracting"
        ? `The ${taxYear} return is still being read. Check back in a moment.`
        : `The ${taxYear} return's facts couldn't be read. Open it on Tax Analysis to recover it.`,
    };
  }

  let tree;
  try {
    ({ effectiveTree: tree } = await loadEffectiveTree(clientId, firmId, "base", {}));
  } catch (err) {
    if (err instanceof ProjectionInputError || err instanceof ClientNotFoundError) {
      return { ok: false, code: "no_plan", message: "This household has no base-case plan to compare against yet." };
    }
    throw err;
  }

  const [docs, deductions, dismissals, ctx] = await Promise.all([
    loadDocumentContext(row.id), loadBaseDeductions(clientId), listDismissedIds(row.id), loadAnalysisContext(clientId, taxYear),
  ]);
  const plan = snapshotFromTree(tree, deductions);
  const { planStartYear, planEndYear } = plan.planSettings;
  // Never earlier than the plan's first year: a return filed before the plan begins has no
  // projected year of its own, so the nearest year the plan actually models stands in for it.
  // The consequence, which `build.ts`'s deflation note relies on, is planYear >= taxYear always.
  const planYear = taxYear >= planStartYear ? taxYear : planStartYear;

  const notes: string[] = [];
  let engineYear: EngineYear | null = null;
  if (planYear > planEndYear) {
    notes.push(`The plan ends in ${planEndYear}, before the ${taxYear} return's year, so only direct row comparisons are shown.`);
  } else {
    try {
      engineYear = runProjectionWithEvents(tree).years.find((y) => y.year === planYear) ?? null;
      if (!engineYear) notes.push(PROJECTION_FAILED_NOTE);
    } catch (err) {
      console.warn("plan-vs-return: projection failed, degrading to row-level rules", err);
      notes.push(PROJECTION_FAILED_NOTE);
    }
  }

  // `runCalc` returns null when the return's filing status is unknown — it will not guess a
  // bracket. Both estimates then read 0, which is what every consuming rule treats as "unknown".
  const calc = runCalc(facts, { taxParams: ctx.resolver.getYear(taxYear).params, primaryAge: ctx.primaryAge, spouseAge: ctx.spouseAge });
  const w2s = docs.summaries.filter((d) => d.role === "w2").flatMap((d) => d.w2s);

  return {
    ok: true, taxReturnId: row.id, status: row.status,
    input: {
      clientId, taxYear, planYear, facts, w2s, plan, engineYear,
      stateTaxEstimate: calc?.flow.stateTax ?? 0,
      // Line 24 excludes payroll tax, so without this the spending rule would count the
      // household's Social Security and Medicare withholding as money left to spend.
      ficaEstimate: calc?.flow.fica ?? 0,
    },
    dismissedIds: dismissals.ok ? dismissals.ids : new Set(),
    dismissalsUnavailable: !dismissals.ok,
    notes,
  };
}
