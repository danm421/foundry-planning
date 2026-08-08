import type { Finding, FindingContext } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { n } from "../adapter";
import { computeMagi, irmaaTiersFor, nextIrmaaCliff } from "../irmaa-util";

/** The bracket immediately above 0% — the rate these dollars would otherwise
 *  pay. Not a parameter: the 15% rung is the one a harvested gain escapes, and
 *  20% only applies far above any return with 0% headroom left. */
const LTCG_NEXT_RATE = 0.15;

export function bracketPosition(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map) return null;
  const { marginalRate, headroomToNext, nextRate, taxBase } = map.ordinary;
  const ti = ctx.facts.deductions.taxableIncome;
  const atTop = headroomToNext == null || nextRate == null;

  return {
    id: "bracket-position",
    severity: "info",
    category: "brackets",
    headline: `Ordinary income tops out in the ${fmtPct(marginalRate)} bracket`,
    whatTheReturnShows: `Taxable income of ${fmtUsd(ti ?? taxBase)} (line 15) includes ${fmtUsd(map.capGains.preferentialBase)} of long-term gains and qualified dividends, which are taxed on their own schedule. That leaves ${fmtUsd(taxBase)} of ordinary taxable income, placing the return in the ${fmtPct(marginalRate)} federal bracket.`,
    whyItMatters: atTop
      ? `This is the top federal bracket, so every additional dollar of ordinary income — a conversion, a bonus, an IRA distribution — is taxed at ${fmtPct(marginalRate)} with no further step up.`
      : `Brackets are marginal, not cliffs: the next ${fmtUsd(headroomToNext)} of ordinary income is still taxed at ${fmtPct(marginalRate)}, and only dollars above that reach ${fmtPct(nextRate)}. That band is the cheapest remaining tax room this year has.`,
    whatToConsider: atTop
      ? `Deferral rather than acceleration is the lever here — retirement-plan contributions, charitable timing, and loss harvesting each remove dollars taxed at ${fmtPct(marginalRate)}.`
      : `Treat ${fmtUsd(headroomToNext)} as this year's budget for voluntary ordinary income. The conversion and gain-harvesting findings below size specific moves against it.`,
    lineRefs: [
      { form: "Form 1040", line: "line 15", label: "Taxable income", amount: ti },
      { form: "Form 1040", line: "line 3a", label: "Qualified dividends", amount: ctx.facts.income.qualifiedDividends },
    ],
    estimatedImpact: null, // positional — nothing is at stake until a move is made
    numbers: { marginalRate, taxBase, headroom: headroomToNext ?? 0 },
  };
}

export function rothHeadroom(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map) return null;
  const { marginalRate, headroomToNext, nextRate } = map.ordinary;
  if (headroomToNext == null || nextRate == null || headroomToNext < 1000) return null;

  const rateDifferential = nextRate - marginalRate;
  const impact = headroomToNext * rateDifferential;
  const numbers: Record<string, number> = {
    headroom: headroomToNext,
    rate: marginalRate,
    nextRate,
    rateDifferential,
  };

  let caveat = "";
  const magi = computeMagi(ctx.facts);
  const tiers = magi != null ? irmaaTiersFor(ctx.facts, ctx.irmaaParams) : null;
  if (magi != null && tiers) {
    const cliff = nextIrmaaCliff(magi, tiers);
    if (cliff && cliff.distance < headroomToNext) {
      numbers.irmaaCliffDistance = cliff.distance;
      caveat = ` One limit sits inside that band: a conversion above ${fmtUsd(cliff.distance)} also crosses an IRMAA threshold, which is a cliff rather than a rate step — see the Medicare finding.`;
    }
  }

  return {
    id: "roth-headroom",
    severity: "opportunity",
    category: "retirement",
    headline: `${fmtUsd(headroomToNext)} of Roth conversion room at ${fmtPct(marginalRate)}`,
    whatTheReturnShows: `Taxable income of ${fmtUsd(n(ctx.facts.deductions.taxableIncome))} (line 15) leaves ${fmtUsd(headroomToNext)} before the ${fmtPct(nextRate)} bracket begins. The return already reports ${fmtUsd(n(ctx.facts.income.iraDistributionsTaxable))} of taxable IRA distributions (line 4b), so pre-tax retirement money is in the picture.`,
    whyItMatters: `Converting traditional IRA dollars to Roth fills that band at ${fmtPct(marginalRate)}. The same dollars converted in a year when they land in the ${fmtPct(nextRate)} bracket cost ${fmtPct(rateDifferential)} more — about ${fmtUsd(impact)} across the full ${fmtUsd(headroomToNext)}. That figure is the extra rate paid later, not a saving against not converting at all. Converted balances then grow and distribute tax-free and carry no RMD.${caveat}`,
    whatToConsider: `Size the conversion to the ${fmtUsd(headroomToNext)} of headroom rather than to a round number, pay the resulting tax from outside the IRA where possible, and complete it before 31 December — a conversion cannot be undone once the year closes.`,
    lineRefs: [
      { form: "Form 1040", line: "line 15", label: "Taxable income", amount: ctx.facts.deductions.taxableIncome },
      { form: "Form 1040", line: "line 4b", label: "IRA distributions, taxable", amount: ctx.facts.income.iraDistributionsTaxable },
    ],
    estimatedImpact: impact,
    numbers,
  };
}

export function ltcgZeroHeadroom(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map || map.capGains.zeroPctHeadroom < 500) return null;
  const room = map.capGains.zeroPctHeadroom;
  const impact = room * LTCG_NEXT_RATE;
  return {
    id: "ltcg-zero-headroom",
    severity: "opportunity",
    category: "investments",
    headline: `${fmtUsd(room)} of long-term gains could be realized at 0%`,
    whatTheReturnShows: `Long-term gains and qualified dividends of ${fmtUsd(map.capGains.preferentialBase)} stack on top of ${fmtUsd(map.capGains.ordinaryFloor)} of ordinary taxable income and finish ${fmtUsd(room)} below the ${fmtUsd(map.capGains.zeroPctTop)} top of the 0% capital-gains bracket.`,
    whyItMatters: `Gains realized inside that band carry no federal tax at all. Selling an appreciated position and immediately repurchasing it resets cost basis upward for free — about ${fmtUsd(impact)} of federal tax that the same gain would otherwise pay at ${fmtPct(LTCG_NEXT_RATE)} when it is eventually realized. The wash-sale rule bars repurchase only after a loss, never after a gain.`,
    whatToConsider: `Harvest up to ${fmtUsd(room)} of gains before 31 December, remembering that the realized gain still raises AGI and can therefore move state tax, IRMAA, and ACA credits even while the federal rate on it stays 0%.`,
    lineRefs: [
      { form: "Form 1040", line: "line 7", label: "Capital gain or loss", amount: ctx.facts.income.capitalGainOrLoss },
      { form: "Form 1040", line: "line 3a", label: "Qualified dividends", amount: ctx.facts.income.qualifiedDividends },
      { form: "Schedule D", line: "line 15", label: "Net long-term capital gain", amount: ctx.facts.income.netLongTermGain },
    ],
    estimatedImpact: impact,
    numbers: { headroom: room, zeroPctTop: map.capGains.zeroPctTop },
  };
}
