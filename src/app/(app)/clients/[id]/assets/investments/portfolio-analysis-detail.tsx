"use client";

import Link from "next/link";
import { PortfolioAnalysisScatter } from "./portfolio-analysis-scatter";
import { buildColorMap, labelForType } from "./portfolio-analysis-series";
import { exactCurrency } from "@/lib/presentations/format";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import type { BreakdownEntry, WhereHeldRollup } from "@/lib/investments/analysis-detail";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export interface DetailMemberAccount { id: string; name: string; value: number; topClass: string | null; }

export default function PortfolioAnalysisDetail({
  row,
  breakdown,
  members,
  whereHeld,
  scatterRows,
  tax,
  backHref,
}: {
  row: AnalysisRow;
  breakdown: BreakdownEntry[];
  members: DetailMemberAccount[] | null;
  whereHeld: WhereHeldRollup | null;
  scatterRows: AnalysisRow[];
  tax: { ordinaryIncome: number; ltCapitalGains: number; qualifiedDividends: number; taxExempt: number } | null;
  backHref: string;
}) {
  const colorMap = buildColorMap(scatterRows);
  const stat = (label: string, value: string) => (
    <div className="rounded border border-hair px-3 py-2">
      <div className="text-xs text-ink-4">{label}</div>
      <div className="text-sm font-medium text-ink">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        ← Back to analysis
      </Link>

      <header className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-4">{labelForType(row.type)}</div>
          <h2 className="text-xl font-bold text-ink">{row.name}</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stat("Value", row.value === null ? "—" : exactCurrency(row.value))}
          {stat("Return", pct(row.stats.geometricReturn))}
          {stat("Mean", pct(row.stats.arithmeticMean))}
          {stat("Std Dev", pct(row.stats.stdDev))}
          {stat("Sharpe", row.stats.sharpe === null ? "—" : row.stats.sharpe.toFixed(2))}
        </div>
      </header>

      {scatterRows.length > 0 && (
        <div className="h-[360px] rounded-lg border border-hair bg-card p-4">
          <PortfolioAnalysisScatter rows={scatterRows} colorMap={colorMap} />
        </div>
      )}

      {breakdown.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Asset classes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">Asset Class</th>
                <th className="py-2 text-right">Weight</th>
                <th className="py-2 text-right">Value</th>
                <th className="py-2 text-right">Return</th>
                <th className="py-2 text-right">Mean</th>
                <th className="py-2 text-right">Std Dev</th>
                <th className="py-2 text-right">Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.assetClassId} className="border-b border-hair">
                  <td className="py-2">{b.name}</td>
                  <td className="py-2 text-right">{pct(b.weight)}</td>
                  <td className="py-2 text-right">{b.value === null ? "—" : exactCurrency(b.value)}</td>
                  <td className="py-2 text-right">{pct(b.stats.geometricReturn)}</td>
                  <td className="py-2 text-right">{pct(b.stats.arithmeticMean)}</td>
                  <td className="py-2 text-right">{pct(b.stats.stdDev)}</td>
                  <td className="py-2 text-right">{b.stats.sharpe === null ? "—" : b.stats.sharpe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {members && members.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Accounts in this group</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">Account</th>
                <th className="py-2 text-right">Value</th>
                <th className="py-2 text-left">Largest holding</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-hair">
                  <td className="py-2">{m.name}</td>
                  <td className="py-2 text-right">{exactCurrency(m.value)}</td>
                  <td className="py-2">{m.topClass ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tax && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Tax composition</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat("Ordinary income", pct(tax.ordinaryIncome))}
            {stat("LT capital gains", pct(tax.ltCapitalGains))}
            {stat("Qualified dividends", pct(tax.qualifiedDividends))}
            {stat("Tax-exempt", pct(tax.taxExempt))}
          </div>
        </section>
      )}

      {whereHeld && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Where held</h3>
          {whereHeld.accounts.length === 0 ? (
            <p className="text-sm text-ink-4">No accounts in this client hold this asset class.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Account</th>
                  <th className="py-2 text-right">In this class</th>
                  <th className="py-2 text-right">% of account</th>
                </tr>
              </thead>
              <tbody>
                {whereHeld.accounts.map((a) => (
                  <tr key={a.accountId} className="border-b border-hair">
                    <td className="py-2">{a.name}</td>
                    <td className="py-2 text-right">{exactCurrency(a.classValue)}</td>
                    <td className="py-2 text-right">{pct(a.classWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
