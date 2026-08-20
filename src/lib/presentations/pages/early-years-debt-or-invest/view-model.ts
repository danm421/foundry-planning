// "Pay down the loan, or invest?" — the same extra dollars, over the same
// window, sent two different places.
//
// The two arms are symmetric on purpose. An extra loan payment really does
// consume cash: `annualPayment = payment + extraPayment`
// (`src/engine/liabilities.ts:57`) folds into `liabResult.totalPayment`, which
// the projection books as an expense. So this is not "spend money" against
// "spend nothing"; it is one choice against another.

import { derivedKey } from "@/lib/presentations/derived-refs";
import { toTodaysDollars, type DeflationBasis } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
// The same formatter the other Early Years takeaways use, so two sheets never
// print one quantity in two units.
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { largestMovableDeferral } from "../early-years-shared";
import { targetLoan, payoffYear } from "./target-loan";
import type { ProjectionResult } from "@/engine";
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
    subtitle: subtitleFor(base?.scenarioLabel),
    liabilityName: loanRow?.name ?? "",
    monthlyAmount: options.monthlyAmount,
    milestoneAge: options.milestoneAge,
    loan: null,
    invest: null,
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

  const arm = (label: string, projection: ProjectionResult): DebtOrInvestArm | null => {
    const gone = payoffYear(projection, loanRow.id);
    const at = projection.years.find((y) => y.ages.client === options.milestoneAge);
    if (gone == null || at == null) return null;
    return {
      label,
      debtFreeYear: gone,
      interestPaid: projection.years.reduce(
        (sum, y) =>
          sum + toTodaysDollars(y.expenses.interestByLiability[loanRow.id] ?? 0, y.year, basis),
        0,
      ),
      portfolioAtMilestone: toTodaysDollars(at.portfolioAssets.liquidTotal, at.year, basis),
    };
  };

  const loan = arm("Onto the loan", loanBundle.projection);
  const invest = arm("Into the 401(k)", investBundle.projection);
  // Half a comparison is not a comparison: if either arm has no figure at the
  // milestone age, the sheet says so rather than printing one column.
  if (loan == null || invest == null) {
    return empty(
      `This plan does not run to age ${options.milestoneAge}, so there is nothing to compare the two choices at.`,
    );
  }

  return {
    subtitle: subtitleFor(base?.scenarioLabel),
    liabilityName: loanRow.name,
    monthlyAmount: options.monthlyAmount,
    milestoneAge: options.milestoneAge,
    loan,
    invest,
    takeaway: takeawayFor(loan, invest, options.milestoneAge),
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

function subtitleFor(scenarioLabel: string | undefined): string {
  return `${scenarioLabel ?? "Base Case"} · Every figure in today's dollars`;
}

/** Names the arm that ends with more and by how much. Null on a near-tie: this
 *  page is about a real difference, and a sheet declaring a winner over a
 *  fraction of a percent invites a question it cannot answer. */
function takeawayFor(
  loan: DebtOrInvestArm,
  invest: DebtOrInvestArm,
  milestoneAge: number,
): string | null {
  const gap = Math.abs(invest.portfolioAtMilestone - loan.portfolioAtMilestone);
  const scale = Math.max(invest.portfolioAtMilestone, loan.portfolioAtMilestone, 1);
  if (gap / scale <= PORTFOLIO_TOLERANCE) return null;
  const winner = invest.portfolioAtMilestone > loan.portfolioAtMilestone ? invest : loan;
  return `By age ${milestoneAge}, "${winner.label}" leaves about ${fmtAxisUsd(gap)} more, in today's dollars.`;
}
