// src/lib/tax/explain-tax-change/detectors.ts
// Cause detectors for year-over-year tax changes. Each returns a quantified
// TaxChangeFinding or null. Detectors report EXACT income-side dollars from
// ledger data; assembly (explain.ts) attaches the estimated tax impact.
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { LINE_FLOOR, money, pct, type TaxChangeFinding, type TaxYearDiff } from "./types";

export interface DetectorArgs {
  prev: ProjectionYear;
  next: ProjectionYear;
  diff: TaxYearDiff;
  ctx: CellDrillContext;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

/** Recognized income from supplemental draws — the `withdrawal:<acctId>`
 *  bySource keys the engine writes per gap-fill draw. */
function withdrawalIncome(y: ProjectionYear): number {
  return Object.entries(y.taxDetail?.bySource ?? {})
    .filter(([key]) => key.startsWith("withdrawal:"))
    .reduce((sum, [, v]) => sum + v.amount, 0);
}

const names = (rows: Array<{ account: string }>) => rows.map((r) => r.account).join(", ");

/** The canonical chain: a funding account ran dry last year, this year's draws
 *  shifted to other (typically pre-tax) accounts, recognizing more taxable
 *  income — which in turn grosses up the total withdrawal need. */
export function detectWithdrawalShift(a: DetectorArgs): TaxChangeFinding | null {
  const depleted = a.diff.withdrawalPicture.byAccount.filter((d) => d.depleted && d.delta <= 0);
  const risers = a.diff.withdrawalPicture.byAccount.filter((d) => d.delta > 0);
  if (depleted.length === 0 || risers.length === 0) return null;

  const before = withdrawalIncome(a.prev);
  const after = withdrawalIncome(a.next);
  const incomeDelta = Math.round(after - before);
  if (incomeDelta < LINE_FLOOR) return null;

  const grossUp = a.diff.withdrawalPicture.totalWithdrawals.delta;
  const grossUpClause =
    grossUp >= 0
      ? `Total gross withdrawals rose ${money(grossUp)} to fund the same need plus the extra tax.`
      : `Total gross withdrawals actually fell ${money(grossUp)} even as draws shifted to the ` +
        `more heavily taxed source.`;
  return {
    kind: "withdrawal_shift",
    summary:
      `${names(depleted)} was depleted in ${a.prev.year} (ended near $0), so ` +
      `${a.next.year} withdrawals shifted to ${names(risers)} — recognizing ` +
      `${money(incomeDelta)} more taxable income from draws. ${grossUpClause}`,
    incomeDelta,
    evidence: {
      depletedAccounts: names(depleted),
      shiftedTo: names(risers),
      withdrawalIncomePriorYear: Math.round(before),
      withdrawalIncomeYear: Math.round(after),
      grossWithdrawalDelta: grossUp,
    },
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
 *  which belong to detectWithdrawalShift. */
const isGainKey = (k: string) =>
  k.startsWith("sale:") || k.startsWith("equity-ltcg:") || k.startsWith("equity-stcg:") ||
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
      `brackets (marginal federal rate ${pct(from)} → ${pct(to)}), so similar income is taxed harder.`,
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
  detectWithdrawalShift,
  detectRmdChange,
  detectRothConversion,
  detectSocialSecurity,
  detectRealizedGains,
  detectFilingStatusChange,
  detectDeductionChange,
  detectStateMove,
];
