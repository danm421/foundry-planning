import type { Finding, FindingContext } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { n } from "../adapter";
import { computeMagi, irmaaTiersFor, nextIrmaaCliff } from "../irmaa-util";
import { amtApplies } from "@/lib/tax/amt";

/** The bracket immediately above 0% — the rate these dollars would otherwise
 *  pay. Not a parameter: the 15% rung is the one a harvested gain escapes, and
 *  20% only applies far above any return with 0% headroom left. */
const LTCG_NEXT_RATE = 0.15;

/** The alternative minimum tax this return actually reports (Schedule 2 line
 *  1), or 0. Read from the FILED return rather than from the engine's own
 *  re-computation: this model is not given the items that create AMT, so its
 *  reconstruction produces none for exactly the returns that matter here. */
function filedAmt(ctx: FindingContext): number {
  return ctx.facts.tax.amt ?? 0;
}

/** Appended to bracket-positioning prose. In an AMT year the next dollar of
 *  ordinary income is priced by the tentative minimum, not by the bracket, so
 *  "every additional dollar is taxed at Y%" is not true as written (F9). */
function amtCaveat(ctx: FindingContext): string {
  const amt = filedAmt(ctx);
  if (!amtApplies(amt)) return "";
  return ` This return also reports ${fmtUsd(amt)} of alternative minimum tax, and in an AMT year the next dollar of ordinary income is priced by the AMT calculation rather than by this bracket — so treat the rate above as the regular-tax rate only.`;
}

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
    whyItMatters: (atTop
      ? `This is the top federal bracket, so every additional dollar of ordinary income — a conversion, a bonus, an IRA distribution — is taxed at ${fmtPct(marginalRate)} with no further step up.`
      : `Brackets are marginal, not cliffs: the next ${fmtUsd(headroomToNext)} of ordinary income is still taxed at ${fmtPct(marginalRate)}, and only dollars above that reach ${fmtPct(nextRate)}. That band is the cheapest remaining tax room this year has.`) + amtCaveat(ctx),
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

  // F9: when the return itself reports AMT, this band does not price a
  // conversion. The audit measured a quoted 24% band costing 42.9% in reality —
  // $17,766 more than promised, on an irreversible transaction, printed as an
  // "opportunity" on a client deliverable. Suppress the opportunity and say so.
  // This stays suppression rather than a re-priced band until the
  // reconstruction can rebuild AMT income from a filed return, which is the
  // same missing input that keeps AMT out of the cross-check.
  const amt = filedAmt(ctx);
  if (amtApplies(amt)) return amtBlockedConversion(ctx, headroomToNext, marginalRate, amt);

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

/**
 * The Roth-headroom finding for a return that paid AMT. Same id, so it takes
 * the opportunity's place rather than appearing alongside it — an advisor must
 * not see both "room at 22%" and "that room is not priced at 22%".
 */
function amtBlockedConversion(
  ctx: FindingContext,
  headroomToNext: number,
  marginalRate: number,
  amt: number,
): Finding {
  return {
    id: "roth-headroom",
    severity: "watch",
    category: "retirement",
    headline: `Conversion room cannot be priced off the bracket — this return paid ${fmtUsd(amt)} of AMT`,
    whatTheReturnShows: `Taxable income of ${fmtUsd(n(ctx.facts.deductions.taxableIncome))} (line 15) leaves ${fmtUsd(headroomToNext)} before the next ordinary bracket begins, but the return also reports ${fmtUsd(amt)} of alternative minimum tax (Schedule 2, line 1).`,
    whyItMatters: `Ordinary-income headroom only prices a conversion in a year when the regular calculation is the one that binds. In a year that pays alternative minimum tax the next dollar is taxed under the AMT calculation instead, and inside the AMT exemption phase-out each such dollar also destroys part of that exemption — so the true cost of filling this band can be far above ${fmtPct(marginalRate)}. A conversion cannot be undone once the year closes.`,
    whatToConsider: `Price any conversion for this client against a full AMT calculation for the year rather than against the ${fmtUsd(headroomToNext)} of bracket headroom. This analysis does not read the items that create AMT, so it cannot size that conversion for you.`,
    lineRefs: [
      { form: "Form 1040", line: "line 15", label: "Taxable income", amount: ctx.facts.deductions.taxableIncome },
      { form: "Schedule 2", line: "line 1", label: "Alternative minimum tax", amount: amt },
    ],
    // No dollar claim: the whole point is that this year's cost is not knowable
    // from the bracket, and a number here would be the defect all over again.
    estimatedImpact: null,
    numbers: { headroom: headroomToNext, rate: marginalRate, amt },
  };
}
