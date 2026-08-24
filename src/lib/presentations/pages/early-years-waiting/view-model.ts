// "The cost of waiting" — one savings rate, three start dates.
//
// Holding the rate constant IS the page: elapsed time is then the only
// variable, so the gap between two bars is what the delay cost and nothing
// else. Each arm is the base tree plus a WINDOWED delta rule that begins
// `delay` years out — a SECOND rule on the deferral account, so the rule
// already there is never rewritten and the delay-0 arm lands exactly where the
// ladder's middle rung does.

import { derivedKey } from "@/lib/presentations/derived-refs";
import { dollarPair } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { householdSavingsRate } from "@/lib/presentations/savings-rate";
// The same formatter the chart labels its bars with, so the takeaway and the
// bars it measures never print two different units.
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { ladderBlocker, type LadderBlocker } from "../early-years-ladder/rungs";
import { earlyYearsSubtitle } from "../early-years-shared";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsWaitingPageData,
  EarlyYearsWaitingPageOptions,
  WaitingGroup,
} from "./types";

export const EARLY_YEARS_WAITING_PAGE_ID = "earlyYearsWaiting";
export const delayKey = (i: number) => `delay${i}`;

/** Below this the shortfall is float noise, not a limit. The same tolerance the
 *  ladder's cap footnote uses. */
const CAP_TOLERANCE = 0.001;

export function buildEarlyYearsWaitingData(
  ctx: BuildDataContext,
  options: EarlyYearsWaitingPageOptions,
): EarlyYearsWaitingPageData {
  // The arms are derived FROM BASE, so everything that describes them — the
  // client's current rate, the deflation basis, the label on the sheet — is read
  // off the base tree too.
  const base = ctx.bundlesByRef?.base;
  const source = base?.clientData ?? ctx.clientData;
  const basis = {
    inflationRate: source.planSettings.inflationRate,
    planStartYear: source.planSettings.planStartYear,
  };
  const current = householdSavingsRate(base?.projection.years[0] ?? ctx.years[0]);
  const raisedRate = Math.min(1, current + options.rungOffset);
  const seriesLabels = options.delays.map(labelForDelay);

  const empty = (emptyMessage: string): EarlyYearsWaitingPageData => ({
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    groups: [],
    seriesLabels,
    raisedRate,
    takeaway: null,
    isCapped: false,
    emptyMessage,
    tidbits: [],
    basis,
  });

  // Exactly the ladder's eligibility test: this page raises the same
  // contribution by the same mechanism, so a plan that blocks one blocks the
  // other. WHY it is blocked decides the sentence — a client contributing the
  // annual maximum is not a client with no contributions.
  const blocker = ladderBlocker(source);
  if (blocker != null) return empty(BLOCKED_COPY[blocker]);

  const bundles = options.delays.map(
    (_, i) => ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_WAITING_PAGE_ID, delayKey(i))],
  );
  // No variant built — the export skipped it, or this is a context that never
  // assembles derived bundles.
  if (bundles.some((b) => b == null)) {
    return empty("This chart could not be built for this plan.");
  }

  const groups: WaitingGroup[] = [];
  for (const age of options.milestoneAges) {
    const rows = bundles.map((b) => b!.projection.years.find((y) => y.ages.client === age));
    // A milestone the projection never reaches has no figure to print. Drawing
    // it as $0 would say the money is gone rather than that the plan stops.
    if (rows.some((r) => r == null)) continue;
    groups.push({
      age,
      year: rows[0]!.year,
      bars: rows.map((r) => ({
        value: dollarPair(r!.portfolioAssets.liquidTotal, r!.year, basis),
      })),
    });
  }
  if (groups.length === 0) {
    return empty("This plan does not run to any of the milestone ages on this chart.");
  }

  return {
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    groups,
    seriesLabels,
    raisedRate,
    takeaway: takeawayFor(groups, options.delays),
    // Measured on the arm that starts NOW, and only on that arm: a delayed arm
    // is still contributing the base rate in the plan's first year, so its
    // first-year figure carries no information about the cap.
    isCapped:
      raisedRate - householdSavingsRate(bundles[0]!.projection.years[0]) > CAP_TOLERANCE,
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
    basis,
  };
}

/** One sentence per reason, in this page's own words. The ladder's three
 *  reasons, re-phrased for "start sooner" rather than "raise" — printing "no
 *  payroll retirement contributions" onto a plan that maxes them out
 *  contradicts the sheet two pages earlier, which reported those dollars. */
const BLOCKED_COPY: Record<LadderBlocker, string> = {
  "no-deferral":
    "This plan has no payroll retirement contributions to model, so there is no contribution to start sooner.",
  "at-annual-maximum":
    "This plan's retirement contributions are already set to the annual IRS maximum, so there is no increase left to postpone.",
  "not-modellable":
    "This plan's retirement contributions can't be modelled as a single savings rate, so there is nothing to start sooner here.",
};

/** "Start now" · "Start in 5 years" — never a rate: every bar on this page saves
 *  the SAME rate, and naming it per bar would suggest otherwise. */
function labelForDelay(delay: number): string {
  if (delay <= 0) return "Start now";
  return `Start in ${delay} year${delay === 1 ? "" : "s"}`;
}

const SPELLED = [
  "no", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
];

/**
 * One sentence pricing the FIRST delay at the last milestone the chart reaches.
 *
 * The first delay, not the longest: "waiting five years costs $180,000" is the
 * spec's headline, and five years is the decision a 28-year-old actually faces.
 * Null when there is only one start date — this page never phrases a gap it
 * cannot show.
 */
function takeawayFor(groups: WaitingGroup[], delays: number[]): string | null {
  const last = groups[groups.length - 1];
  if (!last || last.bars.length < 2) return null;
  const gapToday = last.bars[0].value.today - last.bars[1].value.today;
  const gapNominal = last.bars[0].value.nominal - last.bars[1].value.nominal;
  if (gapToday <= 0) return null;
  const years = delays[1] - delays[0];
  const spelled = SPELLED[years] ?? String(years);
  return `Waiting ${spelled} year${years === 1 ? "" : "s"} costs about ${fmtAxisUsd(gapToday)} today (${fmtAxisUsd(gapNominal)} future-year dollars) by age ${last.age}.`;
}
