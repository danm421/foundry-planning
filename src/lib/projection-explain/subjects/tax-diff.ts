// src/lib/projection-explain/subjects/tax-diff.ts
// Tax subject: year-pair delta layer. prev = baseline year, next = asked year.
// Callers guarantee taxResult on both years (explain.ts handles the degrade path).
import type { ProjectionYear } from "@/engine/types";
import { resolveSourceLabel } from "@/lib/tax/cell-drill/_shared";
import { DEPLETED_EPS, LINE_FLOOR, SOURCE_CAP, type DollarDelta, type DrillContext } from "../types";

// ── Tax-specific delta shapes (relocated from the Phase-0 types.ts; owned here) ──

export type TaxChangeCauseKind =
  | "withdrawal_shift"
  | "rmd"
  | "roth_conversion"
  | "social_security"
  | "realized_gains"
  | "filing_status_change"
  | "deduction_change"
  | "state_move";

/** What a detector returns — assembly adds estimatedTaxImpact. */
export interface TaxChangeFinding {
  kind: TaxChangeCauseKind;
  summary: string;
  /** Exact income-side dollars from ledger data, signed. 0 for rate-structure causes. */
  incomeDelta: number;
  evidence: Record<string, number | string | boolean>;
}

export interface TaxChangeCause extends TaxChangeFinding {
  /** ESTIMATE: incomeDelta × blended incremental rate (state_move: exact state
   *  delta; filing_status_change: unattributed residual). Never fake-precise. */
  estimatedTaxImpact: number;
}

export interface AccountDrawDelta {
  account: string;
  from: number;
  to: number;
  delta: number;
  priorYearEndingBalance: number;
  depleted: boolean;
}

export interface TaxYearDiff {
  headline: { totalTax: DollarDelta; federalTax: DollarDelta; stateTax: DollarDelta };
  taxLineDeltas: DollarDelta[];
  incomeDeltas: DollarDelta[];
  sourceDeltas: DollarDelta[];
  withdrawalPicture: {
    totalWithdrawals: DollarDelta;
    netCashFlow: DollarDelta;
    byAccount: AccountDrawDelta[];
  };
  marginalFederalRate: { from: number; to: number };
  /** Δtax/ΔtaxableIncome clamped to [0, 0.6]; falls back to year-N marginal
   *  federal rate when taxable income didn't rise. Used for cause estimates. */
  blendedRate: number;
}

export interface TaxChangeExplanation {
  available: true;
  /** True when one year lacks taxResult — headline only, from expenses.taxes. */
  degraded?: boolean;
  year: number;
  compareYear: number;
  headline: { totalTax: DollarDelta; federalTax?: DollarDelta; stateTax?: DollarDelta };
  taxLineDeltas?: DollarDelta[];
  incomeDeltas?: DollarDelta[];
  sourceDeltas?: DollarDelta[];
  causes?: TaxChangeCause[];
  withdrawalPicture?: TaxYearDiff["withdrawalPicture"];
  marginalFederalRate?: { from: number; to: number };
  noSignificantChange?: boolean;
  notes: string[];
}

export interface TaxChangeUnavailable {
  available: false;
  reason: string;
  availableYears?: { first: number; last: number };
}

function dd(label: string, from: number, to: number): DollarDelta {
  return { label, from: Math.round(from), to: Math.round(to), delta: Math.round(to - from) };
}

export function diffTaxYears(
  prev: ProjectionYear,
  next: ProjectionYear,
  ctx: DrillContext,
): TaxYearDiff {
  const pf = prev.taxResult!.flow;
  const nf = next.taxResult!.flow;
  const pi = prev.taxResult!.income;
  const ni = next.taxResult!.income;

  const taxLines: Array<[string, number, number]> = [
    ["Regular federal income tax", pf.regularFederalIncomeTax, nf.regularFederalIncomeTax],
    ["Capital gains tax", pf.capitalGainsTax, nf.capitalGainsTax],
    ["AMT", pf.amtAdditional, nf.amtAdditional],
    ["NIIT", pf.niit, nf.niit],
    ["Additional Medicare", pf.additionalMedicare, nf.additionalMedicare],
    ["FICA", pf.fica, nf.fica],
    ["Early-withdrawal penalty", pf.earlyWithdrawalPenalty, nf.earlyWithdrawalPenalty],
    ["State tax", pf.stateTax, nf.stateTax],
  ];

  const incomeLines: Array<[string, number, number]> = [
    ["Earned income", pi.earnedIncome, ni.earnedIncome],
    ["Taxable Social Security", pi.taxableSocialSecurity, ni.taxableSocialSecurity],
    ["Ordinary income", pi.ordinaryIncome, ni.ordinaryIncome],
    ["Dividends", pi.dividends, ni.dividends],
    ["LT capital gains", pi.capitalGains, ni.capitalGains],
    ["ST capital gains", pi.shortCapitalGains, ni.shortCapitalGains],
    ["QBI", pi.qbi, ni.qbi],
    ["AGI", pf.adjustedGrossIncome, nf.adjustedGrossIncome],
    ["Taxable income", pf.taxableIncome, nf.taxableIncome],
    ["Above-line deductions", pf.aboveLineDeductions, nf.aboveLineDeductions],
    ["Below-line deductions", pf.belowLineDeductions, nf.belowLineDeductions],
    ["QBI deduction", pf.qbiDeduction, nf.qbiDeduction],
  ];
  const ALWAYS = new Set(["AGI", "Taxable income"]);

  const sourceKeys = new Set([
    ...Object.keys(prev.taxDetail?.bySource ?? {}),
    ...Object.keys(next.taxDetail?.bySource ?? {}),
  ]);
  const sourceDeltas = [...sourceKeys]
    .map((k) =>
      dd(
        resolveSourceLabel(k, ctx),
        prev.taxDetail?.bySource[k]?.amount ?? 0,
        next.taxDetail?.bySource[k]?.amount ?? 0,
      ),
    )
    .filter((d) => Math.abs(d.delta) >= LINE_FLOOR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, SOURCE_CAP);

  const drawIds = new Set([
    ...Object.keys(prev.withdrawals.byAccount),
    ...Object.keys(next.withdrawals.byAccount),
  ]);
  const byAccount = [...drawIds]
    .map((id) => {
      const from = prev.withdrawals.byAccount[id] ?? 0;
      const to = next.withdrawals.byAccount[id] ?? 0;
      const priorEnd = prev.accountLedgers[id]?.endingValue ?? 0;
      return {
        account: ctx.accountNames[id] ?? id,
        from: Math.round(from),
        to: Math.round(to),
        delta: Math.round(to - from),
        priorYearEndingBalance: Math.round(priorEnd),
        depleted: priorEnd < DEPLETED_EPS && from > 0,
      };
    })
    .filter((d) => d.delta !== 0 || d.depleted)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const taxableDelta = nf.taxableIncome - pf.taxableIncome;
  const taxDelta = nf.totalTax - pf.totalTax;
  const blendedRate =
    taxableDelta > 0
      ? Math.min(0.6, Math.max(0, taxDelta / taxableDelta))
      : next.taxResult!.diag.marginalFederalRate;

  return {
    headline: {
      totalTax: dd("Total tax", pf.totalTax, nf.totalTax),
      federalTax: dd("Federal tax", pf.totalFederalTax, nf.totalFederalTax),
      stateTax: dd("State tax", pf.stateTax, nf.stateTax),
    },
    taxLineDeltas: taxLines.map(([l, a, b]) => dd(l, a, b)).filter((d) => Math.abs(d.delta) >= LINE_FLOOR),
    incomeDeltas: incomeLines
      .map(([l, a, b]) => dd(l, a, b))
      .filter((d) => ALWAYS.has(d.label) || Math.abs(d.delta) >= LINE_FLOOR),
    sourceDeltas,
    withdrawalPicture: {
      totalWithdrawals: dd("Total supplemental withdrawals", prev.withdrawals.total, next.withdrawals.total),
      netCashFlow: dd("Net cash flow", prev.netCashFlow, next.netCashFlow),
      byAccount,
    },
    marginalFederalRate: {
      from: prev.taxResult!.diag.marginalFederalRate,
      to: next.taxResult!.diag.marginalFederalRate,
    },
    blendedRate,
  };
}
