import type { Finding, FindingContext, FindingLineRef } from "../types";
import { fmtUsd } from "../format";
import { marginalRateFor } from "./impact";

/** Top §1250 unrecaptured-gain rate. Statutory and unindexed, so a constant
 *  rather than a TaxYearParameter. */
const SECTION_1250_RATE = "25%";

/** The rental row buildActivityDetail already produced. rental-cash-vs-paper
 *  CONSUMES it rather than recomputing: the net there is the FILED Schedule 1
 *  line 5, and §280A plus personal-use exclusions routinely break the
 *  gross-minus-expenses identity (activity-detail.ts:87-90). */
function rentalActivity(ctx: FindingContext) {
  return ctx.activityDetail?.find((a) => a.key === "schedule-e") ?? null;
}

/**
 * Both findings here deliberately restate figures the "Business & rental
 * detail" table already shows. That is BY DESIGN — the table says what the
 * activity is, the finding says what to do about it. Do not "simplify" one of
 * them away on the grounds that the numbers appear twice.
 */
export function rentalCashVsPaper(ctx: FindingContext): Finding | null {
  const e = ctx.facts.income.scheduleE;
  const activity = rentalActivity(ctx);
  if (!e || !activity) return null;
  const depreciation = e.depreciation;
  const cashFlow = activity.cashFlow;
  if (depreciation == null || depreciation <= 0 || cashFlow == null) return null;
  const net = ctx.facts.income.scheduleENet;
  if (net == null) return null;

  const paperLoss = net < 0 && cashFlow > 0;
  const lineRefs: FindingLineRef[] = [
    { form: "Schedule E", line: "line 3", label: "Rents received", amount: e.grossRents },
    { form: "Schedule E", line: "line 18", label: "Depreciation", amount: depreciation },
    { form: "Schedule E", line: "line 20", label: "Total expenses", amount: e.totalExpenses },
    { form: "Schedule 1", line: "line 5", label: "Rental real estate, net", amount: net },
  ];

  return {
    id: "rental-cash-vs-paper",
    severity: "opportunity",
    category: "real-estate",
    headline: paperLoss
      ? `Rental produced about ${fmtUsd(cashFlow)} of cash despite a ${fmtUsd(Math.abs(net))} tax loss`
      : `Rental cash flow of about ${fmtUsd(cashFlow)} against ${fmtUsd(net)} of taxable net`,
    whatTheReturnShows: `Schedule E reports ${fmtUsd(e.grossRents ?? 0)} of gross rents (line 3) against ${fmtUsd(e.totalExpenses ?? 0)} of total expenses (line 20), netting to ${fmtUsd(net)} on Schedule 1 line 5. Of those expenses, ${fmtUsd(depreciation)} is depreciation (line 18) — a book entry, not money that left the account.`,
    whyItMatters: `Adding depreciation back, the properties generated roughly ${fmtUsd(cashFlow)} of actual cash this year. Any cash-flow plan that reads Schedule 1 line 5 as the rental's contribution understates it by the full ${fmtUsd(depreciation)}. Depreciation is not free, though: it reduces basis, and the portion taken is recaptured at up to ${SECTION_1250_RATE} on sale.`,
    whatToConsider: `Treat ${fmtUsd(cashFlow)}, not ${fmtUsd(net)}, as the rental's contribution to household cash flow. If a sale is contemplated, model unrecaptured §1250 gain at ${SECTION_1250_RATE} against depreciation taken TO DATE — this return shows only the current year's ${fmtUsd(depreciation)}, so the accumulated figure has to come from the depreciation schedule.`,
    lineRefs,
    // The dollar magnitude in play is the cash the taxable net fails to state.
    estimatedImpact: depreciation,
    numbers: { grossRents: e.grossRents ?? 0, net, depreciation, cashFlow },
  };
}

export function suspendedPassiveLoss(ctx: FindingContext): Finding | null {
  const e = ctx.facts.income.scheduleE;
  const suspended = e?.suspendedPassiveLoss;
  if (!suspended || suspended <= 0) return null;
  const rate = marginalRateFor(ctx);
  const impact = rate != null ? suspended * rate : null;

  return {
    id: "suspended-passive-loss",
    severity: "info",
    category: "real-estate",
    headline: `${fmtUsd(suspended)} of rental losses suspended and carried forward`,
    whatTheReturnShows: `Form 8582 shows ${fmtUsd(suspended)} of passive rental loss the return could not use this year, so only part of the Schedule E loss reached Schedule 1 line 5 (${fmtUsd(ctx.facts.income.scheduleENet ?? 0)}).`,
    whyItMatters: `Under §469 a passive loss can only offset passive income, and the $25,000 active-participation allowance itself phases out between $100,000 and $150,000 of MAGI. The suspended amount is not lost — it carries forward indefinitely${impact != null ? `, and is worth roughly ${fmtUsd(impact)} of federal tax at this return's marginal rate once it becomes usable` : ""}. Until then it is an asset sitting on a shelf, invisible on every line of the 1040.`,
    whatToConsider: `Three things release it: passive income from another activity, a fully taxable disposition of the property (which frees the entire suspended balance against ordinary income in the year of sale), or qualifying as a real estate professional under §469(c)(7). The disposition route is the one worth modelling before a sale is scheduled, because it changes the after-tax proceeds materially.`,
    lineRefs: [
      { form: "Form 8582", line: "unallowed loss", label: "Suspended passive loss", amount: suspended },
      { form: "Schedule 1", line: "line 5", label: "Rental real estate, net", amount: ctx.facts.income.scheduleENet },
    ],
    estimatedImpact: impact,
    numbers: {
      suspendedLoss: suspended,
      ...(rate != null ? { marginalRate: rate } : {}),
    },
  };
}
