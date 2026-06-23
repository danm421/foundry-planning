// src/components/portal/portal-investments-client.tsx
"use client";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { InvestmentTrendChart } from "@/components/portal/investment-trend-chart";
import { InvestmentAllocationBars } from "@/components/portal/investment-allocation-bars";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalInvestmentsData } from "@/lib/portal/load-portal-investments";

function pctChange(series: { netWorth: number }[]): number | null {
  if (series.length < 2) return null;
  const first = series[0].netWorth, last = series[series.length - 1].netWorth;
  if (!first) return null;
  return ((last - first) / first) * 100;
}
function ChangeBadge({ pct }: { pct: number | null }): ReactElement | null {
  if (pct == null) return null;
  const up = pct >= 0;
  return <span className={up ? "text-emerald-500" : "text-red-500"}>{up ? "↗" : "↘"} {Math.abs(pct).toFixed(2)}%</span>;
}

export function PortalInvestmentsClient({
  data, asOfDate,
}: { data: PortalInvestmentsData; asOfDate: string }): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(data.accounts[0]?.id ?? null);
  const selected = useMemo(() => data.accounts.find((a) => a.id === selectedId) ?? null, [data.accounts, selectedId]);
  const [quotes, setQuotes] = useState<Record<string, { price: number; changePct: number | null }>>({});
  const portalFetch = usePortalFetch();

  useEffect(() => {
    const tickers = [...new Set((selected?.holdings ?? []).map((h) => h.ticker).filter((t): t is string => !!t))];
    if (tickers.length === 0) { setQuotes({}); return; }
    let live = true;
    portalFetch(`/api/portal/investments/quotes?tickers=${tickers.join(",")}`)
      .then((r) => r.ok ? r.json() : { quotes: {} })
      .then((b) => { if (live) setQuotes(b.quotes ?? {}); })
      .catch(() => { if (live) setQuotes({}); });
    return () => { live = false; };
  }, [selected, portalFetch]);

  if (data.accounts.length === 0) {
    return <div className="p-5 text-[13px] text-ink-3">No investment accounts yet. Link an investment account to see your holdings here.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
      {/* Overview */}
      <div className="space-y-5">
        <div>
          <div className="text-[13px] text-ink-3">Investments</div>
          <div className="text-3xl font-semibold text-ink">{fmtUsd(data.totalValue)}</div>
          <div className="text-[13px]"><ChangeBadge pct={pctChange(data.totalSeries)} /></div>
        </div>
        <InvestmentTrendChart series={data.totalSeries} asOfDate={asOfDate} label="Investments" />
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-ink-2">Accounts</h3>
          <ul className="divide-y divide-hair">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setSelectedId(a.id)}
                  className={`flex w-full items-center justify-between py-2.5 text-left ${a.id === selectedId ? "text-accent" : "text-ink"}`}>
                  <span className="flex flex-col">
                    <span className="text-[14px] font-medium">{a.name} {a.last4 ? <span className="text-ink-3">{a.last4}</span> : null}</span>
                    <span className="text-[12px] text-ink-3"><ChangeBadge pct={pctChange(a.series)} /></span>
                  </span>
                  <span className="text-[14px] font-medium">{fmtUsd(a.value)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <InvestmentAllocationBars allocations={data.overallAllocations} />
      </div>

      {/* Account detail */}
      {selected && (
        <div className="space-y-5 lg:border-l lg:border-hair lg:pl-6">
          <div>
            <div className="text-[13px] text-ink-3">{selected.name}</div>
            <div className="text-2xl font-semibold text-ink">{fmtUsd(selected.value)}</div>
            <div className="text-[13px]"><ChangeBadge pct={pctChange(selected.series)} /></div>
          </div>
          <InvestmentTrendChart series={selected.series} asOfDate={asOfDate} label={selected.name} />
          <InvestmentAllocationBars allocations={selected.allocations} />
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink-2">Holdings</h3>
              <span className="text-[11px] uppercase tracking-wide text-ink-3">Last price</span>
            </div>
            <ul className="divide-y divide-hair">
              {selected.holdings.map((h, i) => {
                const q = h.ticker ? quotes[h.ticker] : undefined;
                const price = q?.price ?? h.price;
                return (
                  <li key={`${h.ticker ?? h.name}-${i}`} className="flex items-center justify-between py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-medium text-ink">{h.ticker ?? "—"}</span>
                      <span className="truncate text-[12px] text-ink-3">{h.name}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {q?.changePct != null && <ChangeBadge pct={q.changePct} />}
                      <span className="text-[13px] font-medium text-ink">{fmtUsd(price)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
