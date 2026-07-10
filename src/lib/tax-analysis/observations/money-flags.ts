import type { Observation, ObservationContext } from "../types";
import { fmtUsd } from "../format";
import { resolveLtcg } from "../adapter";

const n = (v: number | null | undefined): number => v ?? 0;

export function charitableBunching(ctx: ObservationContext): Observation | null {
  const d = ctx.facts.deductions;
  const fs = ctx.facts.filingStatus;
  if (!fs) return null;
  const std = ctx.params.stdDeduction[fs];
  const charitable = n(d.scheduleA?.charitableCash) + n(d.scheduleA?.charitableNonCash);

  if (d.deductionTaken === "standard" && charitable > 0) {
    return {
      id: "charitable-bunching",
      severity: "opportunity",
      title: "Charitable gifts yielded no federal deduction",
      body: `This return gave ${fmtUsd(charitable)} to charity but took the ${fmtUsd(std)} standard deduction, so the gifts produced no federal tax benefit. Consider bunching several years of giving into one year — often via a donor-advised fund — to push itemized deductions above the standard deduction in that year.`,
      numbers: { charitable, standardDeduction: std },
    };
  }
  if (d.deductionTaken === "itemized" && d.deductionAmount != null) {
    const gap = d.deductionAmount - std;
    if (gap >= 0 && gap <= 0.2 * std) {
      return {
        id: "charitable-bunching",
        severity: "opportunity",
        title: "Barely itemizing",
        body: `Itemized deductions of ${fmtUsd(d.deductionAmount)} exceed the ${fmtUsd(std)} standard deduction by only ${fmtUsd(gap)}. Consider bunching deductible expenses (especially charitable gifts) into alternating years to capture more total deduction across years.`,
        numbers: { gapOverStandard: gap, standardDeduction: std },
      };
    }
  }
  return null;
}

export function niitExposure(ctx: ObservationContext): Observation | null {
  const f = ctx.facts;
  const fs = f.filingStatus;
  if (!fs || f.income.agi == null) return null;
  const threshold =
    fs === "married_joint" ? ctx.params.niitThreshold.mfj
    : fs === "married_separate" ? ctx.params.niitThreshold.mfs
    : ctx.params.niitThreshold.single;
  const ltcg = Math.max(0, resolveLtcg(f) ?? 0);
  const nii = n(f.income.taxableInterest) + n(f.income.ordinaryDividends) + ltcg + Math.max(0, n(f.income.netShortTermGain));
  if (nii <= 0) return null;
  const excess = f.income.agi - threshold;
  if (excess <= 0) return null;
  const exposed = Math.min(nii, excess);
  return {
    id: "niit-exposure",
    severity: "watch",
    title: "Net investment income tax applies",
    body: `MAGI of ${fmtUsd(f.income.agi)} exceeds the ${fmtUsd(threshold)} NIIT threshold, so ${fmtUsd(exposed)} of investment income is subject to the additional 3.8% tax (about ${fmtUsd(exposed * ctx.params.niitRate)}). Municipal bonds, tax-managed funds, and gain-timing reduce this exposure.`,
    numbers: { exposed, estTax: exposed * ctx.params.niitRate, threshold },
  };
}

export function additionalMedicare(ctx: ObservationContext): Observation | null {
  const f = ctx.facts;
  const fs = f.filingStatus;
  if (!fs) return null;
  const threshold =
    fs === "married_joint" ? ctx.params.addlMedicareThreshold.mfj
    : fs === "married_separate" ? ctx.params.addlMedicareThreshold.mfs
    : ctx.params.addlMedicareThreshold.single;
  const earned = n(f.income.wages) + Math.max(0, n(f.income.scheduleCNet));
  if (earned <= threshold) return null;
  const excess = earned - threshold;
  return {
    id: "additional-medicare",
    severity: "info",
    title: "Additional 0.9% Medicare tax on earned income",
    body: `Earned income of ${fmtUsd(earned)} exceeds the ${fmtUsd(threshold)} threshold by ${fmtUsd(excess)}, adding about ${fmtUsd(excess * ctx.params.addlMedicareRate)} of Additional Medicare Tax. Employers don't withhold for a spouse's wages, so joint filers are often under-withheld here.`,
    numbers: { excess, estTax: excess * ctx.params.addlMedicareRate },
  };
}

export function safeHarbor(ctx: ObservationContext): Observation | null {
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

  if (payments < required) {
    const shortfall = required - payments;
    return {
      id: "safe-harbor",
      severity: "watch",
      title: "Withholding missed the safe harbor",
      body: `Withholding and estimates of ${fmtUsd(payments)} fell ${fmtUsd(shortfall)} short of the ${fmtUsd(required)} safe-harbor level, exposing the return to underpayment penalties. Increasing withholding (which counts as paid evenly through the year) is usually the cleanest fix.`,
      numbers: { payments, required, shortfall },
    };
  }
  if (n(f.payments.amountOwed) > 1000) {
    return {
      id: "safe-harbor",
      severity: "info",
      title: "Large balance due at filing",
      body: `The return met its safe harbor but still owed ${fmtUsd(n(f.payments.amountOwed))} at filing. If that surprise is unwelcome, bump withholding or quarterly estimates.`,
      numbers: { amountOwed: n(f.payments.amountOwed) },
    };
  }
  return null;
}

export function capitalLossCarryover(ctx: ObservationContext): Observation | null {
  const carryover = ctx.facts.carryovers.capitalLossCarryover;
  if (carryover == null || carryover <= 0) return null;
  return {
    id: "capital-loss-carryover",
    severity: "info",
    title: "Capital-loss carryover available",
    body: `A ${fmtUsd(carryover)} capital-loss carryover is available to offset future realized gains (plus up to $3,000/yr of ordinary income) — useful cover for rebalancing or gain harvesting.`,
    numbers: { carryover },
  };
}
