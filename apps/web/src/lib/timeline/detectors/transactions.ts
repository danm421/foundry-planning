// src/lib/timeline/detectors/transactions.ts
import type { ClientData, ProjectionYear } from "@foundry/engine";
import type { TimelineEvent } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function transferModeLabel(mode: string): string {
  switch (mode) {
    case "one_time": return "one-time";
    case "recurring": return "recurring";
    case "scheduled": return "scheduled";
    default: return mode.replace(/_/g, " ");
  }
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectTransactionEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const byYear = new Map<number, ProjectionYear>();
  for (const py of projection) byYear.set(py.year, py);

  for (const tx of data.assetTransactions ?? []) {
    if (!inRange(tx.year, projection)) continue;
    const py = byYear.get(tx.year);

    if (tx.type === "sell") {
      const saleInfo = py?.techniqueBreakdown?.sales.find((s) => s.transactionId === tx.id);
      const supporting = saleInfo
        ? `${currency(saleInfo.saleValue)} sale · ${currency(saleInfo.netProceeds)} net`
        : `${tx.name}`;
      const details = saleInfo
        ? [
            { label: "Sale value", value: currency(saleInfo.saleValue) },
            { label: "Transaction costs", value: currency(saleInfo.transactionCosts) },
            { label: "Mortgage paid off", value: currency(saleInfo.mortgagePaidOff) },
            { label: "Net proceeds", value: currency(saleInfo.netProceeds) },
            { label: "Capital gain", value: currency(saleInfo.capitalGain) },
          ]
        : [{ label: "Transaction", value: tx.name }];
      out.push({
        id: `transaction:sell:${tx.id}`,
        year: tx.year,
        category: "transaction",
        subject: "joint",
        title: tx.name,
        supportingFigure: supporting,
        details,
      });
    } else if (tx.type === "buy") {
      const buyInfo = py?.techniqueBreakdown?.purchases.find((s) => s.transactionId === tx.id);
      const supporting = buyInfo
        ? `${currency(buyInfo.purchasePrice)} purchase${buyInfo.mortgageAmount > 0 ? ` · ${currency(buyInfo.mortgageAmount)} mortgage` : ""}`
        : `${tx.name}`;
      const details = buyInfo
        ? [
            { label: "Purchase price", value: currency(buyInfo.purchasePrice) },
            { label: "Mortgage", value: currency(buyInfo.mortgageAmount) },
            { label: "Equity", value: currency(buyInfo.equity) },
          ]
        : [{ label: "Transaction", value: tx.name }];
      out.push({
        id: `transaction:buy:${tx.id}`,
        year: tx.year,
        category: "transaction",
        subject: "joint",
        title: tx.name,
        supportingFigure: supporting,
        details,
      });
    }
  }

  for (const t of data.transfers ?? []) {
    if (!inRange(t.startYear, projection)) continue;
    out.push({
      id: `transaction:transfer:${t.id}`,
      year: t.startYear,
      category: "transaction",
      subject: "joint",
      title: `${t.name} begins`,
      supportingFigure: `${currency(t.amount)} · ${transferModeLabel(t.mode)}`,
      details: [
        { label: "From", value: t.sourceAccountId },
        { label: "To", value: t.targetAccountId },
        { label: "Mode", value: transferModeLabel(t.mode) },
        { label: "Amount", value: currency(t.amount) },
      ],
    });
  }

  return out;
}
