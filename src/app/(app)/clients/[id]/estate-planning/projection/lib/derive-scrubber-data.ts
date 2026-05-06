/**
 * Pure transform from `(tree, leftResult, rightResult, scrubberYear)` into
 * a 3-cell comparison-grid data structure (`left` / `right` / `delta`).
 *
 * Uniform 4-row schema across all three cells:
 *   1. In-estate
 *   2. Out-of-estate
 *   3. Estate tax + admin
 *   4. Net to heirs
 *
 * The delta cell is right − left, signed. Pre-death (`scrubberYear <
 * finalDeathYear`) renders `$0 (pre-death)` in the tax row of plan cells and
 * `—` in the corresponding delta row. No React, DOM, fetch, or DB.
 */

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "@/lib/estate/in-estate-at-year";

export type RowSentiment = "neutral" | "pos" | "neg";

export type ComparisonRowLabel =
  | "In-estate"
  | "Out-of-estate"
  | "Estate tax + admin"
  | "Net to heirs";

export interface CellRow {
  label: ComparisonRowLabel;
  /** Signed numeric value used for delta math. NaN if pre-death sentinel. */
  signedValue: number;
  /** Human-formatted text for display. */
  valueText: string;
  sentiment: RowSentiment;
}

export interface ComparisonCell {
  variant: "plan" | "delta";
  /** Scenario name for display (the column header dropdown's current selection). */
  scenarioName: string;
  /** True for the synthetic Do-nothing counterfactual. */
  isDoNothing: boolean;
  headlineLabel: "Net to heirs" | "Net to heirs Δ";
  /** Big number; signed for the delta cell. */
  bigNumber: number;
  subLine: string;
  rows: CellRow[];
}

export interface ComparisonData {
  left: ComparisonCell;
  right: ComparisonCell;
  delta: ComparisonCell;
}

const ROW_LABELS: readonly ComparisonRowLabel[] = [
  "In-estate",
  "Out-of-estate",
  "Estate tax + admin",
  "Net to heirs",
] as const;

export function deriveComparisonData(args: {
  tree: ClientData;
  leftResult: ProjectionResult;
  leftScenarioName: string;
  leftIsDoNothing: boolean;
  rightResult: ProjectionResult;
  rightScenarioName: string;
  rightIsDoNothing: boolean;
  scrubberYear: number;
}): ComparisonData {
  const startYear = args.tree.planSettings.planStartYear;

  // Final death year drives pre-death gating. Use the right-side projection so
  // both columns share the same gating window even when left is the do-nothing
  // counterfactual.
  const finalDeathYear =
    args.rightResult.secondDeathEvent?.year ??
    args.rightResult.firstDeathEvent?.year ??
    Number.POSITIVE_INFINITY;
  const isPreDeath = args.scrubberYear < finalDeathYear;

  const leftRows = buildPlanRows({
    tree: args.tree,
    result: args.leftResult,
    scrubberYear: args.scrubberYear,
    startYear,
    finalDeathYear,
    isPreDeath,
  });
  const rightRows = buildPlanRows({
    tree: args.tree,
    result: args.rightResult,
    scrubberYear: args.scrubberYear,
    startYear,
    finalDeathYear,
    isPreDeath,
  });
  const deltaRows: CellRow[] = ROW_LABELS.map((label) => {
    const lr = leftRows.find((r) => r.label === label)!;
    const rr = rightRows.find((r) => r.label === label)!;
    if (Number.isNaN(lr.signedValue) || Number.isNaN(rr.signedValue)) {
      return {
        label,
        signedValue: NaN,
        valueText: "—",
        sentiment: "neutral",
      };
    }
    const value = rr.signedValue - lr.signedValue;
    return {
      label,
      signedValue: value,
      valueText: formatSignedM(value),
      sentiment: deltaSentiment(value),
    };
  });

  const leftNet = leftRows.find((r) => r.label === "Net to heirs")!.signedValue;
  const rightNet = rightRows.find((r) => r.label === "Net to heirs")!.signedValue;

  return {
    left: {
      variant: "plan",
      scenarioName: args.leftScenarioName,
      isDoNothing: args.leftIsDoNothing,
      headlineLabel: "Net to heirs",
      bigNumber: leftNet,
      subLine: `at ${args.scrubberYear}`,
      rows: leftRows,
    },
    right: {
      variant: "plan",
      scenarioName: args.rightScenarioName,
      isDoNothing: args.rightIsDoNothing,
      headlineLabel: "Net to heirs",
      bigNumber: rightNet,
      subLine: `at ${args.scrubberYear}`,
      rows: rightRows,
    },
    delta: {
      variant: "delta",
      scenarioName: "Δ Difference",
      isDoNothing: false,
      headlineLabel: "Net to heirs Δ",
      bigNumber: rightNet - leftNet,
      subLine: isPreDeath ? "—" : `at ${args.scrubberYear}`,
      rows: deltaRows,
    },
  };
}

// ---- helpers --------------------------------------------------------------

function buildPlanRows(args: {
  tree: ClientData;
  result: ProjectionResult;
  scrubberYear: number;
  startYear: number;
  finalDeathYear: number;
  isPreDeath: boolean;
}): CellRow[] {
  const inE = sumInOutAtYear(
    args.tree,
    args.result,
    args.scrubberYear,
    args.startYear,
    "in",
  );
  const outE = sumInOutAtYear(
    args.tree,
    args.result,
    args.scrubberYear,
    args.startYear,
    "out",
  );

  const py = Number.isFinite(args.finalDeathYear)
    ? args.result.years[args.finalDeathYear - args.startYear]
    : undefined;
  const tax = py?.estateTax?.totalEstateTax ?? 0;
  const admin = py?.estateTax?.estateAdminExpenses ?? 0;
  const taxPlusAdmin = tax + admin;
  const net = inE + outE - taxPlusAdmin;

  return [
    {
      label: "In-estate",
      signedValue: inE,
      valueText: formatM(inE),
      sentiment: "neutral",
    },
    {
      label: "Out-of-estate",
      signedValue: outE,
      valueText: formatM(outE),
      sentiment: "pos",
    },
    {
      label: "Estate tax + admin",
      signedValue: args.isPreDeath ? NaN : -taxPlusAdmin,
      valueText: args.isPreDeath ? "$0 (pre-death)" : `−${formatM(taxPlusAdmin)}`,
      sentiment: "neg",
    },
    {
      label: "Net to heirs",
      // Pre-death: report inE + outE (no tax yet) as the meaningful net.
      signedValue: args.isPreDeath ? inE + outE : net,
      valueText: formatM(args.isPreDeath ? inE + outE : net),
      sentiment: "neutral",
    },
  ];
}

function sumInOutAtYear(
  tree: ClientData,
  result: ProjectionResult,
  year: number,
  startYear: number,
  mode: "in" | "out",
): number {
  const yearIdx = year - startYear;
  const py = result.years[yearIdx];
  if (!py) return 0;
  const accountBalances = buildAccountBalances(py);
  const fn = mode === "in" ? computeInEstateAtYear : computeOutOfEstateAtYear;
  return fn({
    tree,
    giftEvents: tree.giftEvents ?? [],
    year,
    projectionStartYear: startYear,
    accountBalances,
  });
}

function buildAccountBalances(py: ProjectionYear): Map<string, number> {
  const balances = new Map<string, number>();
  for (const [accountId, ledger] of Object.entries(py.accountLedgers ?? {})) {
    balances.set(accountId, ledger.endingValue);
  }
  return balances;
}

function deltaSentiment(v: number): RowSentiment {
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "neutral";
}

function formatM(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function formatSignedM(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) body = `$${(abs / 1_000).toFixed(0)}K`;
  else body = `$${Math.round(abs).toLocaleString()}`;
  return n > 0 ? `+${body}` : `−${body}`;
}
