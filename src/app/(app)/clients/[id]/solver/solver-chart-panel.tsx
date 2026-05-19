"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { PortfolioBarsChart } from "@/components/charts/portfolio-bars-chart";
import { SolverCashFlowChart } from "@/components/charts/solver-cash-flow-chart";
import { YearlyLiquidityChart } from "@/components/yearly-liquidity-chart";
import { LiNeedOverTimeView } from "./li-need-over-time-view";
import { useNeedOverTime } from "./use-need-over-time";

type ChartTab = "portfolio" | "cashflow" | "liquidity" | "lifeInsurance";

const BASE_TABS: { id: ChartTab; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "cashflow", label: "Cash Flow" },
  { id: "liquidity", label: "Liquidity" },
];

const LI_TAB: { id: ChartTab; label: string } = {
  id: "lifeInsurance",
  label: "Life Insurance Need",
};

interface Props {
  currentProjection: ProjectionYear[];
  baseProjection: ProjectionYear[];
  workingTree: ClientData;
  computeStatus: "fresh" | "stale" | "computing" | "error";
  clientId: string;
  /** Lifted LI assumptions — POSTed verbatim by the over-time solve. */
  liAssumptions: LiAssumptions;
  clientName: string;
  spouseName: string;
  /** True while the Life Insurance solver tab is active below the grid. */
  showLifeInsuranceTab: boolean;
}

export function SolverChartPanel({
  currentProjection,
  baseProjection,
  workingTree,
  computeStatus,
  clientId,
  liAssumptions,
  clientName,
  spouseName,
  showLifeInsuranceTab,
}: Props) {
  // The user-selected base tab. When the LI solver tab is active, the LI Need
  // chart is auto-selected via `tab` below — but this state remembers what to
  // fall back to once the LI tab closes.
  const [tab, setTab] = useState<ChartTab>("portfolio");
  const [showPortfolioAssets, setShowPortfolioAssets] = useState(false);

  const overTime = useNeedOverTime(clientId);
  const { cancel: cancelOverTime } = overTime;

  // Derived during render — no effect-synced state. Entering the LI solver
  // tab forces the LI Need chart; leaving it reverts to the user's chosen
  // base tab. Because "lifeInsurance" can only ever be reached while the LI
  // tab is open, it can't strand the panel once that tab closes.
  const activeTab: ChartTab = showLifeInsuranceTab
    ? "lifeInsurance"
    : tab === "lifeInsurance"
      ? "portfolio"
      : tab;

  // Leaving the LI solver tab cancels any in-flight over-time solve — a
  // genuine external-system teardown, the legitimate use of an effect.
  useEffect(() => {
    if (!showLifeInsuranceTab) cancelOverTime();
  }, [showLifeInsuranceTab, cancelOverTime]);

  const tabs = showLifeInsuranceTab ? [...BASE_TABS, LI_TAB] : BASE_TABS;
  const isMarried = Boolean(workingTree.client.spouseName);

  // Built only when the Liquidity tab is active — avoids running the estate
  // report on every recompute (and against fixtures that lack estate data).
  const liquidityRows = useMemo(() => {
    if (activeTab !== "liquidity") return [];
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
  }, [activeTab, currentProjection, workingTree]);

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Chart view"
          className="inline-flex rounded-md border border-hair-2 bg-card-2 p-0.5"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-accent/20 text-ink"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab === "liquidity" ? (
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

      {activeTab === "portfolio" ? (
        <div style={{ height: 300 }}>
          <PortfolioBarsChart
            current={currentProjection}
            baseline={baseProjection}
          />
        </div>
      ) : null}
      {activeTab === "cashflow" ? (
        <div style={{ height: 300 }}>
          <SolverCashFlowChart years={currentProjection} />
        </div>
      ) : null}
      {activeTab === "liquidity" ? (
        <YearlyLiquidityChart
          rows={liquidityRows}
          showPortfolio={showPortfolioAssets}
        />
      ) : null}
      {activeTab === "lifeInsurance" ? (
        <LiNeedOverTimeView
          rows={overTime.rows}
          isRunning={overTime.isRunning}
          progress={overTime.progress}
          errorMessage={overTime.errorMessage}
          onRun={() => overTime.run(liAssumptions)}
          onCancel={overTime.cancel}
          isMarried={isMarried}
          clientName={clientName}
          spouseName={spouseName}
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
