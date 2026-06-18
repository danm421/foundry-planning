// src/app/(app)/clients/[id]/assets/investments/holdings-tab.tsx
"use client";

import { useMemo, useState } from "react";
import {
  flattenInventory,
  sortFlatHoldings,
  type AccountHoldingsGroup,
  type HoldingLite,
  type SortDir,
  type SortKey,
} from "@/lib/investments/holdings-inventory";

const usd0 = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const sharesFmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

function GainLoss({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-ink-3">—</span>;
  const cls = value > 0 ? "text-green-500" : value < 0 ? "text-red-500" : "text-ink-2";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cls}>
      {sign}{usd0(value)}{pct != null ? ` (${sign}${(pct * 100).toFixed(1)}%)` : ""}
    </span>
  );
}

const TH = "px-2 py-1.5 text-xs font-semibold text-ink-3";
const TD = "px-2 py-1.5 text-sm text-ink-2";

function HoldingCells({ h }: { h: HoldingLite }) {
  return (
    <>
      <td className={`${TD} font-medium text-ink`}>{h.ticker || "—"}</td>
      <td className={TD}>{h.name || "—"}</td>
      <td className={`${TD} text-right tabular-nums`}>{sharesFmt(h.shares)}</td>
      <td className={`${TD} text-right tabular-nums`}>{usd2(h.price)}</td>
      <td className={`${TD} text-right tabular-nums`}>{usd0(h.marketValue)}</td>
      <td className={`${TD} text-right tabular-nums`}>{pct1(h.pctOfTotal)}</td>
      <td className={`${TD} text-right tabular-nums`}>{h.costBasis == null ? <span className="text-ink-3">—</span> : usd0(h.costBasis)}</td>
      <td className={`${TD} text-right tabular-nums`}><GainLoss value={h.gainLoss} pct={h.gainLossPct} /></td>
    </>
  );
}

function ByAccount({ groups }: { groups: AccountHoldingsGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.accountId} className="rounded-lg border border-hair bg-card">
          <header className="flex items-baseline justify-between border-b border-hair px-4 py-2.5">
            <div>
              <span className="text-sm font-semibold text-ink">{g.accountName}</span>
              <span className="ml-2 text-xs uppercase tracking-wide text-ink-3">{g.category}</span>
            </div>
            <div className="text-sm tabular-nums text-ink-2">
              {usd0(g.totalValue)} <span className="text-ink-3">· {pct1(g.pctOfTotal)}</span>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-hair text-left">
                  <th className={TH}>Ticker</th>
                  <th className={TH}>Name</th>
                  <th className={`${TH} text-right`}>Shares</th>
                  <th className={`${TH} text-right`}>Price</th>
                  <th className={`${TH} text-right`}>Market Value</th>
                  <th className={`${TH} text-right`}>% of Total</th>
                  <th className={`${TH} text-right`}>Cost Basis</th>
                  <th className={`${TH} text-right`}>Gain/Loss</th>
                </tr>
              </thead>
              <tbody>
                {g.holdings.map((h) => (
                  <tr key={h.id} className="border-b border-hair/50 last:border-0">
                    <HoldingCells h={h} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "accountName", label: "Account", align: "left" },
  { key: "ticker", label: "Ticker", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "shares", label: "Shares", align: "right" },
  { key: "price", label: "Price", align: "right" },
  { key: "marketValue", label: "Market Value", align: "right" },
  { key: "pctOfTotal", label: "% of Total", align: "right" },
  { key: "costBasis", label: "Cost Basis", align: "right" },
  { key: "gainLoss", label: "Gain/Loss", align: "right" },
];

function AllHoldings({ groups }: { groups: AccountHoldingsGroup[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const rows = useMemo(
    () => sortFlatHoldings(flattenInventory(groups), sortKey, sortDir),
    [groups, sortKey, sortDir],
  );
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "accountName" || key === "ticker" || key === "name" ? "asc" : "desc"); }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hair">
            {COLUMNS.map((c) => (
              <th key={c.key} className={`${TH} ${c.align === "right" ? "text-right" : "text-left"}`}>
                <button type="button" onClick={() => onSort(c.key)} className="hover:text-ink">
                  {c.label}{arrow(c.key)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hair/50 last:border-0">
              <td className={`${TD} text-ink`}>{r.accountName}</td>
              <HoldingCells h={r} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HoldingsTab({ groups }: { groups: AccountHoldingsGroup[] }) {
  const [mode, setMode] = useState<"byAccount" | "all">("byAccount");

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-hair bg-card p-8 text-center text-sm text-ink-3">
        No holdings recorded for this client.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Holdings view"
        className="inline-flex self-start rounded-md border border-hair-2 bg-card-2/50 p-0.5 text-xs"
      >
        {([
          { id: "byAccount", label: "By Account" },
          { id: "all", label: "All Holdings" },
        ] as const).map((opt) => (
          <button
            key={opt.id}
            role="radio"
            aria-checked={mode === opt.id}
            onClick={() => setMode(opt.id)}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              mode === opt.id ? "bg-card text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === "byAccount" ? <ByAccount groups={groups} /> : <AllHoldings groups={groups} />}
    </div>
  );
}
