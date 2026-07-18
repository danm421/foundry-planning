// src/lib/projection-explain/subjects/tax-diff.ts
// Tax subject: year-pair delta layer. prev = baseline year, next = asked year.
// Callers guarantee taxResult on both years (explain.ts handles the degrade path).
import type { ProjectionYear } from "@/engine/types";
import { resolveSourceLabel } from "@/lib/tax/cell-drill/_shared";
import { DEPLETED_EPS, LINE_FLOOR, SOURCE_CAP, money, type DollarDelta, type DrillContext } from "../types";

// ── Tax-specific delta shapes (relocated from the Phase-0 types.ts; owned here) ──

export type TaxChangeCauseKind =
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

/** One account's funding contribution in the asked year, reconstructed from the
 *  ledgers (RMD) + supplemental draws, with the taxable slice the engine
 *  recognized against it. Consumed by Task 4's recognition-ratio detector. */
export interface FundingRow {
  account: string;
  accountId: string;
  /** rmd + supplemental — total cash leaving the account this year. */
  cashOut: number;
  rmd: number;
  supplemental: number;
  /** Taxable dollars from bySource (withdrawal:<id> + <id>:rmd). */
  recognized: number;
  /** recognized / cashOut, guarded (0 when nothing came out). */
  ratio: number;
  priorYearEndingBalance: number;
  /** True when the account FUNDED the prior year (prior cashOut > 0) yet ended it
   *  below DEPLETED_EPS — a prior-year funder that ran dry. Because ledgers are
   *  continuous (BoY(next) = EoY(prev)), such an account has BoY=EoY=0 and no draw
   *  in the asked year, so its next-year dollar fields (cashOut/rmd/…) are all 0;
   *  the prior-year context below carries the pre-depletion numbers. */
  depleted: boolean;
  /** Prior-year cash out, populated ONLY on depleted rows. */
  priorCashOut?: number;
  /** Prior-year recognized (taxable) dollars, populated ONLY on depleted rows. */
  priorRecognized?: number;
  /** priorRecognized / priorCashOut, guarded — populated ONLY on depleted rows. */
  priorRatio?: number;
}

export interface WithdrawalPicture {
  /** Asked-year funding rows — the union of both years' funding accounts. A
   *  prior-year funder that ran dry is retained as a `depleted` row (its
   *  asked-year dollar fields are 0, with prior-year context attached). */
  byAccount: FundingRow[];
  totalFundingPrev: number;
  totalFundingNext: number;
  /** totalExpenses − non-withdrawal income (portfolio draws excluded). */
  netNeedPrev: number;
  netNeedNext: number;
  /** Set only when |totalFunding − netNeed| exceeds 1% of net need. */
  residualNote?: string;
  grossUp: { deltaFunding: number; deltaNetNeedExTax: number; deltaTax: number };
}

export interface TaxYearDiff {
  headline: { totalTax: DollarDelta; federalTax: DollarDelta; stateTax: DollarDelta };
  taxLineDeltas: DollarDelta[];
  incomeDeltas: DollarDelta[];
  sourceDeltas: DollarDelta[];
  withdrawalPicture: WithdrawalPicture;
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

/** Recognized (taxable) dollars for one account, summed from ONLY the named
 *  taxable bySource keys the engine emits for it: `withdrawal:<id>` (supplemental
 *  draw) and `<id>:rmd` (required distribution). A future
 *  `withdrawal_tax_free:<id>` key (from the unmerged tax-ledger branch) is
 *  intentionally NOT summed here, so tax-free draws correctly lower the ratio. Do
 *  NOT switch to "any key containing the id". Exported: Task 4's recognition-ratio
 *  detector imports this rather than re-deriving it. */
export function recognizedForAccount(y: ProjectionYear, id: string): number {
  const bs = y.taxDetail?.bySource ?? {};
  return (bs[`withdrawal:${id}`]?.amount ?? 0) + (bs[`${id}:rmd`]?.amount ?? 0);
}

/** Total cash leaving an account this year: supplemental draw + RMD. RMDs live in
 *  `accountLedgers[id].rmdAmount`, NOT `withdrawals.byAccount`, so supplemental
 *  draws alone would understate funding (trap 4). */
function cashOutForAccount(y: ProjectionYear, id: string): number {
  return (y.withdrawals.byAccount[id] ?? 0) + (y.accountLedgers[id]?.rmdAmount ?? 0);
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

  // ── Funding reconciliation: rebuild the withdrawal picture from the ledgers ──
  // Funding accounts = anything with a supplemental draw in either year, plus any
  // account with an RMD (RMDs never appear in withdrawals.byAccount).
  const fundingIds = new Set([
    ...Object.keys(prev.withdrawals.byAccount),
    ...Object.keys(next.withdrawals.byAccount),
    ...Object.keys(prev.accountLedgers).filter((id) => (prev.accountLedgers[id]?.rmdAmount ?? 0) > 0),
    ...Object.keys(next.accountLedgers).filter((id) => (next.accountLedgers[id]?.rmdAmount ?? 0) > 0),
  ]);
  const byAccount: FundingRow[] = [...fundingIds]
    .map((id) => {
      const cashOut = cashOutForAccount(next, id);
      const rmd = next.accountLedgers[id]?.rmdAmount ?? 0;
      const recognized = recognizedForAccount(next, id);
      const priorEnd = prev.accountLedgers[id]?.endingValue ?? 0;
      // Depleted = a PRIOR-year funder (prior cashOut > 0) that ran dry (prior
      // ending < EPS). Continuous ledgers mean it then carries BoY=EoY=0 and no
      // asked-year draw, so its next-year dollar fields below are the real (0)
      // values — prior-year dollars are surfaced separately, never folded in.
      const priorCashOut = cashOutForAccount(prev, id);
      const depleted = priorCashOut > 0 && priorEnd < DEPLETED_EPS;
      const priorRecognized = depleted ? recognizedForAccount(prev, id) : 0;
      return {
        account: ctx.accountNames[id] ?? id,
        accountId: id,
        cashOut: Math.round(cashOut),
        rmd: Math.round(rmd),
        supplemental: Math.round(cashOut - rmd),
        recognized: Math.round(recognized),
        ratio: cashOut > 0 ? recognized / cashOut : 0,
        priorYearEndingBalance: Math.round(priorEnd),
        depleted,
        ...(depleted
          ? {
              priorCashOut: Math.round(priorCashOut),
              priorRecognized: Math.round(priorRecognized),
              priorRatio: priorCashOut > 0 ? priorRecognized / priorCashOut : 0,
            }
          : {}),
      };
    })
    .filter((r) => r.cashOut !== 0 || r.depleted)
    .sort((a, b) => b.cashOut - a.cashOut);

  const totalFundingNext = byAccount.reduce((s, r) => s + r.cashOut, 0);
  const totalFundingPrev = [...fundingIds].reduce((s, id) => s + cashOutForAccount(prev, id), 0);
  // Net need excluding portfolio draws. IMPORTANT: the engine folds household
  // RMD income into totalIncome (projection.ts assembles
  // `totalIncome = displayIncome.total + householdRmdIncome + …`), and
  // cashOutForAccount counts that same RMD on the funding side. Add RMD back here
  // so both sides count it consistently — subtracting a raw totalIncome would
  // double-count RMD and fire a false funding≠need residual on every real RMD
  // decumulation year. Sum over ALL ledgers to match the funding side's RMD set
  // (which includes entity-owned RMDs that don't reach householdRmdIncome).
  const totalRmd = (y: ProjectionYear) =>
    Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);
  const netNeed = (y: ProjectionYear) =>
    Math.round(y.totalExpenses - (y.totalIncome - totalRmd(y)));
  const netNeedNext = netNeed(next);
  const netNeedPrev = netNeed(prev);
  const residualNote =
    Math.abs(totalFundingNext - netNeedNext) > 0.01 * Math.max(1, Math.abs(netNeedNext))
      ? `Funding ${money(totalFundingNext)} vs net need ${money(netNeedNext)} differ by ` +
        `${money(totalFundingNext - netNeedNext)} — possible engine drift; report the numbers, don't force a story.`
      : undefined;
  const deltaTax = nf.totalTax - pf.totalTax;
  const withdrawalPicture: WithdrawalPicture = {
    byAccount,
    totalFundingPrev: Math.round(totalFundingPrev),
    totalFundingNext: Math.round(totalFundingNext),
    netNeedPrev,
    netNeedNext,
    residualNote,
    grossUp: {
      deltaFunding: Math.round(totalFundingNext - totalFundingPrev),
      deltaNetNeedExTax: Math.round(netNeedNext - netNeedPrev - deltaTax),
      deltaTax: Math.round(deltaTax),
    },
  };

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
    withdrawalPicture,
    marginalFederalRate: {
      from: prev.taxResult!.diag.marginalFederalRate,
      to: next.taxResult!.diag.marginalFederalRate,
    },
    blendedRate,
  };
}
