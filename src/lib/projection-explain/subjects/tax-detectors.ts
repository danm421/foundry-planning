// src/lib/projection-explain/subjects/tax-detectors.ts
// Cause detectors for year-over-year tax changes. Each returns a quantified
// Finding (TaxChangeFinding for the fixed-shape causes) or null. Detectors report
// EXACT income-side dollars from ledger data; assembly (explain.ts) attaches the
// estimated tax impact.
import type { ProjectionYear } from "@/engine/types";
import type { DrillContext, Finding } from "../types";
import { LINE_FLOOR, RATIO_SHIFT_POINTS, ROTH_SLICE_MIN, money, pct } from "../types";
import { recognizedForAccount, type FundingRow, type TaxChangeFinding, type TaxYearDiff } from "./tax-diff";

export interface DetectorArgs {
  prev: ProjectionYear;
  next: ProjectionYear;
  diff: TaxYearDiff;
  ctx: DrillContext;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

/** A funding row tagged with WHY its recognized/cash ratio lands where it does —
 *  the tax character of the money leaving the account this year. */
export interface RatioAccount extends FundingRow {
  ratioReason:
    | "roth_designated_slice"
    | "roth_ira_qualified"
    | "basis_return"
    | "exempt_529_hsa"
    | "cash_principal"
    | "fully_pretax";
}

/** Classify an account's recognition character from its category/subType (+ name
 *  fallback) and its asked-year Roth slice. Ordered most-specific first. Keys off
 *  `Account.subType` — there is no `taxType` field on Account. */
function classifyRatioReason(
  id: string,
  next: ProjectionYear,
  ctx: DrillContext,
): RatioAccount["ratioReason"] {
  const acct = ctx.accounts.find((a) => a.id === id);
  const sub = `${acct?.category ?? ""}/${acct?.subType ?? ""}`;
  const name = acct?.name ?? "";
  const led = next.accountLedgers[id];
  const rothSlice = led && led.beginningValue > 0 ? (led.rothValueBoY ?? 0) / led.beginningValue : 0;
  if (/roth.?ira/i.test(sub) || /roth.?ira/i.test(name)) return "roth_ira_qualified";
  if (/(401|403)/.test(sub) && rothSlice > ROTH_SLICE_MIN) return "roth_designated_slice";
  if (/529|hsa/i.test(sub) || /529|hsa/i.test(name)) return "exempt_529_hsa";
  if (/cash|checking|savings/i.test(sub)) return "cash_principal";
  if (/taxable|brokerage|individual|joint/i.test(sub)) return "basis_return";
  return "fully_pretax";
}

/** The blended recognition ratio (taxable dollars ÷ gross funding) moved between
 *  the two years — usually because a lower-recognition source (Roth, basis-heavy
 *  taxable, cash) gave way to a fully-pre-tax one, recognizing more ordinary
 *  income to fund the same need and grossing up the total draw. */
export function detectFundingCharacterShift(a: DetectorArgs): Finding | null {
  const wp = a.diff.withdrawalPicture;
  const rows: RatioAccount[] = wp.byAccount.map((r) => ({
    ...r,
    ratioReason: classifyRatioReason(r.accountId, a.next, a.ctx),
  }));

  const blended = (fundingTotal: number, recognizedTotal: number) =>
    fundingTotal > 0 ? recognizedTotal / fundingTotal : 0;
  // Prior-year recognized must sum over the SAME set that produced
  // totalFundingPrev (every prior-year funder), NOT wp.byAccount. byAccount holds
  // asked-year funding rows, so an account that funded last year but ran to $0
  // this year is filtered out — iterating it here would drop that account's prior
  // recognized income and understate ratioPrev (Task 3 deferred this "funding-side
  // account-set" semantics to here). recognizedForAccount(prev, <next-only id>) is
  // 0, so restricting to prior funders is exactly symmetric with totalFundingPrev.
  const priorFundingIds = new Set<string>([
    ...Object.keys(a.prev.withdrawals.byAccount),
    ...Object.keys(a.prev.accountLedgers).filter(
      (id) => (a.prev.accountLedgers[id]?.rmdAmount ?? 0) > 0,
    ),
  ]);
  const recPrev = [...priorFundingIds].reduce((s, id) => s + recognizedForAccount(a.prev, id), 0);
  const recNext = rows.reduce((s, r) => s + r.recognized, 0);
  const ratioPrev = blended(wp.totalFundingPrev, recPrev);
  const ratioNext = blended(wp.totalFundingNext, recNext);
  const impliedIncomeDelta = Math.round((ratioNext - ratioPrev) * wp.totalFundingNext);
  if (
    Math.abs(ratioNext - ratioPrev) < RATIO_SHIFT_POINTS ||
    Math.abs(impliedIncomeDelta) < LINE_FLOOR
  )
    return null;

  const depleted = rows.filter((r) => r.depleted);
  const grossUp = wp.grossUp;
  const grossUpClause =
    grossUp.deltaFunding >= 0
      ? `Total funding rose ${money(grossUp.deltaFunding)}; of that, ${money(grossUp.deltaTax)} is the new tax itself.`
      : `Total funding fell ${money(grossUp.deltaFunding)} even as its tax character worsened.`;
  return {
    kind: "funding_character_shift",
    summary:
      `The taxable share of withdrawals moved ${pct(ratioPrev)} → ${pct(ratioNext)}` +
      (depleted.length
        ? `, as ${depleted.map((r) => r.account).join(", ")} depleted`
        : ` on a funding reorder`) +
      `, recognizing about ${money(impliedIncomeDelta)} ${impliedIncomeDelta >= 0 ? "more" : "less"} ordinary income. ${grossUpClause}`,
    incomeDelta: impliedIncomeDelta,
    evidence: {
      blendedRatioPriorYear: Math.round(ratioPrev * 100) / 100,
      blendedRatioYear: Math.round(ratioNext * 100) / 100,
      totalFunding: wp.totalFundingNext,
      ...(wp.residualNote ? { residualNote: wp.residualNote } : {}),
    },
    detail: { accounts: rows, grossUp },
  };
}

const rmdTotal = (y: ProjectionYear) =>
  Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);

export function detectRmdChange(a: DetectorArgs): TaxChangeFinding | null {
  const before = rmdTotal(a.prev);
  const after = rmdTotal(a.next);
  const d = Math.round(after - before);
  if (Math.abs(d) < LINE_FLOOR) return null;
  const onset = before < 1 && after > 0;
  const perAccount = Object.entries(a.next.accountLedgers)
    .filter(([, l]) => l.rmdAmount > 0)
    .map(([id, l]) => `${a.ctx.accountNames[id] ?? id} ${money(l.rmdAmount)}`)
    .join(", ");
  return {
    kind: "rmd",
    summary: onset
      ? `Required minimum distributions began in ${a.next.year}: ${money(after)} (${perAccount}) became ordinary income.`
      : `RMDs ${d > 0 ? "rose" : "fell"} ${money(d)} (${money(before)} → ${money(after)}).`,
    incomeDelta: d,
    evidence: { rmdPriorYear: Math.round(before), rmdYear: Math.round(after), onset },
  };
}

const rothTaxable = (y: ProjectionYear) =>
  (y.rothConversions ?? []).reduce((s, c) => s + c.taxable, 0);

export function detectRothConversion(a: DetectorArgs): TaxChangeFinding | null {
  const before = rothTaxable(a.prev);
  const after = rothTaxable(a.next);
  const d = Math.round(after - before);
  if (Math.abs(d) < LINE_FLOOR) return null;
  return {
    kind: "roth_conversion",
    summary: `Roth conversions recognized ${money(after)} of ordinary income in ${a.next.year} vs ${money(before)} in ${a.prev.year}.`,
    incomeDelta: d,
    evidence: { conversionTaxablePriorYear: Math.round(before), conversionTaxableYear: Math.round(after) },
  };
}

export function detectSocialSecurity(a: DetectorArgs): TaxChangeFinding | null {
  const tBefore = a.prev.taxResult?.income.taxableSocialSecurity ?? 0;
  const tAfter = a.next.taxResult?.income.taxableSocialSecurity ?? 0;
  const d = Math.round(tAfter - tBefore);
  if (Math.abs(d) < LINE_FLOOR) return null;
  const gBefore = a.prev.income.socialSecurity;
  const gAfter = a.next.income.socialSecurity;
  const onset = gBefore < 1 && gAfter > 0;
  const share = (t: number, g: number) => (g > 0 ? `${Math.round((t / g) * 100)}%` : "n/a");
  return {
    kind: "social_security",
    summary: onset
      ? `Social Security began in ${a.next.year} (${money(gAfter)} gross, ${money(tAfter)} taxable).`
      : `Taxable Social Security ${d > 0 ? "rose" : "fell"} ${money(d)} — the taxable share moved ` +
        `${share(tBefore, gBefore)} → ${share(tAfter, gAfter)} of gross as other income changed.`,
    incomeDelta: d,
    evidence: {
      grossPriorYear: Math.round(gBefore), grossYear: Math.round(gAfter),
      taxablePriorYear: Math.round(tBefore), taxableYear: Math.round(tAfter), onset,
    },
  };
}

/** Gain-flavored bySource keys — deliberately excludes `withdrawal:` keys,
 *  which belong to detectFundingCharacterShift's recognition ratio. */
const isGainKey = (k: string) =>
  k.startsWith("sale:") || k.startsWith("business_sale:") ||
  k.startsWith("equity-ltcg:") || k.startsWith("equity-stcg:") ||
  k.startsWith("transfer:") || (k.startsWith("note:") && k.endsWith(":ltcg"));

const gainIncome = (y: ProjectionYear) =>
  Object.entries(y.taxDetail?.bySource ?? {})
    .filter(([k]) => isGainKey(k))
    .reduce((s, [, v]) => s + v.amount, 0);

export function detectRealizedGains(a: DetectorArgs): TaxChangeFinding | null {
  const before = gainIncome(a.prev);
  const after = gainIncome(a.next);
  const d = Math.round(after - before);
  if (Math.abs(d) < LINE_FLOOR) return null;
  return {
    kind: "realized_gains",
    summary: `Realized gains from sales/equity events ${d > 0 ? "rose" : "fell"} ${money(d)} (${money(before)} → ${money(after)}).`,
    incomeDelta: d,
    evidence: { gainsPriorYear: Math.round(before), gainsYear: Math.round(after) },
  };
}

export function detectFilingStatusChange(a: DetectorArgs): TaxChangeFinding | null {
  const inWindow = (d: number | null) => d != null && d > a.prev.year && d <= a.next.year;
  const deathYear = inWindow(a.firstDeathYear)
    ? a.firstDeathYear
    : inWindow(a.secondDeathYear)
      ? a.secondDeathYear
      : null;
  if (deathYear == null) return null;
  const { from, to } = a.diff.marginalFederalRate;
  return {
    kind: "filing_status_change",
    summary:
      `A death occurs in ${deathYear}; the survivor moves to narrower single-filer ` +
      `brackets (marginal federal rate ${pct(from)} → ${pct(to)}), changing how the same ` +
      `income is taxed.`,
    incomeDelta: 0,
    evidence: { deathYear, marginalRateFrom: from, marginalRateTo: to },
  };
}

export function detectDeductionChange(a: DetectorArgs): TaxChangeFinding | null {
  const pf = a.prev.taxResult!.flow;
  const nf = a.next.taxResult!.flow;
  const before = pf.aboveLineDeductions + pf.belowLineDeductions + pf.qbiDeduction;
  const after = nf.aboveLineDeductions + nf.belowLineDeductions + nf.qbiDeduction;
  // Positive impact = deductions FELL, raising taxable income.
  const impact = Math.round(before - after);
  if (Math.abs(impact) < LINE_FLOOR) return null;
  const bl = a.next.deductionBreakdown?.belowLine;
  return {
    kind: "deduction_change",
    summary:
      `Total deductions ${impact > 0 ? "fell" : "rose"} ${money(impact)} ` +
      `(${money(before)} → ${money(after)}), ${impact > 0 ? "raising" : "lowering"} taxable income.`,
    incomeDelta: impact,
    evidence: {
      deductionsPriorYear: Math.round(before),
      deductionsYear: Math.round(after),
      ...(bl ? { itemizedTotal: Math.round(bl.itemizedTotal), standardDeduction: Math.round(bl.standardDeduction) } : {}),
    },
  };
}

export function detectStateMove(a: DetectorArgs): TaxChangeFinding | null {
  const sBefore = a.prev.taxResult?.state?.state ?? null;
  const sAfter = a.next.taxResult?.state?.state ?? null;
  if (!sBefore || !sAfter || sBefore === sAfter) return null;
  const pf = a.prev.taxResult!.flow;
  const nf = a.next.taxResult!.flow;
  return {
    kind: "state_move",
    summary: `Residence state changes ${sBefore} → ${sAfter}; state tax moves ${money(pf.stateTax)} → ${money(nf.stateTax)}.`,
    incomeDelta: 0,
    evidence: { stateFrom: sBefore, stateTo: sAfter, stateTaxPriorYear: Math.round(pf.stateTax), stateTaxYear: Math.round(nf.stateTax) },
  };
}

/** Ordered detector battery — assembly runs them all and ranks the findings. */
export const DETECTORS = [
  detectFundingCharacterShift,
  detectRmdChange,
  detectRothConversion,
  detectSocialSecurity,
  detectRealizedGains,
  detectFilingStatusChange,
  detectDeductionChange,
  detectStateMove,
];
