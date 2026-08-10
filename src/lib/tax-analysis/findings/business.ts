import type { Finding, FindingContext, FindingLineRef } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { n } from "../adapter";
import { marginalRateFor, seTaxOn, totalScheduleCProfit, selfEmploymentEarnings } from "./impact";

/** §199A statutory deduction rate. */
const QBI_RATE = 0.2;

/** Below this, the payroll administration, separate return and reasonable-comp
 *  exposure of an S-corp usually cost more than the SE tax it saves. A floor,
 *  not a rule — the prose says the trade has to be priced. */
const S_CORP_PROFIT_FLOOR = 50000;

/** Below this an SE retirement or health finding is noise. */
const SE_MIN_EARNINGS = 10000;

function qbiThresholdFor(ctx: FindingContext): number | null {
  const fs = ctx.facts.filingStatus;
  if (!fs) return null;
  return fs === "married_joint"
    ? ctx.params.qbi.thresholdMfj
    : ctx.params.qbi.thresholdSingleHohMfs;
}

export function qbiPhaseoutPosition(ctx: FindingContext): Finding | null {
  const qbi = ctx.facts.deductions.qbi;
  // A null block means Form 8995 was never extracted — the 1040 line 13 scalar
  // alone cannot say where in the phase-out the return sits.
  if (!qbi) return null;
  const qualified = qbi.qualifiedBusinessIncome;
  if (qualified == null || qualified <= 0) return null;

  const threshold = qbiThresholdFor(ctx);
  const ti = ctx.facts.deductions.taxableIncome;
  const taken = n(ctx.facts.deductions.qbiDeduction);
  if (threshold == null || ti == null) return null;

  // Line 15 is AFTER the QBI deduction; the §199A threshold test is applied to
  // taxable income BEFORE it.
  const tiBeforeQbi = ti + taken;
  if (tiBeforeQbi < threshold) return null;

  const full = QBI_RATE * qualified;
  const shortfall = Math.max(0, full - taken);
  const rate = marginalRateFor(ctx);
  const impact = rate != null ? shortfall * rate : null;
  const overThreshold = tiBeforeQbi - threshold;

  const lineRefs: FindingLineRef[] = [
    { form: "Form 1040", line: "line 13", label: "Qualified business income deduction", amount: ctx.facts.deductions.qbiDeduction },
    { form: "Form 1040", line: "line 15", label: "Taxable income", amount: ti },
    { form: "Form 8995", line: "qualified business income", label: "Qualified business income", amount: qualified },
  ];
  if (qbi.w2Wages != null) {
    lineRefs.push({ form: "Form 8995-A", line: "line 19", label: "W-2 wages from the business", amount: qbi.w2Wages });
  }

  const sstbNote = qbi.sstbPresent
    ? ` The return also flags a specified service trade or business, whose deduction disappears entirely — not merely caps — once income clears the top of the phase-in range.`
    : "";

  return {
    id: "qbi-phaseout-position",
    severity: shortfall > 0 ? "opportunity" : "info",
    category: "business",
    headline: shortfall > 0
      ? `QBI deduction capped ${fmtUsd(shortfall)} below the full 20%`
      : `QBI deduction is above the phase-out threshold but still unrestricted`,
    whatTheReturnShows: `Qualified business income of ${fmtUsd(qualified)} would support a full ${fmtPct(QBI_RATE)} deduction of ${fmtUsd(full)}, but the return claims ${fmtUsd(taken)} on line 13. Taxable income before the deduction is ${fmtUsd(tiBeforeQbi)} — ${fmtUsd(overThreshold)} above the ${fmtUsd(threshold)} §199A threshold${qbi.w2Wages != null ? `, against ${fmtUsd(qbi.w2Wages)} of W-2 wages paid by the business` : ""}.`,
    whyItMatters: `Past the threshold, §199A stops being a flat ${fmtPct(QBI_RATE)} and becomes the lesser of that and a wage-and-property test — broadly 50% of the business's W-2 wages, or 25% of wages plus 2.5% of the unadjusted basis of qualified property. ${shortfall > 0 ? `Here the limit is binding, and ${fmtUsd(shortfall)} of deduction${impact != null ? ` — about ${fmtUsd(impact)} of federal tax` : ""} is unavailable purely because of the wage figure, not because of the profit.` : `Here the limit is not yet binding, so the full deduction survives.`}${sstbNote}`,
    whatToConsider: `Two levers move this and both need to happen before year end: raising W-2 wages from the entity (which itself costs payroll tax, so the trade has to be priced, not assumed), and reducing taxable income below the threshold via deductible retirement contributions — a dollar of deferral there can be worth far more than its marginal rate because it also restores deduction. Aggregating commonly-controlled businesses under §1.199A-4 sometimes helps where one entity has the wages and another the income.`,
    lineRefs,
    estimatedImpact: impact,
    numbers: {
      qualifiedBusinessIncome: qualified,
      fullTwentyPercent: full,
      qbiDeduction: taken,
      shortfall,
      threshold,
      taxableIncomeBeforeQbi: tiBeforeQbi,
      ...(qbi.w2Wages != null ? { w2Wages: qbi.w2Wages } : {}),
      ...(rate != null ? { marginalRate: rate } : {}),
    },
  };
}

export function sCorpElection(ctx: FindingContext): Finding | null {
  const profit = totalScheduleCProfit(ctx.facts);
  if (profit < S_CORP_PROFIT_FLOOR) return null;

  // The FULL Schedule SE tax currently paid on that profit. An election
  // REDUCES this — it never eliminates it, because a reasonable salary still
  // carries payroll tax and this return cannot size the distribution share.
  // The figure is therefore an honest ceiling, and the prose says so.
  const seTax = seTaxOn(profit, ctx);

  return {
    id: "s-corp-election",
    severity: "opportunity",
    category: "business",
    headline: `${fmtUsd(seTax)} of self-employment tax on ${fmtUsd(profit)} of Schedule C profit`,
    whatTheReturnShows: `The return reports ${fmtUsd(profit)} of Schedule C net profit (Schedule 1 line 3), carrying ${fmtUsd(n(ctx.facts.tax.seTax) || seTax)} of self-employment tax on Schedule 2 line 4, half of which comes back as a ${fmtUsd(n(ctx.facts.income.adjustmentsDetail?.seTaxDeduction))} adjustment on Schedule 1 line 15.`,
    whyItMatters: `A sole proprietorship pays SE tax on every dollar of profit. An S-corp splits the same profit into a W-2 salary, which still carries full payroll tax, and a distribution, which does not — so an election **reduces** this figure but **never eliminates** it. ${fmtUsd(seTax)} is the whole amount currently in play, not the saving: the actual saving is payroll tax on the distribution share only, and this return carries nothing that says what a reasonable salary for this work would be.`,
    whatToConsider: `Price the trade properly before electing. Against the saving, set the cost of running payroll, a separate 1120-S return, and the reasonable-compensation exposure that comes with it — an IRS challenge to a salary that is too low recharacterises distributions and adds penalties. The election is also not free to reverse: revoking generally locks the entity out of re-electing for five years. A documented compensation study is what makes the position defensible.`,
    lineRefs: [
      { form: "Schedule 1", line: "line 3", label: "Business income", amount: ctx.facts.income.scheduleCNet },
      { form: "Schedule 2", line: "line 4", label: "Self-employment tax", amount: ctx.facts.tax.seTax },
      { form: "Schedule 1", line: "line 15", label: "Deductible part of self-employment tax", amount: ctx.facts.income.adjustmentsDetail?.seTaxDeduction ?? null },
    ],
    estimatedImpact: seTax,
    numbers: { scheduleCProfit: profit, seTax },
  };
}

export function seHealthInsurance(ctx: FindingContext): Finding | null {
  const detail = ctx.facts.income.adjustmentsDetail;
  // Same rule as se-retirement-plan-gap: a null block means Schedule 1 Part II
  // was never extracted, and absence of evidence is not evidence of absence.
  if (!detail) return null;
  if (n(detail.selfEmployedHealthInsurance) > 0) return null;
  const seEarnings = selfEmploymentEarnings(ctx.facts);
  if (seEarnings < SE_MIN_EARNINGS) return null;

  return {
    id: "se-health-insurance",
    severity: "opportunity",
    category: "business",
    headline: "No self-employed health insurance deduction against SE income",
    whatTheReturnShows: `The return reports ${fmtUsd(seEarnings)} of self-employment earnings but nothing on Schedule 1 line 17, the self-employed health insurance deduction. The return does not state what premiums, if any, were actually paid.`,
    whyItMatters: `Line 17 is an above-the-line deduction for medical, dental and qualifying long-term-care premiums for the owner, spouse and dependents, up to the net profit of the business. Above the line matters here: unlike a Schedule A medical deduction it faces no 7.5%-of-AGI floor, needs no itemizing, and reduces AGI — which in turn moves IRMAA, the child tax credit, education credits and NIIT. It does not reduce self-employment tax.`,
    whatToConsider: `Confirm whether premiums were paid and simply not captured, which is the common case. The deduction is unavailable for any month the taxpayer was eligible for an employer-subsidised plan through their own or a spouse's job, so that eligibility question decides it. For an S-corp owner the premiums must be run through the entity's payroll and appear on the owner's W-2 to qualify.`,
    lineRefs: [
      { form: "Schedule 1", line: "line 3", label: "Business income", amount: ctx.facts.income.scheduleCNet },
      { form: "Schedule 1", line: "line 17", label: "Self-employed health insurance deduction", amount: detail.selfEmployedHealthInsurance },
    ],
    estimatedImpact: null, // the return does not state the premium — a figure here would be invented
    numbers: { seEarnings },
  };
}

export function guaranteedPaymentsSeTax(ctx: FindingContext): Finding | null {
  // entityType is load-bearing: guaranteed payments carry SE tax on a
  // partnership K-1, and the concept does not exist on an S-corp one. A null
  // type means we do not know which, so the finding must not fire.
  const partners = ctx.facts.k1s.filter(
    (k) => k.entityType === "partnership" && n(k.guaranteedPayments) > 0,
  );
  if (partners.length === 0) return null;

  const total = partners.reduce((sum, k) => sum + n(k.guaranteedPayments), 0);
  const seTax = seTaxOn(total, ctx);
  const names = partners.map((k) => k.entityName ?? "an unnamed partnership").join(", ");

  return {
    id: "guaranteed-payments-se-tax",
    severity: "watch",
    category: "business",
    headline: `${fmtUsd(total)} of guaranteed payments carry about ${fmtUsd(seTax)} of self-employment tax`,
    whatTheReturnShows: `${names} reported ${fmtUsd(total)} of guaranteed payments on Schedule K-1 box 4, alongside ${fmtUsd(ctx.facts.k1s.reduce((s, k) => s + n(k.ordinaryBusinessIncome), 0))} of ordinary business income. Schedule 2 line 4 carries ${fmtUsd(n(ctx.facts.tax.seTax))} of self-employment tax.`,
    whyItMatters: `Guaranteed payments are compensation for services, so they are subject to self-employment tax in full — unlike an S-corp distribution, and unlike the passive share of partnership income for a limited partner. They are also excluded from qualified business income, so every dollar routed this way is a dollar that earns no §199A deduction either. Both effects push the same direction.`,
    whatToConsider: `Where the partnership agreement allows, a preferred profit allocation can sometimes achieve the same economics as a guaranteed payment while preserving QBI treatment — the trade-off is that an allocation depends on the partnership having profit and a guaranteed payment does not. This is a partnership-agreement amendment, not a filing position, so it changes future years only. Confirm the treatment with the entity's own CPA before restructuring.`,
    lineRefs: [
      ...partners.map((k) => ({
        form: `Schedule K-1 (Form 1065) — ${k.entityName ?? "unnamed partnership"}`,
        line: "box 4",
        label: "Guaranteed payments",
        amount: k.guaranteedPayments,
      })),
      { form: "Schedule 2", line: "line 4", label: "Self-employment tax", amount: ctx.facts.tax.seTax },
    ],
    estimatedImpact: seTax,
    numbers: { guaranteedPayments: total, seTax },
  };
}

export function businessLossMix(ctx: FindingContext): Finding | null {
  const businesses = ctx.facts.businesses.filter((b) => b.netProfit != null);
  const profitable = businesses.filter((b) => n(b.netProfit) > 0);
  const losing = businesses.filter((b) => n(b.netProfit) < 0);
  // The whole point is the MIX. A single losing business is just a loss; the
  // aggregate on Schedule 1 line 3 only misleads when both signs are present.
  if (profitable.length === 0 || losing.length === 0) return null;

  const totalProfit = profitable.reduce((sum, b) => sum + n(b.netProfit), 0);
  const totalLoss = Math.abs(losing.reduce((sum, b) => sum + n(b.netProfit), 0));
  const net = totalProfit - totalLoss;

  return {
    id: "business-loss-mix",
    severity: "watch",
    category: "business",
    headline: `${fmtUsd(totalLoss)} of business losses are netted against ${fmtUsd(totalProfit)} of profit on one line`,
    whatTheReturnShows: `${businesses.length} Schedule C businesses report to a single ${fmtUsd(net)} on Schedule 1 line 3: ${profitable.map((b) => `${b.name ?? "an unnamed business"} at ${fmtUsd(n(b.netProfit))}`).join(", ")} against ${losing.map((b) => `${b.name ?? "an unnamed business"} at ${fmtUsd(n(b.netProfit))}`).join(", ")}.`,
    whyItMatters: `The aggregate describes neither business. A loss-making venture beside a profitable one raises three separate questions the netted line hides: whether the losing activity is a business or a §183 hobby (which would deny the loss entirely), whether its losses are passive and therefore suspended rather than deducted, and — at larger scale — whether §461(l) caps the excess business loss that can offset non-business income in one year, deferring the rest to an NOL carryforward. Each of those has a different answer and a different fix.`,
    whatToConsider: `Confirm the losing activity has a genuine profit motive and the contemporaneous records to show it, since §183 turns on facts rather than on the numbers. Check whether the taxpayer materially participates, because a passive loss is suspended, not lost. Where the loss is large relative to other income, model the §461(l) limitation before assuming it lands in full this year.`,
    lineRefs: businesses.map((b) => ({
      form: `Schedule C — ${b.name ?? "unnamed"}`,
      line: "line 31",
      label: "Net profit or loss",
      amount: b.netProfit,
    })),
    estimatedImpact: totalLoss,
    numbers: { totalProfit, totalLoss, net, businessCount: businesses.length },
  };
}

export function reasonableCompensation(ctx: FindingContext): Finding | null {
  // S-corp only. Reasonable compensation is an S-corp doctrine; applying it to
  // a partnership is simply wrong, and a null entityType means we cannot tell.
  const sCorps = ctx.facts.k1s.filter((k) => k.entityType === "s_corp");
  if (sCorps.length === 0) return null;

  const entity = sCorps.reduce((a, b) =>
    n(b.ordinaryBusinessIncome) > n(a.ordinaryBusinessIncome) ? b : a,
  );
  const distributiveShare = n(entity.ordinaryBusinessIncome);
  if (distributiveShare <= 0) return null;
  const ownerWages = entity.w2WagesFromEntity;
  const name = entity.entityName ?? "the S-corporation";
  const known = ownerWages != null;

  const lineRefs: FindingLineRef[] = [
    { form: "Schedule K-1 (Form 1120-S)", line: "box 1", label: "Ordinary business income", amount: entity.ordinaryBusinessIncome },
  ];
  if (known) {
    lineRefs.push({ form: "Form W-2", line: "box 1", label: `Owner wages from ${name}`, amount: ownerWages });
  }

  return {
    id: "reasonable-compensation",
    // Sized exposure when the wage is known; a verify-this note when it is not.
    // Three severities leave no rung between watch and info, so the pair sits
    // one step down rather than putting an IRS exposure under "Opportunities".
    severity: known ? "watch" : "info",
    category: "business",
    headline: known
      ? `${fmtUsd(distributiveShare)} of ${name} income passed through against ${fmtUsd(ownerWages)} of owner wages`
      : `${name}'s owner compensation is not on this return`,
    whatTheReturnShows: known
      ? `${name} passed through ${fmtUsd(distributiveShare)} of ordinary business income on Schedule K-1 box 1, while the owner's W-2 from that entity is ${fmtUsd(ownerWages)}.`
      : `${name} passed through ${fmtUsd(distributiveShare)} of ordinary business income on Schedule K-1 box 1. The 1040 reports ${fmtUsd(n(ctx.facts.income.wages))} of total wages across every employer, which does not say how much of it — if any — came from this entity.`,
    whyItMatters: `An S-corp owner who works in the business must take reasonable compensation as W-2 wages before taking distributions. The IRS tests the wage against the distributive share, and where it is too low it recharacterises distributions as wages, adding payroll tax, interest and penalties. ${known ? `The ${fmtUsd(distributiveShare)} beside this finding is the amount being tested, not an amount owed.` : `Nothing on this return can size that test, which is why no figure appears beside this finding.`}`,
    whatToConsider: known
      ? `Compare the wage against what the role would pay at arm's length — a documented compensation study using regional salary data is what makes the position defensible under examination. The exposure runs both ways: a wage set too high gives away the payroll-tax saving that motivated the election, and it also caps the §199A deduction, which turns on the entity's W-2 wages.`
      : `Verify the owner's W-2 from this entity before drawing any conclusion — assign it on the K-1 row in the review form and this finding will size itself. Nothing here asserts the compensation is wrong; only that the return does not show it.`,
    lineRefs,
    estimatedImpact: known ? distributiveShare : null,
    numbers: {
      distributiveShare,
      ...(known ? { ownerWages } : {}),
    },
  };
}
