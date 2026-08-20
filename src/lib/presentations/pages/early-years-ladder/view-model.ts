// "What saving more is worth" — the contribution ladder.
//
// Every bar comes from a DERIVED plan variant: the base tree with one deferral
// account moved to the rung's percent, re-projected. The page therefore reads
// its numbers out of `bundlesByRef`, never out of the deck's own scenario, and
// deflates each one to the plan's start year before printing it.

import { derivedKey } from "@/lib/presentations/derived-refs";
import { toTodaysDollars } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
// The same formatter the chart labels its bars with. The takeaway quotes a
// figure measured off those bars, and one sheet printing "$8.9k" beside
// "$977K" reads as two different units.
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { householdSavingsRate } from "@/lib/presentations/savings-rate";
import { earlyYearsSubtitle } from "../early-years-shared";
import { resolveRungs, ladderBlocker, type LadderBlocker, type Rung } from "./rungs";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsLadderPageData,
  EarlyYearsLadderPageOptions,
  LadderGroup,
} from "./types";

export const EARLY_YEARS_LADDER_PAGE_ID = "earlyYearsLadder";
export const rungKey = (i: number) => `rung${i}`;

export function buildEarlyYearsLadderData(
  ctx: BuildDataContext,
  options: EarlyYearsLadderPageOptions,
): EarlyYearsLadderPageData {
  // The rungs are derived FROM BASE, so everything that describes them — the
  // client's current rate, the deflation basis, the label on the sheet — is
  // read off the base tree too. Reading `ctx.clientData` instead would, in a
  // deck built on some other scenario, print rung labels the bars disagree
  // with. Falls back to the page's own tree when no base bundle is present.
  const base = ctx.bundlesByRef?.base;
  const source = base?.clientData ?? ctx.clientData;
  const basis = {
    inflationRate: source.planSettings.inflationRate,
    planStartYear: source.planSettings.planStartYear,
  };

  // The rate the plan ACTUALLY runs at, read the same way the standing sheet
  // reads it — one shared function, so the two pages of this deck cannot state
  // one household's savings rate two different ways.
  const current = householdSavingsRate(base?.projection.years[0] ?? ctx.years[0]);
  const rungs = resolveRungs(options.rungs, current);
  const bundles = rungs.map(
    (_, i) => ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_LADDER_PAGE_ID, rungKey(i))],
  );

  const empty = (emptyMessage: string): EarlyYearsLadderPageData => ({
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    groups: [],
    rungs,
    cappedRungLabels: [],
    takeaway: null,
    emptyMessage,
    tidbits: [],
    basis,
  });

  // Nothing in the plan the ladder can move: a rung the mutation cannot
  // express re-runs the base plan, so the chart would be the same bar drawn
  // three times under three different labels. WHY it cannot be moved decides
  // the sentence — a client contributing the annual maximum is not a client
  // with no contributions.
  const blocker = ladderBlocker(source);
  if (blocker != null) return empty(BLOCKED_COPY[blocker]);

  // No variant built — the export skipped it, or this is a context that never
  // assembles derived bundles.
  if (bundles.some((b) => b == null)) {
    return empty("This chart could not be built for this plan.");
  }

  const groups: LadderGroup[] = [];
  for (const age of options.milestoneAges) {
    const rows = bundles.map((b) => b!.projection.years.find((y) => y.ages.client === age));
    // A milestone the projection never reaches has no figure to print. Drawing
    // it as $0 would say the money is gone rather than that the plan stops.
    if (rows.some((r) => r == null)) continue;
    groups.push({
      age,
      bars: rungs.map((rung, i) => ({
        label: rung.label,
        isCurrent: rung.isCurrent,
        value: toTodaysDollars(rows[i]!.portfolioAssets.liquidTotal, rows[i]!.year, basis),
      })),
    });
  }

  // Every milestone fell outside the projection. The page has nothing to draw,
  // and a cap footnote without a chart to footnote is noise.
  if (groups.length === 0) {
    return empty("This plan does not run to any of the milestone ages on this chart.");
  }

  return {
    subtitle: earlyYearsSubtitle(base?.scenarioLabel),
    groups,
    rungs,
    cappedRungLabels: cappedRungLabels(
      rungs,
      bundles.map((b) => householdSavingsRate(b!.projection.years[0])),
    ),
    takeaway: takeawayFor(groups, rungs),
    emptyMessage: null,
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

/** One sentence per reason the ladder has no chart. They are not
 *  interchangeable: printing "no payroll retirement contributions" onto a plan
 *  that maxes them out contradicts the sheet before it, which has just
 *  reported those dollars. */
const BLOCKED_COPY: Record<LadderBlocker, string> = {
  "no-deferral":
    "This plan has no payroll retirement contributions to model, so there is no contribution to raise.",
  "at-annual-maximum":
    "This plan's retirement contributions are already set to the annual IRS maximum, so there is no rate left to raise.",
  "not-modellable":
    "This plan's retirement contributions can't be modelled as a single savings rate, so there is nothing to raise here.",
};

/** Below this the shortfall is float noise, not a limit. A tenth of a point is
 *  orders of magnitude under anything a rounded whole-percent label can show. */
const CAP_TOLERANCE = 0.001;

/**
 * Rungs the plan could not actually fund — the ones whose bar is labelled with
 * a rate the plan does not run at.
 *
 * Each rung is judged against ITSELF: what it asked for, versus what the
 * engine contributed once the variant was re-projected. Not against the rung
 * below it — a rung the limit only PARTLY absorbed still funds more than its
 * neighbour, so a pairwise test called it uncapped and the sheet read as
 * though 11% were delivered when the plan ran at 8%.
 *
 * The limit is read off the projection rather than re-derived here: the engine
 * runs `applyContributionLimits` whenever it has tax-year rows, and the capped
 * figure is what lands in `savings.total`. (One other thing can shorten a
 * rung: `ladderMutations` clamps the owner's percent at 100% of their pay. A
 * deferral limit binds long before that, so on any plan that applies one the
 * footnote's reason is the true one.)
 */
function cappedRungLabels(rungs: Rung[], deliveredRates: number[]): string[] {
  // Deduped: `resolveRungs` rounds each label to a whole percent, so two rungs
  // a fraction of a point apart share one, and the footnote would name it twice.
  return [
    ...new Set(
      rungs.flatMap((rung, i) =>
        rung.percent - deliveredRates[i] > CAP_TOLERANCE ? [rung.label] : [],
      ),
    ),
  ];
}

/**
 * One sentence naming what the top rung is worth at the last milestone the
 * chart reaches. Null when there is no raised rung above the baseline to
 * compare against — this page never phrases a gap it cannot show.
 *
 * It names the two BARS, in the words the legend labels them with, rather than
 * asserting that the client saves the top rung's rate. A rung the §402(g)
 * limit partly absorbs is drawn and labelled "Save 11%" while the plan runs at
 * 8%, so "saving 11% instead of 5%" would state a rate this plan never
 * reaches — the same defect the two sheets were just reconciled to remove. The
 * dollars are measured off the bars either way, so only the naming changes.
 *
 * It carries no "in today's dollars" tail: the page subtitle and the chart's
 * own subtitle each say it already, and "(today)" inside this sentence means
 * the rate the client defers TODAY — the same word in two senses, one line
 * apart, is worse than the third repetition it saved.
 */
function takeawayFor(groups: LadderGroup[], rungs: Rung[]): string | null {
  const last = groups[groups.length - 1];
  if (!last || last.bars.length < 2) return null;

  const baseIdx = Math.max(0, rungs.findIndex((r) => r.isCurrent));
  const topIdx = last.bars.length - 1;
  if (topIdx === baseIdx) return null;

  const gap = last.bars[topIdx].value - last.bars[baseIdx].value;
  if (gap <= 0) return null;

  // Exactly the legend's own text, so the client can find each bar.
  const named = (i: number) =>
    rungs[i].isCurrent ? `${rungs[i].label} (today)` : rungs[i].label;
  return `At age ${last.age}, the ${named(topIdx)} bar is about ${fmtAxisUsd(gap)} ahead of ${named(baseIdx)}.`;
}
