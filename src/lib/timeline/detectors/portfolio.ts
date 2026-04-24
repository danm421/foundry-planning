// src/lib/timeline/detectors/portfolio.ts
import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

export const DEFAULT_PORTFOLIO_THRESHOLDS: number[] = [
  1_000_000,
  2_000_000,
  5_000_000,
  10_000_000,
];

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function investableValue(py: ProjectionYear): number {
  return py.portfolioAssets.taxableTotal + py.portfolioAssets.cashTotal + py.portfolioAssets.retirementTotal;
}

function accountName(data: ClientData, accountId: string): string {
  return data.accounts.find((a) => a.id === accountId)?.name ?? accountId;
}

export function detectPortfolioEvents(
  data: ClientData,
  projection: ProjectionYear[],
  thresholds: number[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  if (projection.length === 0) return out;

  // First withdrawal per account
  const seenWithdrawal = new Set<string>();
  for (const py of projection) {
    for (const [acctId, amount] of Object.entries(py.withdrawals.byAccount)) {
      if (amount > 0 && !seenWithdrawal.has(acctId)) {
        seenWithdrawal.add(acctId);
        out.push({
          id: `portfolio:first_withdrawal:${acctId}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `Withdrawals begin — ${accountName(data, acctId)}`,
          supportingFigure: `${currency(amount)} this year`,
          details: [
            { label: "Account", value: accountName(data, acctId) },
            { label: "Year 1 withdrawal", value: currency(amount) },
          ],
        });
      }
    }
  }

  // RMD begin per account
  const seenRmd = new Set<string>();
  for (const py of projection) {
    for (const [acctId, ledger] of Object.entries(py.accountLedgers)) {
      if (ledger.rmdAmount > 0 && !seenRmd.has(acctId)) {
        seenRmd.add(acctId);
        out.push({
          id: `portfolio:rmd_begin:${acctId}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `RMDs begin — ${accountName(data, acctId)}`,
          supportingFigure: `${currency(ledger.rmdAmount)} this year`,
          details: [
            { label: "Account", value: accountName(data, acctId) },
            { label: "Year 1 RMD", value: currency(ledger.rmdAmount) },
          ],
        });
      }
    }
  }

  // Threshold crossings (investable portfolio).
  // Suppress thresholds the client has already crossed before the plan starts
  // so they don't surface as year-1 "crossings".
  const seenThresholds = new Set<number>();
  const firstYearValue = investableValue(projection[0]);
  for (const t of thresholds) {
    if (firstYearValue >= t) seenThresholds.add(t);
  }
  for (const py of projection) {
    const v = investableValue(py);
    for (const t of thresholds) {
      if (v >= t && !seenThresholds.has(t)) {
        seenThresholds.add(t);
        out.push({
          id: `portfolio:threshold:${t}`,
          year: py.year,
          category: "portfolio",
          subject: "joint",
          title: `Portfolio crosses ${currency(t)}`,
          supportingFigure: `Investable value: ${currency(v)}`,
          details: [{ label: "Threshold", value: currency(t) }],
        });
      }
    }
  }

  // Peak (investable)
  let peakYear = projection[0].year;
  let peakVal = investableValue(projection[0]);
  for (const py of projection) {
    const v = investableValue(py);
    if (v > peakVal) {
      peakVal = v;
      peakYear = py.year;
    }
  }
  out.push({
    id: "portfolio:peak",
    year: peakYear,
    category: "portfolio",
    subject: "joint",
    title: "Portfolio peak",
    supportingFigure: `Investable value: ${currency(peakVal)}`,
    details: [{ label: "Peak value", value: currency(peakVal) }],
  });

  return out;
}
