// "Where you stand today" — the savings-rate hero.
//
// Each figure keeps both units used by the rest of the section. On this sheet
// they are identical: `runProjection` starts at `planStartYear`, so the first
// projected year is already the purchasing-power basis year.

import { dollarPair, type DollarPair } from "@/lib/presentations/real-dollars";
import { householdSavingsRate } from "@/lib/presentations/savings-rate";
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
  const pair = (nominal: number) =>
    dollarPair(nominal, first.year, { inflationRate, planStartYear });

  const grossNominal = first.income.salaries;
  const contributionsNominal = first.savings.total;

  return {
    // A savings RATE needs salary to divide by. Without it the honest output is
    // "we can't state this", not a 0% that reads as "you save nothing".
    isEmpty: grossNominal <= 0,
    subtitle: `${ctx.scenarioLabel} · At age ${first.ages.client} · Starting year ${first.year} · Today's dollars equal future-year dollars`,
    clientAge: first.ages.client,
    grossAnnual: pair(grossNominal),
    contributionsAnnual: pair(contributionsNominal),
    // Shared with the ladder sheet, which prints the same rate on the next
    // page of the same deck.
    savingsRatePct: householdSavingsRate(first),
    portfolio: pair(first.portfolioAssets.liquidTotal),
    match: resolveMatchLine(options, first.savings.employerTotal, pair),
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
  pair: (nominal: number) => DollarPair,
): MatchLine {
  if (!options.showMatchLine) return { kind: "none" };
  // No employer dollars is not a shortfall to report — this plan simply has no
  // match modelled, and a line about one would invent an employer benefit.
  if (employerNominal <= 0) return { kind: "none" };
  return { kind: "captured", employerAnnual: pair(employerNominal) };
}
