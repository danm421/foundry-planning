// "Roth or traditional?" — the same plan with every payroll deferral fully
// pre-tax, against the same plan with every one fully Roth.
//
// The spec asks for spendable retirement income against lifetime tax. Spendable
// retirement income needs the max-spend solve, which the spec itself phases into
// Phase 3, so this sheet prints the tax bill split three ways plus the plan's
// own average retirement spending. On a plan with a fixed spending row those two
// spending figures agree — and the sheet says so, rather than printing two equal
// numbers under a heading that promises a difference.

import { derivedKey } from "@/lib/presentations/derived-refs";
import { toTodaysDollars, type DeflationBasis } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { exactCurrency } from "@/lib/presentations/format";
import { earlyYearsSubtitle } from "../early-years-shared";
import { rothDeferralAccountIds } from "./deferral-mix";
import type { ProjectionYear } from "@/engine/types";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsRothPageData,
  EarlyYearsRothPageOptions,
  RothBlocker,
} from "./types";

export const EARLY_YEARS_ROTH_PAGE_ID = "earlyYearsRoth";
export const ROTH_TRADITIONAL_KEY = "traditional";
export const ROTH_ALL_ROTH_KEY = "roth";

/** Within this the two spending figures are the same number to a reader. */
const SPENDING_TOLERANCE = 0.005;

export function buildEarlyYearsRothData(
  ctx: BuildDataContext,
  options: EarlyYearsRothPageOptions,
): EarlyYearsRothPageData {
  const base = ctx.bundlesByRef?.base;
  const source = base?.clientData ?? ctx.clientData;
  const basis: DeflationBasis = {
    inflationRate: source.planSettings.inflationRate,
    planStartYear: source.planSettings.planStartYear,
  };

  const empty = (blocker: RothBlocker): EarlyYearsRothPageData => ({
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    rows: [],
    takeaway: null,
    spendingIsFixed: false,
    emptyMessage: BLOCKED_COPY[blocker],
    tidbits: [],
  });

  // The Roth/traditional DEDUCTION side is inside `if (useBracket)` in
  // `src/engine/projection.ts`. In flat mode the variants change the Roth basis
  // but not the current-year deduction, so all four rows would come back
  // near-identical — a sheet quietly arguing that the choice does not matter.
  if (source.planSettings.taxEngineMode !== "bracket") return empty("flat-tax-mode");
  if (rothDeferralAccountIds(source).length === 0) return empty("no-deferral-account");

  const trad = ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_ROTH_PAGE_ID, ROTH_TRADITIONAL_KEY)];
  const roth = ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_ROTH_PAGE_ID, ROTH_ALL_ROTH_KEY)];
  if (trad == null || roth == null) return empty("no-variant");

  const retirementAge = source.client.retirementAge;
  const t = summarize(trad.projection.years, basis, retirementAge);
  const r = summarize(roth.projection.years, basis, retirementAge);

  const spendGap = Math.abs(t.avgRetirementSpend - r.avgRetirementSpend);
  const spendScale = Math.max(t.avgRetirementSpend, r.avgRetirementSpend, 1);

  return {
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    rows: [
      {
        label: "Tax paid while you're working",
        traditional: t.working,
        roth: r.working,
        betterIsLower: true,
      },
      {
        label: "Tax paid from retirement on",
        traditional: t.retired,
        roth: r.retired,
        betterIsLower: true,
      },
      {
        label: "Tax over the whole plan",
        traditional: t.total,
        roth: r.total,
        betterIsLower: true,
      },
      {
        label: "Average yearly spending in retirement",
        traditional: t.avgRetirementSpend,
        roth: r.avgRetirementSpend,
        betterIsLower: false,
      },
    ],
    takeaway: takeawayFor(t.total, r.total),
    spendingIsFixed: spendGap / spendScale <= SPENDING_TOLERANCE,
    emptyMessage: null,
    // Resolved only when the advisor picked something.
    tidbits:
      options.tidbits.length > 0
        ? renderTidbits(
            options.tidbits,
            resolveAllTokens({
              clientData: ctx.clientData,
              projection: ctx.projection,
              monteCarlo: ctx.monteCarlo?.summary ?? null,
            }),
          )
        : [],
  };
}

interface Summary {
  working: number;
  retired: number;
  total: number;
  avgRetirementSpend: number;
}

/**
 * `expenses.taxes` IS `finalTaxResult.flow.totalTax` — the whole tax bill,
 * mode-independent, already net of every deduction the variant earned.
 * `expenses.total` INCLUDES it, so real spending is the difference.
 */
function summarize(
  years: ProjectionYear[],
  basis: DeflationBasis,
  retirementAge: number,
): Summary {
  let working = 0;
  let retired = 0;
  let spendTotal = 0;
  let retiredYears = 0;
  for (const y of years) {
    const tax = toTodaysDollars(y.expenses.taxes, y.year, basis);
    if (y.ages.client < retirementAge) {
      working += tax;
      continue;
    }
    retired += tax;
    spendTotal += toTodaysDollars(y.expenses.total - y.expenses.taxes, y.year, basis);
    retiredYears += 1;
  }
  return {
    working,
    retired,
    total: working + retired,
    avgRetirementSpend: retiredYears > 0 ? spendTotal / retiredYears : 0,
  };
}

const BLOCKED_COPY: Record<RothBlocker, string> = {
  "flat-tax-mode":
    "This comparison is only meaningful on the bracket tax engine — the flat-rate setting doesn't model the deduction a pre-tax contribution earns. Switch the plan's tax engine to brackets to print this page.",
  "no-deferral-account":
    "This plan has no 401(k) or 403(b) contributions, so there is no Roth-or-traditional choice to price.",
  "no-variant": "This comparison could not be built for this plan.",
};

/** Names the cheaper column and what it saves. Null when they tie — a sheet that
 *  declares a winner over a rounding difference is worse than one that doesn't. */
function takeawayFor(traditionalTotal: number, rothTotal: number): string | null {
  const gap = Math.abs(traditionalTotal - rothTotal);
  if (gap < 1) return null;
  const cheaper = rothTotal < traditionalTotal ? "Roth" : "traditional";
  return `Over the whole plan, all-${cheaper} contributions leave about ${exactCurrency(gap)} less tax paid.`;
}
