// src/lib/presentations/pages/life-insurance-summary/view-model.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { LiPolicyRow } from "@/lib/insurance-policies/load-li-inventory";
import {
  inventoryTotals,
  coverageForDecedent,
  isInForce,
  gapFor,
  type InventoryTotals,
  type Gap,
} from "./aggregate";
import type { LifeInsuranceSummaryOptions, LiSolved } from "./options-schema";
import { buildLifeInsuranceNarrative } from "./narrative";
import { roundUpTo50k } from "@/lib/life-insurance/round";

export interface DecedentGap {
  decedentLabel: string;
  have: number;
  need: number;
  gap: Gap;
  exceedsCap: boolean;
  hasJoint: boolean;
}

export interface RangePolicy { name: string; faceValue: number }
export interface RangeBound { need: number; exceedsCap: boolean }
export interface DecedentRange {
  decedentLabel: string;
  deathYear: number;
  /** Lower bound from the straight-line curve at deathYear; null when the
   *  clipped curve has no row there (card renders MC-only). Rounded up to $50k. */
  straightLine: RangeBound | null;
  /** Upper bound from the MC solve. Rounded up to $50k. */
  mc: RangeBound & { achievedScorePct: number };
  /** null → "Estate taxes" line hidden (toggle off, or legacy payload). */
  estateTaxAddend: number | null;
  existingTotal: number;
  existingPolicies: RangePolicy[];
  /** need + existing per bound, re-rounded; null when either bound exceeds cap. */
  totalRecommended: { low: number; high: number } | null;
  hasJoint: boolean;
}

// Solver cap — display detection only; the engine saturates at this bound.
const LI_CAP = 20_000_000;

function buildRange(args: {
  decedentLabel: string;
  decedent: "client" | "spouse";
  deathYear: number;
  /** Curve value at deathYear; null when the row is absent. */
  curveNeed: number | null;
  mc: NonNullable<LiSolved["mcSpouse"]>;
  estateTaxAddend: number | null;
  policies: LiPolicyRow[];
  coverage: { total: number; hasJoint: boolean };
}): DecedentRange {
  const { decedentLabel, decedent, deathYear, curveNeed, mc, estateTaxAddend, policies, coverage } = args;

  const existingPolicies: RangePolicy[] = policies
    .filter((p) => isInForce(p, deathYear) && p.insuredPerson === decedent)
    .map((p) => ({ name: p.name, faceValue: p.deathBenefit }));

  const straightLine: RangeBound | null =
    curveNeed == null
      ? null
      : { need: roundUpTo50k(curveNeed), exceedsCap: curveNeed >= LI_CAP };

  const mcBound = {
    need: roundUpTo50k(mc.faceValue),
    exceedsCap: mc.status === "exceeds-cap",
    achievedScorePct: Math.round(mc.achievedScore * 1000) / 10,
  };

  const anyCap = mcBound.exceedsCap || (straightLine?.exceedsCap ?? false);
  const totalRecommended = anyCap
    ? null
    : {
        low: roundUpTo50k((straightLine?.need ?? mcBound.need) + coverage.total),
        high: roundUpTo50k(mcBound.need + coverage.total),
      };

  return {
    decedentLabel, deathYear, straightLine, mc: mcBound, estateTaxAddend,
    existingTotal: coverage.total, existingPolicies, totalRecommended,
    hasJoint: coverage.hasJoint,
  };
}
export interface LiChartRow {
  year: number;
  clientNeed: number;
  spouseNeed: number | null;
}
export interface LiChart {
  rows: LiChartRow[];
  /** Year the MC point is marked at (the solved death year). */
  markYear: number | null;
  clientCoverageLine: number;
  spouseCoverageLine: number | null;
}

// Trim the need curve to the span that actually has a need — first year with a
// positive client or spouse need through the last such year. Drops the flat $0
// runs before/after so the chart shows only the meaningful window. Returns []
// when there's never a need (chart renders its empty state).
function clipToNeedWindow(rows: LiChartRow[]): LiChartRow[] {
  const hasNeed = (r: LiChartRow) => r.clientNeed > 0 || (r.spouseNeed ?? 0) > 0;
  const first = rows.findIndex(hasNeed);
  if (first === -1) return [];
  let last = first;
  for (let i = rows.length - 1; i > first; i--) {
    if (hasNeed(rows[i])) { last = i; break; }
  }
  return rows.slice(first, last + 1);
}
export interface LifeInsuranceSummaryPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  /** Inventory exists but no solve payload — page 2 shows a "run the solver" hint. */
  notSolved: boolean;
  married: boolean;
  totals: InventoryTotals;
  policies: LiPolicyRow[];
  clientGap: DecedentGap | null;
  spouseGap: DecedentGap | null;
  clientRange: DecedentRange | null;
  spouseRange: DecedentRange | null;
  chart: LiChart;
  jointFootnote: boolean;
  narrative: string[];
}

function isMarried(ctx: BuildDataContext): boolean {
  const fs = ctx.clientData.client.filingStatus;
  return (fs === "married_joint" || fs === "married_separate") && Boolean(ctx.spouseName);
}

function gapFromMc(
  decedentLabel: string,
  have: number,
  mc: LiSolved["mcClient"],
  hasJoint: boolean,
): DecedentGap {
  // `need` is TOTAL RECOMMENDED coverage (rounded additional MC need + existing
  // in force) — comparing `have` against the additional need alone produced a
  // false "surplus" whenever coverage exceeded the additional need.
  const recommended = roundUpTo50k(mc.faceValue) + have;
  return {
    decedentLabel,
    have,
    need: recommended,
    gap: gapFor(have, recommended),
    exceedsCap: mc.status === "exceeds-cap",
    hasJoint,
  };
}

export function buildLifeInsuranceSummaryData(
  ctx: BuildDataContext,
  options: LifeInsuranceSummaryOptions,
): LifeInsuranceSummaryPageData {
  const inventory = ctx.lifeInsurance ?? { policies: [] };
  const policies = inventory.policies;
  const solved = options.solved;
  const married = isMarried(ctx);

  const totals = inventoryTotals(policies);
  const isEmpty = policies.length === 0 && solved == null;
  const notSolved = solved == null;

  // Compare coverage as of the solved death year (so expired term is dropped to
  // match the engine's need), falling back to the current plan year for the
  // not-yet-solved inventory view.
  const asOfYear = solved?.assumptions.deathYear ?? ctx.clientData.planSettings.planStartYear;
  const clientCov = coverageForDecedent(policies, "client", asOfYear);
  const spouseCov = coverageForDecedent(policies, "spouse", asOfYear);
  const jointFootnote = policies.some((p) => p.insuredPerson === "joint" && isInForce(p, asOfYear));

  const clientGap =
    solved != null
      ? gapFromMc(ctx.clientName, clientCov.total, solved.mcClient, clientCov.hasJoint)
      : null;
  const spouseGap =
    solved != null && married && solved.mcSpouse != null
      ? gapFromMc(ctx.spouseName ?? "Spouse", spouseCov.total, solved.mcSpouse, spouseCov.hasJoint)
      : null;

  const deathYear = solved?.assumptions.deathYear ?? null;
  const curveAt = (year: number) => solved?.curveRows.find((r) => r.year === year) ?? null;

  const clientRange =
    solved != null && deathYear != null
      ? buildRange({
          decedentLabel: ctx.clientName,
          decedent: "client",
          deathYear,
          curveNeed: curveAt(deathYear)?.clientNeed ?? null,
          mc: solved.mcClient,
          estateTaxAddend: solved.estateTaxAddendClient,
          policies,
          coverage: clientCov,
        })
      : null;
  const spouseRange =
    solved != null && deathYear != null && married && solved.mcSpouse != null
      ? buildRange({
          decedentLabel: ctx.spouseName ?? "Spouse",
          decedent: "spouse",
          deathYear,
          curveNeed: curveAt(deathYear)?.spouseNeed ?? null,
          mc: solved.mcSpouse,
          estateTaxAddend: solved.estateTaxAddendSpouse,
          policies,
          coverage: spouseCov,
        })
      : null;

  const chart: LiChart = {
    rows: clipToNeedWindow(
      solved?.curveRows.map((r) => ({
        year: r.year,
        clientNeed: r.clientNeed,
        spouseNeed: married ? r.spouseNeed : null,
      })) ?? [],
    ),
    markYear: solved?.assumptions.deathYear ?? null,
    clientCoverageLine: clientCov.total,
    spouseCoverageLine: married ? spouseCov.total : null,
  };

  const subtitle = solved
    ? `Solved for death in ${solved.assumptions.deathYear} · proceeds → ${solved.assumptions.modelPortfolioLabel} · ${Math.round(solved.assumptions.mcTargetScore * 100)}% MC target`
    : `In-force coverage · ${ctx.scenarioLabel}`;

  const narrative = buildLifeInsuranceNarrative({
    totalDeathBenefit: totals.deathBenefit,
    policyCount: totals.count,
    clientGap,
    spouseGap,
    notSolved,
    jointFootnote,
  });

  return {
    title: "Life Insurance Summary",
    subtitle,
    isEmpty,
    notSolved,
    married,
    totals,
    policies,
    clientGap,
    spouseGap,
    clientRange,
    spouseRange,
    chart,
    jointFootnote,
    narrative,
  };
}
