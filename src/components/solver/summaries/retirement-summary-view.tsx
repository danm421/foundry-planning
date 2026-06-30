"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  LineController,
  BarController,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar, Chart } from "react-chartjs-2";
import type { RetirementSummaryPageData } from "@/lib/presentations/pages/retirement-summary/view-model";
import { fmtUsd, fmtUsdMonthly } from "@/lib/presentations/pages/retirement-summary/aggregate";
import type { PortfolioBar } from "@/lib/presentations/pages/retirement-summary/aggregate";
import type { SsClient } from "@/lib/presentations/pages/retirement-summary/social-security";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import {
  SummaryLayout,
  SummarySection,
  SummaryKpiRow,
  SummaryKpiCard,
  SummaryTable,
  SummaryEmpty,
} from "./primitives";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  LineController,
  BarController,
  PointElement,
  Tooltip,
  Legend,
);

// ── Portfolio Trajectory Chart ────────────────────────────────────────────────
// Stacked bar: cash / taxable / retirement assets by year.
const PORTFOLIO_SERIES: {
  label: string;
  key: keyof Pick<PortfolioBar, "cash" | "taxable" | "retirement">;
  colorKey: "grey" | "blue" | "orange";
}[] = [
  { label: "Cash", key: "cash", colorKey: "grey" },
  { label: "Taxable", key: "taxable", colorKey: "blue" },
  { label: "Retirement", key: "retirement", colorKey: "orange" },
];

function PortfolioTrajectoryChart({ bars }: { bars: PortfolioBar[] }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (bars.length === 0) return null;
    const palette = dataPalette(theme);
    return {
      labels: bars.map((b) => String(b.year)),
      datasets: PORTFOLIO_SERIES.map((s) => ({
        label: s.label,
        data: bars.map((b) => b[s.key]),
        backgroundColor: palette[s.colorKey],
        stack: "portfolio",
      })),
    };
  }, [bars, theme]);

  const options = useMemo<ChartOptions<"bar">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtUsd(Number(ctx.parsed.y ?? 0))}`,
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx == null) return [];
              const bar = bars[idx];
              if (!bar) return [];
              return [`Total: ${fmtUsd(bar.total)}`];
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: {
          stacked: true,
          ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsd(Number(v)) },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [bars, theme]);

  if (!chartData) return null;
  return (
    <div className="h-[260px]">
      <Bar data={chartData} options={options} />
    </div>
  );
}

// ── Asset Composition Split Bar ───────────────────────────────────────────────
interface SplitSegment { label: string; value: number; color: string }

function SplitBar({ segments, total }: { segments: SplitSegment[]; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Proportional bar */}
      <div className="flex h-3 overflow-hidden rounded">
        {segments.map((seg) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={seg.label}
              style={{ width: `${pct}%`, backgroundColor: seg.color }}
            />
          );
        })}
      </div>
      {/* Legend rows — show any segment with a real balance, even one that
          rounds to <1% (e.g. a small Roth slice). Only genuinely-empty
          categories are dropped, matching the bar above and the Tax summary. */}
      <div className="flex flex-col gap-0.5">
        {segments.map((seg) => {
          if (seg.value <= 0) return null;
          return (
            <div key={seg.label} className="flex items-center justify-between text-[12px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: seg.color }}
                />
                {seg.label}
              </span>
              <span className="tabular-nums">{fmtUsd(seg.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ChartSpec Renderer ────────────────────────────────────────────────────────
// The `cashFlowChartSpec` is a renderer-agnostic `ChartSpec` (kind:
// "stackedBarWithLine"). There is no existing DOM component for this type —
// `SolverCashFlowChart` takes `ProjectionYear[]`, not a ChartSpec. We build a
// minimal Chart.js renderer here that consumes the spec directly.
function ChartSpecRenderer({ spec }: { spec: ChartSpec }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    // The spec carries PDF (light-theme) colors for the print renderer. On the
    // dark app surface we re-theme to the in-app cash-flow palette so this panel
    // matches the standalone Cash Flow chart (cashflow-report.tsx): grey Other
    // Inflows, gold Withdrawals, and an ink Total-Expenses line that reads on
    // dark — the spec's light-ink line would be near-invisible here.
    const palette = dataPalette(theme);
    const chrome = chartChrome(theme);
    const stackColorByLabel: Record<string, string> = {
      "Social Security": palette.blue,
      Salaries: palette.green,
      "Other Inflows": palette.grey,
      RMDs: palette.orange,
      Withdrawals: palette.yellow,
    };
    const datasets = [
      ...spec.stacks.map((s) => ({
        type: "bar" as const,
        label: s.label,
        data: s.values,
        backgroundColor: stackColorByLabel[s.label] ?? s.color,
        stack: "cf",
        order: 1,
      })),
      ...spec.lines.map((l) => ({
        type: "line" as const,
        label: l.label,
        data: l.values,
        borderColor: chrome.title,
        backgroundColor: "transparent",
        borderWidth: l.strokeWidth,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        order: 0,
      })),
    ];
    return {
      labels: spec.xAxis.domain.map((v) => spec.xAxis.labelFormat(v)),
      datasets,
    };
  }, [spec, theme]);

  const options = useMemo(
    () => {
      const chrome = chartChrome(theme);
      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index" as const, intersect: false },
        plugins: {
          legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 12 } },
          tooltip: {
            backgroundColor: chrome.tooltipBg,
            titleColor: chrome.tooltipTitle,
            bodyColor: chrome.tooltipBody,
            callbacks: {
              label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
                `${ctx.dataset.label}: ${fmtUsd(ctx.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: chrome.tick },
            grid: { color: chrome.grid },
          },
          y: {
            stacked: true,
            ticks: {
              color: chrome.tick,
              callback: (v: unknown) => spec.yAxis.labelFormat(Number(v)),
            },
            grid: { color: chrome.grid },
          },
        },
      };
    },
    [theme, spec],
  );

  return (
    <div className="h-[240px]">
      <Chart type="bar" data={chartData} options={options} />
    </div>
  );
}

// ── Social Security column ────────────────────────────────────────────────────
function SsColumn({ c }: { c: SsClient }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold text-ink">{c.name}</div>
      <div className="text-[11px] text-ink-3">
        {`PIA ${fmtUsdMonthly(c.piaMonthly)}/mo · claims at ${c.claimAge} · COLA ${Math.round(c.colaPct * 100)}%`}
      </div>
      {c.alreadyClaiming ? (
        <div className="flex items-center justify-between rounded bg-card-2 px-2 py-1 text-[12px] text-ink">
          <span>Receiving</span>
          <span className="tabular-nums">{fmtUsdMonthly(c.receivedMonthly ?? 0)}/mo</span>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-hair overflow-hidden rounded border border-hair">
          {c.ladder.map((r) => (
            <div
              key={r.age}
              className={`flex items-center justify-between px-2 py-1 text-[12px] ${
                r.selected ? "bg-accent text-accent-on font-semibold" : "text-ink"
              }`}
            >
              <span className="tabular-nums">{r.age}</span>
              <span className="tabular-nums">{fmtUsdMonthly(r.monthly)}/mo</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────
export function RetirementSummaryView({ data }: { data: RetirementSummaryPageData }) {
  const theme = useThemeName();

  if (data.isEmpty) {
    return <SummaryEmpty message="No data for this scenario yet." />;
  }

  const { kpis, bars, liquid, byType, byTaxType, funding, fundingSources, socialSecurity, living, otherExpenses, income, transactions, narrative, cashFlowChartSpec } = data;

  const palette = dataPalette(theme);

  // Assets-at-retirement split segments
  const byTypeSegments: SplitSegment[] = [
    { label: "Cash", value: byType.cash, color: palette.grey },
    { label: "Taxable", value: byType.taxable, color: palette.blue },
    { label: "Retirement", value: byType.retirement, color: palette.orange },
  ];

  const byTaxTypeSegments: SplitSegment[] = [
    { label: "Roth", value: byTaxType.roth, color: palette.green },
    { label: "Pre-tax", value: byTaxType.preTax, color: palette.red },
    { label: "Taxable", value: byTaxType.taxable, color: palette.grey },
  ];

  // Funding sources (non-zero only, in display order)
  const fundingRows = fundingSources.filter((r) => r.value > 0);
  const FUNDING_COLORS = [palette.blue, palette.green, palette.orange, palette.teal, palette.yellow, palette.red, palette.purple];
  const fundingSegments: SplitSegment[] = fundingRows.map((r, i) => ({
    label: r.label,
    value: r.value,
    color: FUNDING_COLORS[i % FUNDING_COLORS.length] ?? palette.grey,
  }));

  const hasSs = socialSecurity.client != null || socialSecurity.spouse != null;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>

      {/* ── Section 1: Assets & Outlook (mirrors PDF page 1) ── */}

      {/* KPI row: outlook (Monte Carlo, retirement timing, total spend) + liquid checkpoints */}
      <SummaryKpiRow>
        <SummaryKpiCard label="Monte Carlo" value={kpis.monteCarlo} />
        <SummaryKpiCard
          label="Retire"
          value={`Age ${kpis.retirementAge}`}
          delta={String(kpis.retirementYear)}
        />
        <SummaryKpiCard label="Total Spend" value={fmtUsd(kpis.totalSpend)} />
        <SummaryKpiCard label="Liquid — Now" value={fmtUsd(liquid.now)} />
        <SummaryKpiCard label="Liquid — Retire" value={fmtUsd(liquid.retirement)} />
        <SummaryKpiCard label="Liquid — End" value={fmtUsd(liquid.endOfLife)} />
      </SummaryKpiRow>

      {/* Portfolio trajectory chart */}
      <SummarySection heading="Portfolio assets over time">
        <div className="rounded-lg border border-hair bg-card-2 p-4">
          <PortfolioTrajectoryChart bars={bars} />
        </div>
      </SummarySection>

      {/* Assets at retirement: by type + by tax type */}
      <SummarySection heading={`Assets at retirement (${kpis.retirementYear})`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">By type</div>
            <SplitBar segments={byTypeSegments} total={byType.total} />
          </div>
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">By tax type</div>
            <SplitBar segments={byTaxTypeSegments} total={byTaxType.total} />
          </div>
        </div>
      </SummarySection>

      {/* Narrative (page 1 takeaways) */}
      {narrative.length > 0 ? (
        <div className="rounded-lg border border-hair bg-card-2 px-4 py-3 text-[13px] text-ink-3">
          <span className="font-semibold text-ink">Takeaways. </span>
          <ul className="mt-1 flex flex-col gap-1">
            {narrative.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ) : null}

      {/* ── Section 2: Income, Spending & Funding (mirrors PDF page 2) ── */}

      <div className="mt-2 border-t border-hair pt-4">
        <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Income, Spending &amp; Funding
        </h3>
      </div>

      {/* Cash flow in retirement */}
      <SummarySection heading="Cash flow in retirement">
        <div className="rounded-lg border border-hair bg-card-2 p-4">
          <ChartSpecRenderer spec={cashFlowChartSpec} />
        </div>
      </SummarySection>

      {/* Funding breakdown */}
      {fundingRows.length > 0 ? (
        <SummarySection
          heading={`How retirement is funded (${kpis.retirementYear}–${bars[bars.length - 1]?.year ?? kpis.retirementYear})`}
        >
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <SplitBar segments={fundingSegments} total={funding.totalSpending} />
            <div className="mt-3 border-t border-hair pt-3">
              <SummaryTable
                columns={[
                  { key: "label", header: "Source" },
                  { key: "value", header: "Lifetime amount", align: "right" },
                ]}
                rows={[
                  ...fundingRows.map((r) => ({ label: r.label, value: fmtUsd(r.value) })),
                  {
                    label: <span className="font-semibold text-ink">Total cost of retirement</span>,
                    value: <span className="font-semibold text-ink tabular-nums">{fmtUsd(funding.totalSpending)}</span>,
                  },
                  ...(funding.shortfall > 0
                    ? [{ label: <span className="text-crit">Shortfall (unfunded)</span>, value: <span className="tabular-nums text-crit">{fmtUsd(funding.shortfall)}</span> }]
                    : []),
                ]}
              />
            </div>
          </div>
        </SummarySection>
      ) : null}

      {/* Social Security + Spending + Income — three-pane grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Social Security */}
        {hasSs ? (
          <SummarySection heading="Social Security">
            <div className="rounded-lg border border-hair bg-card-2 p-4">
              <div className={`flex flex-col gap-4 ${data.isMarried ? "sm:flex-row" : ""}`}>
                {socialSecurity.client ? <div className="flex-1"><SsColumn c={socialSecurity.client} /></div> : null}
                {socialSecurity.spouse ? <div className="flex-1"><SsColumn c={socialSecurity.spouse} /></div> : null}
              </div>
              {!socialSecurity.client?.alreadyClaiming || !socialSecurity.spouse?.alreadyClaiming ? (
                <p className="mt-2 text-[11px] text-ink-3">
                  Highlighted row = the age the plan has them claiming. Amounts in today&apos;s dollars.
                </p>
              ) : null}
            </div>
          </SummarySection>
        ) : null}

        {/* Retirement spending */}
        <SummarySection heading="Retirement spending">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <SummaryTable
              columns={[
                { key: "label", header: "Expense" },
                { key: "value", header: "Amount", align: "right" },
              ]}
              rows={[
                { label: "Living — today", value: fmtUsd(living.today) },
                { label: "Living — at retirement", value: fmtUsd(living.retirement) },
                ...(otherExpenses.insurance > 0 ? [{ label: "Insurance", value: fmtUsd(otherExpenses.insurance) }] : []),
                ...(otherExpenses.realEstate > 0 ? [{ label: "Property tax", value: fmtUsd(otherExpenses.realEstate) }] : []),
                ...(otherExpenses.liabilities > 0 ? [{ label: "Debt service", value: fmtUsd(otherExpenses.liabilities) }] : []),
                ...(otherExpenses.other > 0 ? [{ label: "Other", value: fmtUsd(otherExpenses.other) }] : []),
              ]}
            />
          </div>
        </SummarySection>

        {/* Income in retirement + asset transactions */}
        <SummarySection heading="Income in retirement">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            {income.length > 0 ? (
              <SummaryTable
                columns={[
                  { key: "label", header: "Source" },
                  { key: "amount", header: "Annual amount", align: "right" },
                ]}
                rows={income.map((r) => ({ label: r.label, amount: fmtUsd(r.amount) }))}
              />
            ) : (
              <p className="text-[12px] text-ink-3">No income streams continue past retirement.</p>
            )}

            {transactions.length > 0 ? (
              <div className="mt-4">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Asset transactions
                </div>
                <SummaryTable
                  columns={[
                    { key: "label", header: "Transaction" },
                    { key: "amount", header: "Amount", align: "right" },
                  ]}
                  rows={transactions.map((t) => ({
                    label: `${t.year} · ${t.kind === "sale" ? "Sell" : "Buy"} ${t.name}`,
                    amount: fmtUsd(t.amount),
                  }))}
                />
              </div>
            ) : null}
          </div>
        </SummarySection>

      </div>

    </SummaryLayout>
  );
}
