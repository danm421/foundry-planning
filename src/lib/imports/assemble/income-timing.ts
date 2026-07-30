import { defaultIncomeRefs, YEAR_REF_LABELS, type YearRef } from "@/lib/milestones";
import type { ImportPayload } from "../types";

/** One rewrite of a document-stated timing ref, for the advisor-facing chip. */
export interface TimingNormalization {
  incomeName: string;
  statedRef: YearRef;
  appliedRef: YearRef;
  reason: string;
}

/**
 * Refs that are NOT a plausible place for earned income to stop. Real planning
 * exports routinely carry these on salary rows - a data-entry slip that models
 * someone drawing a paycheck at 95. We rewrite them to the owner's retirement
 * and surface what the document said.
 */
const IMPLAUSIBLE_EARNING_STOPS: ReadonlySet<YearRef> = new Set([
  "client_end",
  "spouse_end",
  "plan_end",
]);

/** Income types that represent earned income and therefore stop at retirement. */
const EARNED_TYPES: ReadonlySet<string> = new Set(["salary", "business"]);

/**
 * Apply Foundry's timing conventions to extracted income rows.
 *
 * Two rules, in order:
 *   1. A row with no end ref gets `defaultIncomeRefs(type, owner)` - the same
 *      convention the manual editor and quick-start already use. This is why
 *      an imported salary now stops at retirement instead of running to
 *      `currentYear + 30`.
 *   2. An EARNED-income row whose stated end ref is a death/plan-end anchor is
 *      rewritten to the owner's retirement, and the rewrite is reported.
 *
 * Pure and deterministic: no Date.now, no Math.random, no IO. Returns a new
 * payload; the input is never mutated.
 */
export function applyIncomeTimingDefaults(payload: ImportPayload): {
  payload: ImportPayload;
  normalized: TimingNormalization[];
} {
  const normalized: TimingNormalization[] = [];

  const incomes = payload.incomes.map((row) => {
    const owner = row.owner ?? "client";
    const type = row.type ?? "other";
    const defaults = defaultIncomeRefs(type, owner);

    // Rule 2: an implausible earning stop on earned income.
    let current = row;
    if (
      row.endYearRef &&
      EARNED_TYPES.has(type) &&
      IMPLAUSIBLE_EARNING_STOPS.has(row.endYearRef) &&
      defaults.endYearRef
    ) {
      const who = owner === "spouse" ? "the spouse" : "the client";
      normalized.push({
        incomeName: row.name,
        statedRef: row.endYearRef,
        appliedRef: defaults.endYearRef,
        reason:
          `Ends at ${who}'s retirement. The document ended this earned income at ` +
          `${YEAR_REF_LABELS[row.endYearRef]}, which appears to be a data-entry error.`,
      });
      // Drop the concrete year too: it was resolved from the wrong anchor and
      // would otherwise win over the ref in resolveImportTiming.
      const { endYear: _dropped, ...rest } = row;
      current = { ...rest, endYearRef: defaults.endYearRef };
    }

    // Rule 1: fill in what extraction left blank. An explicit year with no ref
    // is a deliberate manual date - leave it alone. Runs even when Rule 2 fired
    // above, so a row rewritten by Rule 2 still gets a blank start ref filled;
    // it no-ops on endYearRef since Rule 2 already set one.
    const next = { ...current };
    if (next.startYearRef === undefined && next.startYear === undefined) {
      next.startYearRef = defaults.startYearRef ?? undefined;
    }
    if (next.endYearRef === undefined && next.endYear === undefined) {
      next.endYearRef = defaults.endYearRef ?? undefined;
    }
    return next;
  });

  return { payload: { ...payload, incomes, warnings: [...payload.warnings] }, normalized };
}
