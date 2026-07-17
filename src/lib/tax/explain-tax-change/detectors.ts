// src/lib/tax/explain-tax-change/detectors.ts
// Cause detectors for year-over-year tax changes. Each returns a quantified
// TaxChangeFinding or null. Detectors report EXACT income-side dollars from
// ledger data; assembly (explain.ts) attaches the estimated tax impact.
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { LINE_FLOOR, money, type TaxChangeFinding, type TaxYearDiff } from "./types";

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
