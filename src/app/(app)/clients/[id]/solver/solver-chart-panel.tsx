"use client";

import { useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { PortfolioBarsChart } from "@/components/charts/portfolio-bars-chart";
import { SolverCashFlowChart } from "@/components/charts/solver-cash-flow-chart";
import { YearlyLiquidityChart } from "@/components/yearly-liquidity-chart";

type ChartTab = "portfolio" | "cashflow" | "liquidity";

const TABS: { id: ChartTab; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "cashflow", label: "Cash Flow" },
  { id: "liquidity", label: "Liquidity" },
];

interface Props {
  currentProjection: ProjectionYear[];
  baseProjection: ProjectionYear[];
  workingTree: ClientData;
  computeStatus: "fresh" | "stale" | "computing" | "error";
}

export function SolverChartPanel({
  currentProjection,
  baseProjection,
  workingTree,
  computeStatus,
}: Props) {
  const [tab, setTab] = useState<ChartTab>("portfolio");
  const [showPortfolioAssets, setShowPortfolioAssets] = useState(false);

  // Built only when the Liquidity tab is active — avoids running the estate
  // report on every recompute (and against fixtures that lack estate data).
  const liquidityRows = useMemo(() => {
    if (tab !== "liquidity") return [];
    const c = workingTree.client;
    return buildYearlyLiquidityReport({
      projection: { years: currentProjection },
      clientData: workingTree,
      ownerNames: {
        clientName: `${c.firstName} ${c.lastName}`.trim(),
        spouseName: c.spouseName ?? null,
      },
      ownerDobs: {
        clientDob: c.dateOfBirth,
        spouseDob: c.spouseDob ?? null,
      },
    }).rows;
  }, [tab, currentProjection, workingTree]);

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Chart view"
          className="inline-flex rounded-md border border-hair-2 bg-card-2 p-0.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-accent/20 text-ink"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "liquidity" ? (
          <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <input
              type="checkbox"
              checked={showPortfolioAssets}
              onChange={(e) => setShowPortfolioAssets(e.target.checked)}
              className="accent-accent"
            />
            Show portfolio assets
          </label>
        ) : null}
      </div>

      {tab === "portfolio" ? (
        <div style={{ height: 300 }}>
          <PortfolioBarsChart
            current={currentProjection}
            baseline={baseProjection}
          />
        </div>
      ) : null}
      {tab === "cashflow" ? (
        <div style={{ height: 300 }}>
          <SolverCashFlowChart years={currentProjection} />
        </div>
      ) : null}
      {tab === "liquidity" ? (
        <YearlyLiquidityChart
          rows={liquidityRows}
          showPortfolio={showPortfolioAssets}
        />
      ) : null}

      {computeStatus === "computing" ? (
        <div
          aria-live="polite"
          className="mt-2 inline-flex items-center gap-2 text-[11px] text-ink-3"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-accent/70 animate-pulse"
          />
          Recalculating…
        </div>
      ) : null}
    </div>
  );
}
