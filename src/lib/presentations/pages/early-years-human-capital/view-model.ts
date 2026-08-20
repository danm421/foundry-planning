// "Your biggest asset isn't your portfolio" — what is invested today, against
// the present value of every salary dollar still to come.
//
// The discount rate is the plan's INFLATION assumption, per the spec, and the
// sheet says so. Discounting at an expected return would produce a smaller and
// arguably more correct number; that is a modeling call the spec already made.

import { dollarPair, sumDollarPairs, type DollarPair } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
// The same formatter the chart labels its bars with — one sheet printing "$3.1M"
// beside "$3,120,000" reads as two different units.
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { earlyYearsSubtitle } from "../early-years-shared";
import {
  HUMAN_CAPITAL_DETAIL_MAX_ROWS,
  selectEarlyYearsDetailYears,
} from "../early-years-detail";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsHumanCapitalPageData,
  EarlyYearsHumanCapitalPageOptions,
} from "./types";

export function buildEarlyYearsHumanCapitalData(
  ctx: BuildDataContext,
  options: EarlyYearsHumanCapitalPageOptions,
): EarlyYearsHumanCapitalPageData {
  // Pinned to Base Case like every Early Years sheet, with the ladder's own
  // fallback for a context that never assembled a base bundle.
  const base = ctx.bundlesByRef?.base;
  const source = base?.clientData ?? ctx.clientData;
  const years = base?.projection.years ?? ctx.years;
  const basis = {
    inflationRate: source.planSettings.inflationRate,
    planStartYear: source.planSettings.planStartYear,
  };

  // `income.salaries` is the engine's own salary line. Known limitation, already
  // filed: it is the PRORATED tax-side figure and it folds in a grantor trust's
  // salaries. Both are unreachable on a young client's tree, and using the
  // engine's number beats re-deriving one that can drift from it.
  const earning = years.filter((y) => y.income.salaries > 0);
  const lifetimeEarnings = sumDollarPairs(
    years.map((y) => dollarPair(y.income.salaries, y.year, basis)),
  );
  const invested = dollarPair(
    years[0].portfolioAssets.liquidTotal,
    years[0].year,
    basis,
  );
  const detailYears = selectEarlyYearsDetailYears({
    availableYears: earning.map((y) => y.year),
    planStartYear: basis.planStartYear,
    requiredYears:
      earning.length === 0 ? [] : [earning[0].year, earning[earning.length - 1].year],
    maxRows: HUMAN_CAPITAL_DETAIL_MAX_ROWS,
  });
  const detailRows = detailYears.map((year) => {
    const row = earning.find((candidate) => candidate.year === year)!;
    return {
      year,
      age: row.ages.client,
      salary: dollarPair(row.income.salaries, row.year, basis),
    };
  });

  return {
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    isEmpty: lifetimeEarnings.nominal <= 0,
    invested,
    lifetimeEarnings,
    multiple: invested.today > 0 ? lifetimeEarnings.today / invested.today : null,
    lastEarningYear: earning.length > 0 ? earning[earning.length - 1].year : null,
    takeaway: takeawayFor(lifetimeEarnings, invested.today),
    detailRows,
    // Resolved only when the advisor picked something: `resolveAllTokens` walks
    // every registered token against the whole tree, and no page should pay for
    // a sidebar it is not printing.
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

/**
 * The sheet's one sentence. Three arms, because the multiple is only meaningful
 * in one of them: a client with nothing invested would otherwise read "Infinity
 * times", and a client whose portfolio already rivals their remaining pay would
 * read "1 times", which argues the opposite of the page.
 */
function takeawayFor(lifetime: DollarPair, invested: number): string {
  const total = `About ${fmtAxisUsd(lifetime.today)} today (${fmtAxisUsd(lifetime.nominal)} nominal as paid) of future pay will pass through your hands.`;
  if (invested <= 0) {
    return `${total} What this report is about is the share of it you keep.`;
  }
  const x = lifetime.today / invested;
  if (x < 2) {
    return `${total} Your portfolio is already a meaningful share of that — the pages after this one decide how much of the rest joins it.`;
  }
  return `${total} That is roughly ${Math.round(x)} times what you have invested today, which is why the decisions on the next few pages matter more than the balance on this one.`;
}
