"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ChartDataset } from "chart.js";
import type { LifeInsuranceSummaryPageData, DecedentGap, DecedentRange, LiChart } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import { fmtUsd, POLICY_TYPE_LABEL, termExpiryLabel } from "@/lib/presentations/pages/life-insurance-summary/aggregate";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { chartChrome, dataPalette, statusColors, useThemeName } from "@/lib/chart-colors";
import {
  SummaryLayout,
  SummarySection,
  SummaryKpiRow,
  SummaryKpiCard,
  SummaryTable,
  SummaryNarrative,
  SummaryEmpty,
} from "./primitives";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

// Solver cap — display detection only; the engine saturates at this bound.
const CAP_LABEL = "exceeds $20M";

// ── Need-range card ───────────────────────────────────────────────────────────
// Static twin of the solver LI tab's RangeCard (li-need-range.tsx): additional
// need as straight-line → Monte Carlo range, itemized in-force coverage, total
// recommended. MC is always present here (the summary only solves once).
function RangeCard({ r }: { r: DecedentRange }) {
  const slValue =
    r.straightLine == null
      ? null
      : r.straightLine.exceedsCap
        ? CAP_LABEL
        : formatCurrency(r.straightLine.need);
  const mcValue = r.mc.exceedsCap ? CAP_LABEL : formatCurrency(r.mc.need);
  const totalDisplay =
    r.totalRecommended == null
      ? null
      : r.totalRecommended.low === r.totalRecommended.high
        ? formatCurrency(r.totalRecommended.high)
        : `${formatCurrency(r.totalRecommended.low)} – ${formatCurrency(r.totalRecommended.high)}`;

  return (
    <div className="flex-1 rounded-lg border border-hair bg-card-2 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        If {r.decedentLabel} dies in {r.deathYear}
      </div>

      <div className="mt-2 flex items-start gap-3">
        {slValue != null ? (
          <>
            <RangeFigure label="Straight-line" value={slValue} warn={r.straightLine!.exceedsCap} />
            <svg viewBox="0 0 24 12" className="mt-1.5 h-3 w-6 shrink-0 text-ink-3" fill="none" aria-hidden="true">
              <path d="M1 6h21m0 0-5-4m5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
        <RangeFigure label={`Monte Carlo · ${r.mc.achievedScorePct}%`} value={mcValue} warn={r.mc.exceedsCap} />
      </div>
      <div className="mt-2.5 text-[11px] text-ink-2">Additional life insurance needed</div>

      <div className="mt-3 border-t border-hair pt-2.5">
        {r.estateTaxAddend != null ? (
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="text-ink-2">Estate taxes</span>
            <span className="tabular text-ink-2">{formatCurrency(r.estateTaxAddend)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-ink-2">Existing coverage in force</span>
          <span className="tabular text-ink-2">{formatCurrency(r.existingTotal)}</span>
        </div>
        {r.existingPolicies.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-3">None in force in {r.deathYear}.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {r.existingPolicies.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center justify-between text-[11px] text-ink-2">
                <span>{p.name}</span>
                <span className="tabular">{formatCurrency(p.faceValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalDisplay != null ? (
        <div className="mt-2.5 flex items-center justify-between border-t border-hair pt-2.5 text-[12px]">
          <span className="font-medium text-ink-2">Total recommended coverage</span>
          <span className="tabular font-semibold text-ink">{totalDisplay}</span>
        </div>
      ) : null}
    </div>
  );
}

function RangeFigure({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className={`text-[22px] font-semibold leading-none tabular tracking-tight ${warn ? "text-warn" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">{label}</div>
    </div>
  );
}

// ── Gap helpers ───────────────────────────────────────────────────────────────
function gapLabel(g: DecedentGap): string {
  if (g.exceedsCap) return "Need exceeds $20M";
  if (g.gap.kind === "shortfall") return `Shortfall ${fmtUsd(g.gap.amount)}`;
  if (g.gap.kind === "surplus") return `Surplus ${fmtUsd(g.gap.amount)}`;
  return "Coverage meets need";
}

function gapIsDeficit(g: DecedentGap): boolean {
  return g.exceedsCap || g.gap.kind === "shortfall";
}

// ── Coverage-vs-need gap card ─────────────────────────────────────────────────
// Renders a two-bar "have vs need" visual with a result label.
function GapCard({ g, markYear }: { g: DecedentGap; markYear: number | null }) {
  const theme = useThemeName();
  const status = statusColors(theme);
  const need = Math.max(1, g.need);
  const havePct = Math.min(100, (g.have / need) * 100);
  const deficit = gapIsDeficit(g);
  const resultColor = deficit ? status.crit : status.good;

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-hair bg-card-2 p-4">
      <p className="text-[13px] font-semibold text-ink">
        {`If ${g.decedentLabel} dies${markYear ? ` (${markYear})` : ""}`}
      </p>

      {/* Have bar */}
      <div>
        <p className="mb-1 text-[11px] text-ink-3">{`Coverage  ${fmtUsd(g.have)}`}</p>
        <div className="h-2 overflow-hidden rounded-full bg-card">
          <div
            className="h-full rounded-full"
            style={{ width: `${havePct}%`, backgroundColor: deficit ? status.crit : status.good }}
          />
        </div>
      </div>

      {/* Need bar */}
      <div>
        <p className="mb-1 text-[11px] text-ink-3">{`Recommended  ${fmtUsd(g.need)}`}</p>
        <div className="h-2 overflow-hidden rounded-full bg-card">
          <div className="h-full w-full rounded-full bg-accent opacity-40" />
        </div>
      </div>

      {/* Result */}
      <p className="text-[13px] font-semibold" style={{ color: resultColor }}>
        {gapLabel(g)}
      </p>

      {g.hasJoint ? (
        <p className="text-[11px] text-ink-3">
          Joint-life policies excluded from per-life totals.
        </p>
      ) : null}
    </div>
  );
}

// ── Need-over-time line chart ─────────────────────────────────────────────────
// Renders client need + optional spouse need as lines, with horizontal
// reference lines for current coverage levels.
function LiNeedChart({ chart, married }: { chart: LiChart; married: boolean }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (chart.rows.length === 0) return null;
    const palette = dataPalette(theme);
    const status = statusColors(theme);

    const labels = chart.rows.map((r) => String(r.year));

    const datasets: ChartDataset<"line">[] = [
      {
        label: "Client need",
        data: chart.rows.map((r) => r.clientNeed),
        borderColor: palette.blue,
        backgroundColor: `${palette.blue}22`,
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
    ];

    if (married && chart.rows.some((r) => r.spouseNeed != null)) {
      datasets.push({
        label: "Spouse need",
        data: chart.rows.map((r) => r.spouseNeed ?? 0),
        borderColor: palette.teal,
        backgroundColor: `${palette.teal}22`,
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      });
    }

    // Client coverage horizontal reference line
    datasets.push({
      label: "Client coverage",
      data: chart.rows.map(() => chart.clientCoverageLine),
      borderColor: status.crit,
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });

    if (married && chart.spouseCoverageLine != null) {
      datasets.push({
        label: "Spouse coverage",
        data: chart.rows.map(() => chart.spouseCoverageLine!),
        borderColor: status.good,
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
      });
    }

    return { labels, datasets };
  }, [chart, married, theme]);

  const options = useMemo<ChartOptions<"line">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: chrome.legend, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtUsd(Number(ctx.parsed.y ?? 0))}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: chrome.tick },
          grid: { color: chrome.grid },
        },
        y: {
          ticks: {
            color: chrome.tick,
            callback: (v: unknown) => fmtUsd(Number(v)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);

  if (!chartData) return null;

  return (
    <div className="h-[280px]">
      <Line data={chartData} options={options} />
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────
export function LifeInsuranceSummaryView({ data }: { data: LifeInsuranceSummaryPageData }) {
  if (data.isEmpty) return <SummaryEmpty message="No data for this scenario yet." />;

  const hasGap = data.clientGap != null || data.spouseGap != null;
  const hasChart = !data.notSolved && data.chart.rows.length > 0;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      {/* ── Inventory KPI row ─────────────────────────────────────────────── */}
      <SummaryKpiRow>
        <SummaryKpiCard label="Policies" value={String(data.totals.count)} />
        <SummaryKpiCard
          label="Total death benefit"
          value={fmtUsd(data.totals.deathBenefit)}
        />
        <SummaryKpiCard label="Cash value" value={fmtUsd(data.totals.cashValue)} />
        <SummaryKpiCard label="Annual premium" value={fmtUsd(data.totals.premium)} />
      </SummaryKpiRow>

      {/* ── Policies table ────────────────────────────────────────────────── */}
      {data.policies.length > 0 ? (
        <SummarySection heading="All policies">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <SummaryTable
              columns={[
                { key: "name", header: "Policy" },
                { key: "type", header: "Type" },
                { key: "insured", header: "Insured" },
                { key: "benefit", header: "Death benefit", align: "right" },
                { key: "cashValue", header: "Cash value", align: "right" },
                { key: "premium", header: "Premium / yr", align: "right" },
                { key: "expiry", header: "Expires", align: "right" },
              ]}
              rows={data.policies.map((p) => ({
                name: p.name,
                type: POLICY_TYPE_LABEL[p.policyType],
                insured: p.insuredLabel,
                benefit: fmtUsd(p.deathBenefit),
                cashValue: fmtUsd(p.cashValue),
                premium: fmtUsd(p.premiumAmount),
                expiry: termExpiryLabel(p),
              }))}
            />
            {data.jointFootnote ? (
              <p className="mt-2 text-[11px] text-ink-3">
                Joint-life policies are listed but excluded from per-life coverage totals.
              </p>
            ) : null}
          </div>
        </SummarySection>
      ) : (
        <SummarySection heading="All policies">
          <p className="rounded-lg border border-hair bg-card-2 px-4 py-3 text-[13px] text-ink-3">
            No in-force life insurance policies on file.
          </p>
        </SummarySection>
      )}

      {/* ── Beneficiaries ─────────────────────────────────────────────────── */}
      {data.policies.some((p) => p.beneficiaries.length > 0) ? (
        <SummarySection heading="Beneficiaries">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            {data.policies.map((p) =>
              p.beneficiaries.length === 0 ? null : (
                <div key={p.accountId} className="mb-3 last:mb-0">
                  <p className="mb-1 text-[12px] font-semibold text-ink">{p.name}</p>
                  <SummaryTable
                    columns={[
                      { key: "name", header: "Beneficiary" },
                      { key: "tier", header: "Tier" },
                      { key: "pct", header: "Share", align: "right" },
                    ]}
                    rows={p.beneficiaries.map((b) => ({
                      name: b.name,
                      tier: b.tier === "primary" ? "Primary" : "Contingent",
                      pct: `${Math.round(b.percentage)}%`,
                    }))}
                  />
                </div>
              )
            )}
          </div>
        </SummarySection>
      ) : null}

      {/* ── Coverage vs. need section ─────────────────────────────────────── */}
      {data.notSolved ? (
        /* notSolved = true is the v1 default: show an intentional informational hint */
        <SummarySection heading="Coverage vs. need">
          <div className="flex items-start gap-3 rounded-lg border border-hair bg-card-2 px-4 py-3">
            <span className="mt-0.5 text-[13px] text-accent">→</span>
            <p className="text-[13px] text-ink-3">
              Run the solver to see coverage-vs-need.
            </p>
          </div>
        </SummarySection>
      ) : (
        /* notSolved = false: range cards + gap cards + optional need-over-time chart */
        <>
          {data.clientRange || data.spouseRange || hasGap ? (
            <SummarySection heading="Coverage vs. need">
              {data.clientRange || data.spouseRange ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  {data.clientRange ? <RangeCard r={data.clientRange} /> : null}
                  {data.spouseRange ? <RangeCard r={data.spouseRange} /> : null}
                </div>
              ) : null}
              {hasGap ? (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  {data.clientGap ? <GapCard g={data.clientGap} markYear={data.chart.markYear} /> : null}
                  {data.spouseGap ? <GapCard g={data.spouseGap} markYear={data.chart.markYear} /> : null}
                </div>
              ) : null}
            </SummarySection>
          ) : null}

          {hasChart ? (
            <SummarySection heading="Life insurance need over time">
              <div className="rounded-lg border border-hair bg-card-2 p-4">
                <LiNeedChart chart={data.chart} married={data.married} />
              </div>
            </SummarySection>
          ) : null}
        </>
      )}

      {/* ── Narrative ─────────────────────────────────────────────────────── */}
      <SummaryNarrative items={data.narrative} />
    </SummaryLayout>
  );
}
