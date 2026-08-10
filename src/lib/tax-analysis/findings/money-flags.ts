import type { Finding, FindingContext, FindingLineRef } from "../types";
import type { TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFilingStatus } from "@/lib/schemas/tax-return-facts";
import { fmtUsd, fmtPct } from "../format";
import { n, resolveLtcg } from "../adapter";
import { marginalRateFor } from "./impact";

/**
 * Illustrative federal underpayment rate, used ONLY to give the safe-harbor
 * shortfall a sortable dollar magnitude. The real rate is the federal
 * short-term rate plus three points, resets quarterly, and has run roughly
 * 7–8% in recent years. It is deliberately NOT a seeded TaxYearParameter and
 * deliberately NOT fetched — the prose calls it illustrative, and a fetched
 * "precise" figure would be fabricated. Do not replace this with a web lookup.
 */
export const ESTIMATED_UNDERPAYMENT_RATE = 0.08;

/** How much of a capital-loss carryover a single year can use against ordinary
 *  income (§1211(b)). The remainder only offsets gains that have not been
 *  realized, so pricing the whole carryover would invent a transaction. */
const ANNUAL_ORDINARY_LOSS_LIMIT = 3000;

/** niitExposure and additionalMedicare both key the same three-way MFJ/MFS/single
 *  threshold shape off filing status — one lookup instead of two duplicated ternaries. */
function thresholdFor(
  fs: TaxReturnFilingStatus,
  t: TaxYearParameters["niitThreshold"] | TaxYearParameters["addlMedicareThreshold"],
): number {
  return fs === "married_joint" ? t.mfj : fs === "married_separate" ? t.mfs : t.single;
}

export function charitableBunching(ctx: FindingContext): Finding | null {
  const d = ctx.facts.deductions;
  const fs = ctx.facts.filingStatus;
  if (!fs) return null;
  const std = ctx.params.stdDeduction[fs];
  const charitable = n(d.scheduleA?.charitableCash) + n(d.scheduleA?.charitableNonCash);
  const rate = marginalRateFor(ctx);

  if (d.deductionTaken === "standard" && charitable > 0) {
    const impact = rate != null ? charitable * rate : null;
    return {
      id: "charitable-bunching",
      severity: "opportunity",
      category: "deductions",
      headline: `${fmtUsd(charitable)} of charitable giving produced no federal deduction`,
      whatTheReturnShows: `Schedule A records ${fmtUsd(charitable)} of gifts to charity, but the return took the ${fmtUsd(std)} standard deduction (line 12) — so Schedule A was never used and the gifts changed the tax by nothing.`,
      whyItMatters: `Charitable gifts are only worth anything federally once total itemized deductions clear the standard deduction. Below that line every dollar given is a dollar of after-tax money with no tax effect${impact != null ? `; at this return's marginal rate the giving already made would have been worth about ${fmtUsd(impact)} had it landed in an itemizing year` : ""}.`,
      whatToConsider: `Bunching two or three years of intended giving into a single year pushes that year above the standard deduction while the intervening years still claim it. A donor-advised fund is the usual vehicle — the deduction lands in the funding year, and grants to the charities can still be paced out annually. For a filer over 70½ with an IRA, a qualified charitable distribution beats both.`,
      lineRefs: [
        { form: "Form 1040", line: "line 12", label: "Standard deduction taken", amount: d.deductionAmount },
        { form: "Schedule A", line: "line 11", label: "Gifts by cash or check", amount: d.scheduleA?.charitableCash ?? null },
        { form: "Schedule A", line: "line 12", label: "Gifts other than by cash or check", amount: d.scheduleA?.charitableNonCash ?? null },
      ],
      estimatedImpact: impact,
      numbers: {
        charitable,
        standardDeduction: std,
        ...(rate != null ? { marginalRate: rate } : {}),
      },
    };
  }

  if (d.deductionTaken === "itemized" && d.deductionAmount != null) {
    const gap = d.deductionAmount - std;
    if (gap >= 0 && gap <= 0.2 * std) {
      return {
        id: "charitable-bunching",
        severity: "opportunity",
        category: "deductions",
        headline: `Itemizing beat the standard deduction by only ${fmtUsd(gap)}`,
        whatTheReturnShows: `Itemized deductions of ${fmtUsd(d.deductionAmount)} (line 12) exceed the ${fmtUsd(std)} standard deduction by ${fmtUsd(gap)}. Everything below that first ${fmtUsd(std)} was available without itemizing at all.`,
        whyItMatters: `Only the ${fmtUsd(gap)} above the standard deduction is doing any work. Spread evenly across years, most deductible spending in a return this close to the line buys nothing — the same total spread unevenly buys the excess twice.`,
        whatToConsider: `Alternate: concentrate the discretionary deductible items — charitable gifts above all, plus elective medical and any state tax payment whose timing is genuinely flexible — into every other year, and take the standard deduction in between. The multi-year gain depends on how far the bunched year clears the line, which one return cannot show.`,
        lineRefs: [
          { form: "Form 1040", line: "line 12", label: "Itemized deductions", amount: d.deductionAmount },
          { form: "Schedule A", line: "line 11", label: "Gifts by cash or check", amount: d.scheduleA?.charitableCash ?? null },
        ],
        estimatedImpact: null, // depends on the bunched year's size — not sourceable from one return
        numbers: { gapOverStandard: gap, standardDeduction: std },
      };
    }
  }
  return null;
}

export function niitExposure(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  const fs = f.filingStatus;
  if (!fs || f.income.agi == null) return null;
  const threshold = thresholdFor(fs, ctx.params.niitThreshold);
  const ltcg = Math.max(0, resolveLtcg(f) ?? 0);
  const nii = n(f.income.taxableInterest) + n(f.income.ordinaryDividends) + ltcg + Math.max(0, n(f.income.netShortTermGain));
  if (nii <= 0) return null;
  const excess = f.income.agi - threshold;
  if (excess <= 0) return null;
  const exposed = Math.min(nii, excess);
  const estTax = exposed * ctx.params.niitRate;
  return {
    id: "niit-exposure",
    severity: "watch",
    category: "investments",
    headline: `${fmtUsd(estTax)} of net investment income tax on ${fmtUsd(exposed)} of investment income`,
    whatTheReturnShows: `AGI of ${fmtUsd(f.income.agi)} (line 11) exceeds the ${fmtUsd(threshold)} NIIT threshold by ${fmtUsd(excess)}. Against ${fmtUsd(nii)} of investment income — interest, dividends and realized gains — that leaves ${fmtUsd(exposed)} subject to the ${fmtPct(ctx.params.niitRate)} surtax, about ${fmtUsd(estTax)}.`,
    whyItMatters: `NIIT is charged on the LESSER of net investment income and the AGI excess, so it can be reduced from either side — and unlike the brackets it is a flat add-on that no deduction inside AGI escapes. It is also unindexed: the ${fmtUsd(threshold)} threshold has not moved since 2013, so ordinary income growth pulls more households in every year.`,
    whatToConsider: `Municipal bond interest is outside net investment income entirely; tax-managed and low-turnover funds throw off less of it; and gains timed into a year when AGI sits below the threshold escape it completely. Deferrals that cut AGI — a retirement-plan contribution, an HSA — reduce the excess side of the same lesser-of test.`,
    lineRefs: [
      { form: "Form 1040", line: "line 11", label: "Adjusted gross income", amount: f.income.agi },
      { form: "Form 1040", line: "line 2b", label: "Taxable interest", amount: f.income.taxableInterest },
      { form: "Form 1040", line: "line 3b", label: "Ordinary dividends", amount: f.income.ordinaryDividends },
      { form: "Form 1040", line: "line 7", label: "Capital gain or loss", amount: f.income.capitalGainOrLoss },
      { form: "Schedule 2", line: "line 12", label: "Net investment income tax", amount: f.tax.niit },
    ],
    estimatedImpact: estTax,
    numbers: { exposed, estTax, threshold },
  };
}

export function additionalMedicare(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  const fs = f.filingStatus;
  if (!fs) return null;
  const threshold = thresholdFor(fs, ctx.params.addlMedicareThreshold);
  const earned = n(f.income.wages) + Math.max(0, n(f.income.scheduleCNet));
  if (earned <= threshold) return null;
  const excess = earned - threshold;
  const estTax = excess * ctx.params.addlMedicareRate;
  return {
    id: "additional-medicare",
    severity: "info",
    category: "withholding",
    headline: `${fmtUsd(estTax)} of Additional Medicare Tax on earned income`,
    whatTheReturnShows: `Earned income of ${fmtUsd(earned)} — wages (line 1a) plus any Schedule C profit — exceeds the ${fmtUsd(threshold)} threshold by ${fmtUsd(excess)}, adding about ${fmtUsd(estTax)} at ${fmtPct(ctx.params.addlMedicareRate)}.`,
    whyItMatters: `The tax itself is unavoidable at this income; the withholding is where it goes wrong. Each employer withholds only once a single job passes $200,000, so a two-earner couple who each earn under that — but jointly clear ${fmtUsd(threshold)} — has nothing withheld against it and meets the whole amount at filing.`,
    whatToConsider: `Check that the balance due at filing is not being driven by this. If it is, the fix is a W-4 extra-withholding amount rather than a quarterly estimate, because withholding is treated as paid evenly across the year regardless of when it actually happened.`,
    lineRefs: [
      { form: "Form 1040", line: "line 1a", label: "Wages", amount: f.income.wages },
      { form: "Schedule 1", line: "line 3", label: "Business income", amount: f.income.scheduleCNet },
      { form: "Schedule 2", line: "line 11", label: "Additional Medicare Tax", amount: f.tax.additionalMedicareTax },
    ],
    estimatedImpact: estTax,
    numbers: { excess, estTax },
  };
}

export function safeHarbor(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  if (f.tax.totalTax == null) return null;
  const payments = n(f.payments.withholding) + n(f.payments.estimatedPayments) + n(f.payments.otherPayments);
  const currentHarbor = 0.9 * f.tax.totalTax;
  const priorTax = ctx.prior?.tax.totalTax;
  const priorHarbor =
    priorTax != null
      ? (n(ctx.prior?.income.agi) > 150000 ? 1.1 : 1.0) * priorTax
      : null;
  const required = priorHarbor != null ? Math.min(currentHarbor, priorHarbor) : currentHarbor;

  const lineRefs: FindingLineRef[] = [
    { form: "Form 1040", line: "line 24", label: "Total tax", amount: f.tax.totalTax },
    { form: "Form 1040", line: "line 25d", label: "Federal income tax withheld", amount: f.payments.withholding },
    { form: "Form 1040", line: "line 26", label: "Estimated tax payments", amount: f.payments.estimatedPayments },
  ];

  if (payments < required) {
    const shortfall = required - payments;
    const impact = shortfall * ESTIMATED_UNDERPAYMENT_RATE;
    return {
      id: "safe-harbor",
      severity: "watch",
      category: "withholding",
      headline: `Payments fell ${fmtUsd(shortfall)} short of the estimated-tax safe harbor`,
      whatTheReturnShows: `Withholding and estimates total ${fmtUsd(payments)} against a safe-harbor requirement of ${fmtUsd(required)}${priorHarbor != null ? " — the lesser of 90% of this year's tax and the prior-year test" : " (90% of this year's total tax of " + fmtUsd(f.tax.totalTax) + ")"}, a shortfall of ${fmtUsd(shortfall)}.`,
      whyItMatters: `Missing the harbor exposes the return to the §6654 underpayment penalty, which is interest-like and charged per quarter on the amount that was late. At an illustrative ${fmtPct(ESTIMATED_UNDERPAYMENT_RATE)} annual rate that is roughly ${fmtUsd(impact)} on this shortfall — the statutory rate is the federal short-term rate plus three points and resets quarterly, so treat the figure as an order of magnitude, not a computed penalty.`,
      whatToConsider: `Increasing withholding is usually the cleanest fix, because withholding counts as paid evenly across the year no matter when it happened — a December adjustment can therefore repair a shortfall that a December estimated payment cannot. Meeting the prior-year test (100% of last year's tax, 110% above ${fmtUsd(150000)} of AGI) removes the penalty regardless of how the current year turns out.`,
      lineRefs,
      estimatedImpact: impact,
      numbers: { payments, required, shortfall },
    };
  }

  if (n(f.payments.amountOwed) > 1000) {
    const owed = n(f.payments.amountOwed);
    return {
      id: "safe-harbor",
      severity: "info",
      category: "withholding",
      headline: `${fmtUsd(owed)} due at filing, though the safe harbor was met`,
      whatTheReturnShows: `Payments of ${fmtUsd(payments)} cleared the ${fmtUsd(required)} safe harbor, so no underpayment penalty arises — but ${fmtUsd(owed)} was still due at filing (line 37).`,
      whyItMatters: `There is no penalty here, so this is a cash-flow and expectations item rather than a tax one. A recurring four-figure April bill usually means withholding is calibrated to one income source while a second — a spouse's wages, self-employment, investment income — carries no withholding at all.`,
      whatToConsider: `If the April bill is unwelcome, a W-4 extra-withholding amount spreads it across the year. If it is deliberate, nothing needs to change: money held until April rather than withheld in January is, at worst, neutral once the harbor is met.`,
      lineRefs: [...lineRefs, { form: "Form 1040", line: "line 37", label: "Amount you owe", amount: f.payments.amountOwed }],
      estimatedImpact: null, // no penalty was incurred — the balance is not a cost
      numbers: { amountOwed: owed },
    };
  }
  return null;
}

export function capitalLossCarryover(ctx: FindingContext): Finding | null {
  const carryover = ctx.facts.carryovers.capitalLossCarryover;
  if (carryover == null || carryover <= 0) return null;
  const rate = marginalRateFor(ctx);
  const usableThisYear = Math.min(carryover, ANNUAL_ORDINARY_LOSS_LIMIT);
  const impact = rate != null ? usableThisYear * rate : null;
  return {
    id: "capital-loss-carryover",
    severity: "info",
    category: "investments",
    headline: `${fmtUsd(carryover)} of capital losses carried forward`,
    whatTheReturnShows: `The return carries ${fmtUsd(carryover)} of unused capital losses into future years, of which ${fmtUsd(usableThisYear)} can be applied against ordinary income in any single year.`,
    whyItMatters: `The carryover never expires and is not reduced by inflation, but it is only fully usable against realized capital GAINS. Applied to ordinary income it is rationed at ${fmtUsd(ANNUAL_ORDINARY_LOSS_LIMIT)} a year — about ${impact != null ? fmtUsd(impact) : "one year's marginal rate on " + fmtUsd(usableThisYear)} of tax annually, which is why the figure beside this finding is the annual amount and not the whole balance.`,
    whatToConsider: `The carryover is cover for moves that would otherwise be expensive: rebalancing a concentrated position, exiting a legacy fund with a large embedded gain, or harvesting gains up to the loss balance. Realizing gains against it converts a slow ${fmtUsd(ANNUAL_ORDINARY_LOSS_LIMIT)}-a-year drip into full value in one year.`,
    lineRefs: [
      { form: "Schedule D", line: "carryover worksheet", label: "Capital loss carryover", amount: carryover },
    ],
    estimatedImpact: impact,
    numbers: {
      carryover,
      usableThisYear,
      ...(rate != null ? { marginalRate: rate } : {}),
    },
  };
}
