// "Where you stand today" — the savings-rate hero.
//
// Every dollar on this page is deflated to the plan's start year, so the client
// reads figures they can price against their current life. Today that is an
// identity: `runProjection` loops `planStartYear..planEndYear`, so `years[0]`
// IS the start year and `toTodaysDollars` returns the nominal figure unchanged.
// The conversion is applied anyway — it is what makes the sheet's "today's
// dollars" line true by construction rather than by that invariant holding.

import { toTodaysDollars } from "@/lib/presentations/real-dollars";
import { renderTidbits } from "@/lib/presentations/tidbits";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  EarlyYearsStandingPageData,
  EarlyYearsStandingPageOptions,
  MatchLine,
} from "./types";

export function buildEarlyYearsStandingData(
  ctx: BuildDataContext,
  options: EarlyYearsStandingPageOptions,
): EarlyYearsStandingPageData {
  const first = ctx.years[0];
  const { inflationRate, planStartYear } = ctx.clientData.planSettings;
  const real = (nominal: number) =>
    toTodaysDollars(nominal, first.year, { inflationRate, planStartYear });

  const grossNominal = first.income.salaries;
  const contributionsNominal = first.savings.total;

  return {
    // A savings RATE needs salary to divide by. Without it the honest output is
    // "we can't state this", not a 0% that reads as "you save nothing".
    isEmpty: grossNominal <= 0,
    subtitle: `${ctx.scenarioLabel} · At age ${first.ages.client} · Every figure in today's dollars`,
    clientAge: first.ages.client,
    grossAnnual: real(grossNominal),
    contributionsAnnual: real(contributionsNominal),
    savingsRatePct: grossNominal > 0 ? contributionsNominal / grossNominal : 0,
    portfolioToday: real(first.portfolioAssets.liquidTotal),
    match: resolveMatchLine(options, first.savings.employerTotal, real),
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

function resolveMatchLine(
  options: EarlyYearsStandingPageOptions,
  employerNominal: number,
  real: (nominal: number) => number,
): MatchLine {
  if (!options.showMatchLine) return { kind: "none" };
  // No employer dollars is not a shortfall to report — this plan simply has no
  // match modelled, and a line about one would invent an employer benefit.
  if (employerNominal <= 0) return { kind: "none" };
  return { kind: "captured", employerAnnual: real(employerNominal) };
}
