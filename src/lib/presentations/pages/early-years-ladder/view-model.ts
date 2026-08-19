// "What saving more is worth" — the contribution ladder.
//
// Every bar comes from a DERIVED plan variant: the base tree with one deferral
// account moved to the rung's percent, re-projected. The page therefore reads
// its numbers out of `bundlesByRef`, never out of the deck's own scenario, and
// deflates each one to the plan's start year before printing it.

import { derivedKey } from "@/lib/presentations/derived-refs";
import { toTodaysDollars } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { compactCurrency } from "@/lib/presentations/format";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { resolveRungs, householdCurrentPercent, movableAccountCount, type Rung } from "./rungs";
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

  const current = householdCurrentPercent(source);
  const rungs = resolveRungs(options.rungs, current);
  const bundles = rungs.map(
    (_, i) => ctx.bundlesByRef?.[derivedKey(EARLY_YEARS_LADDER_PAGE_ID, rungKey(i))],
  );

  const empty = (): EarlyYearsLadderPageData => ({
    subtitle: subtitleFor(base?.scenarioLabel),
    groups: [],
    rungs,
    cappedRungLabels: [],
    takeaway: null,
    tidbits: [],
    basis,
  });

  // No variant built (the export skipped it, or this is a context that never
  // assembles derived bundles), or nothing in the plan the ladder can move: a
  // rung the mutation cannot express re-runs the base plan, so the chart would
  // be the same bar drawn three times under three different labels.
  if (bundles.some((b) => b == null) || movableAccountCount(source) === 0) return empty();

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
  if (groups.length === 0) return empty();

  return {
    subtitle: subtitleFor(base?.scenarioLabel),
    groups,
    rungs,
    cappedRungLabels: cappedRungLabels(rungs, bundles.map((b) => b!.projection.years[0].savings.total)),
    takeaway: takeawayFor(groups, rungs),
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

function subtitleFor(scenarioLabel: string | undefined): string {
  // The bars are always the base plan with one lever moved, whatever scenario
  // the rest of the deck is built on.
  return `${scenarioLabel ?? "Base Case"} · Every figure in today's dollars`;
}

/**
 * Rungs whose extra percent bought no extra contribution.
 *
 * Detected by comparing what the ENGINE actually contributed in the plan's
 * first year, not by re-deriving the §402(g) limit here: the projection runs
 * `applyContributionLimits` whenever it has tax-year rows, and the capped
 * figure is what lands in `savings.total`. Once `salary × percent` clears the
 * owner's deferral ceiling, every higher rung funds identical dollars.
 *
 * Two rungs asking for the SAME percent also fund identical dollars — they are
 * the same plan. That is not a cap, so the percent has to rise before the
 * totals are worth comparing.
 */
function cappedRungLabels(rungs: Rung[], firstYearSavings: number[]): string[] {
  return rungs.flatMap((rung, i) => {
    if (i === 0) return [];
    if (rung.percent <= rungs[i - 1].percent) return [];
    return firstYearSavings[i] <= firstYearSavings[i - 1] ? [rung.label] : [];
  });
}

/** One sentence naming what the top rung is worth at the last milestone the
 *  chart reaches. Null when there is no raised rung above the baseline to
 *  compare against — this page never phrases a gap it cannot show. */
function takeawayFor(groups: LadderGroup[], rungs: Rung[]): string | null {
  const last = groups[groups.length - 1];
  if (!last || last.bars.length < 2) return null;

  const baseIdx = Math.max(0, rungs.findIndex((r) => r.isCurrent));
  const topIdx = last.bars.length - 1;
  if (topIdx === baseIdx) return null;

  const gap = last.bars[topIdx].value - last.bars[baseIdx].value;
  if (gap <= 0) return null;

  const asPct = (p: number) => `${Math.round(p * 100)}%`;
  return `At age ${last.age}, saving ${asPct(rungs[topIdx].percent)} instead of ${asPct(rungs[baseIdx].percent)} leaves you about ${compactCurrency(gap)} more — in today's dollars.`;
}
