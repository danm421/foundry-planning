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
import {
  dollarPair,
  sumDollarPairs,
  type DeflationBasis,
  type DollarPair,
} from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { exactCurrency } from "@/lib/presentations/format";
import { earlyYearsSubtitle } from "../early-years-shared";
import { ROTH_DETAIL_MAX_ROWS, selectEarlyYearsDetailYears } from "../early-years-detail";
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
    detailRows: [],
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

  const spendGap = Math.abs(t.avgRetirementSpend.today - r.avgRetirementSpend.today);
  const spendScale = Math.max(t.avgRetirementSpend.today, r.avgRetirementSpend.today, 1);
  const tradYears = trad.projection.years;
  const rothByYear = new Map(roth.projection.years.map((year) => [year.year, year]));
  const common = tradYears.filter((year) => rothByYear.has(year.year));
  const retirementYear = common.find((year) => year.ages.client === retirementAge)?.year;
  const detailYears = selectEarlyYearsDetailYears({
    availableYears: common.map((year) => year.year),
    planStartYear: basis.planStartYear,
    requiredYears:
      common.length === 0
        ? []
        : [common[0].year, retirementYear ?? common[common.length - 1].year, common[common.length - 1].year],
    maxRows: ROTH_DETAIL_MAX_ROWS,
  });
  const detailRows = detailYears.map((year) => {
    const traditional = common.find((candidate) => candidate.year === year)!;
    const allRoth = rothByYear.get(year)!;
    return {
      year,
      age: traditional.ages.client,
      traditionalTax: dollarPair(traditional.expenses.taxes, year, basis),
      rothTax: dollarPair(allRoth.expenses.taxes, year, basis),
    };
  });

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
    detailRows,
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
  working: DollarPair;
  retired: DollarPair;
  total: DollarPair;
  avgRetirementSpend: DollarPair;
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
  const workingYears = years.filter((year) => year.ages.client < retirementAge);
  const retiredYears = years.filter((year) => year.ages.client >= retirementAge);
  const working = sumDollarPairs(
    workingYears.map((year) => dollarPair(year.expenses.taxes, year.year, basis)),
  );
  const retired = sumDollarPairs(
    retiredYears.map((year) => dollarPair(year.expenses.taxes, year.year, basis)),
  );
  const spendTotal = sumDollarPairs(
    retiredYears.map((year) =>
      dollarPair(year.expenses.total - year.expenses.taxes, year.year, basis),
    ),
  );
  const count = retiredYears.length;
  return {
    working,
    retired,
    total: sumDollarPairs([working, retired]),
    avgRetirementSpend:
      count > 0
        ? { today: spendTotal.today / count, nominal: spendTotal.nominal / count }
        : { today: 0, nominal: 0 },
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
function takeawayFor(traditionalTotal: DollarPair, rothTotal: DollarPair): string | null {
  const todayDelta = traditionalTotal.today - rothTotal.today;
  if (Math.abs(todayDelta) < 1) return null;

  const nominalDelta = traditionalTotal.nominal - rothTotal.nominal;
  const cheaper = todayDelta > 0 ? "Roth" : "traditional";
  const futureGap =
    Math.abs(nominalDelta) >= 1 && Math.sign(todayDelta) === Math.sign(nominalDelta)
      ? ` (${exactCurrency(Math.abs(nominalDelta))} future-year dollars)`
      : "";
  return `Over the whole plan, all-${cheaper} contributions leave about ${exactCurrency(Math.abs(todayDelta))} today${futureGap} less tax paid.`;
}
