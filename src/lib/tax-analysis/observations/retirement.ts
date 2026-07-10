import type { Observation, ObservationContext } from "../types";
import { fmtUsd } from "../format";
import { computeMagi, irmaaTiersFor, currentIrmaaTier, nextIrmaaCliff } from "../irmaa-util";

const IRMAA_RELEVANT_AGE = 63; // MAGI this year sets premiums at 65 (2-year lookback)
const NEAR_CLIFF_DOLLARS = 25000;

export function irmaaCliff(ctx: ObservationContext): Observation | null {
  const age = Math.max(ctx.primaryAge ?? 0, ctx.spouseAge ?? 0);
  if (age < IRMAA_RELEVANT_AGE) return null;
  const magi = computeMagi(ctx.facts);
  if (magi == null) return null;
  const tiers = irmaaTiersFor(ctx.facts, ctx.irmaaParams);
  if (!tiers) return null;

  const premiumYear = ctx.facts.taxYear + 2;
  const current = currentIrmaaTier(magi, tiers);
  const next = nextIrmaaCliff(magi, tiers);

  if (current.tier === 0) {
    if (!next || next.distance > NEAR_CLIFF_DOLLARS) return null;
    return {
      id: "irmaa-cliff",
      severity: "watch",
      title: "Approaching a Medicare IRMAA threshold",
      body: `Your ${ctx.facts.taxYear} MAGI of ${fmtUsd(magi)} sits ${fmtUsd(next.distance)} below the first IRMAA surcharge threshold. Crossing it would raise ${premiumYear} Medicare premiums for each covered person — worth watching before any additional Roth conversions or gain realizations.`,
      numbers: { magi, tier: 0, distanceToNextCliff: next.distance },
    };
  }

  const reduction = magi - current.lower;
  const perPerson = current.partB + current.partD;
  return {
    id: "irmaa-cliff",
    severity: "watch",
    title: `MAGI lands in IRMAA tier ${current.tier}`,
    body: `Your ${ctx.facts.taxYear} MAGI of ${fmtUsd(magi)} falls in IRMAA tier ${current.tier}, adding about ${fmtUsd(perPerson)} per covered person to ${premiumYear} Medicare premiums. Reducing MAGI by ${fmtUsd(reduction)} would have dropped a full tier.`,
    numbers: { magi, tier: current.tier, reductionToDropTier: reduction, surchargePerPerson: perPerson },
  };
}

export function qcd(ctx: ObservationContext): Observation | null {
  const age70 = (ctx.primaryAge ?? 0) >= 70 || (ctx.spouseAge ?? 0) >= 70;
  const iraGross = ctx.facts.income.iraDistributionsGross ?? 0;
  const charitableCash = ctx.facts.deductions.scheduleA?.charitableCash ?? 0;
  const takesStandard = ctx.facts.deductions.deductionTaken === "standard";
  if (!age70 || iraGross <= 0) return null;
  if (charitableCash <= 0 && !takesStandard) return null;

  const why = takesStandard
    ? "Because this return takes the standard deduction, cash gifts to charity produce no federal benefit — but a QCD excludes the gift from income entirely."
    : "A QCD excludes the gift from income rather than deducting it, which also lowers AGI-driven items like IRMAA and taxation of Social Security.";
  return {
    id: "qcd",
    severity: "opportunity",
    title: "Qualified charitable distributions from the IRA",
    body: `With ${fmtUsd(iraGross)} of IRA distributions and charitable intent, giving directly from the IRA via qualified charitable distribution (available from age 70½, up to the annual QCD limit) is likely more tax-efficient. ${why}`,
    numbers: { iraDistributions: iraGross, charitableCash },
  };
}
