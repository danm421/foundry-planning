"use client";

import { useState } from "react";
import MoneyText from "@/components/money-text";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";
import type { PortfolioStats } from "@/lib/portfolio-stats";
import type { RiskReturnStats } from "@/lib/investments/portfolio-stats";

export interface RebalanceComparisonProps {
  result: RebalanceComputeResult;
  onOverrideRate: (rate: number) => void;
}

// ── Delta coloring helper ──────────────────────────────────────────────────────

function deltaColor(delta: number | null | undefined, higherIsBetter: boolean): string {
  if (delta === null || delta === undefined || delta === 0) return "text-ink-3";
  if (higherIsBetter) return delta > 0 ? "text-good" : "text-crit";
  return delta < 0 ? "text-good" : "text-crit";
}

// ── Section card wrapper ───────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-hair-2 bg-card p-4 ${className ?? ""}`}>
      {children}
    </div>
  );
}

// ── Section heading ────────────────────────────────────────────────────────────

function SectionHeading({
  children,
  tooltip,
}: {
  children: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink">
      {children}
      {tooltip && <FieldTooltip text={tooltip} />}
    </h3>
  );
}

// ── 1. Coverage banner ─────────────────────────────────────────────────────────

function CoverageBanner({ result }: { result: RebalanceComputeResult }) {
  const { realizedWindow } = result;
  const coveragePct = result.current.coveragePct;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5">
        <span className="text-sm text-ink-2">
          <span className="font-semibold text-ink">
            <MoneyText value={coveragePct} format="pct" />
          </span>{" "}
          of holdings value has price history
        </span>

        {realizedWindow.windowStart && realizedWindow.windowEnd && (
          <span className="text-xs text-ink-3">
            {realizedWindow.windowStart} – {realizedWindow.windowEnd} · {realizedWindow.nMonths} mo backtest
          </span>
        )}
      </div>

      {realizedWindow.insufficientHistory && (
        <p className="mt-3 text-sm text-warn">
          Not enough shared price history (under 36 months) for a realized backtest — showing
          forward-looking CMA estimates only.
        </p>
      )}
      {!realizedWindow.insufficientHistory && realizedWindow.shortHistory && (
        <p className="mt-3 text-sm text-warn">
          Short shared history (under 60 months); realized stats are less reliable.
        </p>
      )}
    </Card>
  );
}

// ── 2. Asset mix ───────────────────────────────────────────────────────────────

function AssetMixPanel({ result }: { result: RebalanceComputeResult }) {
  return (
    <Card>
      <SectionHeading>Asset mix — current vs. proposed</SectionHeading>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-hair-2">
            <th className="pb-2 text-left font-medium text-ink-2">Asset class</th>
            <th className="pb-2 text-right font-medium text-ink-2">Current</th>
            <th className="pb-2 text-right font-medium text-ink-2">Target</th>
            <th className="pb-2 text-right font-medium text-ink-2">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {result.assetMixDelta.map((row) => (
            <tr key={row.assetClassId}>
              <td className="py-1.5 text-ink">{row.name}</td>
              <td className="py-1.5 text-right tabular-nums">
                <MoneyText value={row.currentPct} format="pct" />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <MoneyText value={row.targetPct} format="pct" />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {row.diffPct === 0 ? (
                  <span className="text-ink-4">—</span>
                ) : (
                  <span className="text-ink">
                    {row.diffPct > 0 ? "+" : ""}
                    <MoneyText value={row.diffPct} format="pct" />
                  </span>
                )}
              </td>
            </tr>
          ))}
          {result.assetMixDelta.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-ink-4">
                No asset class data available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ── 3. KPI comparison ─────────────────────────────────────────────────────────

type KpiFormat = "pct" | "ratio";

interface KpiRow {
  label: string;
  currentValue: number | null;
  proposedValue: number | null;
  format: KpiFormat;
  higherIsBetter: boolean;
}

function kpiDelta(
  current: number | null,
  proposed: number | null,
): number | null {
  if (current === null || proposed === null) return null;
  return proposed - current;
}

function KpiTableRow({ row }: { row: KpiRow }) {
  const delta = kpiDelta(row.currentValue, row.proposedValue);
  const color = deltaColor(delta, row.higherIsBetter);

  const renderValue = (v: number | null, fmt: KpiFormat) => {
    if (v === null) return <span className="text-ink-4">—</span>;
    if (fmt === "ratio") {
      return <span className="tabular-nums">{v.toFixed(2)}</span>;
    }
    return <MoneyText value={v} format="pct" />;
  };

  const renderDelta = (d: number | null, fmt: KpiFormat) => {
    if (d === null) return <span className="text-ink-4">—</span>;
    if (fmt === "ratio") {
      const sign = d > 0 ? "+" : "";
      return (
        <span className={`tabular-nums ${color}`}>
          {sign}
          {d.toFixed(2)}
        </span>
      );
    }
    // pct: show signed value
    if (d === 0) return <span className="text-ink-3">—</span>;
    const sign = d > 0 ? "+" : "";
    return (
      <span className={color}>
        {sign}
        <MoneyText value={d} format="pct" />
      </span>
    );
  };

  return (
    <tr className="border-b border-hair">
      <td className="py-1.5 text-[13px] text-ink-2">{row.label}</td>
      <td className="py-1.5 text-right text-[13px] tabular-nums">
        {renderValue(row.currentValue, row.format)}
      </td>
      <td className="py-1.5 text-right text-[13px] tabular-nums">
        {renderValue(row.proposedValue, row.format)}
      </td>
      <td className="py-1.5 pl-3 border-l border-hair text-right text-[13px] tabular-nums">{renderDelta(delta, row.format)}</td>
    </tr>
  );
}

function buildRealizedRows(
  current: PortfolioStats | null,
  proposed: PortfolioStats | null,
): KpiRow[] {
  return [
    {
      label: "Ann. return (geometric)",
      currentValue: current?.annGeoReturn ?? null,
      proposedValue: proposed?.annGeoReturn ?? null,
      format: "pct",
      higherIsBetter: true,
    },
    {
      label: "Ann. return (arithmetic)",
      currentValue: current?.annArithMean ?? null,
      proposedValue: proposed?.annArithMean ?? null,
      format: "pct",
      higherIsBetter: true,
    },
    {
      label: "Volatility",
      currentValue: current?.annVolatility ?? null,
      proposedValue: proposed?.annVolatility ?? null,
      format: "pct",
      higherIsBetter: false,
    },
    {
      label: "Sharpe",
      currentValue: current?.sharpe ?? null,
      proposedValue: proposed?.sharpe ?? null,
      format: "ratio",
      higherIsBetter: true,
    },
    {
      label: "Sortino",
      currentValue: current?.sortino ?? null,
      proposedValue: proposed?.sortino ?? null,
      format: "ratio",
      higherIsBetter: true,
    },
    {
      label: "Max drawdown",
      currentValue: current?.maxDrawdown ?? null,
      proposedValue: proposed?.maxDrawdown ?? null,
      format: "pct",
      higherIsBetter: false,
    },
  ];
}

function buildCmaRows(current: RiskReturnStats, proposed: RiskReturnStats): KpiRow[] {
  return [
    {
      label: "Expected return (geometric)",
      currentValue: current.geometricReturn,
      proposedValue: proposed.geometricReturn,
      format: "pct",
      higherIsBetter: true,
    },
    {
      label: "Expected return (arithmetic)",
      currentValue: current.arithmeticMean,
      proposedValue: proposed.arithmeticMean,
      format: "pct",
      higherIsBetter: true,
    },
    {
      label: "Std dev",
      currentValue: current.stdDev,
      proposedValue: proposed.stdDev,
      format: "pct",
      higherIsBetter: false,
    },
    {
      label: "Sharpe",
      currentValue: current.sharpe,
      proposedValue: proposed.sharpe,
      format: "ratio",
      higherIsBetter: true,
    },
  ];
}

const REALIZED_TOOLTIP =
  "Realized stats are computed from the historical monthly returns of the actual holdings over the shared backtest window — actual past performance, not a forecast.";

const CMA_TOOLTIP =
  "CMA (capital-market assumption) stats are forward-looking estimates derived from long-run asset-class expected returns and covariances — not past performance.";

function KpiTableHeader() {
  return (
    <thead>
      <tr className="border-b border-hair-2">
        <th className="pb-2 text-left text-[13px] font-medium text-ink-2">Metric</th>
        <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Current</th>
        <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Proposed</th>
        <th className="pb-2 pl-3 border-l border-hair text-right text-[13px] font-semibold text-ink">Δ</th>
      </tr>
    </thead>
  );
}

function KpiPanel({ result }: { result: RebalanceComputeResult }) {
  const realizedRows = buildRealizedRows(result.current.realized, result.proposed.realized);
  const cmaRows = buildCmaRows(result.current.cma, result.proposed.cma);
  const hasRealized = result.current.realized !== null || result.proposed.realized !== null;

  return (
    <Card>
      <SectionHeading>Portfolio statistics</SectionHeading>

      {/* Realized sub-block */}
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Realized</span>
          <FieldTooltip text={REALIZED_TOOLTIP} />
        </div>

        {!hasRealized ? (
          <div className="rounded-md bg-card-2 px-3 py-3 text-[13px] text-ink-3">
            Realized backtest requires 36+ months of shared price history. Showing CMA estimates only.
          </div>
        ) : (
          <table className="w-full">
            <KpiTableHeader />
            <tbody className="divide-y divide-hair">
              {realizedRows.map((row) => (
                <KpiTableRow key={row.label} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CMA sub-block */}
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">
            CMA (forward-looking)
          </span>
          <FieldTooltip text={CMA_TOOLTIP} />
        </div>
        <table className="w-full">
          <KpiTableHeader />
          <tbody className="divide-y divide-hair">
            {cmaRows.map((row) => (
              <KpiTableRow key={row.label} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── 4. Trade summary + Tax impact ─────────────────────────────────────────────

type TradeAction = "buy" | "sell" | "hold";

function ActionPill({ action }: { action: TradeAction }) {
  const classes: Record<TradeAction, string> = {
    buy: "text-good border border-good/30",
    sell: "text-crit border border-crit/30",
    hold: "text-ink-4 border border-hair",
  };
  const labels: Record<TradeAction, string> = {
    buy: "Buy",
    sell: "Sell",
    hold: "Hold",
  };
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${classes[action]}`}
    >
      {labels[action]}
    </span>
  );
}

function TradesAndTaxPanel({
  result,
  onOverrideRate,
}: {
  result: RebalanceComputeResult;
  onOverrideRate: (rate: number) => void;
}) {
  const { tradeSummary, tax } = result;
  const [rateInput, setRateInput] = useState(
    tax.rateSource === "override" ? String((tax.effectiveRate * 100).toFixed(1)) : "",
  );
  const [inputError, setInputError] = useState<string | null>(null);

  function handleApply() {
    const parsed = parseFloat(rateInput);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      setInputError("Enter a rate between 0 and 100.");
      return;
    }
    setInputError(null);
    onOverrideRate(parsed / 100);
  }

  return (
    <Card>
      <SectionHeading>Trades and tax impact</SectionHeading>

      {/* Trade summary table */}
      <div className="mb-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
          Trade summary
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hair-2">
              <th className="pb-2 text-left font-medium text-ink-2">Asset class</th>
              <th className="pb-2 text-right font-medium text-ink-2">Current $</th>
              <th className="pb-2 text-right font-medium text-ink-2">Target $</th>
              <th className="pb-2 text-right font-medium text-ink-2">Δ $</th>
              <th className="pb-2 text-right font-medium text-ink-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {tradeSummary.map((row) => (
              <tr key={row.assetClassId}>
                <td className="py-1.5 text-ink">{row.name}</td>
                <td className="py-1.5 text-right tabular-nums">
                  <MoneyText value={row.currentValue} format="currency" />
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  <MoneyText value={row.targetValue} format="currency" />
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink">
                  <MoneyText value={row.deltaValue} format="accounting" />
                </td>
                <td className="py-1.5 text-right">
                  <ActionPill action={row.action} />
                </td>
              </tr>
            ))}
            {tradeSummary.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-ink-4">
                  No trades required.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Tax impact */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Tax impact</p>
        <div className="rounded-md bg-card-2 p-3">
          <div className="grid grid-cols-3 gap-x-6">
            <div>
              <p className="text-sm text-ink-3">Realized gain / (loss)</p>
              <p className="mt-0.5 text-[15px] tabular-nums text-ink">
                <MoneyText value={tax.realizedGain} format="currency" />
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-sm text-ink-3">
                Effective rate
                <span className="rounded-sm bg-card px-1 py-0.5 text-[10px] text-ink-4">
                  {tax.rateSource === "override" ? "override" : "engine-derived"}
                </span>
              </p>
              <p className="mt-0.5 text-[15px] tabular-nums text-ink">
                <MoneyText value={tax.effectiveRate} format="pct" />
              </p>
            </div>
            <div>
              <p className="text-sm text-ink-3">Estimated tax</p>
              <p className="mt-0.5">
                <MoneyText value={tax.estimatedTax} format="currency" size="kpi" />
              </p>
            </div>
          </div>
        </div>

        {/* Tax notes */}
        {tax.notes.length > 0 && (
          <ul className="mt-3 space-y-0.5">
            {tax.notes.map((note, i) => (
              <li key={i} className="text-xs text-ink-3">
                {note}
              </li>
            ))}
          </ul>
        )}

        {/* Custom tax rate input */}
        <div className="mt-4 border-t border-hair-2 pt-4">
          <p className="mb-3 text-xs text-ink-3">Adjust the capital gains rate used for this estimate. Leave blank to use the projected rate.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1 text-xs text-ink-2">
                Custom tax rate (%)
                <FieldTooltip text="Enter a rate in percent (e.g. 23.8 for the 20% LTCG + 3.8% NIIT bracket)." />
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={rateInput}
                onChange={(e) => {
                  setRateInput(e.target.value);
                  setInputError(null);
                }}
                placeholder={String((tax.effectiveRate * 100).toFixed(1))}
                className="h-8 w-24 rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink tabular focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {inputError && <p className="text-xs text-crit">{inputError}</p>}
            </div>
            <button
              type="button"
              onClick={handleApply}
              disabled={rateInput === ""}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Root export ────────────────────────────────────────────────────────────────

export function RebalanceComparison({ result, onOverrideRate }: RebalanceComparisonProps) {
  return (
    <div className="space-y-6">
      <CoverageBanner result={result} />
      <AssetMixPanel result={result} />
      <KpiPanel result={result} />
      <TradesAndTaxPanel result={result} onOverrideRate={onOverrideRate} />
    </div>
  );
}
