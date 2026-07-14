"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
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
import { EstateComparisonChart } from "@/components/charts/estate-comparison-chart";
import { TaxBracketChart } from "@/components/cashflow/charts/tax-bracket-chart";
import { TaxBracketTab } from "@/components/cashflow/tax-bracket-tab";
import { type ReportKey } from "./report-tab-link";
import {
  PortfolioIcon,
  CashFlowIcon,
  TaxBracketIcon,
  LifeInsuranceIcon,
  EstatePlanningIcon,
  MonteCarloIcon,
  EducationIcon,
  SummariesIcon,
  BalanceSheetIcon,
} from "./report-tab-icons";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import type { SummaryKey } from "@/components/solver/summaries/types";
import { SolverSummaryPanel } from "./solver-summary-panel";
import { SolverMonteCarloPanel } from "./solver-monte-carlo-panel";
import { EducationReportPanel } from "@/components/solver/education/education-report-panel";
import { SolverBalanceSheetPanel } from "./solver-balance-sheet-panel";

// `label` is the full name (accessible name + hover title); `short` is what
// renders beneath the icon — mirrors the left-pane LEFT_TABS so both tab strips
// read the same. Keep `label` exact: tests query tabs by accessible name.
const REPORT_TABS: {
  id: ReportKey;
  label: string;
  short: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}[] = [
  { id: "portfolio", label: "Portfolio", short: "Portfolio", icon: PortfolioIcon },
  { id: "cashflow", label: "Cash Flow", short: "Cash Flow", icon: CashFlowIcon },
  { id: "taxBracket", label: "Tax Bracket", short: "Taxes", icon: TaxBracketIcon },
  { id: "lifeInsurance", label: "Life Insurance Need", short: "Insurance", icon: LifeInsuranceIcon },
  { id: "estate", label: "Estate", short: "Estate", icon: EstatePlanningIcon },
  { id: "monteCarlo", label: "Monte Carlo", short: "Monte Carlo", icon: MonteCarloIcon },
  { id: "education", label: "Education", short: "Education", icon: EducationIcon },
  { id: "balanceSheet", label: "Balance Sheet", short: "Bal Sheet", icon: BalanceSheetIcon },
  { id: "summaries", label: "Summaries", short: "Summary", icon: SummariesIcon },
];

// Resizable chart area. Default sits below the old fixed 300/360px so more of
// the data-entry grid shows on first paint; the advisor can drag it taller and
// the choice persists per browser. Every tab renders into this same height, so
// the minimum has to leave room for the tabs that carry chrome above the plot
// (the estate header/slider/toggle + deltas, the life-insurance controls)
// without clipping it.
const MIN_CHART_HEIGHT = 180;
const MAX_CHART_HEIGHT = 560;
const DEFAULT_CHART_HEIGHT = 240;
const CHART_HEIGHT_KEY = "foundry:solver:chartHeight";

const clampChartHeight = (h: number) =>
  Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, h));

// A tiny external store backed by localStorage, read through
// useSyncExternalStore. This keeps the persisted height working without a mount
// effect (which would trip react-hooks/set-state-in-effect) and without an SSR
// hydration mismatch — the server snapshot is the default and the client
// reconciles to the stored value after hydration.
let cachedChartHeight: number | null = null;
const chartHeightListeners = new Set<() => void>();

function readStoredChartHeight(): number {
  try {
    const raw = window.localStorage.getItem(CHART_HEIGHT_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampChartHeight(n);
    }
  } catch {
    // localStorage unavailable (private mode) — fall through to the default.
  }
  return DEFAULT_CHART_HEIGHT;
}

function getChartHeightSnapshot(): number {
  if (cachedChartHeight === null) cachedChartHeight = readStoredChartHeight();
  return cachedChartHeight;
}

function subscribeChartHeight(onChange: () => void): () => void {
  chartHeightListeners.add(onChange);
  return () => chartHeightListeners.delete(onChange);
}

// `persist` is false during a drag (re-render only) and true on release / nudge
// / reset, so we write to localStorage once per gesture rather than per pixel.
function setChartHeightStore(height: number, persist: boolean): void {
  cachedChartHeight = clampChartHeight(height);
  if (persist) {
    try {
      window.localStorage.setItem(CHART_HEIGHT_KEY, String(cachedChartHeight));
    } catch {
      // localStorage unavailable — keep the in-memory value only.
    }
  }
  for (const listener of chartHeightListeners) listener();
}

interface Props {
  currentProjection: ProjectionYear[];
  /** Real first-death year from the with-events working projection (sourced by
   *  the KPI hook). Drives the estate chart's death-order toggle: at/after this
   *  year the toggle is hidden and ordering is forced to primaryFirst. */
  firstDeathYear: number | null;
  baseProjection: ProjectionYear[];
  workingTree: ClientData;
  computeStatus: "fresh" | "stale" | "computing" | "error";
  clientId: string;
  /** Lifted LI assumptions — POSTed verbatim by the over-time solve. */
  liAssumptions: LiAssumptions;
  /** Display label for the resolved LI-proceeds portfolio — for the summary
   *  Life Insurance tab's Run-button solve. */
  liModelPortfolioLabel: string;
  clientName: string;
  spouseName: string;
  /** Controlled active report tab; linked to the left input tab in the workspace. */
  activeReport: ReportKey;
  /** Called when a report tab is clicked, so the workspace can override the default. */
  onReportChange: (r: ReportKey) => void;
  /** Base-case effective tree, for the Base series of the estate chart. */
  baseTree: ClientData;
  source: SolverSource;
  mutations: SolverMutation[];
  mcSuccessRate: number | null;
  extraAccountMixes: { accountId: string; mix: { assetClassId: string; weight: number }[] }[];
  mcNonce: number;
  mcRequested: boolean;
  activeSummary: SummaryKey;
  onSummaryChange: (s: SummaryKey) => void;
  /** Selected year for the cash-flow detail panel; highlights that bar. */
  selectedYear: number | null;
  /** Fired when a cash-flow chart bar is clicked. */
  onYearClick: (year: number) => void;
  /** Blended dedicated-pool return stats per education goalId, for the Education
   *  report's per-goal POS gauge. Sourced from the plan MC data. Optional — the
   *  panel falls back to a neutral per-goal default when absent. */
  educationReturnStats?: Record<string, { arithMean: number; stdDev: number }>;
  /** Scenario Monte Carlo seed, so the per-goal education gauges reproduce. */
  educationSeed?: number;
}

export function SolverChartPanel({
  currentProjection,
  firstDeathYear,
  baseProjection,
  workingTree,
  computeStatus,
  clientId,
  liAssumptions,
  liModelPortfolioLabel,
  clientName,
  spouseName,
  activeReport,
  onReportChange,
  baseTree,
  source,
  mutations,
  mcSuccessRate,
  extraAccountMixes,
  mcNonce,
  mcRequested,
  activeSummary,
  onSummaryChange,
  selectedYear,
  onYearClick,
  educationReturnStats,
  educationSeed,
}: Props) {
  const tab = activeReport;
  const [showPortfolioAssets, setShowPortfolioAssets] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const chartHeight = useSyncExternalStore(
    subscribeChartHeight,
    getChartHeightSnapshot,
    () => DEFAULT_CHART_HEIGHT,
  );

  // Pointer-drag resize: track the gesture with window listeners so the drag
  // keeps working when the cursor leaves the thin handle. Re-render on every
  // move; persist once on release.
  const startChartResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = chartHeight;
    const onMove = (ev: PointerEvent) => {
      setChartHeightStore(startHeight + (ev.clientY - startY), false);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setChartHeightStore(getChartHeightSnapshot(), true);
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const nudgeChartHeight = (delta: number) =>
    setChartHeightStore(chartHeight + delta, true);

  const resetChartHeight = () => setChartHeightStore(DEFAULT_CHART_HEIGHT, true);

  // Auto-runs the need-over-time solve while the Life Insurance Need report is
  // active (and re-runs, debounced, when the assumptions change); deactivating
  // the report aborts any in-flight run.
  const overTime = useNeedOverTime(
    clientId,
    liAssumptions,
    tab === "lifeInsurance",
    source,
    mutations,
  );

  const tabs = REPORT_TABS;
  // Toggle visibility must match the over-time engine's own spouse check
  // (need-over-time.ts `hasSpouse`) so the client/spouse toggle never offers
  // a series the engine returned as null, nor hides one it computed.
  const isMarried = hasSpouse(workingTree);

  // Built only when the Estate tab is active — the liquidity chart now lives
  // alongside the estate comparison there. Gating avoids running the estate
  // report on every recompute (and against fixtures that lack estate data).
  const liquidityRows = useMemo(() => {
    if (tab !== "estate") return [];
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

  const reportTabs = (
    <div
      role="tablist"
      aria-label="Chart view"
      className="flex border-b border-hair-2"
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t.label}
            title={t.label}
            onClick={() => onReportChange(t.id)}
            className={
              active
                ? "flex min-w-0 flex-1 flex-col items-center gap-1 border-b-2 border-accent px-1 py-1.5 text-[11px] font-medium text-accent"
                : "flex min-w-0 flex-1 flex-col items-center gap-1 border-b-2 border-transparent px-1 py-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="max-w-full truncate">{t.short}</span>
          </button>
        );
      })}
    </div>
  );

  const recalculating =
    computeStatus === "computing" ? (
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
    ) : null;

  // The Summaries report is text + KPI cards, not a resizable plot — render the
  // report tabs at the top and let the summary flow beneath them, skipping the
  // fixed-height chart box and drag handle that would otherwise leave a tall
  // blank gap above the content.
  if (tab === "summaries") {
    return (
      <div className="rounded-lg border border-hair bg-card px-4 pt-2.5 pb-2">
        <div className="mb-3">{reportTabs}</div>
        <SolverSummaryPanel
          clientId={clientId}
          source={source}
          mutations={mutations}
          years={currentProjection}
          workingTree={workingTree}
          clientName={clientName}
          spouseName={spouseName || null}
          mcSuccessRate={mcSuccessRate}
          baseClientData={baseTree}
          baseProjection={baseProjection}
          extraAccountMixes={extraAccountMixes}
          liAssumptions={liAssumptions}
          liModelPortfolioLabel={liModelPortfolioLabel}
          activeSummary={activeSummary}
          onSummaryChange={onSummaryChange}
        />
        {recalculating}
      </div>
    );
  }

  if (tab === "education") {
    return (
      <div className="rounded-lg border border-hair bg-card px-4 pt-2.5 pb-2">
        <div className="mb-3">{reportTabs}</div>
        <EducationReportPanel
          years={currentProjection}
          expenses={workingTree.expenses}
          returnStats={educationReturnStats}
          seed={educationSeed}
        />
        {recalculating}
      </div>
    );
  }

  if (tab === "monteCarlo") {
    return (
      <div className="rounded-lg border border-hair bg-card px-4 pt-2.5 pb-2">
        <div className="mb-3">{reportTabs}</div>
        <SolverMonteCarloPanel
          clientId={clientId}
          source={source}
          mutations={mutations}
          extraAccountMixes={extraAccountMixes}
          enabled={mcRequested}
          nonce={mcNonce}
        />
        {recalculating}
      </div>
    );
  }

  if (tab === "balanceSheet") {
    return (
      <div className="rounded-lg border border-hair bg-card px-4 pt-2.5 pb-2">
        <div className="mb-3">{reportTabs}</div>
        <SolverBalanceSheetPanel
          workingTree={workingTree}
          years={currentProjection}
          clientName={clientName}
          spouseName={spouseName}
        />
        {recalculating}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hair bg-card px-4 pt-2.5 pb-2">
      <div className="mb-3">{reportTabs}</div>
      {/* One shared, resizable height for every chart tab — so the drag handle
          below always applies and no tab's content can overflow onto the page.
          The Estate tab stacks two charts, so it gets twice the height (plus the
          gap between them); resizing still scales both together. */}
      <div
        style={{ height: tab === "estate" ? chartHeight * 2 + 16 : chartHeight }}
        className="overflow-hidden"
      >
        {tab === "portfolio" ? (
          <PortfolioBarsChart
            current={currentProjection}
            baseline={baseProjection}
          />
        ) : null}
        {tab === "cashflow" ? (
          <SolverCashFlowChart
            years={currentProjection}
            selectedYear={selectedYear}
            onYearClick={onYearClick}
          />
        ) : null}
        {tab === "taxBracket" ? (
          <TaxBracketChart years={currentProjection} fillHeight />
        ) : null}
        {tab === "lifeInsurance" ? (
          <LiNeedOverTimeView
            rows={overTime.rows}
            isRunning={overTime.isRunning}
            progress={overTime.progress}
            errorMessage={overTime.errorMessage}
            isMarried={isMarried}
            clientName={clientName}
            spouseName={spouseName}
          />
        ) : null}
        {tab === "estate" ? (
          // Estate comparison stacked above liquidity-vs-transfer-cost: the
          // advisor reads "where the estate goes" then "is there cash to pay for
          // it" below. Full width each so neither chart's labels get pinched;
          // both flex to an equal share of the doubled box height.
          <div className="flex h-full flex-col gap-4">
            <div className="min-h-0 flex-1">
              <EstateComparisonChart
                baseProjection={baseProjection}
                proposedProjection={currentProjection}
                baseTree={baseTree}
                proposedTree={workingTree}
                isMarried={isMarried}
                firstDeathYear={firstDeathYear}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="text-[13px] font-medium text-ink">
                Liquidity &amp; transfer cost
              </div>
              <div className="min-h-0 flex-1">
                <YearlyLiquidityChart
                  rows={liquidityRows}
                  showPortfolio={showPortfolioAssets}
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Always present — the chevrons + grip read as a vertical resize handle
          at rest, so the affordance is discoverable on every tab. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chart height"
        aria-valuenow={chartHeight}
        aria-valuemin={MIN_CHART_HEIGHT}
        aria-valuemax={MAX_CHART_HEIGHT}
        tabIndex={0}
        title="Drag to resize chart · double-click to reset"
        onPointerDown={startChartResize}
        onDoubleClick={resetChartHeight}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            nudgeChartHeight(-16);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            nudgeChartHeight(16);
          }
        }}
        className="group mt-1 flex h-4 cursor-ns-resize touch-none items-center justify-center gap-1.5 rounded text-ink-4 outline-none transition-colors hover:text-accent focus-visible:text-accent focus-visible:ring-1 focus-visible:ring-accent"
      >
        <ResizeChevron direction="up" />
        <span className="h-[3px] w-10 rounded-full bg-current opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        <ResizeChevron direction="down" />
      </div>

      {/* The Taxes report shows its bracket table inline at all times, so it
          needs no expand/collapse control. Every other tab keeps the toggle. */}
      {tab === "taxBracket" ? null : (
        <div className="mt-3 flex items-center justify-end gap-3">
          {tab === "estate" ? (
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
      )}

      {tab === "taxBracket" ? (
        <div className="mt-3">
          <TaxBracketTab years={currentProjection} />
        </div>
      ) : showTable ? (
        <SolverYearTablePanel
          years={currentProjection}
          hasSpouse={isMarried}
          clientData={workingTree}
        />
      ) : null}

      {recalculating}
    </div>
  );
}

// Small chevron for the resize handle. Inlined as SVG because lucide-react is
// not a dependency in this repo; outline-only, 1.5px stroke per the design kit.
function ResizeChevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-2.5 w-2.5"
    >
      <polyline points={direction === "up" ? "6 15 12 9 18 15" : "6 9 12 15 18 9"} />
    </svg>
  );
}
