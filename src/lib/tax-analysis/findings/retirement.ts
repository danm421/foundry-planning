import type { Finding, FindingContext, FindingLineRef } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { computeMagi, irmaaTiersFor, currentIrmaaTier, nextIrmaaCliff } from "../irmaa-util";
import { marginalRateFor, seTaxOn, selfEmploymentEarnings, totalScheduleCProfit } from "./impact";
import { n } from "../adapter";

const IRMAA_RELEVANT_AGE = 63; // MAGI this year sets premiums at 65 (2-year lookback)
const NEAR_CLIFF_DOLLARS = 25000;

export function irmaaCliff(ctx: FindingContext): Finding | null {
  const age = Math.max(ctx.primaryAge ?? 0, ctx.spouseAge ?? 0);
  if (age < IRMAA_RELEVANT_AGE) return null;
  const magi = computeMagi(ctx.facts);
  if (magi == null) return null;
  const tiers = irmaaTiersFor(ctx.facts, ctx.irmaaParams);
  if (!tiers) return null;

  const premiumYear = ctx.facts.taxYear + 2;
  const current = currentIrmaaTier(magi, tiers);
  const next = nextIrmaaCliff(magi, tiers);
  const lineRefs: FindingLineRef[] = [
    { form: "Form 1040", line: "line 11", label: "Adjusted gross income", amount: ctx.facts.income.agi },
    { form: "Form 1040", line: "line 2a", label: "Tax-exempt interest", amount: ctx.facts.income.taxExemptInterest },
  ];

  if (current.tier === 0) {
    if (!next || next.distance > NEAR_CLIFF_DOLLARS) return null;
    return {
      id: "irmaa-cliff",
      severity: "watch",
      category: "retirement",
      headline: `${fmtUsd(next.distance)} below the first Medicare IRMAA threshold`,
      whatTheReturnShows: `${ctx.facts.taxYear} MAGI — AGI of ${fmtUsd(ctx.facts.income.agi ?? magi)} plus ${fmtUsd(ctx.facts.income.taxExemptInterest ?? 0)} of tax-exempt interest, which counts — is ${fmtUsd(magi)}, sitting ${fmtUsd(next.distance)} below the first surcharge threshold.`,
      whyItMatters: `IRMAA is a cliff, not a phase-in: one dollar over the line adds the full surcharge to ${premiumYear} Part B and Part D premiums for every covered person, for the whole year. Nothing has been incurred here yet, which is exactly why it is worth watching rather than fixing.`,
      whatToConsider: `Any voluntary income before 31 December — a Roth conversion, a gain realization, a lump-sum distribution — should be sized to stay inside ${fmtUsd(next.distance)}. If the line is crossed by a one-off event (a property sale, a job change), Form SSA-44 can appeal the surcharge on a life-changing-event basis.`,
      lineRefs,
      estimatedImpact: null, // nothing incurred yet — a near-miss is not a cost
      numbers: { magi, tier: 0, distanceToNextCliff: next.distance },
    };
  }

  const reduction = magi - current.lower;
  const perPerson = current.partB + current.partD;
  return {
    id: "irmaa-cliff",
    severity: "watch",
    category: "retirement",
    headline: `MAGI lands in IRMAA tier ${current.tier} — about ${fmtUsd(perPerson)} per covered person`,
    whatTheReturnShows: `${ctx.facts.taxYear} MAGI of ${fmtUsd(magi)} — AGI of ${fmtUsd(ctx.facts.income.agi ?? magi)} plus ${fmtUsd(ctx.facts.income.taxExemptInterest ?? 0)} of tax-exempt interest — falls in IRMAA tier ${current.tier}, whose floor is ${fmtUsd(current.lower)}.`,
    whyItMatters: `That adds roughly ${fmtUsd(perPerson)} per covered person to ${premiumYear} Medicare Part B and Part D premiums — a two-person household pays it twice. Because the tiers are cliffs, reducing MAGI by ${fmtUsd(reduction)} would have dropped a full tier and removed the whole step, not a proportion of it.`,
    whatToConsider: `In future years, MAGI-reducing moves — QCDs instead of cash gifts, deferring a gain across the year end, bunching deductible business expenses — are worth more than their marginal rate suggests when they land the return just under a threshold. Form SSA-44 appeals a surcharge caused by a one-off life-changing event.`,
    lineRefs,
    estimatedImpact: perPerson,
    numbers: { magi, tier: current.tier, reductionToDropTier: reduction, surchargePerPerson: perPerson },
  };
}

export function qcd(ctx: FindingContext): Finding | null {
  const age70 = (ctx.primaryAge ?? 0) >= 70 || (ctx.spouseAge ?? 0) >= 70;
  const iraGross = ctx.facts.income.iraDistributionsGross ?? 0;
  const charitableCash = ctx.facts.deductions.scheduleA?.charitableCash ?? 0;
  const takesStandard = ctx.facts.deductions.deductionTaken === "standard";
  if (!age70 || iraGross <= 0) return null;
  if (charitableCash <= 0 && !takesStandard) return null;

  const rate = marginalRateFor(ctx);
  // Only a gift that actually appears on the return can be priced. Without one
  // this is a conditional opportunity, and a dollar figure would invent the gift.
  const impact = charitableCash > 0 && rate != null ? charitableCash * rate : null;

  const lineRefs: FindingLineRef[] = [
    { form: "Form 1040", line: "line 4a", label: "IRA distributions, gross", amount: ctx.facts.income.iraDistributionsGross },
  ];
  if (charitableCash > 0) {
    lineRefs.push({ form: "Schedule A", line: "line 11", label: "Gifts by cash or check", amount: charitableCash });
  }

  const shows =
    charitableCash > 0
      ? `The return reports ${fmtUsd(iraGross)} of gross IRA distributions (line 4a) and ${fmtUsd(charitableCash)} of cash gifts to charity (Schedule A line 11)${takesStandard ? ", against a standard deduction — so the gifts produced no federal deduction at all" : ""}.`
      : `If charitable giving is part of the plan, this return's ${fmtUsd(iraGross)} of gross IRA distributions (line 4a) is the raw material for it. No cash gift appears on this return, so nothing here asserts one was made.`;

  const why = takesStandard
    ? `A qualified charitable distribution excludes the gift from income entirely rather than deducting it, so it works even on a return that takes the standard deduction — where a cash gift is worth nothing federally. ${impact != null ? `At this return's marginal rate that is about ${fmtUsd(impact)} of federal tax the same giving would avoid.` : "The saving equals the gift amount times the marginal rate once a gift is actually made."} Excluding the distribution also lowers AGI, which drives IRMAA, the taxable share of Social Security, and the medical-expense floor.`
    : `A QCD excludes the gift from income rather than deducting it. ${impact != null ? `At this return's marginal rate that is worth about ${fmtUsd(impact)}.` : ""} Because it never enters AGI, it also reduces IRMAA exposure and the taxable share of Social Security — which an itemized deduction does not.`;

  return {
    id: "qcd",
    severity: "opportunity",
    category: "retirement",
    headline: charitableCash > 0
      ? `Give from the IRA instead of cash — about ${fmtUsd(charitableCash)} is currently routed the expensive way`
      : "Qualified charitable distributions are available from the IRA",
    whatTheReturnShows: shows,
    whyItMatters: why,
    whatToConsider: `From age 70½ a QCD can go directly from the IRA custodian to the charity, up to the annual QCD limit, and it counts toward the RMD. The transfer must go custodian-to-charity — a distribution taken personally and then donated does not qualify, and cannot be fixed after the fact.`,
    lineRefs,
    estimatedImpact: impact,
    numbers: {
      iraDistributions: iraGross,
      charitableCash,
      ...(rate != null ? { marginalRate: rate } : {}),
    },
  };
}

/** Below this, a plan is usually still worth having but the finding is noise
 *  next to the administrative cost of opening one. */
const SE_PLAN_MIN_EARNINGS = 10000;

/** Employer-side share of net SE earnings after the half-SE-tax reduction —
 *  the 25%-of-compensation limit expressed as 20% of self-employed net, which
 *  is the standard restatement for someone with no W-2 from their own business. */
const EMPLOYER_SHARE = 0.2;

export function seRetirementPlanGap(ctx: FindingContext): Finding | null {
  const detail = ctx.facts.income.adjustmentsDetail;
  // A null block means Schedule 1 Part II was never extracted. We cannot claim
  // "nothing on line 16" for a return we never read line 16 from.
  if (!detail) return null;
  if (n(detail.sepSimpleSolo401k) > 0) return null;

  const seEarnings = selfEmploymentEarnings(ctx.facts);
  if (seEarnings < SE_PLAN_MIN_EARNINGS) return null;

  const halfSeTax = seTaxOn(seEarnings, ctx) / 2;
  const contributionBase = seEarnings - halfSeTax;
  const elective = ctx.params.contribLimits.ira401kElective;
  const contribution = Math.min(elective + EMPLOYER_SHARE * contributionBase, contributionBase);
  const rate = marginalRateFor(ctx);
  const impact = rate != null ? contribution * rate : null;

  const scheduleC = totalScheduleCProfit(ctx.facts);
  const guaranteed = seEarnings - scheduleC;
  const source =
    scheduleC > 0 && guaranteed > 0
      ? `${fmtUsd(scheduleC)} of Schedule C profit and ${fmtUsd(guaranteed)} of partnership guaranteed payments`
      : scheduleC > 0
        ? `${fmtUsd(scheduleC)} of Schedule C profit (Schedule 1 line 3)`
        : `${fmtUsd(guaranteed)} of partnership guaranteed payments`;

  return {
    id: "se-retirement-plan-gap",
    severity: "opportunity",
    category: "retirement",
    headline: `No self-employed retirement plan against ${fmtUsd(seEarnings)} of SE income`,
    whatTheReturnShows: `The return reports ${source}, carries ${fmtUsd(n(detail.seTaxDeduction))} of half-SE-tax deduction on Schedule 1 line 15 — and nothing at all on line 16, the SEP, SIMPLE and qualified-plan line.`,
    whyItMatters: `Self-employment income supports a far larger deductible contribution than a salaried job does, because the owner is both employee and employer. On ${fmtUsd(contributionBase)} of net earnings after the half-SE-tax reduction, a solo 401(k) supports roughly ${fmtUsd(elective)} of elective deferral plus ${fmtPct(EMPLOYER_SHARE)} of net as the employer share — about ${fmtUsd(contribution)}${impact != null ? `, worth roughly ${fmtUsd(impact)} of federal tax at this return's marginal rate` : ""}. Nothing on line 16 means none of that was taken.`,
    whatToConsider: `A solo 401(k) generally maximises the contribution at this income level; a SEP-IRA is simpler but has no elective-deferral component, so it needs materially more profit to reach the same number. The figure above is before any age-50 catch-up and is still subject to the annual defined-contribution limit, so treat it as the shape of the opportunity rather than the exact deposit. A solo 401(k) must be established by year end even where the funding deadline is later.`,
    lineRefs: [
      { form: "Schedule 1", line: "line 3", label: "Business income", amount: ctx.facts.income.scheduleCNet },
      { form: "Schedule 1", line: "line 16", label: "SEP, SIMPLE and qualified plans", amount: detail.sepSimpleSolo401k },
      { form: "Schedule 2", line: "line 4", label: "Self-employment tax", amount: ctx.facts.tax.seTax },
    ],
    estimatedImpact: impact,
    numbers: {
      seEarnings,
      halfSeTax,
      contribution,
      ...(rate != null ? { marginalRate: rate } : {}),
    },
  };
}
