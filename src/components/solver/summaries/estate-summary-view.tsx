"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type {
  EstateSummaryPageData,
  EstateSummaryChartBar,
} from "@/lib/presentations/pages/estate-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/estate-summary/aggregate";
import type { EstateSummaryDeathRow } from "@/lib/presentations/pages/estate-summary/aggregate";
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Stacked "where the estate goes" chart ──────────────────────────────────────
// One stack per scenario bar (Today vs. End of Life); segments mirror the PDF
// chart's six components. netToHeirs/federal use semantic status hues (good/crit);
// the rest draw on the Deep Jewel data palette.
interface ChartSegment {
  key: keyof Pick<
    EstateSummaryChartBar,
    "netToHeirs" | "federal" | "state" | "probate" | "ird" | "debts"
  >;
  label: string;
}
const CHART_SEGMENTS: ChartSegment[] = [
  { key: "netToHeirs", label: "Net to heirs" },
  { key: "federal", label: "Federal" },
  { key: "state", label: "State" },
  { key: "probate", label: "Probate/admin" },
  { key: "ird", label: "IRD" },
  { key: "debts", label: "Debts" },
];

function segmentColors(theme: ReturnType<typeof useThemeName>): Record<ChartSegment["key"], string> {
  const palette = dataPalette(theme);
  const status = statusColors(theme);
  return {
    netToHeirs: status.good,
    federal: status.crit,
    state: palette.blue,
    probate: palette.grey,
    ird: palette.orange,
    debts: palette.purple,
  };
}

function EstateSummaryChart({ bars }: { bars: EstateSummaryChartBar[] }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (bars.length === 0) return null;
    const colors = segmentColors(theme);
    return {
      labels: bars.map((b) => b.label),
      datasets: CHART_SEGMENTS.map((seg) => ({
        label: seg.label,
        data: bars.map((b) => b[seg.key]),
        backgroundColor: colors[seg.key],
        stack: "estate",
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
  }, [theme]);

  if (!chartData) return null;
  return (
    <div className="h-[280px]">
      <Bar data={chartData} options={options} />
    </div>
  );
}

// ── Per-death-event table ──────────────────────────────────────────────────────
// Mirrors the PDF's grouped "By death event (Form 706)" table; rendered here as
// two SummaryTables (Today / End of Life) so each keeps its own header.
function deathRowData(rows: EstateSummaryDeathRow[]) {
  return rows.map((r) => ({
    event: `${r.label} · ${r.decedentName}, ${r.year}`,
    gross: fmtUsd(r.grossEstate),
    federal: fmtUsd(r.federal),
    state: fmtUsd(r.state),
    probate: fmtUsd(r.probate),
    ird: fmtUsd(r.ird),
    net: fmtUsd(r.netAfterTax),
  }));
}

const DEATH_COLUMNS = [
  { key: "event", header: "By death event (Form 706)" },
  { key: "gross", header: "Gross", align: "right" as const },
  { key: "federal", header: "Federal", align: "right" as const },
  { key: "state", header: "State", align: "right" as const },
  { key: "probate", header: "Probate", align: "right" as const },
  { key: "ird", header: "IRD", align: "right" as const },
  { key: "net", header: "Net", align: "right" as const },
];

const DEATH_NOTE =
  "Gross is each decedent's Form 706 chargeable estate (e.g. ~50% of jointly-titled assets at the first death) — a different basis than the headline Gross Estate, so these need not sum to it.";

const HEIR_NOTE =
  "“Today” = household dies now (after both deaths). “End of Life” = each spouse's projected death year. Surviving-spouse pass-through is excluded; amounts are net of taxes & costs.";

// ── View ────────────────────────────────────────────────────────────────────────
export function EstateSummaryView({ data }: { data: EstateSummaryPageData }) {
  if (data.isEmpty) {
    return <SummaryEmpty message="No data for this scenario yet." />;
  }

  const { kpis, chart, todayRows, eolRows, heirs } = data;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      {/* KPI strip — End-of-Life headline value with Today as the sub-line. */}
      <SummaryKpiRow>
        <SummaryKpiCard
          label="Gross Estate · EOL"
          value={fmtUsd(kpis.grossEstateEol)}
          delta={`Today: ${fmtUsd(kpis.grossEstateToday)}`}
        />
        <SummaryKpiCard
          label="Total Tax & Costs · EOL"
          value={fmtUsd(kpis.taxAndCostsEol)}
          delta={`Today: ${fmtUsd(kpis.taxAndCostsToday)}`}
        />
        <SummaryKpiCard
          label="Net to Heirs · EOL"
          value={fmtUsd(kpis.netToHeirsEol)}
          delta={`Today: ${fmtUsd(kpis.netToHeirsToday)}`}
        />
        <SummaryKpiCard
          label="Estate Shrinkage · EOL"
          value={fmtPct(kpis.shrinkageEol)}
          delta={`Today: ${fmtPct(kpis.shrinkageToday)}`}
        />
      </SummaryKpiRow>

      {/* Two-column body: chart + death-event tables (left), heir distributions (right) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[56fr_44fr]">
        <SummarySection heading="Estate today vs. end of life — where it goes">
          <div className="rounded-lg border border-hair bg-card-2 p-4">
            <EstateSummaryChart bars={chart} />
          </div>

          <div className="mt-1 flex flex-col gap-3">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Today (if death occurred now)
              </p>
              <SummaryTable columns={DEATH_COLUMNS} rows={deathRowData(todayRows)} />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                End of life (projected death years)
              </p>
              <SummaryTable columns={DEATH_COLUMNS} rows={deathRowData(eolRows)} />
            </div>
            <p className="text-[11px] text-ink-3">{DEATH_NOTE}</p>
          </div>
        </SummarySection>

        <SummarySection heading="Distributions to heirs (net)">
          <SummaryTable
            columns={[
              { key: "heir", header: "Heir" },
              { key: "todayOutright", header: "Today · Outright", align: "right" },
              { key: "todayInTrust", header: "Today · In trust", align: "right" },
              { key: "eolOutright", header: "EOL · Outright", align: "right" },
              { key: "eolInTrust", header: "EOL · In trust", align: "right" },
            ]}
            rows={heirs.map((h) => ({
              heir: h.recipientLabel,
              todayOutright: h.todayOutright > 0 ? fmtUsd(h.todayOutright) : "—",
              todayInTrust: h.todayInTrust > 0 ? fmtUsd(h.todayInTrust) : "—",
              eolOutright: h.eolOutright > 0 ? fmtUsd(h.eolOutright) : "—",
              eolInTrust: h.eolInTrust > 0 ? fmtUsd(h.eolInTrust) : "—",
            }))}
          />
          <p className="text-[11px] text-ink-3">{HEIR_NOTE}</p>
        </SummarySection>
      </div>

      {/* Narrative — primitive, not hand-rolled. */}
      <SummaryNarrative items={data.narrative} />
    </SummaryLayout>
  );
}
