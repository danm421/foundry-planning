// "Pay down the loan, or invest?" — the same extra dollars, over the same
// window, sent two different places.
//
// The two arms are symmetric on purpose. An extra loan payment really does
// consume cash: `annualPayment = payment + extraPayment`
// (`src/engine/liabilities.ts:57`) folds into `liabResult.totalPayment`, which
// the projection books as an expense. So this is not "spend money" against
// "spend nothing"; it is one choice against another.

import { derivedKey } from "@/lib/presentations/derived-refs";
import {
  absoluteDollarDifference,
  dollarPair,
  sumDollarPairs,
  type DeflationBasis,
} from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
// The same formatter the other Early Years takeaways use, so two sheets never
// print one quantity in two units.
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { earlyYearsSubtitle, largestMovableDeferral } from "../early-years-shared";
import {
  DEBT_OR_INVEST_DETAIL_MAX_ROWS,
  selectEarlyYearsDetailYears,
} from "../early-years-detail";
import { targetLoan, payoffYear } from "./target-loan";
import type { PageScenarioBundle } from "@/components/presentations/document";
import type { BuildDataContext, DeckOmitContext } from "@/components/presentations/registry";
import type {
  DebtOrInvestArm,
  EarlyYearsDebtOrInvestPageData,
  EarlyYearsDebtOrInvestPageOptions,
} from "./types";

export const EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID = "earlyYearsDebtOrInvest";
export const LOAN_ARM_KEY = "loan";
export const INVEST_ARM_KEY = "invest";

/** Below this the two portfolios are the same number to a reader, and naming a
 *  winner would be naming a rounding difference. */
const PORTFOLIO_TOLERANCE = 0.001;
/**
 * The plan's own facts remove this sheet. Two conditions, and both make the
 * page's headings promise a comparison it cannot make:
 *
 * 1. No amortizing liability with a balance — nowhere for arm A to go.
 * 2. No movable deferral — nowhere for arm B to go, so the page would compare
 *    paying the loan against doing nothing, which is not the title's question.
 */
export function omitEarlyYearsDebtOrInvest(
  ctx: DeckOmitContext,
  options: EarlyYearsDebtOrInvestPageOptions,
): boolean {
  // The variants derive from base, so the suppression decision reads base too —
  // otherwise a deck built on a scenario that pays the loan off early would drop
  // a sheet whose figures come from the base plan.
  const source = ctx.bundles.base?.clientData ?? ctx.clientData;
  if (targetLoan(source, options.liabilityId) == null) return true;
  return largestMovableDeferral(source, source.planSettings.planStartYear) == null;
}

export function buildEarlyYearsDebtOrInvestData(
  ctx: BuildDataContext,
  options: EarlyYearsDebtOrInvestPageOptions,
): EarlyYearsDebtOrInvestPageData {
  const base = ctx.bundlesByRef?.base;
  const source = base?.clientData ?? ctx.clientData;
  const basis: DeflationBasis = {
    inflationRate: source.planSettings.inflationRate,
    planStartYear: source.planSettings.planStartYear,
  };
  const loanRow = targetLoan(source, options.liabilityId);

  const empty = (emptyMessage: string): EarlyYearsDebtOrInvestPageData => ({
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    liabilityName: loanRow?.name ?? "",
    monthlyAmount: options.monthlyAmount,
    milestoneAge: options.milestoneAge,
    milestoneYear: basis.planStartYear,
    loan: null,
    invest: null,
    detailRows: [],
    takeaway: null,
    emptyMessage,
    tidbits: [],
  });

  // `omitFromDeck` normally spares us this, but a page the advisor added by hand
  // to a deck the document could not empty still has to render something.
  if (loanRow == null) return empty("This plan has no loan an extra payment could reach.");

  const loanBundle = ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID, LOAN_ARM_KEY)];
  const investBundle = ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID, INVEST_ARM_KEY)];
  if (loanBundle == null || investBundle == null) {
    return empty("This comparison could not be built for this plan.");
  }

  // The label comes off the bundle, not a literal here: the registry names each
  // variant once (`label:` on its derived ref) and `buildDerivedBundle` carries
  // that name through as `scenarioLabel`. Re-typing it would let the card title
  // and the variant it describes drift apart.
  const arm = ({ projection, scenarioLabel }: PageScenarioBundle): DebtOrInvestArm | null => {
    const gone = payoffYear(projection, loanRow.id);
    const at = projection.years.find((y) => y.ages.client === options.milestoneAge);
    if (gone == null || at == null) return null;
    return {
      label: scenarioLabel,
      debtFreeYear: gone,
      interestPaid: sumDollarPairs(
        projection.years.map((year) =>
          dollarPair(year.expenses.interestByLiability[loanRow.id] ?? 0, year.year, basis),
        ),
      ),
      portfolioAtMilestone: dollarPair(at.portfolioAssets.liquidTotal, at.year, basis),
    };
  };

  const loan = arm(loanBundle);
  const invest = arm(investBundle);
  // Half a comparison is not a comparison: if either arm has no figure at the
  // milestone age, the sheet says so rather than printing one column.
  if (loan == null || invest == null) {
    return empty(
      `This plan does not run to age ${options.milestoneAge}, so there is nothing to compare the two choices at.`,
    );
  }
  const loanYears = loanBundle.projection.years;
  const investByYear = new Map(investBundle.projection.years.map((year) => [year.year, year]));
  const milestone = loanYears.find((year) => year.ages.client === options.milestoneAge)!;
  const throughYear = Math.max(milestone.year, loan.debtFreeYear, invest.debtFreeYear);
  const common = loanYears.filter(
    (year) => year.year <= throughYear && investByYear.has(year.year),
  );
  const detailYears = selectEarlyYearsDetailYears({
    availableYears: common.map((year) => year.year),
    planStartYear: basis.planStartYear,
    requiredYears: [common[0]?.year, loan.debtFreeYear, invest.debtFreeYear, milestone.year].filter(
      (year): year is number => year != null,
    ),
    maxRows: DEBT_OR_INVEST_DETAIL_MAX_ROWS,
  });
  const detailRows = detailYears.map((year) => {
    const loanYear = common.find((candidate) => candidate.year === year)!;
    const investYear = investByYear.get(year)!;
    return {
      year,
      age: loanYear.ages.client,
      loanBalance: dollarPair(loanYear.liabilityBalancesBoY[loanRow.id] ?? 0, year, basis),
      investBalance: dollarPair(investYear.liabilityBalancesBoY[loanRow.id] ?? 0, year, basis),
    };
  });

  return {
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    liabilityName: loanRow.name,
    monthlyAmount: options.monthlyAmount,
    milestoneAge: options.milestoneAge,
    milestoneYear: milestone.year,
    loan,
    invest,
    detailRows,
    takeaway: takeawayFor(loan, invest, options.milestoneAge, milestone.year),
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

/** Names the arm that ends with more and by how much. Null on a near-tie: this
 *  page is about a real difference, and a sheet declaring a winner over a
 *  fraction of a percent invites a question it cannot answer. */
function takeawayFor(
  loan: DebtOrInvestArm,
  invest: DebtOrInvestArm,
  milestoneAge: number,
  milestoneYear: number,
): string | null {
  const gap = absoluteDollarDifference(invest.portfolioAtMilestone, loan.portfolioAtMilestone);
  const scale = Math.max(
    invest.portfolioAtMilestone.today,
    loan.portfolioAtMilestone.today,
    1,
  );
  if (gap.today / scale <= PORTFOLIO_TOLERANCE) return null;
  const winner =
    invest.portfolioAtMilestone.today > loan.portfolioAtMilestone.today ? invest : loan;
  return `By age ${milestoneAge}, "${winner.label}" leaves about ${fmtAxisUsd(gap.today)} today (${fmtAxisUsd(gap.nominal)} in ${milestoneYear} dollars) more.`;
}
