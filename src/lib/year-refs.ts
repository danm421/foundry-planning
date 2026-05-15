// src/lib/year-refs.ts
//
// Re-resolves milestone-anchored start/end years on every tree row that
// carries a `startYearRef` / `endYearRef`. The engine treats those refs as
// view-only metadata and reads only the concrete `startYear` / `endYear`
// numbers, so any tree mutation that moves a household milestone
// (retirement age, plan end age, dob) must run through this helper before
// projection — otherwise dependent salaries, retirement expenses, savings
// rules, etc. keep their pre-mutation year windows and the projection drifts
// from what the UI implies.
//
// Mirror of the inline `resolvedStart` / `resolvedEnd` closures in
// `lib/projection/load-client-data.ts`. Extracted so both the DB loader and
// the solver's `applyMutations` use the same resolution rules.

import type { ClientData } from "@/engine/types";
import { buildClientMilestones, resolveMilestone, type YearRef } from "./milestones";

type Position = "start" | "end";

function buildResolver(tree: ClientData) {
  const milestones = buildClientMilestones(
    tree.client,
    tree.planSettings.planStartYear,
    tree.planSettings.planEndYear,
  );
  return (ref: string | null | undefined, stored: number, pos: Position): number => {
    if (!ref) return stored;
    const r = resolveMilestone(ref as YearRef, milestones, pos);
    return r ?? stored;
  };
}

/**
 * Returns a shallow copy of `tree` with every row's `startYear` / `endYear`
 * reshifted from its `startYearRef` / `endYearRef`. Rows without refs are
 * preserved by-reference (no allocation). Rows with refs get a single
 * spread-copy with updated year fields. The original tree is not mutated.
 */
export function resolveRefYears(tree: ClientData): ClientData {
  const resolve = buildResolver(tree);

  const remapInOut = <T extends { startYear: number; endYear: number; startYearRef?: string | null; endYearRef?: string | null }>(
    row: T,
  ): T => {
    if (!row.startYearRef && !row.endYearRef) return row;
    const startYear = resolve(row.startYearRef, row.startYear, "start");
    const endYear = resolve(row.endYearRef, row.endYear, "end");
    if (startYear === row.startYear && endYear === row.endYear) return row;
    return { ...row, startYear, endYear };
  };

  const remapNullableEnd = <T extends { startYear: number; endYear?: number; startYearRef?: string | null; endYearRef?: string | null }>(
    row: T,
  ): T => {
    if (!row.startYearRef && !row.endYearRef) return row;
    const startYear = resolve(row.startYearRef, row.startYear, "start");
    // endYear is optional on transfers and roth conversions. When absent,
    // a ref still has nothing to anchor against, so we leave it undefined.
    const endYear =
      row.endYear == null
        ? row.endYear
        : resolve(row.endYearRef, row.endYear, "end");
    if (startYear === row.startYear && endYear === row.endYear) return row;
    return { ...row, startYear, endYear };
  };

  return {
    ...tree,
    incomes: tree.incomes.map(remapInOut),
    expenses: tree.expenses.map(remapInOut),
    savingsRules: tree.savingsRules.map(remapInOut),
    withdrawalStrategy: tree.withdrawalStrategy.map(remapInOut),
    transfers: tree.transfers?.map(remapNullableEnd),
    rothConversions: tree.rothConversions?.map(remapNullableEnd),
  };
}
