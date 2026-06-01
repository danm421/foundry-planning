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
import { hasSpouse } from "@/lib/life-insurance/need-over-time";
import { SolverYearTablePanel } from "./solver-year-table-panel";

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
  const [tab, setTab] = useState<ChartTab>(
    showLifeInsuranceTab ? "lifeInsurance" : "portfolio",
  );
  const [showPortfolioAssets, setShowPortfolioAssets] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const overTime = useNeedOverTime(clientId);
  const { cancel: cancelOverTime } = overTime;

  // Auto-select the LI Need tab when the LI solver tab opens, and revert to
  // Portfolio when it closes — adjusted during render via a previous-prop
  // tracker (React's "store info from previous renders" pattern). Doing this
  // in render rather than an effect avoids the cascading-render lint rule,
  // while still leaving `tab` as real user-controllable state between the
  // open/close transitions.
  const [prevShowLiTab, setPrevShowLiTab] = useState(showLifeInsuranceTab);
  if (showLifeInsuranceTab !== prevShowLiTab) {
    setPrevShowLiTab(showLifeInsuranceTab);
    setTab((t) =>
      showLifeInsuranceTab
        ? "lifeInsurance"
        : t === "lifeInsurance"
          ? "portfolio"
          : t,
    );
  }

  // Aborting an in-flight over-time fetch is a genuine external-system
  // teardown, so it stays in an effect — it does not call setState.
  useEffect(() => {
    if (!showLifeInsuranceTab) cancelOverTime();
  }, [showLifeInsuranceTab, cancelOverTime]);

  const tabs = showLifeInsuranceTab ? [...BASE_TABS, LI_TAB] : BASE_TABS;
  // Toggle visibility must match the over-time engine's own spouse check
  // (need-over-time.ts `hasSpouse`) so the client/spouse toggle never offers
  // a series the engine returned as null, nor hides one it computed.
  const isMarried = hasSpouse(workingTree);

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
          {tabs.map((t) => (
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
        <div className="flex items-center gap-3">
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
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            className="text-[12px] font-medium text-ink-3 hover:text-ink"
          >
            {showTable ? "Hide table" : "Expand table"}
          </button>
        </div>
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
      {tab === "lifeInsurance" ? (
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

      {showTable ? (
        <SolverYearTablePanel
          years={currentProjection}
          hasSpouse={isMarried}
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
